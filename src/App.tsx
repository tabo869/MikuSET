import { MusicProvider } from './hooks/useMusicPlayer';
import { GameStateProvider } from './hooks/useGameState';
import Scene from './components/Scene';
import MusicManager from './components/MusicManager';
import ScoreHUD from './components/ScoreHUD';

/**
 * アプリケーションルートコンポーネント
 *
 * MusicProvider + GameStateProvider で全体をラップし、
 * 3Dシーン・MusicManager・ScoreHUDの全てから
 * 再生状態とゲーム状態にアクセス可能にする
 */
function App() {
  return (
    <MusicProvider>
      <GameStateProvider>
        <Scene />
        <MusicManager />
        <ScoreHUD />
      </GameStateProvider>
    </MusicProvider>
  );
}

export default App;
