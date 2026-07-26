import { useCallback, useEffect, useRef, useState } from 'react';
import { bump, useOnScreen } from './beat';

/**
 * Eight pads that actually do something.
 *
 * Every other landing page describes what a button feels like. This one lets
 * you hit it. The voices are synthesised on the spot with a handful of
 * oscillators — there is no audio to download, nothing autoplays, and the
 * context is not even created until the first pad is pressed, which is the
 * gesture browsers want anyway.
 *
 * These are toys, and the copy beside them says so: the real pads on the
 * console fire the samples you uploaded. What is honest here is the shape of
 * the thing — eight pads, one press, immediate.
 */

type Voice = 'kick' | 'clap' | 'hat' | 'sub' | 'stab' | 'chord' | 'rise' | 'stop';

const PADS: ReadonlyArray<{ label: string; voice: Voice }> = [
  { label: 'KICK', voice: 'kick' },
  { label: 'CLAP', voice: 'clap' },
  { label: 'HAT', voice: 'hat' },
  { label: 'SUB', voice: 'sub' },
  { label: 'STAB', voice: 'stab' },
  { label: 'CHORD', voice: 'chord' },
  { label: 'RISE', voice: 'rise' },
  { label: 'STOP', voice: 'stop' },
];

/* ---------------------------------------------------------------- synth */

type Rig = { ctx: AudioContext; out: GainNode; noise: AudioBuffer };

function makeRig(): Rig | null {
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  const ctx = new Ctor();
  const out = ctx.createGain();
  // Quiet on purpose. This is a landing page someone opened with the volume
  // wherever they left it, not a set.
  out.gain.value = 0.22;
  out.connect(ctx.destination);

  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

  return { ctx, out, noise };
}

function burst(rig: Rig, at: number, length: number, filter: BiquadFilterNode, level: number) {
  const source = rig.ctx.createBufferSource();
  source.buffer = rig.noise;
  const gain = rig.ctx.createGain();
  gain.gain.setValueAtTime(level, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  source.connect(filter).connect(gain).connect(rig.out);
  source.start(at);
  source.stop(at + length + 0.02);
}

function tone(rig: Rig, at: number, type: OscillatorType, from: number, to: number, length: number, level: number) {
  const osc = rig.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, at);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, at + length * 0.8);
  const gain = rig.ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(level, at + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(rig.out);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

/** One press, one voice. Everything is scheduled ahead of the clock, never on it. */
function play(rig: Rig, voice: Voice) {
  const { ctx } = rig;
  const at = ctx.currentTime + 0.005;
  const band = (type: BiquadFilterType, freq: number, q = 1) => {
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, at);
    filter.Q.value = q;
    return filter;
  };

  switch (voice) {
    case 'kick':
      tone(rig, at, 'sine', 128, 44, 0.34, 0.9);
      burst(rig, at, 0.03, band('bandpass', 1800, 0.7), 0.25);
      break;
    case 'clap':
      // Three quick slaps, which is what makes a clap a clap.
      [0, 0.012, 0.026].forEach((offset, i) => {
        burst(rig, at + offset, i === 2 ? 0.18 : 0.04, band('bandpass', 1500, 1.4), 0.45 - i * 0.07);
      });
      break;
    case 'hat':
      burst(rig, at, 0.045, band('highpass', 7600, 0.9), 0.3);
      break;
    case 'sub':
      tone(rig, at, 'sine', 58, 52, 0.6, 0.85);
      break;
    case 'stab':
      [220, 261.63, 329.63].forEach((freq) => tone(rig, at, 'sawtooth', freq, freq, 0.19, 0.16));
      break;
    case 'chord': {
      // A minor ninth, softly: the one chord that sounds like a room warming up.
      [110, 164.81, 196, 246.94].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(0.13, at + 0.16 + i * 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.5);
        osc.connect(gain).connect(rig.out);
        osc.start(at);
        osc.stop(at + 1.55);
      });
      break;
    }
    case 'rise': {
      const filter = band('bandpass', 400, 6);
      filter.frequency.exponentialRampToValueAtTime(7000, at + 0.9);
      const source = ctx.createBufferSource();
      source.buffer = rig.noise;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.02, at);
      gain.gain.linearRampToValueAtTime(0.5, at + 0.85);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.0);
      source.connect(filter).connect(gain).connect(rig.out);
      source.start(at);
      source.stop(at + 1.05);
      break;
    }
    case 'stop':
      // A real kill: duck the bus and bring it straight back, so whatever was
      // ringing is gone rather than fading out politely.
      rig.out.gain.cancelScheduledValues(at);
      rig.out.gain.setValueAtTime(0.0001, at);
      rig.out.gain.linearRampToValueAtTime(0.22, at + 0.25);
      break;
    default:
      break;
  }
}

/* ----------------------------------------------------------------- pads */

export function PadPlay() {
  const [sectionRef, visible] = useOnScreen<HTMLDivElement>('-20% 0px -20% 0px');
  const rigRef = useRef<Rig | null>(null);
  const [lit, setLit] = useState<number | null>(null);
  const [heard, setHeard] = useState(false);
  const timer = useRef(0);

  const hit = useCallback((index: number) => {
    const pad = PADS[index];
    if (!pad) return;

    if (!rigRef.current) rigRef.current = makeRig();
    const rig = rigRef.current;
    if (rig) {
      // Suspended is the normal state on a page nobody has clicked yet, and
      // on any tab that has been in the background for a while.
      if (rig.ctx.state === 'suspended') void rig.ctx.resume();
      play(rig, pad.voice);
      setHeard(true);
    }

    bump(pad.voice === 'stop' ? 0.3 : 1);
    setLit(index);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLit(null), 190);
  }, []);

  // 1–8 fire the pads, exactly as they do on the console — but only while the
  // pads are on screen, so the keys are never quietly stolen from the page.
  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 8) {
        event.preventDefault();
        hit(digit - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, hit]);

  useEffect(() => {
    const held = rigRef;
    return () => {
      window.clearTimeout(timer.current);
      void held.current?.ctx.close();
      held.current = null;
    };
  }, []);

  return (
    <div className={`padplay ${visible ? 'is-on' : ''}`} ref={sectionRef}>
      <div className="padplay-grid">
        {PADS.map((pad, index) => (
          <button
            type="button"
            key={pad.label}
            className={`padplay-pad ${lit === index ? 'is-lit' : ''}`}
            onPointerDown={() => hit(index)}
            onKeyDown={(event) => {
              // Space and Enter would fire on key-up through the click path;
              // a pad that waits for you to let go is not a pad.
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                hit(index);
              }
            }}
          >
            <span className="padplay-index">{index + 1}</span>
            <span className="padplay-label">{pad.label}</span>
            <span className="padplay-ring" aria-hidden="true" />
          </button>
        ))}
      </div>

      <p className="padplay-note">
        {heard
          ? 'That is the shape of it — press, sound, no delay. On the console the eight pads fire your own samples, one-shot, looped or held.'
          : 'Hit one. Sound comes out of your speakers, not the voice channel — the eight pads on the real console fire your own samples.'}
      </p>
    </div>
  );
}
