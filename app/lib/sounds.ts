const SOUND_STORAGE_KEY = "sw_sound_enabled";

export function isGameSoundEnabled() {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SOUND_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setGameSoundEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, enabled ? "1" : "0");
  } catch {}
}

class GameSounds {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  private getCtx(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    return this.ctx;
  }

  private getMaster(): GainNode {
    const ctx = this.getCtx();
    if (!this.master || this.master.context !== ctx) {
      this.master = ctx.createGain();
      this.master.gain.value = 0.58;
      this.master.connect(ctx.destination);
    }
    return this.master;
  }

  private canPlay() {
    return isGameSoundEnabled();
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
      if (!this.canPlay()) return;
      const ctx = this.getCtx();
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(360, t);
      osc.frequency.exponentialRampToValueAtTime(145, t + 0.11);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.045, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      osc.connect(g).connect(this.getMaster());
      osc.start(t);
      osc.stop(t + 0.12);
    } catch {}
  }

  /** Hit (yellow) — medium explosion */
  playHit() {
    try {
      if (!this.canPlay()) return;
      const ctx = this.getCtx();
      const t = ctx.currentTime;
      const n = this.noise(0.22);
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.setValueAtTime(720, t);
      f.frequency.exponentialRampToValueAtTime(210, t + 0.22);
      f.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.065, t + 0.018);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      n.connect(f).connect(g).connect(this.getMaster());
      n.start(t);
      n.stop(t + 0.22);
    } catch {}
  }

  /** Ship sunk (red/kill) — big explosion */
  playSunk() {
    try {
      if (!this.canPlay()) return;
      const ctx = this.getCtx();
      const t = ctx.currentTime;
      // Low rumble
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(96, t);
      osc.frequency.exponentialRampToValueAtTime(38, t + 0.42);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.linearRampToValueAtTime(0.08, t + 0.035);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      osc.connect(og).connect(this.getMaster());
      osc.start(t);
      osc.stop(t + 0.44);
      // Noise crackle
      const n = this.noise(0.28);
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(1500, t);
      f.frequency.exponentialRampToValueAtTime(220, t + 0.28);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.linearRampToValueAtTime(0.045, t + 0.02);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      n.connect(f).connect(ng).connect(this.getMaster());
      n.start(t);
      n.stop(t + 0.28);
    } catch {}
  }

  /** Miss — water splash */
  playMiss() {
    try {
      if (!this.canPlay()) return;
      const ctx = this.getCtx();
      const t = ctx.currentTime;
      const n = this.noise(0.16);
      const f = ctx.createBiquadFilter();
      f.type = "highpass";
      f.frequency.setValueAtTime(1700, t);
      f.frequency.exponentialRampToValueAtTime(640, t + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.032, t + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      n.connect(f).connect(g).connect(this.getMaster());
      n.start(t);
      n.stop(t + 0.16);
    } catch {}
  }

  /** Opponent shot — sonar ping alert */
  playAlert() {
    try {
      if (!this.canPlay()) return;
      const ctx = this.getCtx();
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.setValueAtTime(650, t + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.04, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(g).connect(this.getMaster());
      osc.start(t);
      osc.stop(t + 0.18);
    } catch {}
  }
}

export const gameSounds = new GameSounds();
