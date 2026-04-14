import { useRef, useMemo, memo } from 'react';
import { useFrame } from '@react-three/fiber';
import { CameraShake } from '@react-three/drei';
import * as THREE from 'three';
import { useGameState } from '../hooks/useGameState';
import { useMusicPlayer } from '../hooks/useMusicPlayer';

// ---------------------------------------------------------------------------
// 共通レベル計算関数 (useFrame内で使用)
// ---------------------------------------------------------------------------
function calculateFinalLevel(
  baseLevel: number,
  now: number,
  choruses: { startTime: number; endTime: number }[] | undefined
): number {
  let isChorus = false;
  if (choruses && choruses.length > 0) {
    for (const c of choruses) {
      if (now >= c.startTime && now <= c.endTime) {
        isChorus = true;
        break;
      }
    }
  }
  return Math.max(baseLevel, isChorus ? 4 : 0);
}

// ---------------------------------------------------------------------------
// DynamicLights: 進行に合わせてライトの強さや色を変える
// ---------------------------------------------------------------------------
function DynamicLights() {
  const ambientRef = useRef<THREE.AmbientLight>(null!);
  const mainSpotRef = useRef<THREE.SpotLight>(null!);
  const subSpotLeftRef = useRef<THREE.SpotLight>(null!);
  const subSpotRightRef = useRef<THREE.SpotLight>(null!);

  const { stateRef } = useGameState();
  const { positionRef } = useMusicPlayer();
  const choruses = (window as unknown as Record<string, unknown>).__mikusetChoruses as { startTime: number; endTime: number }[] | undefined;

  useFrame((state, delta) => {
    const level = calculateFinalLevel(stateRef.current.productionLevel, positionRef.current, choruses);

    // 目標値（Levelごとに設定）
    let targetAmbient = 0.05;
    let targetMainSpot = 0;
    let targetSubSpot = 0;

    if (level === 1) {
      targetAmbient = 0.15;
      targetMainSpot = 1.0;
      targetSubSpot = 0;
    } else if (level === 2) {
      targetAmbient = 0.2;
      targetMainSpot = 2.0;
      targetSubSpot = 0.5;
    } else if (level >= 3) {
      targetAmbient = 0.3;
      targetMainSpot = 3.0;
      targetSubSpot = 1.5;
    }

    // Lerpで滑らかに遷移
    if (ambientRef.current) ambientRef.current.intensity = THREE.MathUtils.lerp(ambientRef.current.intensity, targetAmbient, delta * 2);
    if (mainSpotRef.current) mainSpotRef.current.intensity = THREE.MathUtils.lerp(mainSpotRef.current.intensity, targetMainSpot, delta * 3);
    if (subSpotLeftRef.current) subSpotLeftRef.current.intensity = THREE.MathUtils.lerp(subSpotLeftRef.current.intensity, targetSubSpot, delta * 2);
    if (subSpotRightRef.current) subSpotRightRef.current.intensity = THREE.MathUtils.lerp(subSpotRightRef.current.intensity, targetSubSpot, delta * 2);

    // Level 3以上でSpotLightの色を動的にブレンド
    if (level >= 3 && mainSpotRef.current) {
      const t = state.clock.elapsedTime * 2;
      const r = Math.sin(t) * 0.5 + 0.5;
      const b = Math.cos(t * 1.5) * 0.5 + 0.5;
      mainSpotRef.current.color.setRGB(r, 0.5, b);
      if (level === 4) {
        // サビ中は激しくフラッシュ
        mainSpotRef.current.intensity += Math.sin(t * 10) * 0.5 + 0.5;
      }
    } else if (mainSpotRef.current) {
      // 基本色に戻す
      mainSpotRef.current.color.setHex(0xffffff);
    }
  });

  return (
    <group>
      <ambientLight ref={ambientRef} intensity={0.05} />
      {/* センターライト */}
      <spotLight ref={mainSpotRef} position={[0, 5, 5]} angle={0.5} penumbra={0.5} intensity={0} castShadow />
      {/* サイドライト（左・青系） */}
      <spotLight ref={subSpotLeftRef} position={[-5, 2, -2]} angle={0.8} penumbra={0.5} color="#3388ff" intensity={0} />
      {/* サイドライト（右・ピンク系） */}
      <spotLight ref={subSpotRightRef} position={[5, 2, -2]} angle={0.8} penumbra={0.5} color="#ff66aa" intensity={0} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// CyberBackground: shader material によるネオングリッド
// ---------------------------------------------------------------------------
const backgroundVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const backgroundFragmentShader = `
  uniform float uTime;
  uniform float uIntensity;
  varying vec2 vUv;

  void main() {
    // 遠近感のあるグリッド
    vec2 p = vUv * 2.0 - 1.0;
    
    // UVを床のようなパースに曲げる簡単なテクニック
    vec2 uv = vec2(p.x / abs(p.y), 1.0 / abs(p.y) + uTime * 2.0);
    
    float grid = abs(sin(uv.x * 20.0)) * abs(sin(uv.y * 20.0));
    // 線の部分だけ太らせる
    float line = smoothstep(0.1, 0.0, grid);
    
    // 中央からフェードアウト
    float fade = smoothstep(1.0, 0.0, length(p));
    
    // Levelに応じた強度
    vec3 color = vec3(0.1, 0.4, 0.8) * line * fade * uIntensity;
    
    gl_FragColor = vec4(color, 1.0);
  }
`;

function CyberBackground() {
  const materialRef = useRef<THREE.ShaderMaterial>(null!);

  const { stateRef } = useGameState();
  const { positionRef } = useMusicPlayer();
  const choruses = (window as unknown as Record<string, unknown>).__mikusetChoruses as { startTime: number; endTime: number }[] | undefined;


  useFrame((state, delta) => {
    if (!materialRef.current) return;
    const level = calculateFinalLevel(stateRef.current.productionLevel, positionRef.current, choruses);
    materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    
    // Level 2以上で背景が光る
    const targetIntensity = level >= 2 ? (level === 4 ? 1.5 : 0.8) : 0.0;
    const current = materialRef.current.uniforms.uIntensity.value;
    materialRef.current.uniforms.uIntensity.value = THREE.MathUtils.lerp(current, targetIntensity, delta * 2);
  });

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uIntensity: { value: 0 },
    }),
    []
  );

  return (
    <mesh position={[0, -2, -40]} rotation={[-0.2, 0, 0]}>
      <planeGeometry args={[200, 100]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={backgroundVertexShader}
        fragmentShader={backgroundFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
// AudiencePenlights: 客席を完全に埋め尽くすペンライト演出
// ---------------------------------------------------------------------------
const MAX_PENLIGHTS = 1000;

function AudiencePenlights() {
  const groupRef = useRef<THREE.Group>(null!);
  const coreMeshRef = useRef<THREE.InstancedMesh>(null!);
  const glowMeshRef = useRef<THREE.InstancedMesh>(null!);
  
  const { stateRef } = useGameState();
  const { positionRef } = useMusicPlayer();
  const choruses = (window as unknown as Record<string, unknown>).__mikusetChoruses as { startTime: number; endTime: number }[] | undefined;

  // ペンライトの初期位置とパラメータ
  // トラッキングエリア外 (x < -5 または x > 5) に配置
  const penlights = useMemo(() => {
    const arr = [];
    for (let i = 0; i < MAX_PENLIGHTS; i++) {
        const isLeft = Math.random() > 0.5;
        // 会場全体を埋め尽くすように左右と奥に広大に配置
        const xOffset = 5.0 + Math.pow(Math.random(), 1.5) * 80.0; 
        const x = isLeft ? -xOffset : xOffset;
        
        arr.push({
            pos: new THREE.Vector3(
              x, 
              -6 + Math.random() * 4, 
              -5 - Math.random() * 120
            ),
            phase: Math.random() * Math.PI * 2,
            speed: 1.5 + Math.random() * 2.0,
        });
    }
    return arr;
  }, []);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorObj = useMemo(() => new THREE.Color(), []);

  useFrame((state, delta) => {
    if (!coreMeshRef.current || !glowMeshRef.current || !groupRef.current) return;
    
    const level = calculateFinalLevel(stateRef.current.productionLevel, positionRef.current, choruses);
    
    // Level 1: 0本, Level 2: 30本, Level 3: 80本, Level 4: 150本
    let targetCount = 0;
    if (level === 2) targetCount = 100;
    else if (level === 3) targetCount = 300;
    else if (level >= 4) targetCount = MAX_PENLIGHTS;

    // 滑らかに増減させるなら scale を使うか、今回は単純に count を切り替える
    // InstancedMesh の count を動的に変えるのもありだが、今回は見えない位置に飛ばす等の簡易版。
    // count プロパティを直接変えるのが手軽
    coreMeshRef.current.count = targetCount;
    glowMeshRef.current.count = targetCount;

    if (targetCount === 0) {
        groupRef.current.visible = false;
        return;
    }
    groupRef.current.visible = true;
    
    const time = state.clock.elapsedTime;
    
    for (let i = 0; i < targetCount; i++) {
        const p = penlights[i];
        
        // 腕を振るように根本を支点にして揺らす
        const angle = Math.sin(time * p.speed + p.phase) * (Math.PI / 4); // 振れ幅大きめ
        
        // ペンライトの底辺を中心回転軸にするためのオフセット計算
        // length = 1.25 なので、その半分(0.625)だけY軸のローカル方向にずらす
        const pivotYOffset = 0.625; 
        const rotatedOffsetX = -Math.sin(angle) * pivotYOffset;
        const rotatedOffsetY = Math.cos(angle) * pivotYOffset;
        
        dummy.position.copy(p.pos);
        dummy.position.x += rotatedOffsetX;
        dummy.position.y += rotatedOffsetY;
        dummy.rotation.set(0, 0, angle);
        dummy.scale.set(1.0, 1.0, 1.0); 
        dummy.updateMatrix();
        coreMeshRef.current.setMatrixAt(i, dummy.matrix);
        glowMeshRef.current.setMatrixAt(i, dummy.matrix);

        // レベルに応じたカラーバリエーション
        // 5曲目(インデックス4)は鏡音リン、それ以外は初音ミク
        const isRin = stateRef.current.songIndex === 4;
        const mainColor = isRin ? 0xfcf5a7 : 0x86cecb;
        const accentColors = [0xcb213c, 0xaeb6e5, 0xebd3cf]; // MEIKO, KAITO, LUKA

        if (level <= 2) {
            // 会場全体が一色のメインカラー
            colorObj.setHex(mainColor);
        } else {
            // コンボが上がった時の演出 (Level 3以降)
            // 7割メイン、3割ランダムで全バリエーションの差し色
            // useFrame内で毎フレーム変わらないよう、i を使った疑似乱数(ハッシュ)で判定する
            const pseudoRandom = (i * 17) % 100; // 0 〜 99 の分散された値
            if (pseudoRandom < 30) {
                // 30%の確率でアクセントカラーにする
                const colorIdx = (i * 31) % accentColors.length; // 色も均等にバラけさせる
                colorObj.setHex(accentColors[colorIdx]);
            } else {
                // 残り70%はメインカラー
                colorObj.setHex(mainColor);
            }
        }
        
        // 遠距離で細すぎると1ピクセルの白線に潰れてしまうため、コアも色付きにする
        coreMeshRef.current.setColorAt(i, colorObj);
        glowMeshRef.current.setColorAt(i, colorObj);
    }
    
    coreMeshRef.current.instanceMatrix.needsUpdate = true;
    glowMeshRef.current.instanceMatrix.needsUpdate = true;
    if (glowMeshRef.current.instanceColor) {
        glowMeshRef.current.instanceColor.needsUpdate = true;
    }
    if (coreMeshRef.current.instanceColor) {
        coreMeshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      {/* 発光用アウターシェル: 少し太くして遠距離でも色が残るように */}
      <instancedMesh ref={glowMeshRef} args={[undefined, undefined, MAX_PENLIGHTS]}>
        <cylinderGeometry args={[0.2, 0.2, 1.25, 8]} />
        <meshBasicMaterial transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      {/* 中心コア: 少し太く */}
      <instancedMesh ref={coreMeshRef} args={[undefined, undefined, MAX_PENLIGHTS]}>
        <cylinderGeometry args={[0.08, 0.08, 1.2, 8]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  );
}


export default memo(function StageProduction() {
  const { getSnapshot } = useGameState();
  const { positionRef } = useMusicPlayer();
  const gameState = getSnapshot();
  const baseLevel = gameState.productionLevel;
  
  // TextAlive のサビ判定
  const choruses = (window as unknown as Record<string, unknown>).__mikusetChoruses as { startTime: number; endTime: number }[] | undefined;
  
  // 現在時刻がサビの中か判定 (サビなら強制Level 4)
  const now = positionRef.current;
  let isChorus = false;
  if (choruses && choruses.length > 0) {
      for (const c of choruses) {
          if (now >= c.startTime && now <= c.endTime) {
              isChorus = true;
              break;
          }
      }
  }

  const finalLevel = Math.max(baseLevel, isChorus ? 4 : 0);
  const shakeIntensity = finalLevel >= 4 ? 0.05 : (finalLevel === 3 ? 0.02 : 0);

  return (
    <group>
      <DynamicLights />
      <CyberBackground />
      <AudiencePenlights />
      {shakeIntensity > 0 && (
        <CameraShake 
          maxYaw={shakeIntensity} 
          maxPitch={shakeIntensity} 
          maxRoll={shakeIntensity} 
          yawFrequency={0.5} 
          pitchFrequency={0.5} 
          rollFrequency={0.5} 
        />
      )}
    </group>
  );
});
