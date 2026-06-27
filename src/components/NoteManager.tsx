import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
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
  units: { text: string; startTime: number; endTime: number; sourceStartTimes?: number[] }[],
  mergeCount: number,
): MergedUnit[] {
  if (mergeCount <= 1) {
    return units.map(u => ({
      text: u.text,
      startTime: u.startTime,
      endTime: u.endTime,
      sourceStartTimes: u.sourceStartTimes || [u.startTime]
    }));
  }
  const merged: MergedUnit[] = [];
  for (let i = 0; i < units.length; i += mergeCount) {
    const slice = units.slice(i, i + mergeCount);
    merged.push({
      text: slice.map((s) => s.text).join(''),
      startTime: slice[0].startTime,
      endTime: slice[slice.length - 1].endTime,
      sourceStartTimes: slice.flatMap(s => s.sourceStartTimes || [s.startTime]),
    });
  }
  return merged;
}


// 左手（鏡合わせ）の指揮パターン (3x3 グリッド座標に完全準拠)
// X: Left=-3.5, Center=-2.0, Right=-0.5
const Y_TOP = 2.8 - (5.6 / 6); // 1.8666...
const Y_BOT = -Y_TOP;

const CONDUCTOR_PATTERN_LEFT: { x: number; y: number }[] = [
  { x: -2.4, y: Y_BOT }, // Bottom Center (C)
  { x: -4.0, y:  0.0 }, // Middle Left (S)
  { x: -2.4, y: Y_TOP }, // Top Center (E)
  { x: -0.8, y:  0.0 }, // Middle Right (F)
  { x: -4.0, y: Y_TOP }, // Top Left (W)
  { x: -0.8, y: Y_BOT }, // Bottom Right (V)
  { x: -0.8, y: Y_TOP }, // Top Right (R)
  { x: -4.0, y: Y_BOT }, // Bottom Left (X)
  { x: -2.4, y:  0.0 }, // Middle Center (D)
];

const CONDUCTOR_PATTERN_RIGHT: { x: number; y: number }[] = [
  { x:  2.4, y: Y_BOT }, // Bottom Center (<)
  { x:  0.8, y:  0.0 }, // Middle Left (J)
  { x:  2.4, y: Y_TOP }, // Top Center (I)
  { x:  4.0, y:  0.0 }, // Middle Right (L)
  { x:  4.0, y: Y_TOP }, // Top Right (O)
  { x:  0.8, y: Y_BOT }, // Bottom Left (M)
  { x:  0.8, y: Y_TOP }, // Top Left (U)
  { x:  4.0, y: Y_BOT }, // Bottom Right (>)
  { x:  2.4, y:  0.0 }, // Middle Center (K)
];

function getStarPoints(outerRadius = 0.4, innerRadius = 0.15) {
  const points: [number, number, number][] = [];
  const spikes = 5;
  for (let i = 0; i <= spikes * 2; i++) {
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    points.push([Math.cos(a) * r, Math.sin(a) * r, 0]);
  }
  return points;
}

// ---------------------------------------------------------------------------
// サブコンポーネント: タイミング・ガイドスター
// ---------------------------------------------------------------------------

function TimingStar({
  hand,
  wordsRef,
  positionRef,
  safeScale,
}: {
  hand: 'left' | 'right';
  wordsRef: React.RefObject<{ text: string; startTime: number; endTime: number }[]>;
  positionRef: React.RefObject<number>;
  safeScale: number;
}) {
  const lineStarRef = useRef<any>(null!);
  const lineRef = useRef<any>(null!); // ガイドライン
  const starPoints = useMemo(() => getStarPoints(0.4, 0.15), []);
  
  const pattern = hand === 'left' ? CONDUCTOR_PATTERN_LEFT : CONDUCTOR_PATTERN_RIGHT;
  const color = hand === 'left' ? '#66aaff' : '#ff66aa';

  const lastIndexCache = useRef(0);
  const linePoints = useRef<number[]>([]);

  useFrame((state) => {
    const now = positionRef.current;
    const words = wordsRef.current;
    
    if (!lineStarRef.current || now <= 0 || !words || words.length === 0) {
      if (lineStarRef.current) lineStarRef.current.visible = false;
      if (lineRef.current) lineRef.current.visible = false;
      return;
    }

    let targetIndex = Math.min(lastIndexCache.current, words.length);
    while (targetIndex < words.length && words[targetIndex].startTime <= now) {
      targetIndex++;
    }
    while (targetIndex > 0 && words[targetIndex - 1].startTime > now) {
      targetIndex--;
    }
    lastIndexCache.current = targetIndex;

    if (targetIndex >= words.length) {
      lineStarRef.current.visible = false;
      if (lineRef.current) lineRef.current.visible = false;
      return;
    }

    lineStarRef.current.visible = true;
    const nextIdx = targetIndex;
    const nextWord = words[nextIdx];
    const nextPos = pattern[nextIdx % pattern.length];
    
    let currentStarPos = new THREE.Vector3();

    if (nextIdx === 0) {
      const spawnTime = nextWord.startTime - DEFAULT_SPAWN_AHEAD_MS;
      if (now < spawnTime) {
        lineStarRef.current.material.opacity = 0;
      } else {
        const p = (now - spawnTime) / DEFAULT_SPAWN_AHEAD_MS;
        const smoothP = p * p * (3 - 2 * p);
        currentStarPos.set(
          nextPos.x * safeScale * smoothP,
          nextPos.y * safeScale * smoothP,
          0
        );
        lineStarRef.current.material.opacity = p;
      }
    } else {
      const prevIdx = targetIndex - 1;
      const prevWord = words[prevIdx];
      const prevPos = pattern[prevIdx % pattern.length];

      const timeToNext = nextWord.startTime - now;
      if (timeToNext > DEFAULT_SPAWN_AHEAD_MS) {
         currentStarPos.set(prevPos.x * safeScale, prevPos.y * safeScale, 0);
      } else {
         const moveDuration = Math.min(nextWord.startTime - prevWord.startTime, DEFAULT_SPAWN_AHEAD_MS);
         const moveStartTime = nextWord.startTime - moveDuration;
         if (now < moveStartTime) {
           currentStarPos.set(prevPos.x * safeScale, prevPos.y * safeScale, 0);
         } else {
           const p = (now - moveStartTime) / moveDuration;
           const smoothP = p * p * (3 - 2 * p); 
           currentStarPos.set(
             (prevPos.x * safeScale) + (nextPos.x * safeScale - prevPos.x * safeScale) * smoothP,
             (prevPos.y * safeScale) + (nextPos.y * safeScale - prevPos.y * safeScale) * smoothP,
             0
           );
         }
      }
    }
    
    lineStarRef.current.position.copy(currentStarPos);
    lineStarRef.current.rotation.z = state.clock.elapsedTime * 2;

    linePoints.current = [currentStarPos.x, currentStarPos.y, 0];
    for (let i = 0; i < 3; i++) {
        if (targetIndex + i < words.length) {
            const pos = pattern[(targetIndex + i) % pattern.length];
            linePoints.current.push(pos.x * safeScale, pos.y * safeScale, 0);
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
      <Line
        ref={lineStarRef}
        points={starPoints}
        color={color}
        lineWidth={3}
        transparent
        opacity={1}
      />
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
  const { viewport } = useThree();
  const { state, positionRef } = useMusicPlayer();
  const { stateRef: gameStateRef, actions: gameActions } = useGameState();

  const scaleX = Math.min(1.0, viewport.width / 11);
  const scaleY = Math.min(1.0, viewport.height / 7);
  const safeScale = Math.min(scaleX, scaleY);

  const [activeNotes, setActiveNotes] = useState<NoteData[]>([]);
  const activeNotesRef = useRef<NoteData[]>([]);
  activeNotesRef.current = activeNotes;

  const leftWordsRef = useRef<{ text: string; startTime: number; endTime: number }[]>([]);
  const rightWordsRef = useRef<{ text: string; startTime: number; endTime: number }[]>([]);

  const nextIndexLeftRef = useRef(0);
  const nextIndexRightRef = useRef(0);
  const wordsInitializedRef = useRef(false);
  const lastDetectedRef = useRef({ left: false, right: false });

  const { actions: musicActions } = useMusicPlayer();
  const hitWordIdsRef = useRef<Set<string>>(new Set());
  (window as unknown as Record<string, unknown>).__mikusetHitWordIds = hitWordIdsRef.current;

  useEffect(() => {
    if (!state.isVideoReady) {
      wordsInitializedRef.current = false;
      leftWordsRef.current = [];
      rightWordsRef.current = [];
      nextIndexLeftRef.current = 0;
      nextIndexRightRef.current = 0;
      hitWordIdsRef.current.clear();
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

  // 楽曲URLが変わった瞬間に初期化フラグとインデックスをリセットする
  useEffect(() => {
    wordsInitializedRef.current = false;
    nextIndexLeftRef.current = 0;
    nextIndexRightRef.current = 0;
    leftWordsRef.current = [];
    rightWordsRef.current = [];
    setActiveNotes([]);
    hitWordIdsRef.current.clear();
    console.log(`[NoteManager] 楽曲変更を検知。状態をフルリセットしました。: ${state.activeSongUrl}`);
  }, [state.activeSongUrl]);

  // ★ 難易度変更を検知するためのポーリング
  const lastDifficultyRef = useRef(gameStateRef.current.currentDifficulty);
  useEffect(() => {
    const interval = setInterval(() => {
      const currentDiff = gameStateRef.current.currentDifficulty;
      if (currentDiff !== lastDifficultyRef.current) {
        console.log(`[NoteManager] 難易度変更を検知: ${lastDifficultyRef.current} -> ${currentDiff}`);
        lastDifficultyRef.current = currentDiff;
        wordsInitializedRef.current = false;
        setActiveNotes([]);
        hitWordIdsRef.current.clear();
      }
    }, 100);
    return () => clearInterval(interval);
  }, [gameStateRef]);

  useEffect(() => {
    if (state.isPlaying) {
      // 再生開始時にインデックスを0に戻すが、データ自体は保持する
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

  const lastLogTimeRef = useRef<number>(0);

  useFrame(() => {
    if (!wordsInitializedRef.current && state.isVideoReady && state.isPlaying) {
      const gs = gameStateRef.current;
      const diffCfg = DIFFICULTIES[gs.currentDifficulty];

      const win = window as unknown as Record<string, any>;
      let rawUnits: { text: string; startTime: number; endTime: number; sourceStartTimes?: number[] }[] | undefined;
      
      if (diffCfg.textUnit === 'char') {
        rawUnits = win.__mikusetChars;
      }
      if (!rawUnits || rawUnits.length === 0) {
        rawUnits = win.__mikusetWords;
      }
      if (!rawUnits || rawUnits.length === 0) return;


      const units = mergeUnits(rawUnits, diffCfg.mergeCount);
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

      const now = positionRef.current;
      let li = 0, ri = 0;
      while (li < leftArr.length && leftArr[li].endTime < now) li++;
      while (ri < rightArr.length && rightArr[ri].endTime < now) ri++;
      nextIndexLeftRef.current = li;
      nextIndexRightRef.current = ri;

      wordsInitializedRef.current = true;
      return;
    }






    if (!state.isPlaying) return;

    const rawNow = positionRef.current;
    const offsetMs = gameStateRef.current.globalOffsetMs;
    const now = rawNow + offsetMs;

    if (rawNow <= 0 && !state.isAutoPlayMode) return;



    if (gameStateRef.current.isGameOver || gameStateRef.current.isCleared) {
      if (gameStateRef.current.isGameOver && state.isPlaying) {
        musicActions.pause();
      }
      return;
    }

    ['left', 'right'].forEach(h => {
      const hand = h as 'left' | 'right';
      const isSwinging = handsDataRef.current[hand].isSwinging;
      if (isSwinging && !lastDetectedRef.current[hand]) {
        const nowTime = positionRef.current + gameStateRef.current.globalOffsetMs;
        const hasTarget = activeNotesRef.current.some(n => 
          n.hand === hand && 
          !n.hit && !n.missed &&
          Math.abs(nowTime - n.startTime) < (n.timingWindow ?? 400)
        );
        if (!hasTarget && !state.isAutoPlayMode && 
            gameStateRef.current.currentDifficulty !== 'Easy' && 
            gameStateRef.current.currentDifficulty !== 'Normal') {
          gameActions.registerPenalty();
        }



      }
      lastDetectedRef.current[hand] = isSwinging;
    });

    const diffCfg = DIFFICULTIES[gameStateRef.current.currentDifficulty];
    const SPAWN_AHEAD_MS = diffCfg.speed;

    const prevL = leftWordsRef.current[nextIndexLeftRef.current - 1];
    const prevR = rightWordsRef.current[nextIndexRightRef.current - 1];
    if (
      (prevL && prevL.startTime > now + 3000) || 
      (prevR && prevR.startTime > now + 3000)
    ) {
      wordsInitializedRef.current = false;
      setActiveNotes([]);
      hitWordIdsRef.current.clear();
      return;
    }
    
    const newNotesBatch: NoteData[] = [];

    while (nextIndexLeftRef.current < leftWordsRef.current.length) {
      const idx = nextIndexLeftRef.current;
      const word = leftWordsRef.current[idx];
      const spawnTime = word.startTime - SPAWN_AHEAD_MS;
      if (now >= spawnTime) {
        const ringPosLeft = CONDUCTOR_PATTERN_LEFT[idx % CONDUCTOR_PATTERN_LEFT.length];
        newNotesBatch.push({
          id: `note-left-${word.startTime}-${word.text}`,
          hand: 'left',
          text: word.text,
          startTime: word.startTime,
          endTime: word.endTime,
          spawnTime,
          hit: false,
          missed: false,
          targetX: ringPosLeft.x * safeScale,
          targetY: ringPosLeft.y * safeScale,
          originX: 0, 
          originY: -2.3 * safeScale, // 出現位置もスケールに合わせる
          ringColor: '#66aaff',
          speed: diffCfg.speed,
          hitboxRadius: diffCfg.hitboxRadius,
          magnetPower: diffCfg.magnetPower,
          timingWindow: diffCfg.timingWindow,
          sourceStartTimes: word.sourceStartTimes,
        });
        nextIndexLeftRef.current += 1;
      } else {
        break;
      }
    }

    while (nextIndexRightRef.current < rightWordsRef.current.length) {
      const idx = nextIndexRightRef.current;
      const word = rightWordsRef.current[idx];
      const spawnTime = word.startTime - SPAWN_AHEAD_MS;
      if (now >= spawnTime) {
        const ringPosRight = CONDUCTOR_PATTERN_RIGHT[idx % CONDUCTOR_PATTERN_RIGHT.length];
        newNotesBatch.push({
          id: `note-right-${word.startTime}-${word.text}`,
          hand: 'right',
          text: word.text,
          startTime: word.startTime,
          endTime: word.endTime,
          spawnTime,
          hit: false,
          missed: false,
          targetX: ringPosRight.x * safeScale,
          targetY: ringPosRight.y * safeScale,
          originX: 0,
          originY: -2.3 * safeScale, // 出現位置もスケールに合わせる
          ringColor: '#ff66aa',
          speed: diffCfg.speed,
          hitboxRadius: diffCfg.hitboxRadius,
          magnetPower: diffCfg.magnetPower,
          timingWindow: diffCfg.timingWindow,
          sourceStartTimes: word.sourceStartTimes,
        });
        nextIndexRightRef.current += 1;
      } else {
        break;
      }
    }

    if (newNotesBatch.length > 0) {
      setActiveNotes((prev) => {
        const combined = [...prev, ...newNotesBatch];
        const maxNotes = DIFFICULTIES[gameStateRef.current.currentDifficulty].textUnit === 'char' ? 20 : MAX_ACTIVE_NOTES;
        return combined.slice(Math.max(0, combined.length - maxNotes));
      });
    }
  });

  const handleHit = useCallback((id: string, hand: 'left'|'right', isPerfect: boolean) => {
    gameActions.registerHit(isPerfect);
    const hitNote = activeNotesRef.current.find(n => n.id === id);
    if (hitNote?.sourceStartTimes) {
      hitNote.sourceStartTimes.forEach(st => hitWordIdsRef.current.add(String(st)));
    } else {
      const startTimeMatch = id.match(/note-(?:left|right)-(\d+)-/);
      if (startTimeMatch) hitWordIdsRef.current.add(startTimeMatch[1]);
    }
    
    // 歌詞表示(PhraseDisplay)にヒットを通知して再描画を促す
    window.dispatchEvent(new CustomEvent('mikuset-hit'));
    
    setActiveNotes((prev) => prev.map((n) => (n.id === id ? { ...n, hit: true } : n)));
    setTimeout(() => setActiveNotes((prev) => prev.filter((n) => n.id !== id)), 600);
  }, [gameActions]);


  const handleMiss = useCallback((id: string, _hand: 'left'|'right') => {
    gameActions.registerMiss();
    setActiveNotes((prev) => prev.map((n) => (n.id === id ? { ...n, missed: true } : n)));
    setTimeout(() => setActiveNotes((prev) => prev.filter((n) => n.id !== id)), 400);
  }, [gameActions]);

  return (
    <>
      <TimingStar hand="left" wordsRef={leftWordsRef} positionRef={positionRef} safeScale={safeScale} />
      <TimingStar hand="right" wordsRef={rightWordsRef} positionRef={positionRef} safeScale={safeScale} />

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
