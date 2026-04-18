import { useRef, memo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
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
const HIT_TIMING_WINDOW = 400;
const PARTICLE_COUNT = 8; // 破壊エフェクト（パフォーマンス重視で最小化）

// ---------------------------------------------------------------------------
// パーティクル & ガイド コンポーネント
// ---------------------------------------------------------------------------

import { useGameState } from '../hooks/useGameState';

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

function RingGuide({
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
  const ringRef = useRef<THREE.Mesh>(null!);

  useFrame((_state) => {
    if (!ringRef.current) return;
    const progress = progressRef.current || 0;
    const currentState = stateRef.current;
    const active = currentState === 'active' || currentState === 'magnet';
    const mat = ringRef.current.material as THREE.MeshStandardMaterial;

    if (active) {
      // progressは0（出現時）→ 1（ジャストヒット時）
      // progressが0の時は4倍の大きさで、1の時にピッタリ等倍(1.0)になるように縮小
      const scale = Math.max(0, 4.0 - progress * 3.0);
      ringRef.current.scale.setScalar(scale);

      // ジャストタイミングに近づくほど色が濃く(opacityと明るさUP)なる
      const fadeProgress = Math.min(1, progress * 1.2);
      mat.opacity = fadeProgress;
      mat.emissiveIntensity = 1 + fadeProgress * 3;
    } else {
      mat.opacity = 0;
    }
  });

  return (
    <mesh ref={ringRef} position={[targetX, targetY, JUDGE_Z]}>
      {/* 基準の半径をノーツ本体のサイズ(0.3)に合わせる */}
      <torusGeometry args={[0.3, 0.015, 8, 24]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={2}
        transparent
        opacity={0}
        toneMapped={false}
        side={THREE.DoubleSide}
      />
    </mesh>
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
  const groupRef = useRef<THREE.Group>(null!);
  const meshRef = useRef<THREE.Mesh>(null!);
  const stateRef = useRef<'active' | 'magnet' | 'hit' | 'missed'>('active');
  const opacityRef = useRef(1);
  const progressRef = useRef(0);
  const showEffectRef = useRef(false);
  const hitPosRef = useRef(new THREE.Vector3());
  const resolvedRef = useRef(false);
  const magnetTimeRef = useRef(0);

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
      return;
    }

    if (stateRef.current === 'missed') {
      opacityRef.current = Math.max(0, opacityRef.current - delta * 3);
      if (meshRef.current) (meshRef.current.material as THREE.MeshStandardMaterial).opacity = opacityRef.current * 0.3;
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
        // タクトに激突するか、一定時間(0.3秒)追尾したら強制的に爆発させる（無限ループ軌道による処理落ち防止）
        if (dist < 0.5 || magnetTimeRef.current > 0.3) {
          stateRef.current = 'hit';
          hitPosRef.current.copy(groupRef.current.position);
          showEffectRef.current = true;
          onHit(note.id, note.hand);
        }
      } else {
        // トラッキングを見失った場合は即ヒット扱い
        stateRef.current = 'hit';
        hitPosRef.current.copy(groupRef.current.position);
        showEffectRef.current = true;
        onHit(note.id, note.hand);
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
        onMiss(note.id, note.hand);
        return;
      }
    }

    // --- 当たり判定（★自身の指定された手のみ検証★） ---
    // オートプレイ（テストモード）時の処理： ジャストタイミングで自動ヒット
    if (isAutoPlayMode && progress > 0.98 && !resolvedRef.current) {
      stateRef.current = 'magnet';
      resolvedRef.current = true;
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
          // マグネット開始
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
    <group>
      <RingGuide targetX={note.targetX} targetY={note.targetY} color={note.ringColor} progressRef={progressRef} stateRef={stateRef} />

      <group ref={groupRef} visible={opacityRef.current > 0.05}>
        <mesh ref={meshRef}>
          <sphereGeometry args={[0.3, 8, 8]} />
          <meshStandardMaterial
            color={note.ringColor}
            emissive={note.ringColor}
            emissiveIntensity={isNearJudge ? 6 : 3}
            transparent
            opacity={opacityRef.current * 0.9}
            toneMapped={false}
          />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.5, 6, 6]} />
          <meshStandardMaterial
            color={note.ringColor}
            emissive={note.ringColor}
            emissiveIntensity={1}
            transparent
            opacity={opacityRef.current * 0.15}
            toneMapped={false}
          />
        </mesh>

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
    </group>
  );
});

export default Note;
