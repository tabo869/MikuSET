import { useEffect, useRef, useCallback } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { useMusicPlayer } from '../hooks/useMusicPlayer';
import type { BothHandsDataRef, CalibrationData } from '../types/hand';
import { DEFAULT_HAND_POSITION, LIVE_RAW_HANDS } from '../types/hand';
import { mapToWorld } from '../utils/coordinateMapper';

/** MediaPipe WASMアセットのCDN URL */
const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';

/** HandLandmarkerモデルファイルのURL */
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';

/** ランドマークのインデックス定数 */
const LANDMARK = {
  INDEX_FINGER_TIP: 8,
  MIDDLE_FINGER_MCP: 9,
} as const;

interface HandTrackerProps {
  handsDataRef: BothHandsDataRef;
}

/**
 * HandTracker — WebカメラとAIモデルによるハンドトラッキング
 *
 * 【設計の核心】
 * - 座標データは handsDataRef（useRef）経由で共有：React の再レンダリングを一切引き起こさない
 * - calibrationData も useRef で保持し、useCallback の依存配列から除外：
 *   detectLoop が途中でキャンセル＋再生成されることによるフリーム欠落（ラグ・ジャンプ）を根絶する
 * - カメラ解像度は 320×240 に固定：MediaPipe の CPU 推論負荷を最小化
 */
export default function HandTracker({ handsDataRef }: HandTrackerProps) {
  const { state } = useMusicPlayer();
  const videoRef = useRef<HTMLVideoElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const isTrackingRef = useRef<boolean>(false);
  const loopHandleRef = useRef<any>(null);
  const lastVideoTimeRef = useRef<number>(-1);

  /**
   * ★ 重要：calibrationData を useRef で保持する
   * これにより detectLoop の useCallback 依存配列から除外でき、
   * キャリブレーション更新のたびにループが再起動してフレームが途切れる問題を根絶する。
   */
  const calibrationDataRef = useRef<CalibrationData>(state.calibrationData);

  // state.calibrationData が変わったときに Ref だけを更新（再レンダリング不要）
  useEffect(() => {
    calibrationDataRef.current = state.calibrationData;
  }, [state.calibrationData]);

  /** AIモデルの初期化（重いので事前に実行しておく） */
  const initHandLandmarker = useCallback(async () => {
    if (landmarkerRef.current) return;
    try {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      const handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          // GPU は同期 Readback によりメインスレッドをブロックし強烈なカクツキを生む。
          // CPU（WASM マルチスレッド）で実行することで 3D レンダリングループと競合しない。
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
      });
      landmarkerRef.current = handLandmarker;
      console.log('[HandTracker] AIモデル 初期化完了');
    } catch (err) {
      console.error('[HandTracker] AIモデル初期化エラー:', err);
    }
  }, []);

  /** Webカメラの起動（解像度 320×240 固定で推論コストを最小化） */
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { exact: 320 },
          height: { exact: 240 },
          facingMode: 'user',
          frameRate: { ideal: 30, max: 30 }, // 30fps 上限でブラウザのデコードコストも削減
        },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        console.log('[HandTracker] Webカメラ ON (320x240 @30fps)');
      }
    } catch (err) {
      console.error('[HandTracker] Webカメラ起動エラー:', err);
    }
  }, []);

  /** Webカメラの停止 */
  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
      console.log('[HandTracker] Webカメラ OFF');
    }
  }, []);

  /**
   * 毎フレームの検出ループ
   *
   * ★ 依存配列は [handsDataRef] のみ。
   *   calibrationData は calibrationDataRef.current で参照するため、
   *   キャリブレーション更新時にこの関数が再生成→ループが途切れる問題が起きない。
   */
  const detectLoop = useCallback(() => {
    if (!isTrackingRef.current) return;

    const video = videoRef.current;
    const landmarker = landmarkerRef.current;

    if (!video || !landmarker || video.readyState < 2) {
      loopHandleRef.current = requestAnimationFrame(detectLoop);
      return;
    }

    try {
      // カメラの新しいフレームが来た時だけ推論する（無駄な推論を省くクリティカルな最適化）
      if (video.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = video.currentTime;

        const results = landmarker.detectForVideo(video, performance.now());

        let leftDetected = false;
        let rightDetected = false;

        if (results.landmarks && results.landmarks.length > 0) {
          // 生の画角正規化座標（0.0〜1.0）を取得
          const parsedHandsRaw = results.landmarks.map((hand) => {
            const tip = hand[LANDMARK.INDEX_FINGER_TIP];
            const palm = hand[LANDMARK.MIDDLE_FINGER_MCP];
            return { tip, palm };
          });

          const prevLeft = handsDataRef.current.left;
          const prevRight = handsDataRef.current.right;

          /**
           * 生の正規化座標空間で距離・左右判定を行い、
           * キャリブレーション補正は mapToWorld 内で適用する。
           *
           * 【追加: 逆サイドガード + X軸クランプ】
           * カメラはミラー表示なので：
           *   - 物理的な右手 → 生座標 X < 0.5（カメラの左側に写る）
           *   - 物理的な左手 → 生座標 X > 0.5（カメラの右側に写る）
           * 逆の半分に検出された手は誤認識として完全にスキップする。
           * さらに、ワールド座標を自分の半分（右手:X≥0、左手:X≤0）にクランプして
           * 画面の逆側へバトンが飛び出さないようにする。
           */
          const assignHand = (raw: { tip: any; palm: any }, isLeft: boolean): boolean => {
            // ── 逆サイドガード ──────────────────────────────────────────────
            // ミラー空間で左手(物理)はX>0.5、右手(物理)はX<0.5に見える。
            // 逆の領域に検出された場合はスキップ（falseを返してdetected扱いにしない）。
            if (isLeft && raw.tip.x < 0.5) {
              // 左手のはずなのにカメラ右半分（X<0.5）に写っている → 右手の誤認識
              return false;
            }
            if (!isLeft && raw.tip.x > 0.5) {
              // 右手のはずなのにカメラ左半分（X>0.5）に写っている → 左手の誤認識
              return false;
            }

            // Ref から最新のキャリブレーションデータを取得
            const bounds = isLeft
              ? calibrationDataRef.current.left
              : calibrationDataRef.current.right;

            const fingertip = mapToWorld(raw.tip.x, raw.tip.y, raw.tip.z, bounds);
            const palmCenter = mapToWorld(raw.palm.x, raw.palm.y, raw.palm.z, bounds);

            // ── X軸クランプ ──────────────────────────────────────────────────
            // 右手はワールドX≥0（画面右半分）、左手はワールドX≤0（画面左半分）に固定。
            // キャリブレーションや多少のはみ出しで逆側に出た場合も 0 で止める。
            if (isLeft) {
              fingertip.x  = Math.min(fingertip.x,  0);
              palmCenter.x = Math.min(palmCenter.x, 0);
            } else {
              fingertip.x  = Math.max(fingertip.x,  0);
              palmCenter.x = Math.max(palmCenter.x, 0);
            }

            const position = {
              fingertip,
              rawFingertip: { x: raw.tip.x, y: raw.tip.y, z: raw.tip.z },
              palmCenter,
              detected: true,
            };

            if (isLeft) {
              handsDataRef.current.left = position;
              LIVE_RAW_HANDS.left = { x: raw.tip.x, y: raw.tip.y };
              leftDetected = true;
            } else {
              handsDataRef.current.right = position;
              LIVE_RAW_HANDS.right = { x: raw.tip.x, y: raw.tip.y };
              rightDetected = true;
            }
            return true;
          };

          if (parsedHandsRaw.length === 1) {
            const pos = parsedHandsRaw[0];
            let isLeft = true;

            if (prevLeft.detected && prevRight.detected) {
              // 前フレームとの距離で左右を確定（クロス時も絶対に入れ替わらない）
              const distL = Math.hypot(pos.tip.x - prevLeft.rawFingertip.x, pos.tip.y - prevLeft.rawFingertip.y);
              const distR = Math.hypot(pos.tip.x - prevRight.rawFingertip.x, pos.tip.y - prevRight.rawFingertip.y);
              if (distR < distL) isLeft = false;
            } else if (prevRight.detected && !prevLeft.detected) {
              isLeft = false;
            } else if (prevLeft.detected && !prevRight.detected) {
              isLeft = true;
            } else {
              // 初回検出：ミラー映像なので生 X が 0.5 より大きい方が物理的な左手
              isLeft = pos.tip.x > 0.5;
            }
            assignHand(pos, isLeft);
          } else if (parsedHandsRaw.length >= 2) {
            // 2 手検出：前フレームからの距離合計が最小になる組み合わせを選択
            const h0 = parsedHandsRaw[0];
            const h1 = parsedHandsRaw[1];

            if (prevLeft.detected && prevRight.detected) {
              const distA =
                Math.hypot(h0.tip.x - prevLeft.rawFingertip.x, h0.tip.y - prevLeft.rawFingertip.y) +
                Math.hypot(h1.tip.x - prevRight.rawFingertip.x, h1.tip.y - prevRight.rawFingertip.y);

              const distB =
                Math.hypot(h1.tip.x - prevLeft.rawFingertip.x, h1.tip.y - prevLeft.rawFingertip.y) +
                Math.hypot(h0.tip.x - prevRight.rawFingertip.x, h0.tip.y - prevRight.rawFingertip.y);

              if (distA <= distB) {
                assignHand(h0, true);
                assignHand(h1, false);
              } else {
                assignHand(h1, true);
                assignHand(h0, false);
              }
            } else {
              // 前フレーム情報なし：生 X でソート（大きい方が物理的な左手）
              if (h0.tip.x > h1.tip.x) {
                assignHand(h0, true);
                assignHand(h1, false);
              } else {
                assignHand(h1, true);
                assignHand(h0, false);
              }
            }
          }
        }

        if (!leftDetected)  { handsDataRef.current.left.detected = false;  LIVE_RAW_HANDS.left = null; }
        if (!rightDetected) { handsDataRef.current.right.detected = false; LIVE_RAW_HANDS.right = null; }
      }
    } catch (err) {
      console.warn('[HandTracker] detectForVideoエラー', err);
    }

    loopHandleRef.current = requestAnimationFrame(detectLoop);
  // ★ calibrationData を依存配列から除外（calibrationDataRef 経由で参照するため）
  }, [handsDataRef]);

  // 1. アプリマウント時にAIモデルだけ初期化しておく
  useEffect(() => {
    initHandLandmarker();
    return () => {
      landmarkerRef.current?.close();
    };
  }, [initHandLandmarker]);

  // 補助関数: ループの停止
  const cancelLoop = useCallback(() => {
    isTrackingRef.current = false;
    if (loopHandleRef.current !== null) {
      cancelAnimationFrame(loopHandleRef.current);
      loopHandleRef.current = null;
    }
  }, []);

  // 2. Play/Stop状態 または テストモード に連動してカメラとトラッキングをON/OFFする
  useEffect(() => {
    const shouldTrack = state.isPlaying || state.isTrackingTest;

    if (shouldTrack) {
      isTrackingRef.current = true;
      (async () => {
        await startCamera();
        if (isTrackingRef.current) {
          detectLoop();
        }
      })();
    } else {
      cancelLoop();
      stopCamera();
      handsDataRef.current.left = { ...DEFAULT_HAND_POSITION };
      handsDataRef.current.right = { ...DEFAULT_HAND_POSITION };
      LIVE_RAW_HANDS.left = null;
      LIVE_RAW_HANDS.right = null;
    }

    return () => {
      cancelLoop();
      stopCamera();
    };
  }, [state.isPlaying, state.isTrackingTest, startCamera, stopCamera, detectLoop, handsDataRef, cancelLoop]);

  return (
    <>
      <video
        ref={videoRef}
        style={{
          position: 'absolute',
          bottom: 'clamp(8px, 2vh, 16px)',
          right: 'clamp(8px, 2vw, 16px)',
          width: 'clamp(100px, 15vw, 160px)',
          height: 'auto',
          borderRadius: 8,
          opacity: 0.6,
          zIndex: 10,
          transform: 'scaleX(-1)', // ミラー表示
          pointerEvents: 'none',
          display: (state.isPlaying || state.isTrackingTest) ? 'block' : 'none',
        }}
        autoPlay
        playsInline
        muted
      />
    </>
  );
}
