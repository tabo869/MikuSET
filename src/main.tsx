import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

/**
 * エントリーポイント
 *
 * ★ StrictModeを無効化
 * TextAlive App APIはuseEffect内で初期化され、StrictModeの二重実行で
 * Player/Songleウィジェットが競合しinitializeエラーが発生するため。
 */
createRoot(document.getElementById('root')!).render(
  <App />,
)
