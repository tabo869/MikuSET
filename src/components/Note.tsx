import { useRef, useEffect, memo, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { NoteData } from '../types/note';
import type { BothHandsDataRef } from '../types/hand';



// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const SPAWN_Z = -30;
const JUDGE_Z = 0;
const MISS_Z = 3;
const NOTE_TRAVEL_TIME = 2000;
const HIT_DISTANCE_XY = 5.0; // 激甘ヒットボックス（X/Y半径）
const HIT_DISTANCE_Z = 2.0;  // Z軸（奥行き）の判定
const HIT_TIMING_WINDOW = 500; // デフォルトの判定幅（ms）を緩和
const HIT_PERFECT_WINDOW = 150; // PERFECT判定の幅（ms）


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

const PARTICLE_COUNT = 8; // 破壊エフェクト（パフォーマンス重視で最小化）

// ---------------------------------------------------------------------------
// パーティクル & ガイド コンポーネント
// ---------------------------------------------------------------------------

import { useGameState } from '../hooks/useGameState';

// ---------------------------------------------------------------------------
// 共有オーディオコンテキスト (タンバリンSE用)
// ---------------------------------------------------------------------------
let sharedAudioCtx: AudioContext | null = null;

function playTambourineSE() {
  if (typeof window === 'undefined') return;
  try {
    if (!sharedAudioCtx) {
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      sharedAudioCtx = new AudioContextClass();
    }
    const ctx = sharedAudioCtx;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    
    // 1. ノイズ成分 (金属的なアタックと空気感)
    const duration = 0.25;
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      // わずかに歪ませたノイズで「シャン」という広がりを出す
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 5000;
    
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 9000;
    bandpass.Q.value = 1.0;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    source.connect(highpass);
    highpass.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(ctx.destination);

    // 2. メタリックな共鳴音 (ジングルのシマー感)
    const frequencies = [4000, 5800, 8200, 10500];
    frequencies.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      
      const g = ctx.createGain();
      // 少しタイミングをずらして重なりを作る
      const start = now + (i * 0.005);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.04, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.2 + (i * 0.05));
      
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });

    source.start(now);
  } catch (e) {}
}



function HitEffect({
  position,
  color,
  onComplete,
}: {
  position: THREE.Vector3;
  color: string;
  onComplete: () => void;
}) {
  const particlesRef = useRef<{ position: THREE.Vector3; velocity: THREE.Vector3; life: number }[]>([]);
  const meshRefs = useRef<(THREE.Mesh | null)[]>([]);
  const elapsed = useRef(0);
  const { getSnapshot } = useGameState();

  if (particlesRef.current.length === 0) {
    // パフォーマンス優先: パーティクル数は固定（Level3でも増やさない）
    const actualParticleCount = PARTICLE_COUNT;
    const speedMultiplier = 1.0;

    for (let i = 0; i < actualParticleCount; i++) {
      const angle = (i / actualParticleCount) * Math.PI * 2;
      const speed = (3 + Math.random() * 4) * speedMultiplier;
      particlesRef.current.push({
        position: position.clone(),
        velocity: new THREE.Vector3(
          Math.cos(angle) * speed * (0.5 + Math.random()),
          Math.sin(angle) * speed * (0.5 + Math.random()),
          (Math.random() - 0.5) * speed * 0.5
        ),
        life: 1,
      });
    }
  }

  useFrame((_s, delta) => {
    elapsed.current += delta;
    let allDead = true;
    particlesRef.current.forEach((p, i) => {
      if (p.life <= 0) return;
      p.life -= delta * 2;
      p.position.add(p.velocity.clone().multiplyScalar(delta));
      p.velocity.y -= delta * 8; // 重力強めにして散らばり感を出す
      if (meshRefs.current[i]) {
        meshRefs.current[i]!.position.copy(p.position);
        meshRefs.current[i]!.scale.setScalar(p.life * 1.5);
        const mat = meshRefs.current[i]!.material as THREE.MeshStandardMaterial;
        if (mat) mat.opacity = Math.max(0, p.life);
      }
      if (p.life > 0) allDead = false;
    });
    if (allDead || elapsed.current > 1.5) onComplete();
  });

  return (
    <group>
      {particlesRef.current.map((_, i) => (
        <mesh key={i} ref={(el) => { meshRefs.current[i] = el; }}>
          <sphereGeometry args={[0.15, 4, 4]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={3}
            transparent
            opacity={1}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/** 判定文字（PERFECT/HIT/MISS）を表示するコンポーネント */
function JudgeLabel({
  position,
  text,
  color,
  onComplete,
}: {
  position: THREE.Vector3;
  text: string;
  color: string;
  onComplete: () => void;
}) {
  const [opacity, setOpacity] = useState(1);
  const [yOffset, setYOffset] = useState(0);

  useFrame((_s, delta) => {
    setOpacity(prev => Math.max(0, prev - delta * 2));
    setYOffset(prev => prev + delta * 2);
    if (opacity <= 0) onComplete();
  });

  return (
    <Html
      position={[position.x, position.y + yOffset, position.z]}
      center
      pointerEvents="none"
      className="mikuset-note-html-orphaned-guard"
    >
      <div style={{
        color,
        fontSize: text === 'PERFECT' ? 32 : 24,
        fontWeight: 900,
        fontFamily: "'Inter', sans-serif",
        fontStyle: 'italic',
        textShadow: `0 0 10px ${color}, 0 0 20px ${color}`,
        opacity,
        whiteSpace: 'nowrap',
        transform: `scale(${text === 'PERFECT' ? 1.2 : 1})`,
      }}>
        {text}
      </div>
    </Html>
  );
}

function StarGuide({
  targetX,
  targetY,
  color,
  progressRef,
  stateRef,
}: {
  targetX: number;
  targetY: number;
  color: string;
  progressRef: React.RefObject<number>;
  stateRef: React.MutableRefObject<'active' | 'magnet' | 'hit' | 'missed'>;
}) {
  const lineRef = useRef<any>(null!);
  const starPoints = useMemo(() => getStarPoints(0.4, 0.15), []);

  useFrame((state) => {
    if (!lineRef.current) return;
    const progress = progressRef.current || 0;
    const currentState = stateRef.current;
    const active = currentState === 'active' || currentState === 'magnet';

    if (active) {
      lineRef.current.visible = true;
      // progressは0（出現時）→ 1（ジャストヒット時）
      const scale = Math.max(0, 4.0 - progress * 3.0);
      lineRef.current.scale.setScalar(scale);
      lineRef.current.rotation.z = state.clock.elapsedTime * 4;

      const fadeProgress = Math.min(1, progress * 1.2);
      lineRef.current.material.opacity = fadeProgress;
    } else {
      lineRef.current.visible = false;
    }
  });

  return (
    <Line
      ref={lineRef}
      points={starPoints}
      color={color}
      lineWidth={3}
      transparent
      opacity={0}
      position={[targetX, targetY, JUDGE_Z]}
    />
  );
}

// ---------------------------------------------------------------------------
// メインNoteコンポーネント
// ---------------------------------------------------------------------------

interface NoteProps {
  note: NoteData;
  positionRef: React.RefObject<number>;
  handsDataRef: BothHandsDataRef;
  onHit: (id: string, hand: 'left' | 'right') => void;
  onMiss: (id: string, hand: 'left' | 'right') => void;
  isAutoPlayMode?: boolean;
}

const Note = memo(function Note({ note, positionRef, handsDataRef, onHit, onMiss, isAutoPlayMode = false }: NoteProps) {
  const outerGroupRef = useRef<THREE.Group>(null!);
  const groupRef = useRef<THREE.Group>(null!);
  const meshRef = useRef<THREE.Mesh>(null!);
  const stateRef = useRef<'active' | 'magnet' | 'hit' | 'missed'>('active');
  const opacityRef = useRef(1);
  const progressRef = useRef(0);
  const showEffectRef = useRef(false);
  const hitPosRef = useRef(new THREE.Vector3());
  const resolvedRef = useRef(false);
  const magnetTimeRef = useRef(0);
  const isPerfectRef = useRef(false);
  const [judgeInfo, setJudgeInfo] = useState<{ text: string; color: string } | null>(null);

  // ★ R3Fのリコンサイラーがアンマウント時にThree.jsオブジェクトを取りこぼした場合のセーフティネット
  useEffect(() => {
    return () => {
      const group = outerGroupRef.current;
      if (group) {
        // シーングラフから強制除去（visible=falseも併用）
        group.visible = false;
        group.parent?.remove(group);
        // GPUリソースの解放
        group.traverse((child: THREE.Object3D) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            const mat = child.material;
            if (Array.isArray(mat)) mat.forEach(m => m.dispose());
            else if (mat) mat.dispose();
          }
        });
      }
    };
  }, []);

  useFrame((_s, delta) => {
    if (!groupRef.current) return;

    const now = positionRef.current;
    const noteSpeed = note.speed ?? NOTE_TRAVEL_TIME;
    const elapsed = now - note.spawnTime;
    const progress = Math.max(0, elapsed / noteSpeed);
    progressRef.current = progress;

    if (stateRef.current === 'hit') {
      opacityRef.current = Math.max(0, opacityRef.current - delta * 6);
      if (meshRef.current) (meshRef.current.material as THREE.MeshStandardMaterial).opacity = opacityRef.current * 0.6;
      // ★ 外側グロー球体はrefがなくuseFrameで更新できないため、
      //    グループ全体のvisibilityで一括制御して残像を防止する
      if (groupRef.current) groupRef.current.visible = opacityRef.current > 0.05;
      return;
    }

    if (stateRef.current === 'missed') {
      opacityRef.current = Math.max(0, opacityRef.current - delta * 3);
      if (meshRef.current) (meshRef.current.material as THREE.MeshStandardMaterial).opacity = opacityRef.current * 0.3;
      // ★ ミス時も同様にグループ全体を非表示にする
      if (groupRef.current) groupRef.current.visible = opacityRef.current > 0.05;
      return;
    }

    if (stateRef.current === 'magnet') {
      magnetTimeRef.current += delta;
      const trackingHand = handsDataRef.current[note.hand];
      if (trackingHand.detected) {
        // タクトの位置に向かって急激に吸い寄せる（Lerp）
        const magPower = note.magnetPower ?? 30;
        groupRef.current.position.lerp(trackingHand.fingertip, delta * magPower);
        const dist = groupRef.current.position.distanceTo(trackingHand.fingertip);
        if (dist < 0.5 || magnetTimeRef.current > 0.3) {
          stateRef.current = 'hit';
          hitPosRef.current.copy(groupRef.current.position);
          showEffectRef.current = true;
          const isPerf = isPerfectRef.current;
          setJudgeInfo({
            text: isPerf ? 'PERFECT' : 'HIT',
            color: isPerf ? '#ffff00' : '#00ffff'
          });
          onHit(note.id, note.hand, isPerf);
        }
      } else {
        // トラッキングを見失った場合は即ヒット扱い
        stateRef.current = 'hit';
        hitPosRef.current.copy(groupRef.current.position);
        showEffectRef.current = true;
        const isPerf = isPerfectRef.current;
        setJudgeInfo({
          text: isPerf ? 'PERFECT' : 'HIT',
          color: isPerf ? '#ffff00' : '#00ffff'
        });
        onHit(note.id, note.hand, isPerf);
      }
      return;
    }

    // --- 移動計算 (active時のみ) ---
    const x = note.originX + (note.targetX - note.originX) * progress;
    const y = note.originY + (note.targetY - note.originY) * progress;
    const z = SPAWN_Z + (JUDGE_Z - SPAWN_Z) * progress;
    groupRef.current.position.set(x, y, z);

    // --- ミス判定 ---
    if (z > MISS_Z && !resolvedRef.current) {
      // NOTE: AutoPlayの場合はここに来る前に処理されているが念のため
      if (!isAutoPlayMode) {
        stateRef.current = 'missed';
        resolvedRef.current = true;
        hitPosRef.current.set(x, y, z);
        setJudgeInfo({ text: 'MISS', color: '#ff4444' });
        onMiss(note.id, note.hand);
        return;
      }
    }

    // --- 当たり判定（★自身の指定された手のみ検証★） ---
    // オートプレイ（テストモード）時の処理： ジャストタイミングで自動ヒット
    if (isAutoPlayMode && progress > 0.98 && !resolvedRef.current) {
      stateRef.current = 'magnet';
      resolvedRef.current = true;
      isPerfectRef.current = true;
      playTambourineSE(); // オートプレイ時にSEを鳴らす
      return;
    }

    const noteTimingWindow = note.timingWindow ?? HIT_TIMING_WINDOW;
    const timeDiff = Math.abs(now - note.startTime);
    if (timeDiff < noteTimingWindow && !resolvedRef.current) {
      const notePos = groupRef.current.position;
      
      // note.hand で指定された手だけをチェックする
      const trackingHand = handsDataRef.current[note.hand];
      
      if (trackingHand.detected) {
        const dx = notePos.x - trackingHand.fingertip.x;
        const dy = notePos.y - trackingHand.fingertip.y;
        const dz = notePos.z - trackingHand.fingertip.z;
        const xyDist = Math.sqrt(dx * dx + dy * dy);

        // 難易度に応じたヒットボックス半径
        const noteHitboxRadius = note.hitboxRadius ?? HIT_DISTANCE_XY;
        if (xyDist < noteHitboxRadius && Math.abs(dz) < HIT_DISTANCE_Z) {
          stateRef.current = 'magnet';
          resolvedRef.current = true;
          // PERFECT判定 (HIT_PERFECT_WINDOW 以内)
          isPerfectRef.current = timeDiff < HIT_PERFECT_WINDOW;

          return;
        }
      }
    }
  });

  if (opacityRef.current <= 0 && stateRef.current !== 'active' && stateRef.current !== 'magnet') {
    return showEffectRef.current ? (
      <HitEffect position={hitPosRef.current} color={note.ringColor} onComplete={() => { showEffectRef.current = false; }} />
    ) : null;
  }

  const isNearJudge = progressRef.current > 0.7;

  return (
    <group ref={outerGroupRef}>
      <StarGuide targetX={note.targetX} targetY={note.targetY} color={note.ringColor} progressRef={progressRef} stateRef={stateRef} />

      <group ref={groupRef} visible={opacityRef.current > 0.05}>
        {/* 球体ノーツを非表示にし、テキストのみに軽量化 */}
        {(stateRef.current === 'active' || stateRef.current === 'magnet') && (
          <Html
            center
            distanceFactor={10}
            className="mikuset-note-html-orphaned-guard"
            style={{
              color: '#ffffff',
              fontSize: 34, // 大きく視認性アップ
              fontWeight: 900,
              fontFamily: "'Noto Sans JP', 'Yu Gothic', sans-serif",
              // 発光をより強力に
              textShadow: `0 0 12px ${note.ringColor}, 0 0 24px ${note.ringColor}, 0 0 36px ${note.ringColor}, 0 0 60px ${note.ringColor}`,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              userSelect: 'none',
              transform: 'translateY(-30px)',
            }}
          >
            {note.text}
          </Html>
        )}
      </group>

      {showEffectRef.current && (
        <HitEffect position={hitPosRef.current} color={note.ringColor} onComplete={() => { showEffectRef.current = false; }} />
      )}

      {judgeInfo && (
        <JudgeLabel
          position={hitPosRef.current}
          text={judgeInfo.text}
          color={judgeInfo.color}
          onComplete={() => setJudgeInfo(null)}
        />
      )}
    </group>
  );
});

export default Note;
