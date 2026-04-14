import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Trail } from '@react-three/drei';
import * as THREE from 'three';
import type { HandDataRef } from '../types/hand';
import { useProductionLevel } from '../hooks/useGameState';

/**
 * 座標の補間係数（Lerp Factor）
 *
 * 0.0 = まったく動かない / 1.0 = 瞬間移動（カクカク）
 *
 * 0.15 が最適な理由：
 * - HandTracker 側の処理落ち・フレーム欠落はすでに根絶済み（useRef化 + 320×240カメラ）
 * - 0.8〜1.0 は "手ブレ・AIノイズ" がそのまま出て見た目がガタつく
 * - 0.15 は 1フレームの遅延を最小限に保ちつつ、高周波ノイズを滑らかに吸収する
 *   → 指揮棒がまるで "吸い付くように" 追従する最適値
 */
const LERP_FACTOR = 0.15;

interface BatonProps {
  /** ハンドトラッキングデータの共有Ref */
  handDataRef: HandDataRef;
  /** Trail軌跡の色（CSS色文字列、例: "#66aaff"） */
  trailColor?: string;
}

/**
 * 指揮棒（Baton）コンポーネント
 *
 * - 手の人差し指先端の座標に追従する白く発光する球体
 * - Trailエフェクトで光の軌跡を美しく描画
 * - MathUtils.lerp（線形補間）で滑らかに追従し、AIのノイズを吸収
 * - trailColorで左右の手ごとに軌跡の色を変更可能
 *
 * 【設計の核心】
 * - handDataRef は React の state ではなく useRef のため、
 *   useFrame 内で参照してもレンダリングコストがゼロ
 * - LERP で 1/60 秒ごとに少しずつ目標に近づけるため、
 *   カメラ推論のフレームレートが多少低くても滑らかに見える
 */
export default function Baton({ handDataRef, trailColor = '#66aaff' }: BatonProps) {
  const meshRef = useRef<THREE.Mesh>(null!);
  /** 現在の補間済み位置（Three.js ベクトル） */
  const currentPos = useRef(new THREE.Vector3(0, 0, 0));
  /** 目標位置（最新の手の座標） */
  const targetPos = useRef(new THREE.Vector3(0, 0, 0));

  useFrame(() => {
    const hand = handDataRef.current;

    if (hand.detected) {
      // ターゲット座標を最新の手の位置に更新（Ref なのでコストゼロ）
      targetPos.current.set(
        hand.fingertip.x,
        hand.fingertip.y,
        hand.fingertip.z
      );
    }

    // Vector3.lerp で現在地 → 目標地点へ滑らかに補間
    // 毎フレーム「残り距離の LERP_FACTOR 分だけ近づく」⇒ 指数的収束で自然な動き
    currentPos.current.lerp(targetPos.current, LERP_FACTOR);

    // メッシュ位置を更新（これ以外の React state 更新は一切しない）
    meshRef.current.position.copy(currentPos.current);
  });

  const level = useProductionLevel();
  const isHighLevel = level >= 3;

  return (
    <Trail
      width={isHighLevel ? 0.35 : 0.15}
      length={isHighLevel ? 30 : 15}
      color={trailColor}
      attenuation={(t) => t * t}
    >
      <mesh ref={meshRef}>
        {/* 指揮棒の先端：球体ジオメトリ */}
        <sphereGeometry args={[0.08, 16, 16]} />
        {/* 白く発光するマテリアル */}
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={isHighLevel ? 4 : 2}
          toneMapped={false}
        />
      </mesh>
    </Trail>
  );
}
