import { useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
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
  const xMax = 4.8;
  const yMax = 2.8;
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
      {/* ── 演出ブロック用の不可視マスク（枠内）── */}
      {/* 背後の演出（ペンライトや背景など）が枠内に描画されないように被せる */}
      <mesh position={[0, 0, -0.1]}>
         <planeGeometry args={[xMax * 2, yMax * 2]} />
         <meshBasicMaterial colorWrite={false} depthWrite={true} />
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
        camera={{ position: [0, 0, 8], fov: 50 }}
        style={{ width: '100%', height: '100%', background: '#050510' }}
      >
        {/* レベル連動・ステージ演出マネージャー (ライト, 背景, サビ演出) */}
        <StageProduction />

        {/* 星空の背景 */}
        <Stars
          radius={50}
          depth={80}
          count={3000}
          factor={3}
          saturation={0.5}
          fade
          speed={0.5}
        />

        {/* 判定ライン */}
        <JudgeLine />

        {/* プレイエリア枠（左手:ブルー / 右手:ピンク） */}
        <PlayAreaFrame />

        {/* 左手のBaton */}
        <Baton handDataRef={leftHandRef} trailColor="#66aaff" />

        {/* 右手のBaton */}
        <Baton handDataRef={rightHandRef} trailColor="#ff66aa" />

        {/* ノート管理 */}
        <NoteManager handsDataRef={handsDataRef} />

        {/* 視点操作 */}
        <OrbitControls enableDamping dampingFactor={0.05} />
      </Canvas>
    </div>
  );
}
