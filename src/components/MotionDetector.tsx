import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BothHandsDataRef } from '../types/hand';


interface MotionDetectorProps {
  handsDataRef: BothHandsDataRef;
  threshold?: number;
  cooldownMs?: number;
  isVisible?: boolean;
  isSwingTestMode?: boolean;
  onSwing?: (hand: 'left' | 'right') => void;
}



const MotionDetector: React.FC<MotionDetectorProps> = ({ 
  handsDataRef, 
  threshold = 100000, 
  cooldownMs = 250,
  isVisible = false,
  isSwingTestMode = false,
  onSwing
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prevImageDataRef = useRef<Uint8ClampedArray | null>(null);
  const requestRef = useRef<number>();
  
  // 最後にスイング判定を出した時間（ローカル管理用）
  const lastLeftSwingRef = useRef(0);
  const lastRightSwingRef = useRef(0);



  // ポータル先の要素を状態として保持
  const [portalElement, setPortalElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const handlePortalReady = (e: any) => {
      setPortalElement(e.detail.element);
    };
    window.addEventListener('mikuset-portal-ready', handlePortalReady);
    
    // すでに存在する場合もチェック
    const existing = document.getElementById('swing-test-camera-portal');
    if (existing) setPortalElement(existing);

    // ポーリングによる要素検索（イベントを逃した場合のバックアップ）
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

  useEffect(() => {
    if (!isVisible) setPortalElement(null);
  }, [isVisible]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    
    const initCamera = async () => {
      try {
        // 低解像度で取得し、パフォーマンスを稼ぐ
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, facingMode: 'user' },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch (pErr) {
            // Interrupted play is fine
          }
          startDetection();
        }
      } catch (err) {
        console.error("[MotionDetector] Camera access failed:", err);
      }
    };


    if (isVisible) {
      initCamera();
    }

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [isVisible]);


  const startDetection = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // キャンバスサイズをビデオに合わせる
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const width = canvas.width;
    const height = canvas.height;
    const halfWidth = Math.floor(width / 2);

    const detect = () => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        // 映像をキャンバスに描画（鏡合わせのため反転はしない。論理的に左半分が右手とする）
        ctx.drawImage(video, 0, 0, width, height);
        
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const prevData = prevImageDataRef.current;

        if (prevData) {
          let leftDiff = 0;  // 画面左半分（ユーザーの右手）
          let rightDiff = 0; // 画面右半分（ユーザーの左手）

          // ダウンサンプリング：4ピクセル（16インデックス）ごとにチェック
          for (let y = 0; y < height; y += 4) {
            for (let x = 0; x < width; x += 4) {
              const i = (y * width + x) * 4;
              
              const diff = Math.abs(data[i] - prevData[i]) + 
                           Math.abs(data[i+1] - prevData[i+1]) + 
                           Math.abs(data[i+2] - prevData[i+2]);

              if (x < halfWidth) {
                leftDiff += diff;
              } else {
                rightDiff += diff;
              }
            }
          }

          const now = performance.now();

          // `handsDataRef` を更新
          const hData = handsDataRef.current;
          
          // 画面左側 (Screen Left) = 鏡合わせなのでユーザーの右手 (User Right Hand)
          if (leftDiff > threshold && now - lastRightSwingRef.current > cooldownMs) {
            hData.right.isSwinging = true;
            hData.right.lastSwingTime = now;
            lastRightSwingRef.current = now;
            if (onSwing) onSwing('right');
          } else {
            hData.right.isSwinging = false;
          }
          hData.right.detected = true;

          // 画面右側 (Screen Right) = 鏡合わせなのでユーザーの左手 (User Left Hand)
          if (rightDiff > threshold && now - lastLeftSwingRef.current > cooldownMs) {
            hData.left.isSwinging = true;
            hData.left.lastSwingTime = now;
            lastLeftSwingRef.current = now;
            if (onSwing) onSwing('left');
          } else {
            hData.left.isSwinging = false;
          }
          hData.left.detected = true;

          // テストモード時はスコアをUIに通知（可視化用）
          if (isVisible) {
            window.dispatchEvent(new CustomEvent('mikuset-motion-score', { 
              detail: { left: leftDiff, right: rightDiff } 
            }));
          }

        }

        // 現在のフレームを保存
        prevImageDataRef.current = new Uint8ClampedArray(data);
      }

      requestRef.current = requestAnimationFrame(detect);
    };

    detect();
  };

  useEffect(() => {
    const resumeVideo = async () => {
      if (isVisible && videoRef.current && videoRef.current.paused) {
        try {
          await videoRef.current.play();
        } catch (err) {
          // すでに再生中か、中断された場合は無視
        }
      }
    };
    resumeVideo();
  }, [isVisible]);




  const canvasContent = (
    <div style={{ 
      position: 'relative',
      width: '100%',
      height: '100%',
      borderRadius: 8,
      overflow: 'hidden',
      pointerEvents: 'none', // 内部コンテンツも入力をブロックしないように
    }}>

      <canvas 
        ref={canvasRef} 
        style={{ 
          width: '100%', 
          height: '100%', 
          display: 'block', 
          transform: 'scaleX(-1)',
          background: '#111'
        }} 
      />
      {isVisible && !isSwingTestMode && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          background: 'rgba(0,0,0,0.5)',
          color: '#fff',
          fontSize: 10,
          padding: '2px 4px',
          textAlign: 'center'
        }}>
          CAMERA PREVIEW
        </div>
      )}
    </div>
  );

  if (!isVisible) return null;

  return (
    <>
      {/* ビデオ要素は常に元の場所に隠して配置（Portal移動させない） */}
      <video 
        ref={videoRef} 
        playsInline 
        muted 
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' }} 
      />

      {portalElement ? (
        createPortal(canvasContent, portalElement)
      ) : (
        <div style={{ 
          position: 'fixed', 
          top: 10,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 200,
          height: 150,
          zIndex: 3000,
          pointerEvents: 'none',
          border: '2px solid rgba(0, 210, 255, 0.8)',
          boxShadow: '0 0 20px rgba(0, 210, 255, 0.3)',
          borderRadius: 12,
          overflow: 'hidden',
          background: '#000',
        }}>
          {canvasContent}
        </div>
      )}

    </>
  );
};







export default MotionDetector;
