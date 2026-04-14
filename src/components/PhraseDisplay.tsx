import React, { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

interface WordData {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
}

interface ChunkData {
  id: string;
  startTime: number;
  endTime: number;
  words: WordData[];
}

// ヒット済み判定
function isWordHit(startTime: number): boolean {
  const hitSet = (window as unknown as Record<string, unknown>).__mikusetHitWordIds as Set<string> | undefined;
  return hitSet ? hitSet.has(String(startTime)) : false;
}

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const WORDS_PER_FRONT = 6;  
const BASE_SCROLL_PPS = 30; // 奥へ流れるスピード px/sec

function generateChunks(words: WordData[], chunkSize: number): ChunkData[] {
  const chunks: ChunkData[] = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    const slice = words.slice(i, i + chunkSize);
    chunks.push({
      id: `chunk-${i}`,
      startTime: slice[0].startTime,
      endTime: slice[slice.length - 1].endTime,
      words: slice,
    });
  }
  return chunks;
}

interface DisplayLine {
  uid: string;
  words: WordData[];
  startY: number; // トラック内での絶対描画位置
}

export default function PhraseDisplay({ positionRef }: { positionRef: React.RefObject<number> }) {
  const [currentChunk, setCurrentChunk] = useState<ChunkData | null>(null);
  const [pastLines, setPastLines] = useState<DisplayLine[]>([]);

  const sourceRef = useRef<unknown>(null);
  const displayChunksRef = useRef<ChunkData[]>([]);
  const activeChunkIdRef = useRef<string | null>(null);

  const trackRef = useRef<HTMLDivElement>(null);
  
  // スクロールを一元管理 (絶対Y基準)
  const globalScrollRef = useRef(0);
  const lastTimestampRef = useRef<number | null>(null);
  const animFrameRef = useRef<number>(0);

  const [, setTick] = useState(0);

  // ─── 常時スクロールアニメーション (rAF) ───
  useEffect(() => {
    const animate = (ts: number) => {
      setTick(t => t + 1);
      
      if (lastTimestampRef.current !== null) {
        const dt = ts - lastTimestampRef.current;
        globalScrollRef.current += (BASE_SCROLL_PPS * dt) / 1000;

        if (trackRef.current) {
          // トラック全体を上方向へ移動し続ける
          trackRef.current.style.transform = `translateY(${-globalScrollRef.current}px)`;
        }

        // 溜まりすぎた古い行を掃除
        setPastLines(prev => {
           const cutoff = globalScrollRef.current - 1200; 
           if (prev.length > 0 && prev[0].startY < cutoff) {
              return prev.filter(p => p.startY >= cutoff);
           }
           return prev;
        });
      }
      lastTimestampRef.current = ts;
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []);

  // ─── チャンク切り替え監視 ───
  useEffect(() => {
    const interval = setInterval(() => {
      const words = (window as unknown as Record<string, unknown>).__mikusetWords as WordData[] | undefined;
      if (!words || words.length === 0) return;

      if (words !== sourceRef.current) {
        sourceRef.current = words;
        displayChunksRef.current = generateChunks(words, WORDS_PER_FRONT);
        activeChunkIdRef.current = null;
        setCurrentChunk(null);
        setPastLines([]);
        globalScrollRef.current = 0;
        return;
      }

      const now = positionRef.current;
      if (now <= 0) return;

      const LOOK_AHEAD = 1000; // 最前列には少し早めに持ってくる
      
      const cur = displayChunksRef.current.find(
        c => (now + LOOK_AHEAD) >= c.startTime && now <= c.endTime + 500
      );

      const pushOldChunkToTrack = (chunk: ChunkData) => {
          setPastLines(prev => {
              let newY = globalScrollRef.current;
              if (prev.length > 0) {
                  const lastY = prev[prev.length - 1].startY;
                  if (newY < lastY + 50) newY = lastY + 50; // 最低50pxのオフセット
              }
              return [...prev, {
                  uid: `${chunk.id}-past-${Date.now()}`,
                  words: chunk.words,
                  startY: newY
              }];
          });
      };

      if (cur && cur.id !== activeChunkIdRef.current) {
        if (activeChunkIdRef.current) {
          const oldChunk = displayChunksRef.current.find(c => c.id === activeChunkIdRef.current);
          if (oldChunk) pushOldChunkToTrack(oldChunk);
        }
        activeChunkIdRef.current = cur.id;
        setCurrentChunk(cur);
      } else if (!cur && activeChunkIdRef.current) {
        const oldChunk = displayChunksRef.current.find(c => c.id === activeChunkIdRef.current);
        if (oldChunk) pushOldChunkToTrack(oldChunk);
        activeChunkIdRef.current = null;
        setCurrentChunk(null);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [positionRef]);

  return (
    <div style={{
      position: 'absolute',
      bottom: 0, left: 0, right: 0, top: 0,
      pointerEvents: 'none',
      zIndex: 5,
    }}>
      
      {/* ─── 奥へ流れる過去フレーズ領域 ─── */}
      <div style={{
          position: 'absolute',
          bottom: '22%', 
          left: 0, right: 0, height: '65%',
          perspective: '600px',
          perspectiveOrigin: '50% 10%', 
          overflow: 'hidden',
          maskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.5) 40%, black 80%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.5) 40%, black 80%)',
          display: 'flex',
          justifyContent: 'center',
      }}>
        <div style={{
            position: 'absolute',
            bottom: 0,
            left: '50%',
            width: '100vw',
            marginLeft: '-50vw',
            height: '100%',
            transformOrigin: '50% 100%',
            transform: 'rotateX(50deg)',
            willChange: 'transform',
        }}>
            {/* 内部スクロール専用のコンテナ */}
            <div
                ref={trackRef}
                style={{
                  position: 'absolute',
                  top: '100%', // 底辺からスタート
                  left: 0,
                  width: '100%',
                  willChange: 'transform',
                }}
            >
              {pastLines.map((line) => (
                <div key={line.uid} style={{
                  position: 'absolute',
                  top: line.startY, // スクロールに同期した絶対位置
                  left: 0,
                  width: '100%',
                  height: '50px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px',
                }}>
                  {line.words.map(w => {
                     const hit = isWordHit(w.startTime);
                     return (
                      <span key={w.id} style={{
                        fontSize: '32px',
                        fontFamily: "'Noto Sans JP', sans-serif",
                        fontWeight: 900,
                        color: hit ? 'rgba(255, 255, 255, 0.95)' : 'rgba(100, 130, 180, 0.3)',
                        textShadow: hit ? '0 0 15px rgba(100, 180, 255, 0.7), 0 0 30px rgba(0, 100, 255, 0.5)' : 'none',
                        letterSpacing: '0.08em',
                      }}>
                        {w.text}
                      </span>
                     );
                  })}
                </div>
              ))}
            </div>
        </div>
      </div>

      {/* ─── 最前列の現在フレーズ (画面下部に大きく固定) ─── */}
      <div style={{
        position: 'absolute',
        bottom: '8%',
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}>
        {currentChunk && (
          <div style={{
            maxWidth: 1200,
            width: '80%',   
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '4px 16px',
            textAlign: 'center',
          }}>
            {currentChunk.words.map(w => {
              const hit = isWordHit(w.startTime);
              return (
                <span key={w.id} style={{
                  fontSize: 'clamp(32px, 5vw, 64px)',
                  fontFamily: "'Noto Sans JP', sans-serif",
                  fontWeight: 900,
                  color: hit ? '#ffffff' : 'rgba(180, 210, 255, 0.7)',
                  textShadow: hit 
                    ? '0 0 15px #88ccff, 0 0 30px #44aaff, 0 0 60px #0066ff' 
                    : '0 0 8px rgba(50, 100, 200, 0.5)',
                  transition: 'color 0.1s ease, text-shadow 0.1s ease',
                  lineHeight: 1.1,
                  letterSpacing: '0.1em',
                }}>
                  {w.text}
                </span>
              );
            })}
          </div>
        )}
      </div>
      
    </div>
  );
}
