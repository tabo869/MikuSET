import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import Note from './Note';
import { useMusicPlayer } from '../hooks/useMusicPlayer';
import { useGameState } from '../hooks/useGameState';
import type { NoteData } from '../types/note';
import type { BothHandsDataRef } from '../types/hand';

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const SPAWN_AHEAD_MS = 2000;

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
      const spawnTime = nextWord.startTime - SPAWN_AHEAD_MS;
      if (now < spawnTime) {
        const material = meshRef.current.material as THREE.MeshStandardMaterial;
        material.opacity = 0;
      } else {
        const p = (now - spawnTime) / SPAWN_AHEAD_MS;
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
      if (timeToNext > SPAWN_AHEAD_MS) {
         currentStarPos.set(prevPos.x, prevPos.y, 0);
      } else {
         const moveDuration = Math.min(nextWord.startTime - prevWord.startTime, SPAWN_AHEAD_MS);
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
  const { actions: gameActions } = useGameState();

  const [activeNotes, setActiveNotes] = useState<NoteData[]>([]);

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
      console.log('[NoteManager] 楽曲の変更を検知。ノーツ状態をリセットしました。');
    }
  }, [state.isVideoReady]);

  useFrame(() => {
    // 楽曲データが準備完了し、かつノーツリストが未構築の場合のみ構築する
    if (!wordsInitializedRef.current && state.isVideoReady) {
      const words = (window as unknown as Record<string, unknown>).__mikusetWords as
        | { text: string; startTime: number; endTime: number }[]
        | undefined;
      if (words && words.length > 0) {
        // ノーツを左右交互に振り分ける
        const leftArr: typeof words = [];
        const rightArr: typeof words = [];
        words.forEach((w, i) => {
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
        console.log(`[NoteManager] 右手用 ${rightArr.length} 個、左手用 ${leftArr.length} 個に分割。再生位置 ${Math.round(now / 1000)}s からインデックス開始 (L=${li}, R=${ri})`);
      }
      return;
    }

    const now = positionRef.current;
    if (now <= 0) {
      if (nextIndexLeftRef.current > 0 || nextIndexRightRef.current > 0) {
        // 曲がリセットされて最初に戻った場合
        wordsInitializedRef.current = false;
        setActiveNotes([]);
        hitWordIdsRef.current.clear();
      }
      return;
    }

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
          targetX: ringPosLeft.x,
          targetY: ringPosLeft.y,
          originX: 0, 
          originY: 0,
          ringColor: '#66aaff',
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
          targetX: ringPosRight.x,
          targetY: ringPosRight.y,
          originX: 0,
          originY: 0,
          ringColor: '#ff66aa',
        };
        newNotesBatch.push(rightNote);
        nextIndexRightRef.current += 1;
      } else {
        break; // 以降のノーツもまだ出現時間ではない
      }
    }

    if (newNotesBatch.length > 0) {
      setActiveNotes((prev) => [...prev, ...newNotesBatch]);
    }
  });

  const handleHit = useCallback((id: string, _hand: 'left'|'right') => {
    gameActions.onHit();
    // note.id の形式: "note-left-{startTime}-{text}" → wordIdとしてstartTime+textを使用
    // フレーズ内のwordIdと照合するため、startTimeをキーとして登録する
    const startTimeMatch = id.match(/note-(?:left|right)-(\d+)-/);
    if (startTimeMatch) {
      const startTime = parseInt(startTimeMatch[1], 10);
      // __mikusetPhrases のwordIdと合わせるため「startTime」をキーに保存
      hitWordIdsRef.current.add(String(startTime));
    }
    setActiveNotes((prev) => prev.map((n) => (n.id === id ? { ...n, hit: true } : n)));
    setTimeout(() => setActiveNotes((prev) => prev.filter((n) => n.id !== id)), 1500);
  }, [gameActions]);

  const handleMiss = useCallback((id: string, _hand: 'left'|'right') => {
    gameActions.onMiss();
    setActiveNotes((prev) => prev.map((n) => (n.id === id ? { ...n, missed: true } : n)));
    setTimeout(() => setActiveNotes((prev) => prev.filter((n) => n.id !== id)), 800);
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
