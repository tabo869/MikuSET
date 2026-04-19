import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import Note from './Note';
import { useMusicPlayer } from '../hooks/useMusicPlayer';
import { useGameState } from '../hooks/useGameState';
import type { NoteData } from '../types/note';
import { DIFFICULTIES } from '../config/difficulty';
import type { BothHandsDataRef } from '../types/hand';

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const DEFAULT_SPAWN_AHEAD_MS = 2000;

/** 同時にアクティブにできるノーツの最大数（パフォーマンス保護） */
const MAX_ACTIVE_NOTES = 30;

/**
 * マージユーティリティ: 複数の word/char を mergeCount 個ずつまとめて 1 ノーツに結合する
 * sourceStartTimes: マージ元のすべてのstartTimeを保持（歌詞ハイライト用）
 */
interface MergedUnit {
  text: string;
  startTime: number;
  endTime: number;
  sourceStartTimes: number[];
}

function mergeUnits(
  units: { text: string; startTime: number; endTime: number }[],
  mergeCount: number,
): MergedUnit[] {
  if (mergeCount <= 1) {
    return units.map(u => ({ ...u, sourceStartTimes: [u.startTime] }));
  }
  const merged: MergedUnit[] = [];
  for (let i = 0; i < units.length; i += mergeCount) {
    const slice = units.slice(i, i + mergeCount);
    merged.push({
      text: slice.map((s) => s.text).join(''),
      startTime: slice[0].startTime,
      endTime: slice[slice.length - 1].endTime,
      sourceStartTimes: slice.map(s => s.startTime),
    });
  }
  return merged;
}

// 左手（鏡合わせ）の指揮パターン (3x3 グリッド座標に完全準拠)
// X: Left=-3.5, Center=-2.0, Right=-0.5
// Y: Top=2.0, Middle=0.0, Bottom=-2.0
const CONDUCTOR_PATTERN_LEFT: { x: number; y: number }[] = [
  { x: -2.0, y: -2.0 }, // ↓ ダウン (Center, Bottom)
  { x: -0.5, y:  0.0 }, // → イン (Right, Middle)
  { x: -3.5, y:  0.0 }, // ← アウト (Left, Middle)
  { x: -2.0, y:  2.0 }, // ↑ アップ (Center, Top)
  
  { x: -2.0, y: -2.0 }, // (Center, Bottom)
  { x: -3.5, y: -2.0 }, // (Left, Bottom)
  { x: -0.5, y:  2.0 }, // (Right, Top)
  { x: -2.0, y:  2.0 }, // (Center, Top)

  { x: -0.5, y:  0.0 }, // (Right, Middle)
  { x: -2.0, y:  2.0 }, // (Center, Top)
  { x: -3.5, y:  0.0 }, // (Left, Middle)
  { x: -2.0, y: -2.0 }, // (Center, Bottom)
  { x: -0.5, y:  0.0 }, // (Right, Middle)
  { x: -2.0, y:  2.0 }, // (Center, Top)
  { x: -3.5, y:  0.0 }, // (Left, Middle)
  { x: -2.0, y: -2.0 }, // (Center, Bottom)
];

// 右手の指揮パターン (3x3 グリッド座標に完全準拠)
// X: Left=0.5, Center=2.0, Right=3.5
// Y: Top=2.0, Middle=0.0, Bottom=-2.0
const CONDUCTOR_PATTERN_RIGHT: { x: number; y: number }[] = [
  { x:  2.0, y: -2.0 }, // ↓ ダウン (Center, Bottom)
  { x:  0.5, y:  0.0 }, // ← イン (Left, Middle)
  { x:  3.5, y:  0.0 }, // → アウト (Right, Middle)
  { x:  2.0, y:  2.0 }, // ↑ アップ (Center, Top)
  
  { x:  2.0, y: -2.0 }, // (Center, Bottom)
  { x:  3.5, y: -2.0 }, // (Right, Bottom)
  { x:  0.5, y:  2.0 }, // (Left, Top)
  { x:  2.0, y:  2.0 }, // (Center, Top)

  { x:  0.5, y:  0.0 }, // (Left, Middle)
  { x:  2.0, y:  2.0 }, // (Center, Top)
  { x:  3.5, y:  0.0 }, // (Right, Middle)
  { x:  2.0, y: -2.0 }, // (Center, Bottom)
  { x:  0.5, y:  0.0 }, // (Left, Middle)
  { x:  2.0, y:  2.0 }, // (Center, Top)
  { x:  3.5, y:  0.0 }, // (Right, Middle)
  { x:  2.0, y: -2.0 }, // (Center, Bottom)
];

function createStarShape() {
  const shape = new THREE.Shape();
  const outerRadius = 0.4;
  const innerRadius = 0.15;
  const spikes = 5;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  return shape;
}

// ---------------------------------------------------------------------------
// サブコンポーネント: タイミング・ガイドスター
// ---------------------------------------------------------------------------

function TimingStar({
  hand,
  wordsRef,
  positionRef,
}: {
  hand: 'left' | 'right';
  wordsRef: React.RefObject<{ text: string; startTime: number; endTime: number }[]>;
  positionRef: React.RefObject<number>;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const lineRef = useRef<any>(null!); // Line2
  const starShape = useMemo(() => createStarShape(), []);
  
  const pattern = hand === 'left' ? CONDUCTOR_PATTERN_LEFT : CONDUCTOR_PATTERN_RIGHT;
  const color = hand === 'left' ? '#66aaff' : '#ff66aa';

  const lastIndexCache = useRef(0);
  const linePoints = useRef<number[]>([]);

  useFrame((state) => {
    const now = positionRef.current;
    const words = wordsRef.current;
    if (!meshRef.current || now <= 0 || !words || words.length === 0) {
      if (meshRef.current) meshRef.current.visible = false;
      if (lineRef.current) lineRef.current.visible = false;
      return;
    }

    // 楽曲の変更等で配列が短くなった場合に対応するため、上限をクランプする
    let targetIndex = Math.min(lastIndexCache.current, words.length);
    
    while (targetIndex < words.length && words[targetIndex].startTime <= now) {
      targetIndex++;
    }
    while (targetIndex > 0 && words[targetIndex - 1].startTime > now) {
      targetIndex--;
    }
    lastIndexCache.current = targetIndex;

    if (targetIndex >= words.length) {
      meshRef.current.visible = false;
      if (lineRef.current) lineRef.current.visible = false;
      return;
    }

    meshRef.current.visible = true;
    meshRef.current.rotation.z = state.clock.elapsedTime * 2;

    const nextIdx = targetIndex;
    const nextWord = words[nextIdx];
    const nextPos = pattern[nextIdx % pattern.length];
    
    let currentStarPos = new THREE.Vector3();

    if (nextIdx === 0) {
      const spawnTime = nextWord.startTime - DEFAULT_SPAWN_AHEAD_MS;
      if (now < spawnTime) {
        const material = meshRef.current.material as THREE.MeshStandardMaterial;
        material.opacity = 0;
      } else {
        const p = (now - spawnTime) / DEFAULT_SPAWN_AHEAD_MS;
        const smoothP = p * p * (3 - 2 * p);
        currentStarPos.set(
          0 + (nextPos.x - 0) * smoothP,
          0 + (nextPos.y - 0) * smoothP,
          0
        );
        const material = meshRef.current.material as THREE.MeshStandardMaterial;
        material.opacity = p;
      }
    } else {
      const prevIdx = targetIndex - 1;
      const prevWord = words[prevIdx];
      const prevPos = pattern[prevIdx % pattern.length];

      const timeToNext = nextWord.startTime - now;
      if (timeToNext > DEFAULT_SPAWN_AHEAD_MS) {
         currentStarPos.set(prevPos.x, prevPos.y, 0);
      } else {
         const moveDuration = Math.min(nextWord.startTime - prevWord.startTime, DEFAULT_SPAWN_AHEAD_MS);
         const moveStartTime = nextWord.startTime - moveDuration;
         
         if (now < moveStartTime) {
           currentStarPos.set(prevPos.x, prevPos.y, 0);
         } else {
           const p = (now - moveStartTime) / moveDuration;
           const smoothP = p * p * (3 - 2 * p); 
           currentStarPos.set(
             prevPos.x + (nextPos.x - prevPos.x) * smoothP,
             prevPos.y + (nextPos.y - prevPos.y) * smoothP,
             0
           );
         }
      }
    }
    
    meshRef.current.position.copy(currentStarPos);

    linePoints.current = [currentStarPos.x, currentStarPos.y, 0];
    for (let i = 0; i < 3; i++) {
        if (targetIndex + i < words.length) {
            const pos = pattern[(targetIndex + i) % pattern.length];
            linePoints.current.push(pos.x, pos.y, 0);
        }
    }

    if (lineRef.current) {
        lineRef.current.visible = true;
        lineRef.current.geometry.setPositions(linePoints.current);
    }
  });

  return (
    <group>
      <Line
        ref={lineRef}
        points={[[0,0,0], [0,0,0]]}
        color={color}
        opacity={0.35}
        transparent
        dashed
        dashSize={0.2}
        dashScale={1.5}
        gapSize={0.1}
        lineWidth={3}
      />
      <mesh ref={meshRef} visible={false}>
        <shapeGeometry args={[starShape]} />
        <meshStandardMaterial 
          color="#ffffff" 
          emissive={color} 
          emissiveIntensity={4} 
          transparent
          opacity={1}
          side={THREE.DoubleSide} 
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// メインコンポーネント: NoteManager
// ---------------------------------------------------------------------------

interface NoteManagerProps {
  handsDataRef: BothHandsDataRef;
}

export default function NoteManager({ handsDataRef }: NoteManagerProps) {
  const { state, positionRef } = useMusicPlayer();
  const { stateRef: gameStateRef, actions: gameActions } = useGameState();

  const [activeNotes, setActiveNotes] = useState<NoteData[]>([]);
  // handleHit/handleMiss内でactiveNotesを参照するためのRef
  // ※ useCallbackの依存配列にactiveNotesを含めると全ノーツが毎フレーム再レンダリングされるため
  const activeNotesRef = useRef<NoteData[]>([]);
  activeNotesRef.current = activeNotes;

  // 左右それぞれに振り分けた歌詞リスト
  const leftWordsRef = useRef<{ text: string; startTime: number; endTime: number }[]>([]);
  const rightWordsRef = useRef<{ text: string; startTime: number; endTime: number }[]>([]);

  const nextIndexLeftRef = useRef(0);
  const nextIndexRightRef = useRef(0);
  const wordsInitializedRef = useRef(false);

  // ヒットした単語IDのグローバルSet (PhraseDisplayが参照する)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hitWordIdsRef = useRef<Set<string>>(new Set());
  (window as unknown as Record<string, unknown>).__mikusetHitWordIds = hitWordIdsRef.current;

  // 曲が切り替わったとき (isVideoReady == false になったとき) に内部ステートをリセットする
  useEffect(() => {
    if (!state.isVideoReady) {
      wordsInitializedRef.current = false;
      leftWordsRef.current = [];
      rightWordsRef.current = [];
      nextIndexLeftRef.current = 0;
      nextIndexRightRef.current = 0;
      hitWordIdsRef.current.clear(); // ★ 曲変更時にヒット済みリストをクリア
      setActiveNotes([]);
      setTimeout(() => {
        document.querySelectorAll('.mikuset-note-html-orphaned-guard').forEach(el => {
          const wrapper = el.closest('div[style*="absolute"]') as HTMLElement;
          if (wrapper) wrapper.style.display = 'none';
          else (el as HTMLElement).style.display = 'none';
        });
      }, 100);
      console.log('[NoteManager] 楽曲の変更を検知。ノーツ状態をリセットしました。');
    }
  }, [state.isVideoReady]);

  // 再生開始時/停止時にノーツを強制再初期化・クリアする
  useEffect(() => {
    if (state.isPlaying) {
      wordsInitializedRef.current = false;
      nextIndexLeftRef.current = 0;
      nextIndexRightRef.current = 0;
      setActiveNotes([]);
      hitWordIdsRef.current.clear();
      setTimeout(() => {
        document.querySelectorAll('.mikuset-note-html-orphaned-guard').forEach(el => {
          const wrapper = el.closest('div[style*="absolute"]') as HTMLElement;
          if (wrapper) wrapper.style.display = 'none';
          else (el as HTMLElement).style.display = 'none';
        });
      }, 100);
      console.log('[NoteManager] 再生開始を検知。ノーツ状態を強制リセットしました。');
    } else {
      // 停止時（曲終了・STOP時）に残っているノーツとエフェクトを即座に消去
      setActiveNotes([]);
      hitWordIdsRef.current.clear();
      setTimeout(() => {
        document.querySelectorAll('.mikuset-note-html-orphaned-guard').forEach(el => {
          const wrapper = el.closest('div[style*="absolute"]') as HTMLElement;
          if (wrapper) wrapper.style.display = 'none';
          else (el as HTMLElement).style.display = 'none';
        });
      }, 100);
      console.log('[NoteManager] 再生停止を検知。画面上のノーツをクリアしました。');
    }
  }, [state.isPlaying]);

  useFrame(() => {
    // 楽曲データが準備完了し、再生中で、かつノーツリストが未構築の場合のみ構築する
    // ※ state.isPlaying のチェックが無いと、一時停止中に初期化→リセットが
    //   毎フレーム繰り返されて不安定になる
    if (!wordsInitializedRef.current && state.isVideoReady && state.isPlaying) {
      // --- 難易度に応じたtextUnit/mergeCountで元データを取得・マージ ---
      const gs = gameStateRef.current;
      const diffCfg = DIFFICULTIES[gs.currentDifficulty];

      let rawUnits: { text: string; startTime: number; endTime: number }[] | undefined;
      if (diffCfg.textUnit === 'char') {
        rawUnits = (window as unknown as Record<string, unknown>).__mikusetChars as typeof rawUnits;
      }
      // charデータ無しの場合、またはword単位の場合はword配列を使用
      if (!rawUnits || rawUnits.length === 0) {
        rawUnits = (window as unknown as Record<string, unknown>).__mikusetWords as typeof rawUnits;
      }

      if (rawUnits && rawUnits.length > 0) {
        // マージ処理 (Easy: 3個まとめ等)
        const units = mergeUnits(rawUnits, diffCfg.mergeCount);

        // ノーツを左右交互に振り分ける
        const leftArr: typeof units = [];
        const rightArr: typeof units = [];
        units.forEach((w, i) => {
          if (i % 2 === 0) {
            rightArr.push(w);
          } else {
            leftArr.push(w);
          }
        });
        leftWordsRef.current = leftArr;
        rightWordsRef.current = rightArr;

        // シーク再生対応：現在の再生位置より前のWordは既にスキップ済みとしてインデックスを初期化
        const now = positionRef.current;
        let li = 0, ri = 0;
        // 既に終わった（endTimeが過ぎた）ノーツだけをスキップする
        while (li < leftArr.length && leftArr[li].endTime < now) li++;
        while (ri < rightArr.length && rightArr[ri].endTime < now) ri++;
        nextIndexLeftRef.current = li;
        nextIndexRightRef.current = ri;

        wordsInitializedRef.current = true;
        console.log(`[NoteManager] 難易度=${gs.currentDifficulty} (${diffCfg.textUnit}×merge${diffCfg.mergeCount}) → 右手用 ${rightArr.length} 個、左手用 ${leftArr.length} 個に分割。再生位置 ${Math.round(now / 1000)}s からインデックス開始 (L=${li}, R=${ri})`);
      }
      return;
    }

    // 再生中でなければ何もしない（一時停止中のフレームで状態を壊さない）
    if (!state.isPlaying) return;

    // ラグオフセットを加味した現在時刻
    const rawNow = positionRef.current;
    const offsetMs = gameStateRef.current.globalOffsetMs;
    const now = rawNow + offsetMs;
    if (rawNow <= 0) {
      // 再生位置が0以下ならノーツ生成はスキップ（再生開始直後の過渡期）
      return;
    }

    // ★ ステージクリア後（リザルト画面表示中）は動画再生の自動ループに巻き込まれないように処理をブロック
    if (gameStateRef.current.isCleared) {
      return;
    }

    // 難易度パラメータ（ノーツ生成時に注入する物理値）
    const diffCfg = DIFFICULTIES[gameStateRef.current.currentDifficulty];
    const SPAWN_AHEAD_MS = diffCfg.speed;

    // 再生状態でのシーク・巻き戻しを検知してインデックスを回復する
    const prevL = leftWordsRef.current[nextIndexLeftRef.current - 1];
    const prevR = rightWordsRef.current[nextIndexRightRef.current - 1];
    if (
      (prevL && prevL.startTime > now + 3000) || 
      (prevR && prevR.startTime > now + 3000)
    ) {
      console.log('[NoteManager] リトライ/巻き戻しを検知。インデックスをリセットします。');
      wordsInitializedRef.current = false;
      setActiveNotes([]);
      hitWordIdsRef.current.clear();
      return;
    }
    
    const newNotesBatch: NoteData[] = [];

    // 左手用ノーツの生成判定
    while (nextIndexLeftRef.current < leftWordsRef.current.length) {
      const idx = nextIndexLeftRef.current;
      const word = leftWordsRef.current[idx];
      const spawnTime = word.startTime - SPAWN_AHEAD_MS;

      if (now >= spawnTime) {
        const ringPosLeft = CONDUCTOR_PATTERN_LEFT[idx % CONDUCTOR_PATTERN_LEFT.length];
        const leftNote: NoteData = {
          id: `note-left-${word.startTime}-${word.text}`,
          hand: 'left',
          text: word.text,
          startTime: word.startTime,
          endTime: word.endTime,
          spawnTime,
          hit: false,
          missed: false,
          targetX: Math.max(-4.5, Math.min(4.5, ringPosLeft.x)),
          targetY: ringPosLeft.y,
          originX: 0, 
          originY: 0,
          ringColor: '#66aaff',
          speed: diffCfg.speed,
          hitboxRadius: diffCfg.hitboxRadius,
          magnetPower: diffCfg.magnetPower,
          timingWindow: diffCfg.timingWindow,
          sourceStartTimes: word.sourceStartTimes,
        };
        newNotesBatch.push(leftNote);
        nextIndexLeftRef.current += 1;
      } else {
        break; // 以降のノーツもまだ出現時間ではない
      }
    }

    // 右手用ノーツの生成判定
    while (nextIndexRightRef.current < rightWordsRef.current.length) {
      const idx = nextIndexRightRef.current;
      const word = rightWordsRef.current[idx];
      const spawnTime = word.startTime - SPAWN_AHEAD_MS;

      if (now >= spawnTime) {
        const ringPosRight = CONDUCTOR_PATTERN_RIGHT[idx % CONDUCTOR_PATTERN_RIGHT.length];
        const rightNote: NoteData = {
          id: `note-right-${word.startTime}-${word.text}`,
          hand: 'right',
          text: word.text,
          startTime: word.startTime,
          endTime: word.endTime,
          spawnTime,
          hit: false,
          missed: false,
          targetX: Math.max(-4.5, Math.min(4.5, ringPosRight.x)),
          targetY: ringPosRight.y,
          originX: 0,
          originY: 0,
          ringColor: '#ff66aa',
          speed: diffCfg.speed,
          hitboxRadius: diffCfg.hitboxRadius,
          magnetPower: diffCfg.magnetPower,
          timingWindow: diffCfg.timingWindow,
          sourceStartTimes: word.sourceStartTimes,
        };
        newNotesBatch.push(rightNote);
        nextIndexRightRef.current += 1;
      } else {
        break; // 以降のノーツもまだ出現時間ではない
      }
    }

    if (newNotesBatch.length > 0) {
      setActiveNotes((prev) => {
        const combined = [...prev, ...newNotesBatch];
        // パフォーマンス保護: 難易度に応じた最大アクティブノーツ数
        const diffCfgCurrent = DIFFICULTIES[gameStateRef.current.currentDifficulty];
        const maxNotes = diffCfgCurrent.textUnit === 'char' ? 20 : MAX_ACTIVE_NOTES;
        if (combined.length > maxNotes) {
          return combined.slice(combined.length - maxNotes);
        }
        return combined;
      });
    }
  });

  const handleHit = useCallback((id: string, _hand: 'left'|'right') => {
    gameActions.onHit();
    const startTimeMatch = id.match(/note-(?:left|right)-(\d+)-/);
    if (startTimeMatch) {
      const noteStartTime = parseInt(startTimeMatch[1], 10);
      hitWordIdsRef.current.add(String(noteStartTime));

      // マージされたノーツの場合、元のソースWord全てのstartTimeも登録する
      const hitNote = activeNotesRef.current.find(n => n.id === id);
      if (hitNote?.sourceStartTimes) {
        hitNote.sourceStartTimes.forEach(st => hitWordIdsRef.current.add(String(st)));
      }
    }
    setActiveNotes((prev) => prev.map((n) => (n.id === id ? { ...n, hit: true } : n)));
    setTimeout(() => setActiveNotes((prev) => prev.filter((n) => n.id !== id)), 600);
  }, [gameActions]);

  const handleMiss = useCallback((id: string, _hand: 'left'|'right') => {
    gameActions.onMiss();
    setActiveNotes((prev) => prev.map((n) => (n.id === id ? { ...n, missed: true } : n)));
    // ミスアニメーション後に除去（短縮: 800→400ms）
    setTimeout(() => setActiveNotes((prev) => prev.filter((n) => n.id !== id)), 400);
  }, [gameActions]);

  return (
    <>
      {/* 左右独立したタイミングスター */}
      <TimingStar hand="left" wordsRef={leftWordsRef} positionRef={positionRef} />
      <TimingStar hand="right" wordsRef={rightWordsRef} positionRef={positionRef} />

      {activeNotes.map((note) => (
        <Note
          key={note.id}
          note={note}
          positionRef={positionRef}
          handsDataRef={handsDataRef}
          onHit={handleHit}
          onMiss={handleMiss}
          isAutoPlayMode={state.isAutoPlayMode}
        />
      ))}
    </>
  );
}
