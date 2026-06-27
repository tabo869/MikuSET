import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { audioPlayer } from '../utils/AudioPlayer';

interface FaceTrackerProps {
  isVisible: boolean;
}

const FaceTracker: React.FC<FaceTrackerProps> = ({ isVisible }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);       // ユーザーに見せるプレビュー用 (鏡像)
  const inputCanvasRef = useRef<HTMLCanvasElement>(null);  // FaceLandmarker入力用 (回転補正後)

  const [landmarker, setLandmarker] = useState<FaceLandmarker | null>(null);
  const [portalElement, setPortalElement] = useState<HTMLElement | null>(null);
  const [statusMessage, setStatusMessage] = useState('カメラ準備中...');

  // 表情スコアの表示用ステート
  const [smileScore, setSmileScore] = useState(0);
  const [jawOpenScore, setJawOpenScore] = useState(0);
  const [blinkScore, setBlinkScore] = useState(0);
  const [currentRotationDeg, setCurrentRotationDeg] = useState(0);

  // 最後にトリガーした時間（クールダウン制御用）
  const lastTriggerTimeRef = useRef(0);
  const COOLDOWN_MS = 500;

  // 顔の回転アライメント用変数
  const rotationAngleRef = useRef(0); // ラジアン
  const consecutiveMissFramesRef = useRef(0);
  const isScanningRef = useRef(false);

  // 角度ぐらつき防止（チャタリング防止）用のスナップ変数
  const currentSnapAngleRef = useRef(0);   // 現在のスナップ目標角度 (ラジアン)
  const pendingSnapAngleRef = useRef(0);   // 移行検証中の新しいスナップ目標角度
  const angleChangeCounterRef = useRef(0); // 移行検証フレームカウンター

  // 表情判定のノイズディバウンス用カウンター
  const activeSmileFramesRef = useRef(0);
  const activeJawOpenFramesRef = useRef(0);
  const activeBlinkFramesRef = useRef(0);

  // 表情判定の閾値（0.58に引き上げてノイズを低減）
  const TRIGGER_THRESHOLD = 0.58;
  const REQUIRED_FRAMES = 4; // 表情がこのフレーム数（約100ms）連続で維持されたらトリガー

  // スキャン対象の代表角度（0度、90度、-90度、180度）
  const SCAN_ANGLES = [0, Math.PI / 2, -Math.PI / 2, Math.PI];

  // 1. ポータル要素の取得（MusicManagerなどの swing-test-camera-portal に配置）
  useEffect(() => {
    const handlePortalReady = (e: any) => {
      setPortalElement(e.detail.element);
    };
    window.addEventListener('mikuset-portal-ready', handlePortalReady);

    const existing = document.getElementById('swing-test-camera-portal');
    if (existing) setPortalElement(existing);

    const interval = setInterval(() => {
      const el = document.getElementById('swing-test-camera-portal');
      if (el) {
        setPortalElement(el);
        clearInterval(interval);
      }
    }, 500);

    return () => {
      window.removeEventListener('mikuset-portal-ready', handlePortalReady);
      clearInterval(interval);
    };
  }, []);

  // 2. FaceLandmarker のロード
  useEffect(() => {
    let active = true;
    const loadLandmarker = async () => {
      try {
        setStatusMessage('AI表情認識モデルをロード中...');
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm'
        );
        const marker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU',
          },
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: false,
          runningMode: 'VIDEO',
        });
        if (active) {
          setLandmarker(marker);
          setStatusMessage('モデル準備完了。カメラ起動中...');
        }
      } catch (err) {
        console.error('[FaceTracker] FaceLandmarker load failed:', err);
        if (active) setStatusMessage('モデルのロードに失敗しました');
      }
    };

    if (isVisible) {
      loadLandmarker();
    }

    return () => {
      active = false;
    };
  }, [isVisible]);

  // 3. カメラストリームの起動と表情認識ループ
  useEffect(() => {
    if (!isVisible || !landmarker) return;

    let stream: MediaStream | null = null;
    let requestRef = 0;

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, facingMode: 'user' },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setStatusMessage('セッション開始！表情を作ってください');
          loop();
        }
      } catch (err) {
        console.error('[FaceTracker] Camera access failed:', err);
        setStatusMessage('カメラへのアクセスが拒否されました');
      }
    };

    const loop = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const inputCanvas = inputCanvasRef.current;

      if (!video || !canvas || !inputCanvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        requestRef = requestAnimationFrame(loop);
        return;
      }

      const ctx = canvas.getContext('2d');
      const inputCtx = inputCanvas.getContext('2d');
      if (!ctx || !inputCtx) {
        requestRef = requestAnimationFrame(loop);
        return;
      }

      // サイズ同期
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      if (inputCanvas.width !== width) inputCanvas.width = width;
      if (inputCanvas.height !== height) inputCanvas.height = height;

      // --- A. FaceLandmarker用入力キャンバスの回転描画（アライメント補正） ---
      inputCtx.clearRect(0, 0, width, height);
      inputCtx.save();
      inputCtx.translate(width / 2, height / 2);
      inputCtx.rotate(rotationAngleRef.current);
      inputCtx.drawImage(video, -width / 2, -height / 2, width, height);
      inputCtx.restore();

      // --- B. 表情認識の実行 ---
      const now = performance.now();
      const result = landmarker.detectForVideo(inputCanvas, now);

      let detectedAngle = 0;
      let faceFound = false;

      if (result.faceLandmarks && result.faceLandmarks.length > 0) {
        faceFound = true;
        consecutiveMissFramesRef.current = 0;
        isScanningRef.current = false;

        const landmarks = result.faceLandmarks[0];
        // 左目の中心付近（ランドマーク33）と右目の中心付近（263）から傾き角度（ロール角）を計測
        const leftEye = landmarks[33];
        const rightEye = landmarks[263];

        if (leftEye && rightEye) {
          const dx = rightEye.x - leftEye.x;
          const dy = rightEye.y - leftEye.y;
          detectedAngle = Math.atan2(dy, dx); // 補正後のキャンバス上でのズレ

          // カメラ映像に対するトータルの実際の顔の傾き
          const totalAngle = rotationAngleRef.current + detectedAngle;
          let totalDeg = (totalAngle * 180) / Math.PI;

          // 角度を [-180, 180] の範囲に正規化
          let normDeg = totalDeg % 360;
          if (normDeg > 180) normDeg -= 360;
          if (normDeg < -180) normDeg += 360;

          // 代表角度（0, 90, -90, 180）への段階的スナップ（境界付近に遊びを持たせる）
          let snapDeg = 0;
          if (Math.abs(normDeg) < 35) {
            snapDeg = 0;
          } else if (Math.abs(normDeg - 90) < 40) {
            snapDeg = 90;
          } else if (Math.abs(normDeg + 90) < 40) {
            snapDeg = -90;
          } else if (Math.abs(normDeg) > 145) {
            snapDeg = 180;
          } else {
            // 境界付近（グレーゾーン）では前回のスナップ角度を維持（ヒステリシス）
            snapDeg = Math.round((currentSnapAngleRef.current * 180) / Math.PI);
          }

          const snapRad = (snapDeg * Math.PI) / 180;

          // 新しいスナップ角度が検出されたら一定時間（45フレーム＝約1.5秒）安定するまで待機
          if (snapRad !== currentSnapAngleRef.current) {
            if (snapRad === pendingSnapAngleRef.current) {
              angleChangeCounterRef.current += 1;
              if (angleChangeCounterRef.current > 45) {
                currentSnapAngleRef.current = snapRad;
                angleChangeCounterRef.current = 0;
              }
            } else {
              pendingSnapAngleRef.current = snapRad;
              angleChangeCounterRef.current = 0;
            }
          } else {
            angleChangeCounterRef.current = 0;
          }

          // 確定したスナップ角度へ滑らかに遷移させる（遷移時以外は完全に固定される）
          rotationAngleRef.current += (currentSnapAngleRef.current - rotationAngleRef.current) * 0.12;

          // 完全にスナップ値に近づいたら値を丸めてぐらつきを排除
          if (Math.abs(currentSnapAngleRef.current - rotationAngleRef.current) < 0.01) {
            rotationAngleRef.current = currentSnapAngleRef.current;
          }
        }

        // --- C. 表情ブレンドシェイプの判定とSEトリガー（ディバウンス処理） ---
        if (result.faceBlendshapes && result.faceBlendshapes.length > 0) {
          const shapes = result.faceBlendshapes[0].categories;
          const smileLeft = shapes.find(s => s.categoryName === 'mouthSmileLeft')?.score || 0;
          const smileRight = shapes.find(s => s.categoryName === 'mouthSmileRight')?.score || 0;
          const jawOpen = shapes.find(s => s.categoryName === 'jawOpen')?.score || 0;
          const blinkLeft = shapes.find(s => s.categoryName === 'eyeBlinkLeft')?.score || 0;
          const blinkRight = shapes.find(s => s.categoryName === 'eyeBlinkRight')?.score || 0;

          const smile = (smileLeft + smileRight) / 2;
          const blink = (blinkLeft + blinkRight) / 2;

          setSmileScore(smile);
          setJawOpenScore(jawOpen);
          setBlinkScore(blink);

          // 1. 笑顔の判定（TRIGGER_THRESHOLD以上の状態がREQUIRED_FRAMES連続した場合のみトリガー）
          if (smile > TRIGGER_THRESHOLD) {
            activeSmileFramesRef.current += 1;
            if (activeSmileFramesRef.current >= REQUIRED_FRAMES && now - lastTriggerTimeRef.current > COOLDOWN_MS) {
              lastTriggerTimeRef.current = now;
              activeSmileFramesRef.current = 0;
              activeJawOpenFramesRef.current = 0;
              activeBlinkFramesRef.current = 0;
              audioPlayer.triggerQuantized('sparkle');
            }
          } else {
            activeSmileFramesRef.current = 0;
          }

          // 2. 口開きの判定
          if (jawOpen > TRIGGER_THRESHOLD) {
            activeJawOpenFramesRef.current += 1;
            if (activeJawOpenFramesRef.current >= REQUIRED_FRAMES && now - lastTriggerTimeRef.current > COOLDOWN_MS) {
              lastTriggerTimeRef.current = now;
              activeSmileFramesRef.current = 0;
              activeJawOpenFramesRef.current = 0;
              activeBlinkFramesRef.current = 0;
              audioPlayer.triggerQuantized('pop');
            }
          } else {
            activeJawOpenFramesRef.current = 0;
          }

          // 3. まばたきの判定
          if (blink > TRIGGER_THRESHOLD) {
            activeBlinkFramesRef.current += 1;
            if (activeBlinkFramesRef.current >= REQUIRED_FRAMES && now - lastTriggerTimeRef.current > COOLDOWN_MS) {
              lastTriggerTimeRef.current = now;
              activeSmileFramesRef.current = 0;
              activeJawOpenFramesRef.current = 0;
              activeBlinkFramesRef.current = 0;
              audioPlayer.triggerQuantized('blink');
            }
          } else {
            activeBlinkFramesRef.current = 0;
          }
        }
      } else {
        // 顔が検出されなかった場合
        consecutiveMissFramesRef.current += 1;
        setSmileScore(0);
        setJawOpenScore(0);
        setBlinkScore(0);
        activeSmileFramesRef.current = 0;
        activeJawOpenFramesRef.current = 0;
        activeBlinkFramesRef.current = 0;

        // 30フレーム連続で見失った場合、スキャン（異なる角度を順次試す）を開始
        if (consecutiveMissFramesRef.current > 30) {
          isScanningRef.current = true;
          const scanIdx = Math.floor(consecutiveMissFramesRef.current / 15) % SCAN_ANGLES.length;
          rotationAngleRef.current = SCAN_ANGLES[scanIdx];
        }
      }

      setCurrentRotationDeg(Math.round((rotationAngleRef.current * 180) / Math.PI));

      // --- D. ユーザーへの鏡合わせプレビュー描画 ---
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      // プレビューは鏡像（左右反転）にして使いやすくする
      ctx.translate(width, 0);
      ctx.scale(-1, 1);

      // 横向き寝で画面が傾いている場合、プレビューも回転させて正立で見せると見やすい
      ctx.translate(width / 2, height / 2);
      ctx.rotate(rotationAngleRef.current);
      ctx.drawImage(video, -width / 2, -height / 2, width, height);
      ctx.restore();

      // 顔のトラッキング枠とランドマークの簡易描画（正立プレビュー上）
      if (faceFound && result.faceLandmarks && result.faceLandmarks.length > 0) {
        ctx.save();
        ctx.translate(width / 2, height / 2);
        // プレビューの描画は反転かつ回転しているため、それに合わせてランドマークを重ねる
        ctx.fillStyle = 'rgba(0, 210, 255, 0.7)';
        const landmarks = result.faceLandmarks[0];
        const keyPoints = [33, 263, 1, 61, 291, 13, 14, 0];
        keyPoints.forEach((idx) => {
          const pt = landmarks[idx];
          if (pt) {
            const x = (pt.x - 0.5) * width;
            const y = (pt.y - 0.5) * height;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, 2 * Math.PI);
            ctx.fill();
          }
        });
        ctx.restore();
      }

      requestRef = requestAnimationFrame(loop);
    };

    startCamera();

    return () => {
      if (requestRef) cancelAnimationFrame(requestRef);
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [isVisible, landmarker]);

  if (!isVisible) return null;

  // プレビューおよび表情強度のUI
  const canvasContent = (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      borderRadius: 12,
      overflow: 'hidden',
      pointerEvents: 'none',
      background: '#050510',
      border: '2px solid rgba(0, 210, 255, 0.4)',
      boxShadow: '0 0 25px rgba(0, 210, 255, 0.25)',
      fontFamily: 'system-ui, sans-serif',
      color: '#fff',
    }}>
      {/* 隠し要素として、回転入力用の中間キャンバスとビデオを配置 */}
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' }}
      />
      <canvas
        ref={inputCanvasRef}
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' }}
      />

      {/* ユーザー用プレビュー（鏡合わせアライメント済み） */}
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          objectFit: 'cover'
        }}
      />

      {/* オーバーレイUI：表情のスコアとアライメント回転角の可視化 */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.85), rgba(0,0,0,0))',
        fontSize: '11px',
        padding: '8px',
        fontWeight: 'bold',
        letterSpacing: '0.5px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#00d2ff' }}>
          <span>MAGICAL GUEST: CAM ON</span>
          <span>ROLL: {currentRotationDeg}°</span>
        </div>
        <div style={{ fontSize: '9px', color: '#aaa', marginTop: '2px' }}>
          {statusMessage}
        </div>
      </div>

      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0))',
        padding: '10px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px'
      }}>
        {/* 笑顔スコアバー */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '40px', fontSize: '10px', color: '#ff66b2', fontWeight: 'bold' }}>笑顔</span>
          <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.15)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, smileScore * 100)}%`,
              height: '100%',
              background: smileScore > 0.5 ? '#ff3399' : '#ff85c2',
              boxShadow: smileScore > 0.5 ? '0 0 10px #ff3399' : 'none',
              transition: 'width 0.1s ease'
            }} />
          </div>
          <span style={{ width: '25px', fontSize: '10px', textAlign: 'right', fontFamily: 'monospace' }}>
            {Math.round(smileScore * 100)}
          </span>
        </div>

        {/* 口開きスコアバー */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '40px', fontSize: '10px', color: '#33ccff', fontWeight: 'bold' }}>口開き</span>
          <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.15)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, jawOpenScore * 100)}%`,
              height: '100%',
              background: jawOpenScore > 0.5 ? '#00b2ff' : '#66d9ff',
              boxShadow: jawOpenScore > 0.5 ? '0 0 10px #00b2ff' : 'none',
              transition: 'width 0.1s ease'
            }} />
          </div>
          <span style={{ width: '25px', fontSize: '10px', textAlign: 'right', fontFamily: 'monospace' }}>
            {Math.round(jawOpenScore * 100)}
          </span>
        </div>

        {/* まばたきスコアバー */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '40px', fontSize: '10px', color: '#39ff14', fontWeight: 'bold' }}>まばたき</span>
          <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.15)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, blinkScore * 100)}%`,
              height: '100%',
              background: blinkScore > 0.5 ? '#2ebd10' : '#8cff75',
              boxShadow: blinkScore > 0.5 ? '0 0 10px #39ff14' : 'none',
              transition: 'width 0.1s ease'
            }} />
          </div>
          <span style={{ width: '25px', fontSize: '10px', textAlign: 'right', fontFamily: 'monospace' }}>
            {Math.round(blinkScore * 100)}
          </span>
        </div>
      </div>
    </div>
  );

  if (portalElement) {
    return createPortal(canvasContent, portalElement);
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      right: 20,
      width: 220,
      height: 165,
      zIndex: 10000,
      pointerEvents: 'none',
    }}>
      {canvasContent}
    </div>
  );
};

export default FaceTracker;
