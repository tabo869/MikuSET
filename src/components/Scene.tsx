import { useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { PerspectiveCamera, OrbitControls, Stars, Text } from '@react-three/drei';
import HandTracker from './HandTracker';
import Baton from './Baton';
import NoteManager from './NoteManager';
import StageProduction from './StageProduction';
import VirtualInputManager from './VirtualInputManager';
import PhraseDisplay from './PhraseDisplay';
import { useMusicPlayer } from '../hooks/useMusicPlayer';
import type { BothHandsDataRef, HandDataRef } from '../types/hand';
import { DEFAULT_BOTH_HANDS } from '../types/hand';

/**
 * 片手分のデータを参照するプロキシRefを生成する
 */
function createHandProxy(
  handsRef: BothHandsDataRef,
  side: 'left' | 'right'
): HandDataRef {
  return {
    get current() {
      return handsRef.current[side];
    },
    set current(value) {
      handsRef.current[side] = value;
    },
  };
}

/**
 * 画面サイズ（アスペクト比）に応じてカメラのFOVを調整するコンポーネント
 */
function ResponsiveCamera() {
  const { viewport } = useThree();
  const aspect = viewport.aspect;
  
  // 標準アスペクト比 (16:9 = 1.77) を基準に、それより縦長になる場合は
  // 左右が切れないように FOV を広げる
  const baseFov = 50;
  const responsiveFov = aspect < 1.77 ? baseFov * (1.77 / aspect) : baseFov;
  // FOVが大きすぎると歪むので上限を設ける
  const finalFov = Math.min(responsiveFov, 95);

  return <PerspectiveCamera makeDefault position={[0, 0, 8]} fov={finalFov} />;
}

/**
 * 判定ラインの視覚的ガイド
 * Z=0の平面に薄く光るグリッドラインを表示
 */
function JudgeLine() {
  return (
    <group position={[0, 0, 0]}>
      {/* 横線 */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[12, 0.01]} />
        <meshStandardMaterial
          color="#224466"
          emissive="#224466"
          emissiveIntensity={1}
          transparent
          opacity={0.2}
          toneMapped={false}
        />
      </mesh>
      {/* 縦線 */}
      <mesh rotation={[Math.PI / 2, 0, Math.PI / 2]}>
        <planeGeometry args={[8, 0.01]} />
        <meshStandardMaterial
          color="#224466"
          emissive="#224466"
          emissiveIntensity={1}
          transparent
          opacity={0.2}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/**
 * プレイエリア枠
 * coordinateMapper.ts の RANGE と同じ値 X:±4.8, Y:±2.8 で矩形枠を描画。
 * 左半分（左手）: ブルー系、右半分（右手）: ピンク系
 */
function PlayAreaFrame() {
  const { viewport } = useThree();
  const scaleX = Math.min(1.0, viewport.width / 11);
  const scaleY = Math.min(1.0, viewport.height / 7);
  const safeScale = Math.min(scaleX, scaleY);

  const xMax = 4.8 * safeScale;
  const yMax = 2.8 * safeScale;
  const thick = 0.03;
  const depth = 0;

  const makeBar = (
    pos: [number, number, number],
    size: [number, number, number],
    color: string,
    emissive: string
  ) => (
    <mesh position={pos}>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={0.4} // 大幅に抑えめ
        transparent
        opacity={0.3} // 大幅に抑えめ
        toneMapped={false}
      />
    </mesh>
  );

  return (
    <group position={[0, 0, depth]}>
      {/* ── 入力エリア（枠内）の背景を暗くして視認性を大幅に向上 ── */}
      <mesh position={[0, 0, -0.1]}>
         <planeGeometry args={[xMax * 2, yMax * 2]} />
         <meshBasicMaterial color="#000000" transparent opacity={0.75} depthWrite={false} />
      </mesh>

      {/* ── 下部歌詞エリアの背景を暗くするマスク ── */}
      <mesh position={[0, -3.5, -0.1]}>
         <planeGeometry args={[20, 2]} />
         <meshBasicMaterial color="#000000" transparent opacity={0.6} depthWrite={false} />
      </mesh>

      {/* ── 左エリア（左手 / ブルー系）── */}
      {makeBar([-xMax / 2, yMax, 0], [xMax, thick, thick], '#3388ff', '#3388ff')}
      {makeBar([-xMax / 2, -yMax, 0], [xMax, thick, thick], '#3388ff', '#3388ff')}
      {makeBar([-xMax, 0, 0], [thick, yMax * 2, thick], '#3388ff', '#3388ff')}
      {/* 中央縦線（仕切り：両エリア共有） */}
      {makeBar([0, 0, 0], [thick, yMax * 2, thick], '#aaccff', '#aaccff')}

      {/* ── 右エリア（右手 / ピンク系）── */}
      {makeBar([xMax / 2, yMax, 0], [xMax, thick, thick], '#ff66aa', '#ff66aa')}
      {makeBar([xMax / 2, -yMax, 0], [xMax, thick, thick], '#ff66aa', '#ff66aa')}
      {makeBar([xMax, 0, 0], [thick, yMax * 2, thick], '#ff66aa', '#ff66aa')}
    </group>
  );
}

/**
 * スタート画面の 3D タイトルロゴ "S★LIVE"
 */
function TitleLogo() {
  const meshRef = useRef<THREE.Mesh>(null!);
  
  useFrame((state) => {
    if (!meshRef.current) return;
    
    // 虹色のグラデーション（HSLサイクル）
    const hue = (state.clock.elapsedTime * 0.15) % 1;
    const color = new THREE.Color().setHSL(hue, 0.9, 0.6);
    
    // MeshBasicMaterial の場合は color 直接更新で発光
    const mat = meshRef.current.material as THREE.MeshBasicMaterial;
    mat.color.copy(color);
    
    // 浮遊・揺れアニメーション (ダイナミックな上下動)
    meshRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.8) * 1.2;
    meshRef.current.position.x = Math.sin(state.clock.elapsedTime * 0.5) * 0.4;
    meshRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.3) * 0.05;
  });

  return (
    <Text
      ref={meshRef}
      position={[0, 0, 0]}
      fontSize={3.0}
      maxWidth={15}
      textAlign="center"
      anchorX="center"
      anchorY="middle"
      renderOrder={100}
    >
      S★LIVE
      <meshBasicMaterial toneMapped={false} />
    </Text>
  );
}

/**
 * 3Dシーンコンポーネント（ゲームシーン）
 *
 * - 星空の背景
 * - 判定ラインのガイド
 * - ハンドトラッキング + Baton
 * - NoteManager（歌詞ノートの生成・移動・当たり判定）
 * - VirtualInputManager（カメラ不要のキーボード/タッチ入力）
 */
export default function Scene() {
  const handsDataRef: BothHandsDataRef = useRef({ ...DEFAULT_BOTH_HANDS });
  const leftHandRef = useRef(createHandProxy(handsDataRef, 'left')).current;
  const rightHandRef = useRef(createHandProxy(handsDataRef, 'right')).current;
  const { state, positionRef } = useMusicPlayer();

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* カメラ不要モードでない場合のみカメラ＆AIを起動 */}
      {!state.isVirtualInputMode && (
        <HandTracker handsDataRef={handsDataRef} />
      )}

      {/* タッチ・キーボード操作オーバーレイ（ゲームプレイ中のみ表示） */}
      {state.isVirtualInputMode && state.isPlaying && (
        <VirtualInputManager
          handsDataRef={handsDataRef}
          isActive={state.isVirtualInputMode}
        />
      )}

      {/* フレーズ表示 CSS オーバーレイ（スターウォーズ風） */}
      <PhraseDisplay positionRef={positionRef} />

      {/* 3Dシーン */}
      <Canvas
        style={{ width: '100%', height: '100%', background: '#050510' }}
      >
        <ResponsiveCamera />

        {/* スタート画面のみタイトルロゴを表示 */}
        {!state.isPlaying && !state.isTrackingTest && (
          <TitleLogo />
        )}

        {/* レベル連動・ステージ演出マネージャー (ライト, 背景, サビ演出) */}
        <StageProduction />

        {/* 判定ライン */}
        <JudgeLine />

        {/* プレイエリア枠（左手:ブルー / 右手:ピンク） */}
        <PlayAreaFrame />

        {/* Baton (指揮棒と軌跡) - トップ画面ではアンマウントし、前回のTrailキャッシュをリセット */}
        {(state.isPlaying || state.isTrackingTest) && (
          <>
            <Baton handDataRef={leftHandRef} trailColor="#66aaff" />
            <Baton handDataRef={rightHandRef} trailColor="#ff66aa" />
          </>
        )}

        {/* ノート管理 */}
        <NoteManager handsDataRef={handsDataRef} />

        {/* 視点操作 (オートプレイ時のみ有効) */}
        <OrbitControls 
          enabled={state.isAutoPlayMode} 
          enableDamping 
          dampingFactor={0.05} 
          enableRotate={state.isAutoPlayMode}
          enableZoom={state.isAutoPlayMode}
          enablePan={false} 
        />
      </Canvas>
    </div>
  );
}
