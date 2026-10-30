import { useEffect, useState, useSyncExternalStore } from 'react';
import type { FrameSource } from '../types';

type Listener = () => void;

/** Another video that follows the clock: a highlight tile, the BTS recording, a looping background. */
export interface SlaveDef {
  key: string;
  /** Object URL to load, or an element someone else owns (background video). */
  url?: string;
  el?: HTMLVideoElement;
  /** Where this video should be at output time t. Null means hidden/paused. */
  target: (t: number) => number | null;
  /** Plays sound (the soundtrack of highlight grids). Everything else is muted. */
  audible?: boolean;
}

interface Slave {
  def: SlaveDef;
  el: HTMLVideoElement;
  owned: boolean;
  /** Has decoded a picture at least once; while seeking it keeps showing the last one. */
  shown: boolean;
}

/**
 * Preview playback. Keeps time outside React state so playback doesn't re-render the whole editor
 * every frame.
 *
 * Two clock modes:
 * - 'main': the main video element is the clock (breakdown, launch + highlights, storyboard, BTS).
 * - 'free': a wall clock drives everything (highlight grids, whose length is chosen by the user).
 *   The main video then only plays as the soundtrack, if the soundtrack comes from it.
 * Every other video is a slave that is nudged back into place whenever it drifts.
 */
export class Player {
  video: HTMLVideoElement;
  fps = 30000 / 1001;
  /** Output duration. */
  duration = 0;
  private mode: 'main' | 'free' = 'main';
  private mainTarget: ((t: number) => number | null) | null = null;
  private mainAudible = true;
  private listeners = new Set<Listener>();
  private raf = 0;
  private slaves = new Map<string, Slave>();
  /** Free clock, and the time shown when no video is loaded. */
  private clockTime = 0;
  private clockStart = 0;
  private freePlaying = false;

  constructor() {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.preload = 'auto';
    const notify = () => this.emit();
    for (const ev of ['play', 'pause', 'seeked', 'seeking', 'ended', 'loadeddata', 'timeupdate']) this.video.addEventListener(ev, notify);
    this.video.addEventListener('play', () => this.mode === 'main' && this.loop());
    this.video.addEventListener('pause', () => this.mode === 'main' && this.sync());
  }

  get hasVideo() {
    return !!this.video.currentSrc && this.video.readyState >= 1;
  }

  get time(): number {
    if (this.mode === 'free') return this.freePlaying ? Math.min(this.duration, this.clockTime + (performance.now() - this.clockStart) / 1000) : this.clockTime;
    return this.hasVideo ? this.video.currentTime : this.clockTime;
  }

  get playing(): boolean {
    if (this.mode === 'free') return this.freePlaying;
    return !this.video.paused && !this.video.ended;
  }

  /** Set up the clock and the videos that follow it. Reuses elements whose key and URL are unchanged. */
  configure(opts: { mode: 'main' | 'free'; duration: number; slaves: SlaveDef[]; mainTarget?: (t: number) => number | null; mainAudible?: boolean }) {
    const t = this.time;
    const wasPlaying = this.playing;
    if (opts.mode !== this.mode) {
      this.pause();
      this.mode = opts.mode;
      this.clockTime = Math.min(t, opts.duration);
    }
    this.duration = opts.duration;
    this.mainTarget = opts.mainTarget ?? null;
    this.mainAudible = opts.mainAudible ?? true;
    this.video.muted = !this.mainAudible;
    const keep = new Set<string>();
    for (const def of opts.slaves) {
      keep.add(def.key);
      const cur = this.slaves.get(def.key);
      if (cur && (def.el ? cur.el === def.el : cur.def.url === def.url)) {
        cur.def = def;
        cur.el.muted = !def.audible;
        continue;
      }
      if (cur) this.dropSlave(def.key);
      let el = def.el;
      const owned = !el;
      if (!el) {
        el = document.createElement('video');
        el.playsInline = true;
        el.preload = 'auto';
        el.src = def.url ?? '';
      }
      el.muted = !def.audible;
      const slave: Slave = { def, el, owned, shown: el.readyState >= 2 };
      // Mark the picture as available before the redraw listener below runs.
      el.addEventListener('loadeddata', () => (slave.shown = true), { once: true });
      el.addEventListener('loadedmetadata', this.onSlaveLoaded);
      el.addEventListener('loadeddata', this.onSlaveEvent);
      el.addEventListener('seeked', this.onSlaveEvent);
      this.slaves.set(def.key, slave);
    }
    for (const key of [...this.slaves.keys()]) if (!keep.has(key)) this.dropSlave(key);
    this.sync(true);
    if (wasPlaying && !this.playing && opts.mode === this.mode) this.play();
    this.emit();
  }

  /** The current frame of a slave, if it has one to show. */
  frame(key: string): FrameSource | null {
    const s = this.slaves.get(key);
    if (!s || !s.shown || s.el.videoWidth === 0) return null;
    if (s.def.target(this.time) === null) return null;
    return { image: s.el, width: s.el.videoWidth, height: s.el.videoHeight };
  }

  mainFrame(): FrameSource | null {
    const v = this.video;
    return this.hasVideo && v.readyState >= 2 ? { image: v, width: v.videoWidth, height: v.videoHeight } : null;
  }

  private onSlaveEvent = () => this.emit();

  /** Some video is still seeking or loading, so the picture may not be final yet. */
  get busy(): boolean {
    const t = this.time;
    if (this.mode === 'main' && this.hasVideo && (this.video.seeking || this.video.readyState < 2)) return true;
    for (const s of this.slaves.values()) {
      if (s.def.target(t) === null) continue;
      if (s.el.seeking || s.el.readyState < 2) return true;
    }
    return false;
  }
  /** A follower that finished loading after setup must jump to where it belongs. */
  private onSlaveLoaded = () => {
    this.sync(true);
    this.emit();
  };

  private dropSlave(key: string) {
    const s = this.slaves.get(key);
    if (!s) return;
    s.el.removeEventListener('loadedmetadata', this.onSlaveLoaded);
    s.el.removeEventListener('loadeddata', this.onSlaveEvent);
    s.el.removeEventListener('seeked', this.onSlaveEvent);
    s.el.pause();
    if (s.owned) {
      s.el.removeAttribute('src');
      s.el.load();
    }
    this.slaves.delete(key);
  }

  /** Nudge every follower to where it should be. `hard` seeks even small drifts (used when paused). */
  private sync(hard = false) {
    const t = this.time;
    const playing = this.playing;
    const follow = (el: HTMLVideoElement, target: number | null) => {
      if (el.readyState < 1) return;
      if (target === null) {
        if (!el.paused) el.pause();
        return;
      }
      const want = Math.max(0, Math.min(target, (el.duration || Infinity) - 0.01));
      const drift = Math.abs(el.currentTime - want);
      if (playing) {
        if (drift > 0.25 && !el.seeking) el.currentTime = want;
        if (el.paused) el.play().catch(() => {});
      } else {
        if (!el.paused) el.pause();
        if ((hard || drift > 0.01) && drift > 0.001 && !el.seeking) el.currentTime = want;
      }
    };
    if (this.mode === 'free' && this.hasVideo) follow(this.video, this.mainTarget ? this.mainTarget(t) : null);
    for (const s of this.slaves.values()) follow(s.el, s.def.target(t));
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  private emit() {
    for (const l of this.listeners) l();
  }

  private loop = () => {
    cancelAnimationFrame(this.raf);
    let n = 0;
    const tick = () => {
      if (this.mode === 'free' && this.freePlaying && this.time >= this.duration) {
        this.clockTime = this.duration;
        this.freePlaying = false;
      }
      // Correct drift a few times a second; seeking every frame would stall the videos.
      if (n++ % 8 === 0 || !this.playing) this.sync();
      this.emit();
      if (this.playing) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  };

  private play() {
    if (this.mode === 'free') {
      if (this.clockTime >= this.duration - 0.01) this.clockTime = 0;
      this.clockStart = performance.now();
      this.freePlaying = true;
      this.sync(true);
      this.loop();
    } else {
      if (this.video.ended || this.video.currentTime >= this.duration - 0.01) this.video.currentTime = 0;
      this.video.play().catch(() => {});
    }
    this.emit();
  }

  toggle() {
    if (!this.hasVideo && this.slaves.size === 0) return;
    if (this.playing) this.pause();
    else this.play();
  }

  pause() {
    if (this.mode === 'free') {
      if (!this.freePlaying) return;
      this.clockTime = this.time;
      this.freePlaying = false;
      this.sync(true);
      this.emit();
    } else if (this.playing) this.video.pause();
  }

  seek(t: number) {
    const clamped = Math.max(0, Math.min(this.duration || 0, t));
    if (this.mode === 'free') {
      this.clockTime = clamped;
      this.clockStart = performance.now();
    } else if (this.hasVideo) this.video.currentTime = clamped;
    else this.clockTime = clamped;
    this.sync(true);
    this.emit();
  }

  step(frames: number) {
    this.pause();
    // Land on frame boundaries (+ a hair, so the browser shows that frame and not the previous one).
    const f = Math.round(this.time * this.fps) + frames;
    this.seek(f / this.fps + (f > 0 ? 0.001 : 0));
  }

  /** Load the main video. Resolves with its duration. */
  load(url: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const v = this.video;
      const ok = () => {
        cleanup();
        if (this.mode === 'main') this.duration = v.duration;
        resolve(v.duration);
      };
      const fail = () => {
        cleanup();
        reject(new Error("This video can't be played by your browser. Try converting it to H.264 MP4 first."));
      };
      const cleanup = () => {
        v.removeEventListener('loadeddata', ok);
        v.removeEventListener('error', fail);
      };
      v.addEventListener('loadeddata', ok);
      v.addEventListener('error', fail);
      v.src = url;
      v.load();
    });
  }

  unload() {
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.clockTime = 0;
    this.emit();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    for (const key of [...this.slaves.keys()]) this.dropSlave(key);
    this.unload();
    this.listeners.clear();
  }
}

/** Current time, re-rendering at most every `intervalMs`. */
export function usePlayerTime(player: Player, intervalMs = 66): number {
  const [t, setT] = useState(player.time);
  useEffect(() => {
    let last = 0;
    let pending = 0;
    const unsub = player.subscribe(() => {
      const now = performance.now();
      if (now - last >= intervalMs || !player.playing) {
        last = now;
        setT(player.time);
      } else if (!pending) {
        pending = window.setTimeout(() => {
          pending = 0;
          last = performance.now();
          setT(player.time);
        }, intervalMs);
      }
    });
    return () => {
      unsub();
      clearTimeout(pending);
    };
  }, [player, intervalMs]);
  return t;
}

export function usePlaying(player: Player): boolean {
  return useSyncExternalStore(player.subscribe, () => player.playing);
}
