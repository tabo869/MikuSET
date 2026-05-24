import React, { useEffect, useRef, useState } from 'react';
import { useMusicPlayer } from '../hooks/useMusicPlayer';

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
function isWordHit(startTime: number, now: number): boolean {
  if (startTime > now + 50) return false;
  const hitSet = (window as any).__mikusetHitWordIds as Set<string> | undefined;
  return hitSet ? hitSet.has(String(startTime)) : false;
}

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const WORDS_PER_FRONT = 3;  
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
  startY: number;
}

export default function PhraseDisplay({ positionRef }: { positionRef: React.RefObject<number> }) {
  const { state } = useMusicPlayer();
  
  const [pastLines, setPastLines] = useState<DisplayLine[]>([]);
  const [allChars, setAllChars] = useState<any[]>([]);

  const sourceRef = useRef<unknown>(null);
  const displayChunksRef = useRef<ChunkData[]>([]);
  const activeChunkIdRef = useRef<string | null>(null);
  const charOffsetsRef = useRef<number[]>([]);

  const trackRef = useRef<HTMLDivElement>(null);
  const tickerRef = useRef<HTMLDivElement>(null);
  
  const [, setHitTrigger] = useState(0);

  useEffect(() => {
    const handleHitEvent = () => setHitTrigger(v => v + 1);
    window.addEventListener('mikuset-hit', handleHitEvent);
    return () => window.removeEventListener('mikuset-hit', handleHitEvent);
  }, []);

  const globalScrollRef = useRef(0);
  const lastTimestampRef = useRef<number | null>(null);

  // ─── 歌詞ハイライト & スクロール制御 ───
  useEffect(() => {
    const updateTicker = () => {
      const chars = (window as any).__mikusetChars as any[];
      if (!chars || chars.length === 0 || !tickerRef.current) return;

      const now = positionRef.current;
      const adjustedNow = now - 40; 

      let activeIdx = -1;
      for (let i = 0; i < chars.length; i++) {
        if (adjustedNow >= chars[i].startTime) {
          activeIdx = i;
        } else {
          break;
        }
      }

      // オフセット計算 (初回またはサイズ変更時)
      if (charOffsetsRef.current.length !== chars.length) {
        const children = tickerRef.current.children;
        const offsets: number[] = [];
        let currentX = 0;
        for (let i = 0; i < children.length; i++) {
          const child = children[i] as HTMLElement;
          offsets.push(currentX + child.offsetWidth / 2);
          currentX += child.offsetWidth + 2; // ★ gap (2px) を正確に加算
        }
        charOffsetsRef.current = offsets;
      }

      const offsets = charOffsetsRef.current;
      const children = tickerRef.current.children;
      for (let i = 0; i < children.length; i++) {
        const span = children[i] as HTMLElement;
        if (i <= activeIdx) {
          span.style.color = '#ffffff';
          span.style.textShadow = '0 0 15px #88ccff, 0 0 30px #44aaff, 0 0 60px #0066ff';
          span.style.opacity = '1';
        } else {
          span.style.color = 'rgba(180, 210, 255, 0.35)';
          span.style.textShadow = '0 0 8px rgba(50, 100, 200, 0.3)';
          span.style.opacity = '0.7';
        }
      }

      const scrollActiveIdx = Math.max(0, activeIdx);
      const containerWidth = tickerRef.current.parentElement?.clientWidth ?? 800;
      
      const activeSpan = tickerRef.current.children[scrollActiveIdx] as HTMLSpanElement;
      const wordWidth = activeSpan?.offsetWidth ?? 0;
      const wordOffset = activeSpan?.offsetLeft ?? 0;

      // ★ 歌っている位置（単語の中心）を画面中央（50%）に固定
      const targetOffset = containerWidth * 0.5;
      const scrollX = wordOffset + (wordWidth / 2) - targetOffset;

      tickerRef.current.style.transform = `translateX(${-scrollX}px)`;
    };

    let animFrame: number;
    const loop = () => {
      updateTicker();
      animFrame = requestAnimationFrame(loop);
    };
    animFrame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrame);
  }, [positionRef]);

  // ─── データ更新監視 ───
  useEffect(() => {
    const interval = setInterval(() => {
      const words = (window as any).__mikusetWords as WordData[];
      const chars = (window as any).__mikusetChars as any[];
      if (!words || !chars) return;

      if (words !== sourceRef.current) {
        sourceRef.current = words;
        displayChunksRef.current = generateChunks(words, WORDS_PER_FRONT);
        activeChunkIdRef.current = null;
        setAllChars(chars);
        charOffsetsRef.current = [];
        setPastLines([]);
        globalScrollRef.current = 0;
        lastTimestampRef.current = null;
      }

      const now = positionRef.current;

      if (now <= 10) {
        setPastLines([]);
        activeChunkIdRef.current = null;
        globalScrollRef.current = 0;
        lastTimestampRef.current = null; // ★ タイマーをリセットして計算ミスを防ぐ
        return;
      }

      const LOOK_AHEAD = 4000;
      const cur = displayChunksRef.current.find(c => (now + LOOK_AHEAD) >= c.startTime && now <= c.endTime + 500);

      // --- 歌詞の送り出しロジックの極大化 ---
      const activeChunk = activeChunkIdRef.current ? displayChunksRef.current.find(c => c.id === activeChunkIdRef.current) : null;
      
      if (activeChunk) {
        const nextChunk = displayChunksRef.current.find(c => c.startTime > activeChunk.endTime);
        const isFinished = now > activeChunk.endTime + 100; // 歌い終わって100ms経過
        
        // 1. 次のチャンクが既に来ている場合
        if (cur && cur.id !== activeChunkIdRef.current) {
          pushChunk(activeChunk);
          activeChunkIdRef.current = cur.id;
        } 
        // 2. 歌い終わり、かつ「次がない（最後の一節）」または「次まで1秒以上ある（間奏）」場合
        else if (isFinished && (!nextChunk || nextChunk.startTime - now > 1000)) {
          pushChunk(activeChunk);
          activeChunkIdRef.current = null;
        }
      } else if (cur) {
        // 待機状態から新しいチャンクに入った場合
        activeChunkIdRef.current = cur.id;
      }
    }, 100);

    function pushChunk(chunk: ChunkData) {
      setPastLines(prev => {
        // IDだけでなく中身も見て二重追加を防止
        if (prev.some(p => p.uid.includes(chunk.id))) return prev;
        
        let newY = globalScrollRef.current;
        if (prev.length > 0) {
          const lastY = prev[prev.length - 1].startY;
          if (newY < lastY + 45) newY = lastY + 45;
        }
        return [...prev, { uid: `${chunk.id}-past-${Date.now()}`, words: chunk.words, startY: newY }];
      });
    }

    return () => clearInterval(interval);
  }, [positionRef]);

  // 曲が非再生中、または動画のロード中の時は表示データを即座にクリアする
  useEffect(() => {
    if (!state.isPlaying || !state.isVideoReady) {
      setPastLines([]);
      setAllChars([]);
      sourceRef.current = null;
      displayChunksRef.current = [];
      activeChunkIdRef.current = null;
      charOffsetsRef.current = [];
      globalScrollRef.current = 0;
      lastTimestampRef.current = null;
    }
  }, [state.isPlaying, state.isVideoReady]);

  // 過去歌詞スクロール (rAF)
  useEffect(() => {
    let animFrame = 0;
    const animate = (ts: number) => {
      if (lastTimestampRef.current !== null) {
        const dt = ts - lastTimestampRef.current;
        globalScrollRef.current += (BASE_SCROLL_PPS * dt) / 1000;
        if (trackRef.current) trackRef.current.style.transform = `translateY(${-globalScrollRef.current}px)`;
      }
      lastTimestampRef.current = ts;
      animFrame = requestAnimationFrame(animate);
    };
    animFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrame);
  }, []);

  // 表示条件の判定（JSX内で使用）
  const isVisible = state.isPlaying && state.isVideoReady;

  return (
    <div style={{ 
      position: 'absolute', 
      bottom: 0, left: 0, right: 0, top: 0, 
      pointerEvents: 'none', 
      overflow: 'hidden', 
      zIndex: 9999,
      opacity: isVisible ? 1 : 0,
      transition: 'opacity 0.3s ease'
    }}>
      {!state.hideScrollingLyrics && (
        <div style={{ position: 'absolute', bottom: 'max(130px, 22vh)', left: 0, right: 0, height: '65%', perspective: '600px', perspectiveOrigin: '50% 10%', overflow: 'hidden', maskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.5) 40%, black 80%)', WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.5) 40%, black 80%)', display: 'flex', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', bottom: 0, left: '50%', width: '100vw', marginLeft: '-50vw', height: '100%', transformOrigin: '50% 100%', transform: 'rotateX(50deg)', willChange: 'transform' }}>
            <div ref={trackRef} style={{ position: 'absolute', top: '100%', left: 0, width: '100%', willChange: 'transform' }}>
              {pastLines.map((line) => (
                <div key={line.uid} style={{ position: 'absolute', top: line.startY, left: 0, width: '100%', height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                  {line.words.map(w => {
                    const hit = isWordHit(w.startTime, positionRef.current || 0);
                    return (
                      <span key={w.id} style={{ fontSize: 'clamp(18px, 4vw, 32px)', fontFamily: "'Noto Sans JP', sans-serif", fontWeight: 900, color: hit ? 'rgba(255, 255, 255, 0.95)' : 'rgba(100, 130, 180, 0.3)', textShadow: hit ? '0 0 15px rgba(100, 180, 255, 0.7), 0 0 30px rgba(0, 100, 255, 0.5)' : 'none', letterSpacing: '0.08em' }}>
                        {w.text}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ position: 'absolute', bottom: 'max(60px, 12vh)', width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
        <div style={{ maxWidth: 'min(1200px, 95%)', width: '95%', overflow: 'hidden', position: 'relative', display: 'flex', justifyContent: 'flex-start', alignItems: 'center', maskImage: 'linear-gradient(to right, transparent 0%, black 8%, black 85%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 8%, black 85%, transparent 100%)' }}>
          <div ref={tickerRef} style={{ display: 'flex', alignItems: 'center', gap: '0 2px', whiteSpace: 'nowrap', willChange: 'transform' }}>
            {allChars.map((c, idx) => (
              <span key={c.id || `char-${idx}`} style={{ fontSize: 'clamp(21px, 3.3vw, 42px)', fontFamily: "'Noto Sans JP', sans-serif", fontWeight: 900, color: 'rgba(180, 210, 255, 0.35)', textShadow: '0 0 8px rgba(50, 100, 200, 0.3)', lineHeight: 1.1, letterSpacing: '0.05em', flexShrink: 0, transition: 'color 0.1s ease, text-shadow 0.1s ease' }}>
                {c.text}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
