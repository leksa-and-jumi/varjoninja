// Sound effects made with Web Audio (no sound files): hits, whooshes, the rope, sirens,
// wind when moving fast and a car engine.

import type { SoundName } from '../play/world';

type Listener = { x: number; y: number; z: number };

export class Sounds {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode } | null = null;
  private siren: { osc: OscillatorNode; gain: GainNode; lfo: OscillatorNode } | null = null;
  private city: GainNode | null = null;
  volume = 0.8;
  listener: Listener = { x: 0, y: 0, z: 0 };

  /** Must be called from a click (browsers only allow audio after the user does something). */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.startLoops();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    return src;
  }

  private startLoops(): void {
    const ctx = this.ctx!;
    // Wind: filtered noise, louder when fast.
    const wn = this.noiseSource();
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 600;
    wf.Q.value = 0.6;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    wn.connect(wf).connect(wg).connect(this.master!);
    wn.start();
    this.wind = { gain: wg, filter: wf };

    // Distant city rumble.
    const cn = this.noiseSource();
    const cf = ctx.createBiquadFilter();
    cf.type = 'lowpass';
    cf.frequency.value = 220;
    const cg = ctx.createGain();
    cg.gain.value = 0.05;
    cn.connect(cf).connect(cg).connect(this.master!);
    cn.start();
    this.city = cg;

    // Engine (silent until driving).
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    const ef = ctx.createBiquadFilter();
    ef.type = 'lowpass';
    ef.frequency.value = 500;
    const eg = ctx.createGain();
    eg.gain.value = 0;
    osc.connect(ef);
    osc2.connect(ef);
    ef.connect(eg).connect(this.master!);
    osc.start();
    osc2.start();
    this.engine = { osc, osc2, gain: eg };

    // Police siren (wailing).
    const so = ctx.createOscillator();
    so.type = 'triangle';
    so.frequency.value = 800;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.35;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain).connect(so.frequency);
    const sg = ctx.createGain();
    sg.gain.value = 0;
    so.connect(sg).connect(this.master!);
    so.start();
    lfo.start();
    this.siren = { osc: so, gain: sg, lfo };
  }

  /** Continuous sounds, every frame. */
  update(speed: number, driving: boolean, carSpeed: number, sirenOn: boolean, night: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const w = Math.max(0, Math.min(1, (speed - 10) / 40));
    this.wind?.gain.gain.setTargetAtTime(driving ? 0 : w * 0.35, t, 0.15);
    this.wind?.filter.frequency.setTargetAtTime(400 + w * 1400, t, 0.2);
    if (this.engine) {
      const rpm = 40 + Math.abs(carSpeed) * 3.2;
      this.engine.osc.frequency.setTargetAtTime(rpm, t, 0.1);
      this.engine.osc2.frequency.setTargetAtTime(rpm * 0.5, t, 0.1);
      this.engine.gain.gain.setTargetAtTime(driving ? 0.09 : 0, t, 0.2);
    }
    this.siren?.gain.gain.setTargetAtTime(sirenOn ? 0.04 : 0, t, 0.3);
    this.city?.gain.setTargetAtTime(0.05 * (1 - night * 0.5), t, 1);
  }

  private env(gain: GainNode, attack: number, decay: number, peak: number): void {
    const t = this.ctx!.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private distanceGain(at?: { x: number; y: number; z: number }): number {
    if (!at) return 1;
    const d = Math.hypot(at.x - this.listener.x, at.y - this.listener.y, at.z - this.listener.z);
    return Math.max(0, 1 - d / 60);
  }

  private tone(
    freq: number,
    endFreq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
  ): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), ctx.currentTime + dur);
    const g = ctx.createGain();
    this.env(g, 0.005, dur, vol);
    o.connect(g).connect(this.master!);
    o.start();
    o.stop(ctx.currentTime + dur + 0.05);
  }

  private burst(
    freq: number,
    q: number,
    dur: number,
    vol: number,
    type: BiquadFilterType = 'bandpass',
    sweepTo?: number,
  ): void {
    const ctx = this.ctx!;
    const src = this.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, ctx.currentTime);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, 0.004, dur, vol);
    src.connect(f).connect(g).connect(this.master!);
    src.start();
    src.stop(ctx.currentTime + dur + 0.05);
  }

  play(
    name: SoundName | 'rope' | 'jump' | 'land' | 'zip' | 'splash' | 'ui' | 'alarm',
    at?: { x: number; y: number; z: number },
  ): void {
    if (!this.ctx) return;
    const v = this.distanceGain(at);
    if (v <= 0.01) return;
    switch (name) {
      case 'punch':
        this.burst(900, 1, 0.08, 0.5 * v);
        this.tone(160, 60, 0.1, 'sine', 0.5 * v);
        break;
      case 'kick':
        this.burst(600, 0.8, 0.12, 0.6 * v);
        this.tone(120, 40, 0.18, 'sine', 0.7 * v);
        break;
      case 'whoosh':
        this.burst(500, 1.5, 0.18, 0.18 * v, 'bandpass', 2200);
        break;
      case 'rope':
        this.burst(2500, 3, 0.12, 0.25 * v, 'bandpass', 800);
        this.tone(1400, 500, 0.08, 'triangle', 0.08 * v);
        break;
      case 'zip':
        this.burst(800, 2, 0.3, 0.25 * v, 'bandpass', 3000);
        break;
      case 'jump':
        this.burst(700, 1, 0.1, 0.1 * v, 'bandpass', 1500);
        break;
      case 'land':
        this.tone(90, 40, 0.12, 'sine', 0.35 * v);
        this.burst(300, 0.7, 0.08, 0.15 * v);
        break;
      case 'hurt':
        this.tone(300, 120, 0.2, 'square', 0.15 * v);
        this.burst(500, 1, 0.1, 0.3 * v);
        break;
      case 'ko':
        this.tone(700, 1800, 0.25, 'triangle', 0.12 * v);
        break;
      case 'coin':
        this.tone(988, 988, 0.08, 'square', 0.1 * v);
        setTimeout(() => this.tone(1319, 1319, 0.25, 'square', 0.1 * v), 80);
        break;
      case 'reward':
        [523, 659, 784, 1047].forEach((f, i) =>
          setTimeout(() => this.tone(f, f, 0.22, 'triangle', 0.18), i * 90),
        );
        break;
      case 'shuriken':
        this.burst(3000, 4, 0.15, 0.2 * v, 'bandpass', 6000);
        break;
      case 'smoke':
        this.burst(400, 0.5, 0.9, 0.5 * v, 'lowpass', 120);
        break;
      case 'carHit':
        this.burst(250, 0.5, 0.35, 0.7 * v, 'lowpass', 80);
        this.tone(80, 30, 0.3, 'sine', 0.5 * v);
        break;
      case 'horn':
        this.tone(415, 415, 0.35, 'sawtooth', 0.06 * v);
        this.tone(330, 330, 0.35, 'sawtooth', 0.06 * v);
        break;
      case 'meow':
        this.tone(700, 1100, 0.15, 'triangle', 0.15);
        setTimeout(() => this.tone(1100, 600, 0.35, 'triangle', 0.15), 150);
        break;
      case 'finisher':
        // Rising swoosh, then a deep boom.
        this.burst(300, 1.2, 0.5, 0.45, 'bandpass', 3500);
        this.tone(220, 880, 0.35, 'sawtooth', 0.06);
        setTimeout(() => {
          this.tone(110, 35, 0.6, 'sine', 0.8);
          this.burst(180, 0.6, 0.5, 0.6, 'lowpass', 60);
        }, 380);
        break;
      case 'carDoor':
        this.burst(200, 1, 0.12, 0.4 * v, 'lowpass');
        break;
      case 'splash':
        this.burst(1200, 0.5, 0.6, 0.5 * v, 'lowpass', 300);
        break;
      case 'ui':
        this.tone(660, 880, 0.06, 'triangle', 0.08);
        break;
      case 'alarm':
        this.tone(880, 660, 0.3, 'square', 0.06);
        setTimeout(() => this.tone(880, 660, 0.3, 'square', 0.06), 330);
        break;
    }
  }
}
