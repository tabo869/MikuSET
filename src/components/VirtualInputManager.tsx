import { useEffect, useCallback, useState } from 'react';
import type { BothHandsDataRef } from '../types/hand';

interface VirtualInputManagerProps {
  handsDataRef: BothHandsDataRef;
  isActive: boolean;
}

// ヘルパー: fingertipはプレーンオブジェクト（THREE.Vector3ではない）
function setFingertip(fp: { x: number; y: number; z: number }, x: number, y: number, z: number) {
  fp.x = x; fp.y = y; fp.z = z;
}

const Z_HIT = 0;
type CellCoord = { x: number; y: number; label: string };

const Y_TOP = 2.8 - (5.6 / 6); // 1.8666...
const Y_BOT = -Y_TOP;

const LEFT_CELLS: CellCoord[][] = [
  [
    { x: -4.0, y: Y_TOP, label: 'W' },
    { x: -2.4, y: Y_TOP, label: 'E' },
    { x: -0.8, y: Y_TOP, label: 'R' },
  ],
  [
    { x: -4.0, y:  0.0, label: 'S' },
    { x: -2.4, y:  0.0, label: 'D' },
    { x: -0.8, y:  0.0, label: 'F' },
  ],
  [
    { x: -4.0, y: Y_BOT, label: 'X' },
    { x: -2.4, y: Y_BOT, label: 'C' },
    { x: -0.8, y: Y_BOT, label: 'V' },
  ],
];

const RIGHT_CELLS: CellCoord[][] = [
  [
    { x: 0.8, y: Y_TOP, label: 'U' },
    { x: 2.4, y: Y_TOP, label: 'I' },
    { x: 4.0, y: Y_TOP, label: 'O' },
  ],
  [
    { x: 0.8, y:  0.0, label: 'J' },
    { x: 2.4, y:  0.0, label: 'K' },
    { x: 4.0, y:  0.0, label: 'L' },
  ],
  [
    { x: 0.8, y: Y_BOT, label: 'M' },
    { x: 2.4, y: Y_BOT, label: '<' },
    { x: 4.0, y: Y_BOT, label: '>' },
  ],
];

// キーボード → 座標ルックアップ
type HandedCell = { hand: 'left' | 'right'; x: number; y: number };
const KEY_MAP: Record<string, HandedCell> = {};
LEFT_CELLS.flat().forEach(c => {
  KEY_MAP[c.label.toLowerCase()] = { hand: 'left', x: c.x, y: c.y };
});
RIGHT_CELLS.flat().forEach(c => {
  const k = c.label === '<' ? ',' : c.label === '>' ? '.' : c.label.toLowerCase();
  KEY_MAP[k] = { hand: 'right', x: c.x, y: c.y };
});

interface BoxStyle {
  left: number;
  top: number;
  width: number;
  height: number;
}

export default function VirtualInputManager({ handsDataRef, isActive }: VirtualInputManagerProps) {
  const [activeKeys, setActiveKeys] = useState<Record<string, boolean>>({});
  const [safeScale, setSafeScale] = useState<number>(1.0);

  // 左グリッドと右グリッドの 2D ピクセル境界スタイル (初期値は0)
  const [leftGridStyle, setLeftGridStyle] = useState<BoxStyle>({ left: 0, top: 0, width: 0, height: 0 });
  const [rightGridStyle, setRightGridStyle] = useState<BoxStyle>({ left: 0, top: 0, width: 0, height: 0 });

  // 3D 空間からの射影座標イベントを受け取る
  useEffect(() => {
    if (!isActive) return;

    const handleProjection = (e: CustomEvent) => {
      const { leftStyle, rightStyle, safeScale: scale } = e.detail;
      setLeftGridStyle(leftStyle);
      setRightGridStyle(rightStyle);
      setSafeScale(scale);
    };

    window.addEventListener('mikuset-grid-projection' as any, handleProjection);
    return () => {
      window.removeEventListener('mikuset-grid-projection' as any, handleProjection);
    };
  }, [isActive]);

  const activateHand = useCallback((hand: 'left' | 'right', x: number, y: number, key: string) => {
    handsDataRef.current[hand].detected = true;
    handsDataRef.current[hand].isSwinging = true;
    setFingertip(handsDataRef.current[hand].fingertip, x, y, Z_HIT);
    setActiveKeys(prev => ({ ...prev, [key]: true }));
  }, [handsDataRef]);

  const deactivateHand = useCallback((hand: 'left' | 'right', key: string) => {
    handsDataRef.current[hand].detected = false;
    handsDataRef.current[hand].isSwinging = false;
    const defaultX = hand === 'left' ? -2.0 : 2.0;
    setFingertip(handsDataRef.current[hand].fingertip, defaultX, -3.5, 0);
    setActiveKeys(prev => ({ ...prev, [key]: false }));
  }, [handsDataRef]);

  // モード有効時：両手を未検出で初期化
  useEffect(() => {
    if (!isActive) return;
    handsDataRef.current.left.detected = false;
    setFingertip(handsDataRef.current.left.fingertip, -2.0, -3.5, 0);
    handsDataRef.current.right.detected = false;
    setFingertip(handsDataRef.current.right.fingertip, 2.0, -3.5, 0);
  }, [isActive, handsDataRef]);

  // キーボード入力
  useEffect(() => {
    if (!isActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const key = e.key === ',' ? ',' : e.key === '.' ? '.' : e.key.toLowerCase();
      const cell = KEY_MAP[key];
      if (cell) activateHand(cell.hand, cell.x, cell.y, key);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key === ',' ? ',' : e.key === '.' ? '.' : e.key.toLowerCase();
      const cell = KEY_MAP[key];
      if (cell) deactivateHand(cell.hand, key);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isActive, activateHand, deactivateHand]);

  if (!isActive) return null;

  const renderGrid = (
    rows: CellCoord[][],
    hand: 'left' | 'right',
    borderColor: string,
    activeColor: string
  ) =>
    rows.map((row, rowIdx) =>
      row.map((cell, colIdx) => {
        const rawKey = cell.label === '<' ? ',' : cell.label === '>' ? '.' : cell.label.toLowerCase();
        const isActiveCell = !!activeKeys[rawKey];
        const textColor = isActiveCell ? '#ffffff' : (hand === 'left' ? '#4da3ff' : '#ff4d94');

        // CSS borderの設定 (HTML側で3x3グリッドの仕切り線を描く)
        const borderStyle = {
          borderRight: colIdx < 2 ? `1px solid ${borderColor}` : 'none',
          borderBottom: rowIdx < 2 ? `1px solid ${borderColor}` : 'none',
        };

        return (
          <div
            key={rawKey}
            onMouseDown={() => activateHand(hand, cell.x, cell.y, rawKey)}
            onMouseUp={() => deactivateHand(hand, rawKey)}
            onMouseLeave={() => deactivateHand(hand, rawKey)}
            onTouchStart={(e) => { e.preventDefault(); activateHand(hand, cell.x, cell.y, rawKey); }}
            onTouchEnd={(e) => { e.preventDefault(); deactivateHand(hand, rawKey); }}
            onTouchCancel={(e) => { e.preventDefault(); deactivateHand(hand, rawKey); }}
            style={{
              position: 'absolute',
              left: `${(colIdx * 100) / 3}%`,
              top: `${(rowIdx * 100) / 3}%`,
              width: '33.333%',
              height: '33.333%',
              background: isActiveCell ? activeColor : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: textColor,
              fontSize: `${18 * safeScale}px`, // 画面比率に応じて文字サイズも自動伸縮
              fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
              fontWeight: 900,
              textShadow: '0 0 4px rgba(0, 0, 0, 0.8), 0 0 10px rgba(0,0,0,0.5)',
              letterSpacing: 2,
              userSelect: 'none',
              WebkitUserSelect: 'none',
              cursor: 'pointer',
              touchAction: 'none',
              pointerEvents: 'auto', // タッチ領域自身はイベントを拾う
              transition: 'background 0.07s, color 0.07s',
              boxSizing: 'border-box',
              ...borderStyle,
            }}
          >
            {cell.label}
          </div>
        );
      })
    );

  return (
    <>
      {/* 画面全体を覆う透明なコンテナ (pointer-events: none にして、HUD等へのタップを一切透過させる) */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 2400,
        pointerEvents: 'none', // HUD へのタッチはすべて透過
        userSelect: 'none',
        overflow: 'hidden',
      }}>
        {/* 左手エリア 3x3 (3D座標の左端から右端に100%完璧にピクセル追従) */}
        <div style={{
          position: 'absolute',
          left: `${leftGridStyle.left}px`,
          top: `${leftGridStyle.top}px`,
          width: `${leftGridStyle.width}px`,
          height: `${leftGridStyle.height}px`,
          boxSizing: 'border-box',
        }}>
          {renderGrid(LEFT_CELLS, 'left', 'rgba(100,170,255,0.18)', 'rgba(100,170,255,0.25)')}
        </div>

        {/* 右手エリア 3x3 (3D座標の左端から右端に100%完璧にピクセル追従) */}
        <div style={{
          position: 'absolute',
          left: `${rightGridStyle.left}px`,
          top: `${rightGridStyle.top}px`,
          width: `${rightGridStyle.width}px`,
          height: `${rightGridStyle.height}px`,
          boxSizing: 'border-box',
        }}>
          {renderGrid(RIGHT_CELLS, 'right', 'rgba(255,100,170,0.18)', 'rgba(255,100,170,0.25)')}
        </div>
      </div>
    </>
  );
}
