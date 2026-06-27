import { Player } from 'textalive-app-api';

class AudioPlayer {
  private ctx: AudioContext | null = null;

  constructor() {
    // ユーザー操作のタイミング（STARTボタンやマジカル・ゲスト有効時など）で初期化するため、
    // ここではコンテキストを作成しない
  }

  public initCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  /**
   * タンバリン音の生成とスケジュール再生
   * ノイズ＋バンドパスフィルタ＋金属音オシレータ
   */
  public playTambourine(when: number) {
    const ctx = this.initCtx();
    const duration = 0.15;

    // 1. ジングルメタル音（金属音）
    // タンバリンの金属的なジャラジャラ音を模倣するため、高周波数帯のオシレータを複数合成
    const metalFreqs = [3500, 4800, 5200, 7800];
    metalFreqs.forEach((freq) => {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, when);

      // 非常に素早い減衰
      oscGain.gain.setValueAtTime(0.08, when);
      oscGain.gain.exponentialRampToValueAtTime(0.001, when + 0.08);

      osc.connect(oscGain);
      oscGain.connect(ctx.destination);

      osc.start(when);
      osc.stop(when + 0.1);
    });

    // 2. シャカシャカノイズ音
    // 1チャンネル（モノラル）のホワイトノイズバッファを作成
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = buffer;

    // 8kHz周辺のバンドパスフィルタを適用して高音シャカシャカ感を作る
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(8000, when);
    filter.Q.setValueAtTime(3, when);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.25, when);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, when + duration);

    noiseSource.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    noiseSource.start(when);
    noiseSource.stop(when + duration);
  }

  /**
   * キラキラ音の生成とスケジュール再生
   * 高音サイン波による高速アルペジオ
   */
  public playSparkle(when: number) {
    const ctx = this.initCtx();
    // C7, E7, G7, C8, E8, G8 の高い音階
    const frequencies = [2093.00, 2637.02, 3135.96, 4186.01, 5274.04, 6271.93];
    const delay = 0.025; // 25ms 間隔でアルペジオ

    frequencies.forEach((freq, index) => {
      const noteTime = when + index * delay;
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteTime);
      // キラキラしたピッチのゆらぎ演出
      osc.frequency.exponentialRampToValueAtTime(freq * 1.03, noteTime + 0.25);

      gainNode.gain.setValueAtTime(0.0, noteTime);
      gainNode.gain.linearRampToValueAtTime(0.12, noteTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.3);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(noteTime);
      osc.stop(noteTime + 0.35);
    });
  }

  /**
   * ポップ音の生成とスケジュール再生
   * 口開きアクション用：アタックがはっきりした「ポン！」というシンセ音
   */
  public playPop(when: number) {
    const ctx = this.initCtx();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = 'sine';
    
    // アタックの立ち上がり周波数800Hzから150Hzへの急速な指数スイープ
    osc.frequency.setValueAtTime(800, when);
    osc.frequency.exponentialRampToValueAtTime(150, when + 0.08);

    // アタックは即座に最大音量になり、100msで急激に減衰
    gainNode.gain.setValueAtTime(0.28, when);
    gainNode.gain.exponentialRampToValueAtTime(0.001, when + 0.1);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(when);
    osc.stop(when + 0.12);
  }

  /**
   * まばたき音の生成とスケジュール再生
   * まばたきアクション用：高音で繊細な「チーン」という短い鈴・金属風シンセ音
   */
  public playBlink(when: number) {
    const ctx = this.initCtx();
    
    // 主音となる高域サイン波
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(3200, when);
    osc1.frequency.exponentialRampToValueAtTime(1600, when + 0.05);

    gain1.gain.setValueAtTime(0.12, when);
    gain1.gain.exponentialRampToValueAtTime(0.001, when + 0.06);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(when);
    osc1.stop(when + 0.08);

    // 金属的な倍音成分
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(4800, when);

    gain2.gain.setValueAtTime(0.06, when);
    gain2.gain.exponentialRampToValueAtTime(0.001, when + 0.04);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(when);
    osc2.stop(when + 0.06);
  }

  /**
   * BPMクオンタイズを計算し、適切なタイミングでSEを再生する
   */
  public triggerQuantized(type: 'sparkle' | 'tambourine' | 'pop' | 'blink') {
    const win = window as any;
    const player = win.__mikusetPlayer as Player;
    const currentSongPos = win.__mikusetCurrentPosition || 0;

    // 再生中でない場合、またはPlayerが取得できない場合は即座に再生
    if (!player || !player.isPlaying) {
      this.playImmediate(type);
      return;
    }

    // 拍（Beat）情報を取得
    const beat = player.findBeat(currentSongPos);
    let bpm = 120;
    let beatStart = currentSongPos;
    let beatDuration = 500; // 120BPM時の1拍のミリ秒数

    if (beat) {
      bpm = (beat as any).bpm || 120;
      beatStart = beat.startTime;
      beatDuration = beat.duration || (60000 / bpm);
    }

    // 8分音符単位でクオンタイズを計算（BPM同期）
    const noteLength = beatDuration / 2; // 8分音符のミリ秒数
    const elapsed = currentSongPos - beatStart;

    // 次の8分音符のタイミングを計算
    const nextNoteIndex = Math.ceil(elapsed / noteLength);
    let targetSongPos = beatStart + nextNoteIndex * noteLength;

    // Web Audio の先読みバッファを確保するため、残り時間が35ms未満の場合はその次の8分音符に送る
    if (targetSongPos - currentSongPos < 35) {
      targetSongPos += noteLength;
    }

    const delayMs = targetSongPos - currentSongPos;

    // Web Audio API の絶対予約時間（currentTime基準の秒数）
    const ctx = this.initCtx();
    const targetAudioTime = ctx.currentTime + (delayMs / 1000);

    // SE再生を予約
    if (type === 'sparkle') {
      this.playSparkle(targetAudioTime);
    } else if (type === 'blink') {
      this.playBlink(targetAudioTime);
    } else if (type === 'pop') {
      this.playPop(targetAudioTime);
    } else {
      this.playTambourine(targetAudioTime);
    }

    // 視覚的なエフェクト（Ripple / Particles）を、音が鳴るタイミングと完全に同期して発火
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('mikuset-magical-trigger', {
        detail: { type, position: targetSongPos }
      }));
    }, delayMs);
  }

  /**
   * 遅延なしで即時に再生する（プレビューや非再生時）
   */
  private playImmediate(type: 'sparkle' | 'tambourine' | 'pop' | 'blink') {
    const ctx = this.initCtx();
    const now = ctx.currentTime;
    if (type === 'sparkle') {
      this.playSparkle(now);
    } else if (type === 'blink') {
      this.playBlink(now);
    } else if (type === 'pop') {
      this.playPop(now);
    } else {
      this.playTambourine(now);
    }

    // 視覚演出のイベントも即座に発火
    window.dispatchEvent(new CustomEvent('mikuset-magical-trigger', {
      detail: { type, position: 0 }
    }));
  }
}

export const audioPlayer = new AudioPlayer();
