import { useRef, useEffect, useState, useCallback, useMemo, Suspense } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { PerspectiveCamera, OrbitControls, Text } from '@react-three/drei';
import MotionDetector from './MotionDetector';
import Baton from './Baton';
import NoteManager from './NoteManager';
import StageProduction from './StageProduction';
import VirtualInputManager from './VirtualInputManager';
import PhraseDisplay from './PhraseDisplay';
import { useMusicPlayer } from '../hooks/useMusicPlayer';
import { useGameState } from '../hooks/useGameState';
import { playTambourineSE } from './Note';
import type { BothHandsDataRef, HandDataRef } from '../types/hand';
import { CONTEST_SONGS } from '../config/songs';
import { getRankingByDifficulty } from '../utils/ranking';
import type { DifficultyLevel } from '../config/difficulty';

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
function ResponsiveCamera({ cinematicActive }: { cinematicActive: boolean }) {
  const { viewport } = useThree();
  const aspect = viewport.aspect;
  const baseFov = 50;
  // ドローン演出中はFOVをやや広めに固定して臨場感を出す
  const cinematicFov = 65;
  const normalFov = aspect < 1.77 ? baseFov * (1.77 / aspect) : baseFov;
  
  const finalFov = cinematicActive ? cinematicFov : Math.min(normalFov, 95);

  return (
    <PerspectiveCamera 
      makeDefault 
      position={cinematicActive ? undefined : [0, 0, 8]} 
      fov={finalFov} 
    />
  );
}

/**
 * カメラ位置および OrbitControls ターゲットを滑らかにリセットする制御コンポーネント
 */
interface CameraResetProps {
  isAutoPlayMode: boolean;
  cinematicActive: boolean;
  controlsRef: React.RefObject<any>;
  resetTrigger: number;
  onResetComplete: () => void;
}

function CameraReset({ 
  isAutoPlayMode, 
  cinematicActive, 
  controlsRef, 
  resetTrigger, 
  onResetComplete 
}: CameraResetProps) {
  const { camera } = useThree();
  const [resetState, setResetState] = useState<'idle' | 'resetting'>('idle');
  const progressRef = useRef(0);
  const startPosRef = useRef(new THREE.Vector3());
  const startTargetRef = useRef(new THREE.Vector3());
  
  const prevAutoPlay = useRef(isAutoPlayMode);
  const prevCinematic = useRef(cinematicActive);

  // リセットトリガーを監視して補間アニメーションを開始
  useEffect(() => {
    if (resetTrigger > 0 && controlsRef.current) {
      startPosRef.current.copy(camera.position);
      startTargetRef.current.copy(controlsRef.current.target);
      progressRef.current = 0;
      setResetState('resetting');
    }
  }, [resetTrigger, camera, controlsRef]);

  // オートプレイ終了時や演出切り替え時の瞬時クリアガード
  useEffect(() => {
    const autoPlayStopped = prevAutoPlay.current && !isAutoPlayMode;
    const cinematicStopped = prevCinematic.current && !cinematicActive;

    if (autoPlayStopped || cinematicStopped) {
      setResetState('idle'); // 実行中のアニメーションがあれば中断
      camera.position.set(0, 0, 8);
      camera.rotation.set(0, 0, 0);
      camera.lookAt(0, 0, 0);
      if (controlsRef.current) {
        controlsRef.current.target.set(0, 0, 0);
        controlsRef.current.update();
      }
      camera.updateProjectionMatrix();
    }
    prevAutoPlay.current = isAutoPlayMode;
    prevCinematic.current = cinematicActive;
  }, [isAutoPlayMode, cinematicActive, camera, controlsRef]);

  // 毎フレームごとのイージング補間処理
  useFrame((_, delta) => {
    if (resetState === 'resetting' && controlsRef.current) {
      progressRef.current += delta * 1.6; // 約0.6秒で補間完了
      const t = Math.min(1, progressRef.current);
      const ease = t * t * (3 - 2 * t); // Smoothstep イージング

      camera.position.lerpVectors(startPosRef.current, new THREE.Vector3(0, 0, 8), ease);
      controlsRef.current.target.lerpVectors(startTargetRef.current, new THREE.Vector3(0, -5, -80), ease);
      controlsRef.current.update();

      if (t >= 1) {
        setResetState('idle');
        onResetComplete();
      }
    }
  });

  return null;
}

/**
 * 判定ラインのガイド
 */
function JudgeLine() {
  return (
    <group position={[0, 0, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[12, 12]} />
        <meshBasicMaterial color="#112233" transparent opacity={0.1} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
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
 * 3D空間上のグリッド座標を、HTML 2Dピクセル座標に射影・同期するプロジェクター
 */
function GridProjector() {
  const { camera, size, viewport } = useThree();

  useFrame(() => {
    const scaleX = Math.min(1.0, viewport.width / 11);
    const scaleY = Math.min(1.0, viewport.height / 7);
    const safeScale = Math.min(scaleX, scaleY);

    const vecLU = new THREE.Vector3(-4.8 * safeScale, 2.8 * safeScale, 0);
    const vecRD = new THREE.Vector3(0, -2.8 * safeScale, 0);

    const vecRU_LU = new THREE.Vector3(0, 2.8 * safeScale, 0);
    const vecRU_RD = new THREE.Vector3(4.8 * safeScale, -2.8 * safeScale, 0);

    // プロジェクション (3D → NDC [-1, 1])
    vecLU.project(camera);
    vecRD.project(camera);
    vecRU_LU.project(camera);
    vecRU_RD.project(camera);

    // NDC → 画面ピクセル座標 (Canvas基準)
    const leftX_LU = ((vecLU.x + 1) * size.width) / 2;
    const leftY_LU = ((-vecLU.y + 1) * size.height) / 2;
    const leftX_RD = ((vecRD.x + 1) * size.width) / 2;
    const leftY_RD = ((-vecRD.y + 1) * size.height) / 2;

    const rightX_LU = ((vecRU_LU.x + 1) * size.width) / 2;
    const rightY_LU = ((-vecRU_LU.y + 1) * size.height) / 2;
    const rightX_RD = ((vecRU_RD.x + 1) * size.width) / 2;
    const rightY_RD = ((-vecRU_RD.y + 1) * size.height) / 2;

    // 左グリッドの 2D スタイル情報
    const leftStyle = {
      left: leftX_LU,
      top: leftY_LU,
      width: leftX_RD - leftX_LU,
      height: leftY_RD - leftY_LU,
    };

    // 右グリッドの 2D スタイル情報
    const rightStyle = {
      left: rightX_LU,
      top: rightY_LU,
      width: rightX_RD - rightX_LU,
      height: rightY_RD - rightY_LU,
    };

    // イベントを発火して VirtualInputManager に伝える
    window.dispatchEvent(new CustomEvent('mikuset-grid-projection', {
      detail: { leftStyle, rightStyle, safeScale }
    }));
  });

  return null;
}

/**
 * プレイエリア枠
 */
function PlayAreaFrame({ isVisible }: { isVisible: boolean }) {
  const { viewport } = useThree();
  const scaleX = Math.min(1.0, viewport.width / 11);
  const scaleY = Math.min(1.0, viewport.height / 7);
  const safeScale = Math.min(scaleX, scaleY);

  const xMax = 4.8 * safeScale;
  const yMax = 2.8 * safeScale;
  const thick = 0.03;

  const makeBar = (pos: [number, number, number], size: [number, number, number], color: string, emissive: string) => (
    <mesh position={pos}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.4} transparent opacity={0.3} toneMapped={false} />
    </mesh>
  );

  return (
    <group position={[0, 0, 0]}>
      {/* プレイ中またはテスト中のみ表示 */}
      {isVisible && (
        <>
          {/* 背景マスク */}
          <mesh position={[0, 0, -0.1]} renderOrder={-5}>
             <planeGeometry args={[xMax * 2, yMax * 2]} />
             <meshBasicMaterial color="#000000" transparent opacity={0.75} depthWrite={false} />
          </mesh>
          <mesh position={[0, -3.5, -0.1]} renderOrder={-5}>
             <planeGeometry args={[20, 2]} />
             <meshBasicMaterial color="#000000" transparent opacity={0.6} depthWrite={false} />
          </mesh>
          {/* 枠線 */}
          {makeBar([-xMax / 2, yMax, 0], [xMax, thick, thick], '#3388ff', '#3388ff')}
          {makeBar([-xMax / 2, -yMax, 0], [xMax, thick, thick], '#3388ff', '#3388ff')}
          {makeBar([-xMax, 0, 0], [thick, yMax * 2, thick], '#3388ff', '#3388ff')}
          {makeBar([0, 0, 0], [thick, yMax * 2, thick], '#aaccff', '#aaccff')}
          {makeBar([xMax / 2, yMax, 0], [xMax, thick, thick], '#ff66aa', '#ff66aa')}
          {makeBar([xMax / 2, -yMax, 0], [xMax, thick, thick], '#ff66aa', '#ff66aa')}
          {makeBar([xMax, 0, 0], [thick, yMax * 2, thick], '#ff66aa', '#ff66aa')}
        </>
      )}
    </group>
  );
}

const INTRO_DURATION = 6.0; // アプローチ軌道の所要時間（秒）
const PEAK_HEIGHT = 12.0;    // 上昇する放物線のピーク高さ

/**
 * ドローンシネマティック
 */
function DroneCinematic({ active }: { active: boolean }) {
  const { camera } = useThree();
  const startTimeRef = useRef(0);
  const prevActive = useRef(false);

  const curve = useMemo(() => {
    return new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 3, -86),       // スタート：ボーカル背後上部（Zを -92 から -86 に変更して背面スクリーンとの干渉を回避）
      new THREE.Vector3(25, 1, -80),      // ステージ右手へ回り込む
      new THREE.Vector3(45, 6, -45),      // 観客席右手奥
      new THREE.Vector3(0, 10, -20),      // 会場中央上空
      new THREE.Vector3(-45, 6, -45),     // 観客席左手奥
      new THREE.Vector3(-25, 1, -80),     // ステージ左手へ回り込む
    ], true);
  }, []);

  const targetLookAt = useMemo(() => new THREE.Vector3(0, -5, -80), []);
  const currentLookAt = useRef(new THREE.Vector3());
  
  useEffect(() => {
    if (active) {
      // 演出開始時に即座にカメラを初期位置（ゲーム画面位置）へワープさせる
      camera.position.set(0, 0, 8);
      currentLookAt.current.set(0, 0, 0);
      camera.lookAt(currentLookAt.current);
      camera.updateProjectionMatrix();
    }
  }, [active, camera]);

  useFrame((state) => {
    if (!active) {
      if (prevActive.current) {
        prevActive.current = false;
      }
      return;
    }

    // 開始時の初期化 (state.clock.elapsedTimeをセット)
    if (!prevActive.current) {
      console.log("[DroneCinematic] Starting cinematic animation...");
      startTimeRef.current = state.clock.elapsedTime;
      prevActive.current = true;
      // 1フレーム目から確実に位置を固定
      try {
        camera.position.set(0, 0, 8);
        currentLookAt.current.set(0, 0, 0);
        camera.lookAt(currentLookAt.current);
      } catch (err) {
        console.error("[DroneCinematic] Initialization error:", err);
      }
    }

    const elapsed = state.clock.elapsedTime - startTimeRef.current;

    if (elapsed < INTRO_DURATION) {
      // 1. アプローチ軌道（イントロフェーズ）
      const u = elapsed / INTRO_DURATION;
      
      // カメラ位置：(0, 0, 8) から (0, 3, -86) まで直線補間し、Y軸方向に放物線を描いて上昇・下降
      const startPos = new THREE.Vector3(0, 0, 8);
      const endPos = new THREE.Vector3(0, 3, -86);
      const pos = new THREE.Vector3().lerpVectors(startPos, endPos, u);
      pos.y += PEAK_HEIGHT * 4 * u * (1 - u);

      // 注視点：(0, 0, 0) からボーカル位置 (0, -5, -80) まで直線補間
      const startLook = new THREE.Vector3(0, 0, 0);
      const endLook = targetLookAt;
      const lookAtPoint = new THREE.Vector3().lerpVectors(startLook, endLook, u);

      camera.position.copy(pos);
      currentLookAt.current.copy(lookAtPoint);
      camera.lookAt(currentLookAt.current);
    } else {
      // 2. 本来の旋回軌道（ループフェーズ）
      const t_loop = elapsed - INTRO_DURATION;
      const t = (t_loop * 0.03) % 1;
      const pos = curve.getPointAt(t);

      // 前フレームの位置から滑らかに補間
      camera.position.lerp(pos, 0.08);

      // 注視点も動的に補間。ターゲット (客席方向) を強く優先し、移動方向に少しだけ向ける
      const lookAtPoint = targetLookAt.clone().lerp(curve.getPointAt((t + 0.02) % 1), 0.05);
      currentLookAt.current.lerp(lookAtPoint, 0.1);
      camera.lookAt(currentLookAt.current);
    }
  });

  return null;
}

/**
 * シネマティックタイトル
 */
function CinematicTitle({ activeSongUrl }: { activeSongUrl: string }) {
  const logoRef = useRef<THREE.Group>(null!);
  const boardRef = useRef<THREE.Group>(null!);
  const targetLogoZ = useRef(0);
  const targetBoardZ = useRef(-8);
  const targetLogoRot = useRef(0);
  const targetBoardRot = useRef(-Math.PI / 2);
  const [phase, setPhase] = useState<'logo' | 'board'>('logo');

  const togglePhase = useCallback(() => {
    setPhase((prev) => {
      const next = prev === 'logo' ? 'board' : 'logo';
      if (next === 'board') {
        targetLogoZ.current = -12;
        targetBoardZ.current = 0;
        targetLogoRot.current = Math.PI;
        targetBoardRot.current = 0;
      } else {
        targetLogoZ.current = 0;
        targetBoardZ.current = -12;
        targetLogoRot.current = 0;
        targetBoardRot.current = -Math.PI / 2;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const timer = setInterval(togglePhase, 8000);
    return () => clearInterval(timer);
  }, [togglePhase]);

  useEffect(() => {
    // 楽曲切り替え時はランキング表示から開始する
    setPhase('board');
    targetLogoZ.current = -12;
    targetBoardZ.current = 0;
    targetLogoRot.current = Math.PI;
    targetBoardRot.current = 0;
  }, [activeSongUrl]);

  const groupRef = useRef<THREE.Group>(null!);

  useFrame((state, delta) => {
    // 横に大きく揺れる演出 (メニュー回避用)
    const swayX = Math.sin(state.clock.elapsedTime * 0.6) * 3.5;
    const swayY = Math.cos(state.clock.elapsedTime * 0.4) * 0.3;
    
    if (groupRef.current) {
      groupRef.current.position.x = THREE.MathUtils.lerp(groupRef.current.position.x, swayX, delta * 2);
      groupRef.current.position.y = THREE.MathUtils.lerp(groupRef.current.position.y, swayY, delta * 2);
    }

    // ロゴとボードの切り替えアニメーション
    if (logoRef.current) {
      logoRef.current.position.z = THREE.MathUtils.lerp(logoRef.current.position.z, targetLogoZ.current, delta * 3);
      logoRef.current.rotation.y = THREE.MathUtils.lerp(logoRef.current.rotation.y, targetLogoRot.current, delta * 3);
    }
    if (boardRef.current) {
      boardRef.current.position.z = THREE.MathUtils.lerp(boardRef.current.position.z, targetBoardZ.current, delta * 3);
      boardRef.current.rotation.y = THREE.MathUtils.lerp(boardRef.current.rotation.y, targetBoardRot.current, delta * 3);
    }

    // デバッグログ (1秒に1回出力)
    if (Math.floor(state.clock.elapsedTime * 2) % 2 === 0 && Math.random() < 0.01) {
      console.log(`[CinematicTitle] Phase: ${phase}, LogoZ: ${logoRef.current?.position.z.toFixed(2)}, BoardZ: ${boardRef.current?.position.z.toFixed(2)}`);
    }
  });

  const songInfo = useMemo(() => CONTEST_SONGS.find(s => s.url === activeSongUrl), [activeSongUrl]);

  return (
    <group ref={groupRef} position={[0, 0, 2.0]} renderOrder={100}>
      <group ref={logoRef} visible={phase === 'logo'}>
          <TitleLogo />
      </group>
      <group ref={boardRef} visible={phase === 'board'}>
          <RankingBoard songUrl={activeSongUrl} songInfo={songInfo} />
      </group>
    </group>
  );
}

function TitleLogo() {
  return (
    <group position={[0, 0, 0]}>
      <Text fontSize={2.8} color="#88ffee" fontStyle="italic" fontWeight={900}>
        S★LIVE
        <meshStandardMaterial emissive="#88ffee" emissiveIntensity={2.5} toneMapped={false} depthTest={false} />
      </Text>
      <Text position={[0, -1.3, 0.05]} fontSize={0.3} color="#ffffff" letterSpacing={0.2}>
        VIRTUAL PERFORMANCE SYSTEM
        <meshStandardMaterial color="#ffffff" depthTest={false} />
      </Text>
    </group>
  );
}

function RankingBoard({ songUrl, songInfo }: { songUrl: string; songInfo?: { title: string; artist: string } }) {
  const activeDiff: DifficultyLevel = 'Normal';
  // 常に最新データを取得
  let entries = getRankingByDifficulty(songUrl, activeDiff);
  
  // データが空の場合はダミーを表示 (トップ画面の賑やかし)
  if (entries.length === 0) {
    // 楽曲ごとに異なるデータが出るように、URLからシードを生成
    const seed = songUrl.length;
    const prefix = songInfo ? songInfo.title.slice(0, 1) : 'M';
    entries = [
      { initial: `${prefix}01`, score: 300000 + seed * 1000, difficulty: 'Normal', date: '' },
      { initial: `${prefix}02`, score: 250000 + seed * 800, difficulty: 'Normal', date: '' },
      { initial: `${prefix}03`, score: 200000 + seed * 600, difficulty: 'Normal', date: '' },
      { initial: `${prefix}04`, score: 150000 + seed * 400, difficulty: 'Normal', date: '' },
      { initial: `${prefix}05`, score: 100000 + seed * 200, difficulty: 'Normal', date: '' },
    ];
  }

  console.log(`[RankingBoard] Rendering ${entries.length} entries for ${songUrl}`);

  const panelW = 7.5;
  const panelH = 5.5;

  return (
    <group position={[0, 0, 0]}>
      <mesh position={[0, 0.4, -0.05]} renderOrder={100}>
        <planeGeometry args={[panelW, panelH]} />
        <meshStandardMaterial color="#000810" transparent opacity={0.8} />
      </mesh>
      <Text position={[0, 3.2, 0.15]} fontSize={0.4} color="#88aaff" renderOrder={200} textAlign="center">
        TOP 5 RANKING
        <meshStandardMaterial emissive="#88aaff" emissiveIntensity={2} toneMapped={false} />
      </Text>
      {songInfo && (
        <>
          <Text position={[0, 2.6, 0.25]} fontSize={0.45} color="#ffffff" renderOrder={200} textAlign="center">
            {songInfo.title}
            <meshStandardMaterial emissive="#ffffff" emissiveIntensity={1.5} toneMapped={false} />
          </Text>
          <Text position={[0, 2.1, 0.25]} fontSize={0.28} color="#8899bb" renderOrder={200} textAlign="center">
            {songInfo.artist}
            <meshStandardMaterial emissive="#8899bb" emissiveIntensity={1} toneMapped={false} />
          </Text>
        </>
      )}
      {entries.length === 0 ? (
        <Text position={[0, 0, 0.25]} fontSize={0.32} color="#334455" renderOrder={200} textAlign="center">
          NO RECORDS YET
          <meshStandardMaterial color="#334455" />
        </Text>
      ) : (
        entries.slice(0, 5).map((entry, i) => {
          const yPos = 1.0 - i * 0.9;
          const rankColor = i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : '#445566';
          return (
            <group key={`${entry.initial}-${i}`} position={[0, yPos, 0.35]}>
              <Text position={[-3.0, 0, 0]} fontSize={i === 0 ? 0.42 : 0.35} color={rankColor} renderOrder={200}>
                {i === 0 ? '★' : `#${i + 1}`}
                <meshStandardMaterial emissive={rankColor} emissiveIntensity={1.5} toneMapped={false} />
              </Text>
              <Text position={[-1.8, 0, 0]} fontSize={0.42} color="#ffffff" renderOrder={200}>
                {entry.initial}
                <meshStandardMaterial emissive="#ffffff" emissiveIntensity={1} toneMapped={false} />
              </Text>
              <Text position={[3.0, 0, 0]} fontSize={0.35} color="#aaddff" renderOrder={200}>
                {entry.score.toLocaleString()}
                <meshStandardMaterial emissive="#aaddff" emissiveIntensity={1} toneMapped={false} />
              </Text>
            </group>
          );
        })
      )}
    </group>
  );
}

/**
 * 3Dシーンメイン
 */
export default function Scene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const handsDataRef: BothHandsDataRef = useRef({ ...DEFAULT_BOTH_HANDS });
  const leftHandRef = useRef(createHandProxy(handsDataRef, 'left')).current;
  const rightHandRef = useRef(createHandProxy(handsDataRef, 'right')).current;
  
  const { state: musicState, positionRef } = useMusicPlayer();
  const { stateRef } = useGameState();

  const [cinematicActive, setCinematicActive] = useState(false);

  // ゲーム開始前のタイトル画面表示中、またはゲーム終了後のドローン演出アクティブ時
  const isDroneActive = cinematicActive || (!musicState.isPlaying && !musicState.isTrackingTest);

  // 視点リセット制御用の状態変数とRef
  const controlsRef = useRef<any>(null);
  const [resetTrigger, setResetTrigger] = useState(0);
  const [showResetButton, setShowResetButton] = useState(false);
  const pendingCinematicRef = useRef<boolean>(false);
  const isResettingRef = useRef<boolean>(false);

  // カメラがデフォルト位置・ターゲットからズレているか判定
  const isCameraMoved = useCallback(() => {
    if (!controlsRef.current) return false;
    const camera = controlsRef.current.object;
    if (!camera) return false;

    const distToDefault = camera.position.distanceTo(new THREE.Vector3(0, 0, 8));
    const distToTarget = controlsRef.current.target.distanceTo(new THREE.Vector3(0, -5, -80));

    // 0.1ユニット以上のズレを検知
    return distToDefault > 0.1 || distToTarget > 0.1;
  }, []);

  // カメラ操作時にリセットボタンの表示状態を更新
  const handleControlsChange = useCallback(() => {
    if (isResettingRef.current) {
      setShowResetButton(false);
      return;
    }
    if (musicState.isAutoPlayMode && musicState.isPlaying && !cinematicActive) {
      setShowResetButton(isCameraMoved());
    } else {
      setShowResetButton(false);
    }
  }, [musicState.isAutoPlayMode, musicState.isPlaying, cinematicActive, isCameraMoved]);

  // 手動リセットボタン押下時
  const handleResetView = useCallback(() => {
    isResettingRef.current = true;
    setResetTrigger((prev) => prev + 1);
    setShowResetButton(false);
  }, []);

  // 補間リセット完了時（自動リセット後のドローン演出移行用）
  const handleResetComplete = useCallback(() => {
    isResettingRef.current = false;
    if (pendingCinematicRef.current) {
      pendingCinematicRef.current = false;
      setCinematicActive(true);
    }
    setShowResetButton(false);
  }, []);

  // 再生停止時の状態クリーンアップ
  useEffect(() => {
    if (!musicState.isPlaying) {
      setShowResetButton(false);
      pendingCinematicRef.current = false;
      isResettingRef.current = false;
    }
  }, [musicState.isPlaying]);

  useEffect(() => {
    const startCinematic = () => {
      // もし視点が移動している場合は、一旦デフォルト視点へリセットした後にドローン演出を開始する
      if (musicState.isAutoPlayMode && isCameraMoved()) {
        isResettingRef.current = true;
        pendingCinematicRef.current = true;
        setResetTrigger((prev) => prev + 1);
        stateRef.current.productionLevel = 8;
      } else {
        // 視点移動が無い場合は即座にドローン演出を開始
        setCinematicActive(true);
        stateRef.current.productionLevel = 8;
      }
    };
    const stopCinematic = () => {
      setCinematicActive(false);
      pendingCinematicRef.current = false;
    };

    window.addEventListener('mikuset-result-cinematic' as any, startCinematic);
    window.addEventListener('mikuset-stop-cinematic' as any, stopCinematic);
    return () => {
      window.removeEventListener('mikuset-result-cinematic' as any, startCinematic);
      window.removeEventListener('mikuset-stop-cinematic' as any, stopCinematic);
    };
  }, [stateRef, musicState.isAutoPlayMode, isCameraMoved]);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}>
      {!musicState.isVirtualInputMode && (
        <MotionDetector 
          handsDataRef={handsDataRef} 
          isVisible={musicState.isTrackingTest || (musicState.isPlaying && !musicState.isVirtualInputMode)}
          isSwingTestMode={musicState.isTrackingTest}
          threshold={stateRef.current.motionThreshold}
          cooldownMs={stateRef.current.swingCooldownMs}
          onSwing={(hand) => {
            if (musicState.isTrackingTest) {
              playTambourineSE();
              window.dispatchEvent(new CustomEvent('mikuset-test-swing', { detail: { hand } }));
            }
          }}
        />
      )}





      {/* 視点手動リセットボタン（オートプレイ中に視点移動があるときのみ浮き出て表示） */}
      {showResetButton && (
        <button
          onClick={handleResetView}
          style={{
            position: 'absolute',
            bottom: '24px',
            right: '24px',
            zIndex: 10000,
            padding: '12px 24px',
            fontSize: '15px',
            fontWeight: 800,
            letterSpacing: '1px',
            color: '#ffffff',
            background: 'rgba(0, 210, 255, 0.2)',
            border: '2px solid rgba(0, 210, 255, 0.6)',
            borderRadius: '24px',
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 0 20px rgba(0, 210, 255, 0.3), inset 0 0 10px rgba(0, 210, 255, 0.2)',
            transition: 'all 0.2s ease',
            pointerEvents: 'auto',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = 'rgba(0, 210, 255, 0.4)';
            e.currentTarget.style.boxShadow = '0 0 30px rgba(0, 210, 255, 0.6), inset 0 0 15px rgba(0, 210, 255, 0.3)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = 'rgba(0, 210, 255, 0.2)';
            e.currentTarget.style.boxShadow = '0 0 20px rgba(0, 210, 255, 0.3), inset 0 0 10px rgba(0, 210, 255, 0.2)';
          }}
        >
          視点をリセット
        </button>
      )}

      <Canvas style={{ width: '100%', height: '100%', background: '#050510' }}>
        <Suspense fallback={null}>
          <ResponsiveCamera cinematicActive={isDroneActive} />
          <CameraReset 
            isAutoPlayMode={musicState.isAutoPlayMode} 
            cinematicActive={isDroneActive} 
            controlsRef={controlsRef}
            resetTrigger={resetTrigger}
            onResetComplete={handleResetComplete}
          />
          <DroneCinematic active={isDroneActive} />

          {!musicState.isPlaying && !musicState.isTrackingTest && (
            <CinematicTitle activeSongUrl={musicState.activeSongUrl} />
          )}

          {(musicState.isPlaying || musicState.isTrackingTest || isDroneActive) && (
            <StageProduction isDroneActive={isDroneActive} />
          )}
          {(musicState.isPlaying === true || musicState.isTrackingTest === true) && (
            <>
              <JudgeLine />
              <PlayAreaFrame isVisible={true} />
              <Baton handDataRef={leftHandRef} trailColor="#66aaff" />
              <Baton handDataRef={rightHandRef} trailColor="#ff66aa" />
            </>
          )}

          <NoteManager handsDataRef={handsDataRef} />

          {musicState.isVirtualInputMode && musicState.isPlaying && (
            <GridProjector />
          )}



          <OrbitControls 
            ref={controlsRef}
            onChange={handleControlsChange}
            enabled={musicState.isAutoPlayMode && !isDroneActive} 
            enableRotate={musicState.isAutoPlayMode && !isDroneActive}
            enableZoom={musicState.isAutoPlayMode && !isDroneActive}
            enablePan={false}
            minDistance={10}
            maxDistance={150}
            target={[0, -5, -80]}
          />
          <MagicalGuestEffects />
        </Suspense>
      </Canvas>

      {musicState.isVirtualInputMode && musicState.isPlaying && (
        <VirtualInputManager handsDataRef={handsDataRef} isActive={musicState.isVirtualInputMode} />
      )}



      <PhraseDisplay positionRef={positionRef} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// マジカル・ゲストモード用 3D 視覚効果（波紋＆パーティクル）
// ---------------------------------------------------------------------------
interface ParticleItem {
  id: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: string;
  size: number;
  opacity: number;
  life: number;
}

interface RippleItem {
  id: string;
  scale: number;
  opacity: number;
  color: string;
}

function MagicalGuestEffects() {
  const [ripples, setRipples] = useState<RippleItem[]>([]);
  const [particles, setParticles] = useState<ParticleItem[]>([]);

  useEffect(() => {
    const handleTrigger = (e: any) => {
      const type = e.detail?.type; // 'sparkle' | 'pop' | 'blink' | 'tambourine'
      const id = Math.random().toString(36).substring(2, 9);
      
      // 1. 波紋（リップル）の追加
      let rippleColor = '#ff66b2';
      if (type === 'pop' || type === 'tambourine') {
        rippleColor = '#00d2ff';
      } else if (type === 'blink') {
        rippleColor = '#39ff14';
      }
      setRipples((prev) => [
        ...prev,
        { id, scale: 0.1, opacity: 0.8, color: rippleColor }
      ]);

      // 2. パーティクル（キラキラ）の追加（35個）
      const newParticles: ParticleItem[] = [];
      let colors = ['#ff3399', '#ff85c2', '#ffeb3b', '#e040fb']; // sparkle (笑顔: ピンク系)
      if (type === 'pop' || type === 'tambourine') {
        colors = ['#00b2ff', '#66d9ff', '#00e5ff', '#1de9b6']; // pop/tambourine (口開き: 青系)
      } else if (type === 'blink') {
        colors = ['#39ff14', '#bfff00', '#00ff88', '#adff2f']; // blink (まばたき: 緑系)
      }

      for (let i = 0; i < 35; i++) {
        // カメラの手前（Z=7付近）のランダムな位置
        const x = (Math.random() - 0.5) * 8;
        const y = -4 + Math.random() * 2;
        const z = 6 + Math.random() * 1.5;

        // 上昇および拡散方向の初期速度
        const vx = (Math.random() - 0.5) * 4;
        const vy = 5 + Math.random() * 5;
        const vz = (Math.random() - 0.5) * 2;

        const color = colors[Math.floor(Math.random() * colors.length)];
        const size = 0.05 + Math.random() * 0.12;

        newParticles.push({
          id: `${id}-${i}`,
          position: new THREE.Vector3(x, y, z),
          velocity: new THREE.Vector3(vx, vy, vz),
          color,
          size,
          opacity: 1.0,
          life: 1.0
        });
      }
      setParticles((prev) => [...prev, ...newParticles]);
    };

    window.addEventListener('mikuset-magical-trigger', handleTrigger);
    return () => {
      window.removeEventListener('mikuset-magical-trigger', handleTrigger);
    };
  }, []);

  useFrame((_, delta) => {
    const d = Math.min(0.1, delta); // 極端なフレーム落ち対策

    // A. 波紋の更新
    setRipples((prev) =>
      prev
        .map((r) => ({
          ...r,
          scale: r.scale + d * 22.0,
          opacity: r.opacity - d * 1.3
        }))
        .filter((r) => r.opacity > 0)
    );

    // B. パーティクルの更新
    setParticles((prev) =>
      prev
        .map((p) => {
          const nextPos = p.position.clone().addScaledVector(p.velocity, d);
          const nextVel = p.velocity.clone().multiplyScalar(0.94);
          nextVel.y += d * 1.8; // 上昇方向の微小加速

          const nextLife = p.life - d * 0.85;
          return {
            ...p,
            position: nextPos,
            velocity: nextVel,
            life: nextLife,
            opacity: Math.max(0, nextLife)
          };
        })
        .filter((p) => p.life > 0)
    );
  });

  return (
    <group>
      {/* リップルエフェクト */}
      {ripples.map((r) => (
        <mesh key={r.id} position={[0, -1, 6.8]}>
          <ringGeometry args={[r.scale, r.scale + 0.08, 64]} />
          <meshBasicMaterial
            color={r.color}
            transparent
            opacity={r.opacity}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      {/* パーティクルエフェクト */}
      {particles.map((p) => (
        <mesh key={p.id} position={p.position}>
          <tetrahedronGeometry args={[p.size]} />
          <meshBasicMaterial
            color={p.color}
            transparent
            opacity={p.opacity}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

