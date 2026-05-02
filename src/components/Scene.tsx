import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
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
import { DIFFICULTY_LEVELS } from '../config/difficulty';
import { getRankingByDifficulty } from '../utils/ranking';
import type { RankingEntry } from '../utils/ranking';
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
function ResponsiveCamera() {
  const { viewport } = useThree();
  const aspect = viewport.aspect;
  const baseFov = 50;
  const responsiveFov = aspect < 1.77 ? baseFov * (1.77 / aspect) : baseFov;
  const finalFov = Math.min(responsiveFov, 95);

  return <PerspectiveCamera makeDefault position={[0, 0, 8]} fov={finalFov} />;
}

/**
 * オートプレイ解除時にカメラ位置をデフォルトにリセットする
 */
function CameraReset({ isAutoPlayMode, cinematicActive }: { isAutoPlayMode: boolean, cinematicActive: boolean }) {
  const { camera } = useThree();
  const prevAutoPlay = useRef(isAutoPlayMode);
  const prevCinematic = useRef(cinematicActive);

  useEffect(() => {
    const autoPlayStopped = prevAutoPlay.current && !isAutoPlayMode;
    const cinematicStopped = prevCinematic.current && !cinematicActive;

    if (autoPlayStopped || cinematicStopped) {
      camera.position.set(0, 0, 8);
      camera.rotation.set(0, 0, 0);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    }
    prevAutoPlay.current = isAutoPlayMode;
    prevCinematic.current = cinematicActive;
  }, [isAutoPlayMode, cinematicActive, camera]);

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

/**
 * ドローンシネマティック
 */
function DroneCinematic({ active }: { active: boolean }) {
  const { camera } = useThree();
  const startTimeRef = useRef(0);
  const prevActive = useRef(false);

  const curve = useMemo(() => {
    return new THREE.CatmullRomCurve3([
      new THREE.Vector3(3.5, -2, -92),    // スタート：ボーカルの斜め後方（シルエット内部への入り込みを完全に回避）
      new THREE.Vector3(0, 22, -82),      // 上昇：全体俯瞰
      new THREE.Vector3(65, 18, -40),     // 右翼
      new THREE.Vector3(35, 10, 20),      // 後方
      new THREE.Vector3(0, 14, 55),       // 正面
      new THREE.Vector3(-35, 10, 20),     // 左翼
      new THREE.Vector3(-65, 18, -40),    // 左側接近
      new THREE.Vector3(-25, 12, -82),    // 裏側へ
    ], true);
  }, []);

  const targetLookAt = useMemo(() => new THREE.Vector3(0, -5, 0), []);
  const currentLookAt = useRef(new THREE.Vector3());
  
  useEffect(() => {
    if (active) {
      // 演出開始時に即座にカメラを初期位置へワープさせる
      const startPos = curve.getPointAt(0);
      camera.position.copy(startPos);
      currentLookAt.current.copy(targetLookAt);
      camera.lookAt(currentLookAt.current);
      camera.updateProjectionMatrix();
    }
  }, [active, curve, targetLookAt, camera]);

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
        const startPos = curve.getPointAt(0);
        camera.position.copy(startPos);
        camera.lookAt(targetLookAt);
      } catch (err) {
        console.error("[DroneCinematic] Initialization error:", err);
      }
    }

    const elapsed = state.clock.elapsedTime - startTimeRef.current;
    const t = (elapsed * 0.03) % 1;
    const pos = curve.getPointAt(t);

    // 最初のアニメーション開始時は、前のカメラ位置からの「滑り（Lerp）」を回避するために即座にセットする
    if (elapsed < 0.25) {
      camera.position.copy(pos);
    } else {
      camera.position.lerp(pos, 0.08);
    }

    // 注視点も動的に補間。スタート時は targetLookAt (客席方向) を優先
    const lookAtPoint = targetLookAt.clone().lerp(curve.getPointAt((t + 0.05) % 1), 0.15);
    if (elapsed < 0.25) {
      currentLookAt.current.copy(lookAtPoint);
    } else {
      currentLookAt.current.lerp(lookAtPoint, 0.08);
    }
    camera.lookAt(currentLookAt.current);
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
  const handsDataRef: BothHandsDataRef = useRef({ ...DEFAULT_BOTH_HANDS });
  const leftHandRef = useRef(createHandProxy(handsDataRef, 'left')).current;
  const rightHandRef = useRef(createHandProxy(handsDataRef, 'right')).current;
  
  const { state: musicState, positionRef } = useMusicPlayer();
  const { stateRef } = useGameState();

  const [cinematicActive, setCinematicActive] = useState(false);


  useEffect(() => {
    const startCinematic = (e: any) => {
      // ステージクリア時は常にドローン演出を有効化
      setCinematicActive(true);
      stateRef.current.productionLevel = 8;
    };
    const stopCinematic = () => {
      setCinematicActive(false);
    };

    window.addEventListener('mikuset-result-cinematic' as any, startCinematic);
    window.addEventListener('mikuset-stop-cinematic' as any, stopCinematic);
    return () => {
      window.removeEventListener('mikuset-result-cinematic' as any, startCinematic);
      window.removeEventListener('mikuset-stop-cinematic' as any, stopCinematic);
    };
  }, [stateRef]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}>
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

      {musicState.isVirtualInputMode && musicState.isPlaying && (
        <VirtualInputManager handsDataRef={handsDataRef} isActive={musicState.isVirtualInputMode} />
      )}

      <PhraseDisplay positionRef={positionRef} />

      <Canvas style={{ width: '100%', height: '100%', background: '#050510' }}>
        <ResponsiveCamera />
        <CameraReset isAutoPlayMode={musicState.isAutoPlayMode} cinematicActive={cinematicActive} />
        <DroneCinematic active={cinematicActive} />

        {!musicState.isPlaying && !musicState.isTrackingTest && !cinematicActive && (
          <CinematicTitle activeSongUrl={musicState.activeSongUrl} />
        )}

        <StageProduction />
        {(musicState.isPlaying === true || musicState.isTrackingTest === true) && (
          <>
            <JudgeLine />
            <PlayAreaFrame isVisible={true} />
            <Baton handDataRef={leftHandRef} trailColor="#66aaff" />
            <Baton handDataRef={rightHandRef} trailColor="#ff66aa" />
          </>
        )}

        <NoteManager handsDataRef={handsDataRef} />

        <OrbitControls 
          enabled={musicState.isAutoPlayMode && !cinematicActive} 
          enableRotate={musicState.isAutoPlayMode && !cinematicActive}
          enableZoom={musicState.isAutoPlayMode && !cinematicActive}
        />
      </Canvas>
    </div>
  );
}
