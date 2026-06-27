import { useRef, useMemo, memo, Suspense } from 'react';
import { useFrame } from '@react-three/fiber';
import { CameraShake, Text } from '@react-three/drei';
import * as THREE from 'three';
import { useGameState } from '../hooks/useGameState';
import { useMusicPlayer } from '../hooks/useMusicPlayer';
import { CONTEST_SONGS } from '../config/songs';
import { getRankingByDifficulty } from '../utils/ranking';

// ---------------------------------------------------------------------------
// 共通レベル計算関数 (useFrame内で使用)
// ---------------------------------------------------------------------------
function calculateFinalLevel(
  baseLevel: number,
  now: number,
  choruses: { startTime: number; endTime: number }[] | undefined
): number {
  // ★ 再生位置が0以下 = 非プレイ状態 → サビブーストを無効化してエフェクト残像を防止
  if (now <= 0) return baseLevel;

  let isChorus = false;
  if (choruses && choruses.length > 0) {
    for (const c of choruses) {
      if (now >= c.startTime && now <= c.endTime) {
        isChorus = true;
        break;
      }
    }
  }
  return Math.max(baseLevel, isChorus ? 8 : 0);
}

// ---------------------------------------------------------------------------
// DynamicLights: 進行に合わせてライトの強さや色を変える
// ---------------------------------------------------------------------------
function DynamicLights({ isDroneActive }: { isDroneActive: boolean }) {
  const ambientRef = useRef<THREE.AmbientLight>(null!);
  const mainSpotRef = useRef<THREE.SpotLight>(null!);
  const subSpotLeftRef = useRef<THREE.SpotLight>(null!);
  const subSpotRightRef = useRef<THREE.SpotLight>(null!);

  const { stateRef } = useGameState();
  const { state: musicState, positionRef } = useMusicPlayer();
  const songIndex = useMemo(() => {
    return CONTEST_SONGS.findIndex((s) => s.url === musicState.activeSongUrl);
  }, [musicState.activeSongUrl]);
  const choruses = (window as unknown as Record<string, unknown>).__mikusetChoruses as { startTime: number; endTime: number }[] | undefined;


  useFrame((state, delta) => {
    const baseLevel = isDroneActive ? 8 : stateRef.current.productionLevel;
    const level = calculateFinalLevel(baseLevel, positionRef.current, choruses);

    // 目標値（Levelごとに設定）
    let targetAmbient = 0.05;
    let targetMainSpot = 0;
    let targetSubSpot = 0;

    if (level === 1) {
      targetAmbient = 0.05;
      targetMainSpot = 1.0;
      targetSubSpot = 0;
    } else if (level === 2) {
      targetAmbient = 0.1;
      targetMainSpot = 1.5;
      targetSubSpot = 0.2;
    } else if (level === 3) {
      targetAmbient = 0.15;
      targetMainSpot = 2.0;
      targetSubSpot = 0.5;
    } else if (level === 4) {
      targetAmbient = 0.2;
      targetMainSpot = 2.5;
      targetSubSpot = 1.0;
    } else if (level >= 5) {
      targetAmbient = 0.3;
      targetMainSpot = 4.0 + (level - 5) * 0.5;
      targetSubSpot = 1.5 + (level - 5) * 0.5;
    }

    // Lerpで滑らかに遷移
    if (ambientRef.current) ambientRef.current.intensity = THREE.MathUtils.lerp(ambientRef.current.intensity, targetAmbient, delta * 2);
    if (mainSpotRef.current) mainSpotRef.current.intensity = THREE.MathUtils.lerp(mainSpotRef.current.intensity, targetMainSpot, delta * 3);
    if (subSpotLeftRef.current) subSpotLeftRef.current.intensity = THREE.MathUtils.lerp(subSpotLeftRef.current.intensity, targetSubSpot, delta * 2);
    if (subSpotRightRef.current) subSpotRightRef.current.intensity = THREE.MathUtils.lerp(subSpotRightRef.current.intensity, targetSubSpot, delta * 2);

    // Level 3以上でSpotLightの色を動的にブレンド
    if (level >= 3 && mainSpotRef.current) {
      const isRin = songIndex === 4;
      if (isRin) {
        // リンの曲：青と暗いオレンジの組み合わせに変更（黄色を引き立てるため）
        const t = state.clock.elapsedTime * 1.5;
        const colorA = new THREE.Color("#0044ff"); // 青
        const colorB = new THREE.Color("#cc5500"); // 暗いオレンジ
        const mix = Math.sin(t) * 0.5 + 0.5;
        mainSpotRef.current.color.copy(colorA).lerp(colorB, mix);
      } else {
        const t = state.clock.elapsedTime * 2;
        const r = Math.sin(t) * 0.5 + 0.5;
        const b = Math.cos(t * 1.5) * 0.5 + 0.5;
        mainSpotRef.current.color.setRGB(r, 0.5, b);
      }

      
      // レベルに応じたフラッシュ周期 (Stage 3 = Level 6以上で高速)
      const flashFreq = level >= 6 ? 15 : 8;
      const flash = Math.sin(state.clock.elapsedTime * flashFreq);
      if (flash > 0.5) {
        mainSpotRef.current.intensity *= 1.5;
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
      <spotLight ref={mainSpotRef} position={[0, 8, 2]} angle={0.4} penumbra={0.3} intensity={0} castShadow />
      {/* サイドライト */}
      <spotLight ref={subSpotLeftRef} position={[-8, 4, -4]} angle={0.8} penumbra={0.5} color="#33aaff" intensity={0} />
      <spotLight ref={subSpotRightRef} position={[8, 4, -4]} angle={0.8} penumbra={0.5} color="#ff33aa" intensity={0} />
    </group>
  );
}


// ---------------------------------------------------------------------------
// StageSpotlights: ステージ上部と床面に配置されたビーム演出
// ---------------------------------------------------------------------------
function StageSpotlights({ isDroneActive }: { isDroneActive: boolean }) {
  const groupRef = useRef<THREE.Group>(null!);
  const floorGroupRef = useRef<THREE.Group>(null!);
  const { stateRef } = useGameState();
  const { state: musicState, positionRef } = useMusicPlayer();
  const songIndex = useMemo(() => {
    return CONTEST_SONGS.findIndex((s) => s.url === musicState.activeSongUrl);
  }, [musicState.activeSongUrl]);
  const choruses = (window as unknown as Record<string, unknown>).__mikusetChoruses as { startTime: number; endTime: number }[] | undefined;


  const spotlightCount = 10;
  // 天井からのライト設定
  const ceilingBeams = useMemo(() => {
    return Array.from({ length: spotlightCount }).map((_, i) => ({
      id: `ceiling-${i}`,
      x: (i - (spotlightCount - 1) / 2) * 3,
      y: 10,
      z: -10,
      angleZ: (i - (spotlightCount - 1) / 2) * 0.15, // ハの字に広げる
      angleX: 0.5, // ステージ床の方へ向ける
    }));
  }, []);

  // 床面からのライト（客席側へ向ける）設定
  const floorBeams = useMemo(() => {
    return Array.from({ length: 8 }).map((_, i) => ({
      id: `floor-${i}`,
      x: (i - 3.5) * 4,
      y: -2,
      z: -5,
      angleX: -0.6, // 客席（手前）側へ向ける
      angleZ: (i - 3.5) * 0.1,
    }));
  }, []);

  useFrame((state, delta) => {
    const baseLevel = isDroneActive ? 8 : stateRef.current.productionLevel;
    const level = calculateFinalLevel(baseLevel, positionRef.current, choruses);
    const t = state.clock.elapsedTime;

    // 天井ライトの制御
    if (groupRef.current) {
      groupRef.current.children.forEach((obj, i) => {
        const mesh = obj as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        let targetOpacity = 0;
        
        if (level >= 3) {
          targetOpacity = level >= 6 ? (Math.sin(t * 12 + i) > 0 ? 0.4 : 0.05) : 0.15;
          mesh.rotation.z = ceilingBeams[i].angleZ + Math.sin(t * 0.5 + i) * 0.2;
        }
        mat.opacity = THREE.MathUtils.lerp(mat.opacity, targetOpacity, delta * 5);
        mesh.visible = mat.opacity > 0.01;
      });
    }

    // 床ライトの制御
    if (floorGroupRef.current) {
      floorGroupRef.current.children.forEach((obj, i) => {
        const mesh = obj as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        let targetOpacity = 0;
        
        if (level >= 5) {
          // サビや高コンボ時のみ激しく点滅
          const flash = Math.sin(t * 15 + i * 2);
          targetOpacity = flash > 0.3 ? 0.3 : 0.02;
          mesh.rotation.y = Math.sin(t * 2 + i) * 0.3;
        }
        mat.opacity = THREE.MathUtils.lerp(mat.opacity, targetOpacity, delta * 3);
        mesh.visible = mat.opacity > 0.01;
      });
    }
  });

  return (
    <>
      <group ref={groupRef}>
        {ceilingBeams.map((b) => (
          <mesh key={b.id} position={[b.x, b.y, b.z]} rotation={[b.angleX, 0, b.angleZ]}>
            <cylinderGeometry args={[0.1, 2.5, 30, 8]} />
            <meshStandardMaterial 
              transparent 
              opacity={0} 
              depthWrite={false} 
              blending={THREE.AdditiveBlending} 
              side={THREE.DoubleSide} 
              toneMapped={false} 
              color={songIndex === 4 ? "#0044ff" : "#aaddff"} 
              emissive={songIndex === 4 ? "#0044ff" : "#aaddff"} 
              emissiveIntensity={1} 
            />
          </mesh>
        ))}
      </group>
      <group ref={floorGroupRef}>
        {floorBeams.map((b) => (
          <mesh key={b.id} position={[b.x, b.y, b.z]} rotation={[b.angleX, 0, b.angleZ]}>
            <cylinderGeometry args={[0.05, 3.0, 25, 8]} />
            <meshStandardMaterial 
              transparent 
              opacity={0} 
              depthWrite={false} 
              blending={THREE.AdditiveBlending} 
              side={THREE.DoubleSide} 
              toneMapped={false} 
              color={songIndex === 4 ? "#cc5500" : "#ff66aa"} 
              emissive={songIndex === 4 ? "#cc5500" : "#ff66aa"} 
              emissiveIntensity={1.5} 
            />
          </mesh>
        ))}
      </group>

    </>
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

function CyberBackground({ isDroneActive }: { isDroneActive: boolean }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null!);

  const { stateRef } = useGameState();
  const { positionRef } = useMusicPlayer();
  const choruses = (window as unknown as Record<string, unknown>).__mikusetChoruses as { startTime: number; endTime: number }[] | undefined;


  useFrame((state, delta) => {
    if (!materialRef.current) return;
    const baseLevel = isDroneActive ? 8 : stateRef.current.productionLevel;
    const level = calculateFinalLevel(baseLevel, positionRef.current, choruses);
    materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    
    // Level 2以上で背景が光る。コンボが上がるにつれて激しく
    const targetIntensity = level >= 2 ? (0.4 + level * 0.15) : 0.0;
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
    <mesh position={[0, -2, -40]} rotation={[-0.2, 0, 0]} renderOrder={-10}>
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
const MAX_PENLIGHTS = 500;

function AudiencePenlights({ isDroneActive }: { isDroneActive: boolean }) {
  const groupRef = useRef<THREE.Group>(null!);
  const coreMeshRef = useRef<THREE.InstancedMesh>(null!);
  const glowMeshRef = useRef<THREE.InstancedMesh>(null!);
  
  const { stateRef } = useGameState();
  const { positionRef, state: musicState } = useMusicPlayer();
  const songIndex = useMemo(() => {
    return CONTEST_SONGS.findIndex((s) => s.url === musicState.activeSongUrl);
  }, [musicState.activeSongUrl]);
  const choruses = (window as unknown as Record<string, unknown>).__mikusetChoruses as { startTime: number; endTime: number }[] | undefined;

  // ペンライトの初期位置とパラメータ
  // トラッキングエリア外 (x < -5 または x > 5) に配置
  const penlights = useMemo(() => {
    const arr = [];
    for (let i = 0; i < MAX_PENLIGHTS; i++) {
        const isLeft = Math.random() > 0.5;
        // ステージ (Z=-60) の手前から少し空間を空け、カメラ手前 (Z=-15) から奥へ密集させる
        // 最前列をカメラから遠ざけ、タッチエリアや歌詞表示と干渉しないようにする
        const xOffset = 2.0 + Math.pow(Math.random(), 1.2) * 35.0; 
        const x = isLeft ? -xOffset : xOffset;
        
        arr.push({
            pos: new THREE.Vector3(
              x, 
              -9.5 + Math.random() * 2, // ステージ床面 (Y=-10) より少し上に出す
              -10 - Math.random() * 60  // Zは -10 〜 -70 (ステージ前方から客席奥まで)
            ),
            phase: Math.random() * Math.PI * 2,
            speed: 1.5 + Math.random() * 2.0,
        });

    }
    return arr;
  }, []);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorObj = useMemo(() => new THREE.Color(), []);

  useFrame((state) => {
    if (!coreMeshRef.current || !glowMeshRef.current || !groupRef.current) return;
    
    const baseLevel = isDroneActive ? 8 : stateRef.current.productionLevel;
    const level = calculateFinalLevel(baseLevel, positionRef.current, choruses);
    
    // Levelに応じてペンライトをなだらかに増加させる（最大8段階）
    let targetCount = 0;
    if (level === 2) targetCount = 30;
    else if (level === 3) targetCount = 80;
    else if (level === 4) targetCount = 150;
    else if (level === 5) targetCount = 250;
    else if (level === 6) targetCount = 350;
    else if (level === 7) targetCount = 450;
    else if (level >= 8) targetCount = MAX_PENLIGHTS;

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
        // コンボレベルが終盤（Level 5〜8）に向かうにつれて、全員の動き（スピードと位相）を曲に完全同期させる
        const syncRatio = Math.max(0, (level - 4) / 4); // L4以下は0%、L8で100%同期
        
        // BPMに合致しそうな平均的スピード
        const targetSpeed = 2.8; 
        const currentSpeed = THREE.MathUtils.lerp(p.speed, targetSpeed, syncRatio);
        
        // 完全に揃う位相は0、わずかな人間のブレを0.2ほど残すのもありだが、今回は一体感のため完全に0へ近づける
        const currentPhase = THREE.MathUtils.lerp(p.phase, 0, syncRatio);

        const angle = Math.sin(time * currentSpeed + currentPhase) * (Math.PI / 3.5); // シンクロ時は大きく振る
        
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
        const isRin = songIndex === 4;
        const mainColor = isRin ? 0xffdd00 : 0x86cecb; // リンの黄色をより彩度の高いものに調整

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
      {/* 発光用アウターシェル: 効果を薄くしてノーツの視認性を邪魔しないように */}
      <instancedMesh ref={glowMeshRef} args={[undefined, undefined, MAX_PENLIGHTS]}>
        <cylinderGeometry args={[0.2, 0.2, 1.25, 8]} />
        <meshBasicMaterial transparent opacity={0.35} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      {/* 中心コア: 細くして主張を抑える */}
      <instancedMesh ref={coreMeshRef} args={[undefined, undefined, MAX_PENLIGHTS]}>
        <cylinderGeometry args={[0.06, 0.06, 1.2, 8]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// VirtualStage: 奥に表示されるライブステージとバーチャルシンガー
// ---------------------------------------------------------------------------
function VirtualStage({ isDroneActive }: { isDroneActive: boolean }) {
  const { positionRef, state: musicState } = useMusicPlayer();
  
  const stageRef = useRef<THREE.Group>(null!);
  const singerAuraRef = useRef<THREE.MeshBasicMaterial>(null!);
  const singerSpotRef = useRef<THREE.PointLight>(null!);
  const singerCoreRef = useRef<THREE.MeshBasicMaterial>(null!);
  const charsIndexRef = useRef(0);
  const lastActiveIdxRef = useRef(-1);
  const vocalPulseRef = useRef(0);

  const activeSong = useMemo(() => {
    return CONTEST_SONGS.find((s) => s.url === musicState.activeSongUrl);
  }, [musicState.activeSongUrl]);

  const songIndex = useMemo(() => {
    return CONTEST_SONGS.findIndex((s) => s.url === musicState.activeSongUrl);
  }, [musicState.activeSongUrl]);

  // ハイスコア情報を取得
  const easyHighScore = useMemo(() => {
    const scores = getRankingByDifficulty(musicState.activeSongUrl, 'Easy');
    return scores[0]?.score ?? 0;
  }, [musicState.activeSongUrl]);

  const normalHighScore = useMemo(() => {
    const scores = getRankingByDifficulty(musicState.activeSongUrl, 'Normal');
    return scores[0]?.score ?? 0;
  }, [musicState.activeSongUrl]);

  const hardHighScore = useMemo(() => {
    const scores = getRankingByDifficulty(musicState.activeSongUrl, 'Hard');
    return scores[0]?.score ?? 0;
  }, [musicState.activeSongUrl]);

  useFrame((_, delta) => {
    if (!stageRef.current) return;
    const now = positionRef.current;
    
    // 文字単位での明滅ロジック
    let units = (window as unknown as Record<string, unknown>).__mikusetWords as { text: string, startTime: number; endTime: number }[] | undefined;

    if (units && units.length > 0) {
      // 巻き戻し検知
      const prevIdx = Math.max(0, charsIndexRef.current - 1);
      if (charsIndexRef.current > 0) {
          if (prevIdx >= units.length || !units[prevIdx] || now < units[prevIdx].startTime) {
              charsIndexRef.current = 0;
              lastActiveIdxRef.current = -1;
          }
      }
      
      let idx = charsIndexRef.current;
      while (idx < units.length - 1 && units[idx] && units[idx].endTime < now) idx++;
      charsIndexRef.current = idx;
      
      const currentUnit = units[idx];
      if (currentUnit && now >= currentUnit.startTime) {
          // 新しいワードに到達した瞬間にパルスを1.0にする
          if (lastActiveIdxRef.current !== idx) {
              vocalPulseRef.current = 1.0;
              lastActiveIdxRef.current = idx;
          }
      }
    }

    
    // パルスの減衰
    vocalPulseRef.current = Math.max(0, vocalPulseRef.current - delta * 2.0);



    // ボーカルのシルエットとオーラの点滅（歌詞同期）

    const currentGlow = 0.1 + vocalPulseRef.current * 0.9;
    if (singerAuraRef.current) {
        singerAuraRef.current.opacity = currentGlow * 0.8;
    }
    if (singerSpotRef.current) {
        singerSpotRef.current.intensity = currentGlow * 40;
    }
    if (singerCoreRef.current) {
        // シルエットを強調するため、発声時でも極めて暗いグレーにとどめる（真っ黒に近い状態を維持）
        const coreTarget = new THREE.Color("#000000").lerp(new THREE.Color("#111111"), vocalPulseRef.current);
        singerCoreRef.current.color.copy(coreTarget);
    }

  });

  const isRin = songIndex === 4;
  const singerColor = isRin ? "#ffeeaa" : "#88ffee";

  return (
    <group ref={stageRef} position={[0, -10, -80]}>
      {/* ステージの土台とトラス（暗い赤の静的なワイヤーフレーム） */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[160, 1.5, 40]} />
        <meshStandardMaterial color="#000000" emissive="#220000" emissiveIntensity={1.0} wireframe />
      </mesh>
      
      {/* 後ろの巨大スクリーン的な枠 */}
      <mesh position={[0, 15, -15]}>
        <planeGeometry args={[120, 40]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.4} />
      </mesh>
      
      {/* ドローン演出時のスクリーン表示 (タイトル & ハイスコア) */}
      {isDroneActive && (
        <group position={[0, 15, -14.8]}>
          {/* メインタイトルロゴ (中央上部) */}
          <Text
            fontSize={7.0}
            color="#00ffcc"
            font="/NotoSansJP-Medium.ttf"
            anchorX="center"
            anchorY="middle"
            position={[0, 10, 0]}
            maxWidth={110}
            textAlign="center"
          >
            MikuSET: BEAT BATON
          </Text>

          {/* 選択中の曲情報 (左側) */}
          {activeSong && (
            <group position={[-25, -2, 0]}>
              <Text
                fontSize={2.2}
                color="#88ffee"
                font="/NotoSansJP-Medium.ttf"
                anchorX="center"
                anchorY="middle"
                position={[0, 4, 0]}
                maxWidth={45}
                textAlign="center"
              >
                ♪ NOW SELECTING
              </Text>
              <Text
                fontSize={3.5}
                color="#ffffff"
                font="/NotoSansJP-Medium.ttf"
                anchorX="center"
                anchorY="middle"
                position={[0, 0, 0]}
                maxWidth={45}
                textAlign="center"
              >
                {activeSong.title}
              </Text>
              <Text
                fontSize={2.2}
                color="#cccccc"
                font="/NotoSansJP-Medium.ttf"
                anchorX="center"
                anchorY="middle"
                position={[0, -3.5, 0]}
                maxWidth={45}
                textAlign="center"
              >
                {activeSong.artist}
              </Text>
            </group>
          )}

          {/* 各難易度のハイスコア (右側) */}
          <group position={[25, -2, 0]}>
            <Text
              fontSize={2.5}
              color="#ffcc66"
              font="/NotoSansJP-Medium.ttf"
              anchorX="left"
              anchorY="middle"
              position={[-15, 5, 0]}
              maxWidth={45}
              textAlign="left"
            >
              🏆 PERSONAL BESTS
            </Text>
            <Text
              fontSize={2.2}
              color="#aaddff"
              font="/NotoSansJP-Medium.ttf"
              anchorX="left"
              anchorY="middle"
              position={[-15, 1, 0]}
              maxWidth={45}
              textAlign="left"
            >
              {`EASY     :   ${easyHighScore > 0 ? easyHighScore.toLocaleString() : '---'}`}
            </Text>
            <Text
              fontSize={2.2}
              color="#ff88cc"
              font="/NotoSansJP-Medium.ttf"
              anchorX="left"
              anchorY="middle"
              position={[-15, -2, 0]}
              maxWidth={45}
              textAlign="left"
            >
              {`NORMAL   :   ${normalHighScore > 0 ? normalHighScore.toLocaleString() : '---'}`}
            </Text>
            <Text
              fontSize={2.2}
              color="#ff3366"
              font="/NotoSansJP-Medium.ttf"
              anchorX="left"
              anchorY="middle"
              position={[-15, -5, 0]}
              maxWidth={45}
              textAlign="left"
            >
              {`HARD     :   ${hardHighScore > 0 ? hardHighScore.toLocaleString() : '---'}`}
            </Text>
          </group>
        </group>
      )}

      <mesh position={[0, 15, -15]}>
        <boxGeometry args={[122, 42, 1]} />
        <meshStandardMaterial color="#000000" emissive="#220000" emissiveIntensity={1.0} wireframe />
      </mesh>

      {/* 3D歌詞表示は削除 */}





      {/* センターステージのバーチャルシンガー（ボーカルのシルエット） */}
      <group position={[0, 1.5, 0]}>
        {/* ボーカル本体：シルエット */}
        <mesh scale={1.8}>
          <capsuleGeometry args={[0.4, 2.5, 16, 16]} />
          <meshBasicMaterial ref={singerCoreRef} color="#000000" toneMapped={false} />
        </mesh>
        
        {/* スポットライトの光の筋 (上から下に広がるコーン型) */}
        <mesh position={[0, 10, 0]} rotation={[0, 0, 0]}>
          <cylinderGeometry args={[0.5, 5, 25, 32, 1, true]} />
          <meshBasicMaterial 
            ref={singerAuraRef} 
            color={singerColor} 
            transparent 
            opacity={0.3} 
            blending={THREE.AdditiveBlending} 
            depthWrite={false} 
            side={THREE.DoubleSide}
            toneMapped={false} 
          />
        </mesh>

        {/* ステージ床面の照り返し (足元を明るくして床の存在感を出す) */}
        <mesh position={[0, -1.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[6, 32]} />
          <meshBasicMaterial 
            color={singerColor} 
            transparent 
            opacity={0.4} 
            blending={THREE.AdditiveBlending} 
            depthWrite={false} 
            toneMapped={false} 
          />
        </mesh>
        
        {/* 足元中心のさらに明るい点光源 */}
        <pointLight ref={singerSpotRef} position={[0, -1, 0]} distance={40} intensity={50} color={singerColor} />
      </group>

    </group>
  );
}



interface StageProductionProps {
  isDroneActive?: boolean;
}

export default memo(function StageProduction({ isDroneActive = false }: StageProductionProps) {
  const { getSnapshot } = useGameState();
  const { positionRef } = useMusicPlayer();
  const gameState = getSnapshot();
  const baseLevel = isDroneActive ? 8 : gameState.productionLevel;
  
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

  const finalLevel = Math.max(baseLevel, isChorus ? 8 : 0);
  const level = finalLevel;

  return (
    <>
      <DynamicLights isDroneActive={isDroneActive} />
      <CyberBackground isDroneActive={isDroneActive} />
      <AudiencePenlights isDroneActive={isDroneActive} />
      <VirtualStage isDroneActive={isDroneActive} />
      <StageSpotlights isDroneActive={isDroneActive} />
      
      {/* Level 8以上（極限状態/サビ中）かつドローン演出中でない場合のみ強烈な画面揺れ */}
      {level >= 8 && !isDroneActive && (
        <CameraShake 
          yawFrequency={0.2} 
          pitchFrequency={0.2} 
          rollFrequency={0.4} 
          intensity={0.5} 
        />
      )}
    </>
  );
});
