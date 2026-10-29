import { useEffect, useState, useSyncExternalStore } from 'react';

type Listener = () => void;

/**
 * Wraps the hidden <video> element used for preview playback. Keeps time outside React state so
 * playback doesn't re-render the whole editor every frame.
 */
export class Player {
  video: HTMLVideoElement;
  bgVideo: HTMLVideoElement | null = null;
  fps = 30000 / 1001;
  private listeners = new Set<Listener>();
  private raf = 0;
  /** Time shown when no video is loaded (projects restored without their video). */
  private fallbackTime = 0;
  duration = 0;

  constructor() {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.crossOrigin = 'anonymous';
    const notify = () => this.emit();
    for (const ev of ['play', 'pause', 'seeked', 'seeking', 'ended', 'loadeddata', 'timeupdate']) this.video.addEventListener(ev, notify);
    this.video.addEventListener('play', () => this.loop());
    this.video.addEventListener('play', () => this.bgVideo?.play().catch(() => {}));
    this.video.addEventListener('pause', () => this.bgVideo?.pause());
  }

  get hasVideo() {
    return !!this.video.currentSrc && this.video.readyState >= 1;
  }

  get time(): number {
    return this.hasVideo ? this.video.currentTime : this.fallbackTime;
  }

  get playing(): boolean {
    return !this.video.paused && !this.video.ended;
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
    const tick = () => {
      this.emit();
      if (this.playing) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  };

  toggle() {
    if (!this.hasVideo) return;
    if (this.playing) this.video.pause();
    else {
      if (this.video.ended || this.video.currentTime >= this.duration - 0.01) this.video.currentTime = 0;
      this.video.play().catch(() => {});
    }
  }

  pause() {
    if (this.playing) this.video.pause();
  }

  seek(t: number) {
    const clamped = Math.max(0, Math.min(this.duration || 0, t));
    if (this.hasVideo) this.video.currentTime = clamped;
    else this.fallbackTime = clamped;
    if (this.bgVideo && this.bgVideo.duration > 0) this.bgVideo.currentTime = clamped % this.bgVideo.duration;
    this.emit();
  }

  step(frames: number) {
    this.pause();
    // Land on frame boundaries (+ a hair, so the browser shows that frame and not the previous one).
    const f = Math.round(this.time * this.fps) + frames;
    this.seek(f / this.fps + (f > 0 ? 0.001 : 0));
  }

  load(url: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const v = this.video;
      const ok = () => {
        cleanup();
        this.duration = v.duration;
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
    this.fallbackTime = 0;
    this.emit();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
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
