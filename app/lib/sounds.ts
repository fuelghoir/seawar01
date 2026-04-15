class GameSounds {
  private ctx: AudioContext | null = null;

  private getCtx(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    return this.ctx;
  }

  private noise(duration: number): AudioBufferSourceNode {
    const ctx = this.getCtx();
    const len = ctx.sampleRate * duration;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  /** My shot fired — quick whoosh */
  playShot() {
    try {
      const ctx = this.getCtx();
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(600, t);
      osc.frequency.exponentialRampToValueAtTime(100, t + 0.15);
      g.gain.setValueAtTime(0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.15);
    } catch {}
  }

  /** Hit (yellow) — medium explosion */
  playHit() {
    try {
      const ctx = this.getCtx();
      const t = ctx.currentTime;
      const n = this.noise(0.3);
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.setValueAtTime(1000, t);
      f.frequency.exponentialRampToValueAtTime(300, t + 0.3);
      f.Q.value = 2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      n.connect(f).connect(g).connect(ctx.destination);
      n.start(t);
      n.stop(t + 0.3);
    } catch {}
  }

  /** Ship sunk (red/kill) — big explosion */
  playSunk() {
    try {
      const ctx = this.getCtx();
      const t = ctx.currentTime;
      // Low rumble
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.6);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.3, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      osc.connect(og).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.6);
      // Noise crackle
      const n = this.noise(0.5);
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(2000, t);
      f.frequency.exponentialRampToValueAtTime(200, t + 0.5);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.2, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      n.connect(f).connect(ng).connect(ctx.destination);
      n.start(t);
      n.stop(t + 0.5);
    } catch {}
  }

  /** Miss — water splash */
  playMiss() {
    try {
      const ctx = this.getCtx();
      const t = ctx.currentTime;
      const n = this.noise(0.2);
      const f = ctx.createBiquadFilter();
      f.type = "highpass";
      f.frequency.setValueAtTime(3000, t);
      f.frequency.exponentialRampToValueAtTime(500, t + 0.2);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.1, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      n.connect(f).connect(g).connect(ctx.destination);
      n.start(t);
      n.stop(t + 0.2);
    } catch {}
  }

  /** Opponent shot — sonar ping alert */
  playAlert() {
    try {
      const ctx = this.getCtx();
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, t);
      osc.frequency.setValueAtTime(550, t + 0.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    } catch {}
  }
}

export const gameSounds = new GameSounds();
