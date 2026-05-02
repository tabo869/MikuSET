import { useEffect, useRef, useCallback, useState } from 'react';
import { useMusicPlayer } from '../hooks/useMusicPlayer';
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

// ---------------------------------------------------------------------------
// トラッキングエリアのサイズ (coordinateMapper.ts / Scene.tsx の RANGE と一致)
// カメラ: position=[0,0,8], fov=50
// ---------------------------------------------------------------------------
const CAM_Z = 8;
const FOV_HALF_DEG = 25; // fov=50 の半分
const PLAY_HALF_W = 4.8; // X 方向の片側最大値
const PLAY_HALF_H = 2.8; // Y 方向の片側最大値

/**
 * カメラパラメータからトラッキングエリアの CSS inset (%) を計算する。
 * ウィンドウの縦横比に合わせて動的に更新する。
 */
function calcTrackingInset(winW: number, winH: number) {
  if (winW <= 0 || winH <= 0) {
    return { topPct: 0, leftPct: 0 };
  }

  const visHalfH = Math.tan((FOV_HALF_DEG * Math.PI) / 180) * CAM_Z;
  const aspect = winW / winH;
  const visHalfW = visHalfH * aspect;

  const topPct = ((visHalfH - PLAY_HALF_H) / (visHalfH * 2)) * 100;
  const leftPct = ((visHalfW - PLAY_HALF_W) / (visHalfW * 2)) * 100;

  return {
    topPct: Math.max(0, topPct),
    leftPct: Math.max(0, leftPct),
  };
}

// ---------------------------------------------------------------------------
// 左手 3x3 グリッド座標  (X: Left=-3.5, Center=-2.0, Right=-0.5)
// ---------------------------------------------------------------------------
type CellCoord = { x: number; y: number; label: string };

const LEFT_CELLS: CellCoord[][] = [
  // top row → middle row → bottom row
  [
    { x: -3.5, y:  2.0, label: 'W' },
    { x: -2.0, y:  2.0, label: 'E' },
    { x: -0.5, y:  2.0, label: 'R' },
  ],
  [
    { x: -3.5, y:  0.0, label: 'S' },
    { x: -2.0, y:  0.0, label: 'D' },
    { x: -0.5, y:  0.0, label: 'F' },
  ],
  [
    { x: -3.5, y: -2.0, label: 'X' },
    { x: -2.0, y: -2.0, label: 'C' },
    { x: -0.5, y: -2.0, label: 'V' },
  ],
];

// ---------------------------------------------------------------------------
// 右手 3x3 グリッド座標  (X: Left=0.5, Center=2.0, Right=3.5)
// ---------------------------------------------------------------------------
const RIGHT_CELLS: CellCoord[][] = [
  [
    { x: 0.5, y:  2.0, label: 'U' },
    { x: 2.0, y:  2.0, label: 'I' },
    { x: 3.5, y:  2.0, label: 'O' },
  ],
  [
    { x: 0.5, y:  0.0, label: 'J' },
    { x: 2.0, y:  0.0, label: 'K' },
    { x: 3.5, y:  0.0, label: 'L' },
  ],
  [
    { x: 0.5, y: -2.0, label: 'M' },
    { x: 2.0, y: -2.0, label: '<' },
    { x: 3.5, y: -2.0, label: '>' },
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

/**
 * VirtualInputManager — 左右それぞれのトラッキングエリアを 3x3 に分割
 *
 * - キーボード: W/E/R・S/D/F・X/C/V (左手) / U/I/O・J/K/L・M/,/. (右手)
 * - タッチ: 左半分 / 右半分それぞれの 3x3 セルをタップ
 * - 各セルはトラッキングエリア (PlayAreaFrame) 内にピッタリ収まる
 * - キー/タッチを離すと「未検出 (detected=false)」に戻る → auto-hit 防止
 */
export default function VirtualInputManager({ handsDataRef, isActive }: VirtualInputManagerProps) {
  const { state: musicState } = useMusicPlayer();
  const cellRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // ウィンドウサイズに基づくインセット (%)
  const [inset, setInset] = useState(() => calcTrackingInset(window.innerWidth, window.innerHeight));

  useEffect(() => {
    const onResize = () => setInset(calcTrackingInset(window.innerWidth, window.innerHeight));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const setCellRef = useCallback((key: string) => (el: HTMLDivElement | null) => {
    if (el) cellRefs.current.set(key, el);
    else cellRefs.current.delete(key);
  }, []);

  const flashCell = useCallback((key: string, on: boolean) => {
    const el = cellRefs.current.get(key);
    if (!el) return;
    el.style.background = on ? 'rgba(255,255,255,0.28)' : 'transparent';
    el.style.boxShadow = on ? '0 0 20px rgba(160,220,255,0.6), inset 0 0 8px rgba(255,255,255,0.15)' : 'none';
  }, []);

  const activateHand = useCallback((hand: 'left' | 'right', x: number, y: number, key: string) => {
    handsDataRef.current[hand].detected = true;
    handsDataRef.current[hand].isSwinging = true; // タッチした瞬間を「スイング」として認識させる
    setFingertip(handsDataRef.current[hand].fingertip, x, y, Z_HIT);
    flashCell(key, true);
  }, [handsDataRef, flashCell]);

  const deactivateHand = useCallback((hand: 'left' | 'right', key: string) => {
    handsDataRef.current[hand].detected = false;
    handsDataRef.current[hand].isSwinging = false;
    const defaultX = hand === 'left' ? -2.0 : 2.0;
    setFingertip(handsDataRef.current[hand].fingertip, defaultX, -3.5, 0);
    flashCell(key, false);
  }, [handsDataRef, flashCell]);


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

  const { topPct, leftPct } = inset;

  // トラッキングエリアの幅/高さ占有率
  const areaW = 100 - leftPct * 2; // %
  const areaH = 100 - topPct * 2;  // %

  const renderGrid = (
    rows: CellCoord[][],
    hand: 'left' | 'right',
    borderColor: string
  ) =>
    rows.map((row) =>
      row.map((cell) => {
        const rawKey = cell.label === '<' ? ',' : cell.label === '>' ? '.' : cell.label.toLowerCase();
        return (
          <div
            key={rawKey}
            ref={setCellRef(rawKey)}
            onMouseDown={() => activateHand(hand, cell.x, cell.y, rawKey)}
            onMouseUp={() => deactivateHand(hand, rawKey)}
            onMouseLeave={() => deactivateHand(hand, rawKey)}
            onTouchStart={(e) => { e.preventDefault(); activateHand(hand, cell.x, cell.y, rawKey); }}
            onTouchEnd={(e) => { e.preventDefault(); deactivateHand(hand, rawKey); }}
            onTouchCancel={(e) => { e.preventDefault(); deactivateHand(hand, rawKey); }}
            style={{
              border: `1px solid ${borderColor}`,
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: borderColor,
              fontSize: 'clamp(11px, 2.5vw, 22px)',
              fontFamily: "'Inter', 'Segoe UI', sans-serif",
              fontWeight: 700,
              letterSpacing: 2,
              userSelect: 'none',
              WebkitUserSelect: 'none',
              cursor: 'pointer',
              touchAction: 'none',
              transition: 'background 0.07s, box-shadow 0.07s',
            }}
          >
          {musicState.showInputLabels ? cell.label : ''}
        </div>
        );
      })
    );

  return (
    // トラッキングエリアの外枠に合わせた配置
    <div style={{
      position: 'absolute',
      top: `${topPct}%`,
      left: `${leftPct}%`,
      width: `${areaW}%`,
      height: `${areaH}%`,
      display: 'flex',
      zIndex: 2400, // HUD(20)や3Dシーンより前面、MusicManager(2500)より背面
      pointerEvents: 'auto',
    }}>

      {/* 左手エリア 3x3 (トラッキング左半分内) */}
      <div style={{
        width: '50%',
        height: '100%',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gridTemplateRows: '1fr 1fr 1fr',
        borderRight: '1px solid rgba(170, 200, 255, 0.3)',
      }}>
        {renderGrid(LEFT_CELLS, 'left', 'rgba(100,170,255,0.4)')}
      </div>

      {/* 右手エリア 3x3 (トラッキング右半分内) */}
      <div style={{
        width: '50%',
        height: '100%',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gridTemplateRows: '1fr 1fr 1fr',
      }}>
        {renderGrid(RIGHT_CELLS, 'right', 'rgba(255,100,170,0.4)')}
      </div>
    </div>
  );
}
