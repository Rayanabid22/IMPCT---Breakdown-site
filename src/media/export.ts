import {
  ALL_FORMATS,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  canEncodeAudio,
  canEncodeVideo,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny';
import { renderFrame, StaticLayerCache, type RenderState } from '../render/renderFrame';
import { fpsValue, frameCount } from '../lib/time';
import type { FrameSource } from '../types';

export type Quality = 'standard' | 'high';

export interface ExportProgress {
  done: number;
  total: number;
  /** Seconds, null until there is enough data. */
  eta: number | null;
  phase: 'preparing' | 'rendering' | 'finishing';
}

export interface ExportJob {
  state: RenderState;
  videoFile: Blob;
  bgVideoFile: Blob | null;
  quality: Quality;
  signal: AbortSignal;
  onProgress: (p: ExportProgress) => void;
  /** Called every few frames with the canvas just rendered, so the UI can show it. */
  onFrame?: (canvas: OffscreenCanvas | HTMLCanvasElement) => void;
}

export class ExportError extends Error {
  hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.hint = hint;
  }
}

export function videoBitrate(w: number, h: number, quality: Quality): number {
  const base = quality === 'high' ? 14_000_000 : 7_000_000;
  return Math.round((base * (w * h)) / (1440 * 1080));
}

export function estimateBytes(duration: number, w: number, h: number, quality: Quality): number {
  return ((videoBitrate(w, h, quality) + 192_000) * duration) / 8;
}

export function hasWebCodecs(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

const AAC_BITRATE = 192_000;

type Matrix = 'bt709' | 'smpte170m';

/**
 * Untagged video (no color info in the file) is up to the browser to interpret, and Chrome's <video>
 * element, which drives the preview, picks different matrices per codec (BT.709 for H.264, BT.601
 * for VP9). Mediabunny would always assume BT.709. To keep the export identical to the preview, we
 * decode one frame both ways and keep whichever matrix matches what the preview shows.
 */
async function matchPreviewColors(track: InputVideoTrack, file: Blob): Promise<void> {
  const original = track.getDecoderConfig.bind(track);
  let matrix: Matrix = track.codec === 'vp8' || track.codec === 'vp9' ? 'smpte170m' : 'bt709';
  track.getDecoderConfig = async () => {
    const config = await original();
    if (!config) return config;
    const cs = config.colorSpace ?? {};
    if (cs.matrix && cs.primaries && cs.transfer && cs.fullRange != null) return config;
    return {
      ...config,
      colorSpace: {
        primaries: cs.primaries ?? 'bt709',
        transfer: cs.transfer ?? 'bt709',
        matrix: cs.matrix ?? matrix,
        fullRange: cs.fullRange ?? false,
      },
    };
  };
  const cs = await track.getColorSpace().catch(() => ({}) as VideoColorSpaceInit);
  if (cs.matrix) return;
  try {
    const first = await track.getFirstTimestamp();
    const duration = (await track.computeDuration()) - first;
    const t = Math.min(1, duration / 2);
    const reference = await elementPixels(file, t);
    if (!reference) return;
    let best = Infinity;
    let chosen = matrix;
    for (const candidate of ['bt709', 'smpte170m'] as Matrix[]) {
      matrix = candidate;
      const sink = new CanvasSink(track, { width: PROBE_W, height: PROBE_H, fit: 'fill', poolSize: 1 });
      const wrapped = await sink.getCanvas(first + t);
      if (!wrapped) continue;
      const ctx = wrapped.canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
      const d = pixelDiff(reference, ctx.getImageData(0, 0, PROBE_W, PROBE_H).data);
      if (d < best) {
        best = d;
        chosen = candidate;
      }
    }
    matrix = chosen;
  } catch (err) {
    console.warn('Color calibration skipped', err);
  }
}

const PROBE_W = 64;
const PROBE_H = 36;

function pixelDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return s;
}

/** A small frame at time t as the browser's <video> element shows it. */
async function elementPixels(file: Blob, t: number): Promise<Uint8ClampedArray | null> {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  const url = URL.createObjectURL(file);
  try {
    const wait = (ev: string) =>
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 8000);
        v.addEventListener(ev, () => (clearTimeout(timer), resolve(true)), { once: true });
        v.addEventListener('error', () => (clearTimeout(timer), resolve(false)), { once: true });
      });
    const loaded = wait('loadeddata');
    v.src = url;
    if (!(await loaded)) return null;
    const seeked = wait('seeked');
    v.currentTime = t;
    if (!(await seeked)) return null;
    const c = new OffscreenCanvas(PROBE_W, PROBE_H);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(v, 0, 0, PROBE_W, PROBE_H);
    return ctx.getImageData(0, 0, PROBE_W, PROBE_H).data;
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}

/** Frame-accurate offline export with WebCodecs. Returns an MP4 blob. */
export async function exportWithWebCodecs(job: ExportJob): Promise<Blob> {
  const { state, signal } = job;
  const { w: W, h: H } = state.style.canvas;
  const fps = fpsValue(state.style.fps);
  const total = frameCount(state.duration, fps);
  job.onProgress({ done: 0, total, eta: null, phase: 'preparing' });

  const bitrate = videoBitrate(W, H, job.quality);
  if (!(await canEncodeVideo('avc', { width: W, height: H, bitrate }))) {
    throw new ExportError(
      'Your browser cannot encode H.264 video at this size.',
      'Update Chrome or Edge to the latest version, or try a smaller canvas size.',
    );
  }

  const input = new Input({ source: new BlobSource(job.videoFile), formats: ALL_FORMATS });
  const bgInput = job.bgVideoFile ? new Input({ source: new BlobSource(job.bgVideoFile), formats: ALL_FORMATS }) : null;
  let output: Output | null = null;
  try {
    const videoTrack = await input.getPrimaryVideoTrack().catch(() => null);
    if (!videoTrack) {
      throw new ExportError('Could not read the video file.', 'Make sure it is an MP4, MOV or WebM file that plays in your browser.');
    }
    if (!(await videoTrack.canDecode())) {
      throw new ExportError(
        "This video's codec isn't supported by your browser.",
        'Try converting it to H.264 MP4 first (for example with HandBrake), then upload it again.',
      );
    }
    await matchPreviewColors(videoTrack, job.videoFile);
    const audioTrack = await input.getPrimaryAudioTrack().catch(() => null);
    // Anchor on the video track. Audio can start slightly earlier (AAC priming) and must keep that offset.
    const t0 = await videoTrack.getFirstTimestamp();

    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new ExportError('Could not create a drawing surface.', 'Close other tabs and try again.');

    output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const videoSource = new CanvasSource(canvas, {
      codec: 'avc',
      bitrate,
      keyFrameInterval: 2,
      latencyMode: 'quality',
    });
    output.addVideoTrack(videoSource, { frameRate: fps });

    const audioPump = audioTrack ? await setupAudio(output, audioTrack, t0, state.duration, signal) : null;
    await output.start();

    const sink = new CanvasSink(videoTrack, { poolSize: 2 });
    const cache = new StaticLayerCache();

    let bgSink: CanvasSink | null = null;
    let bgDuration = 0;
    let bgT0 = 0;
    if (bgInput && state.style.background.type === 'video') {
      const bgTrack = await bgInput.getPrimaryVideoTrack().catch(() => null);
      if (bgTrack && (await bgTrack.canDecode())) {
        await matchPreviewColors(bgTrack, job.bgVideoFile!);
        bgSink = new CanvasSink(bgTrack, { poolSize: 2, width: Math.min(W, bgTrack.displayWidth) });
        bgDuration = (await bgTrack.computeDuration()) - (await bgTrack.getFirstTimestamp());
        bgT0 = await bgTrack.getFirstTimestamp();
      }
    }
    const bgIter = bgSink
      ? bgSink.canvasesAtTimestamps(
          (function* () {
            for (let i = 0; i < total; i++) yield bgT0 + (bgDuration > 0 ? (i / fps) % bgDuration : 0);
          })(),
        )[Symbol.asyncIterator]()
      : null;

    const timestamps = (function* () {
      for (let i = 0; i < total; i++) yield t0 + i / fps;
    })();

    const videoPump = async () => {
      let i = 0;
      let last: FrameSource | null = null;
      const started = performance.now();
      let lastReport = 0;
      for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
        if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
        if (wrapped) last = { image: wrapped.canvas, width: wrapped.canvas.width, height: wrapped.canvas.height };
        let bgFrame: FrameSource | null = null;
        if (bgIter) {
          const r = await bgIter.next();
          if (!r.done && r.value) bgFrame = { image: r.value.canvas, width: r.value.canvas.width, height: r.value.canvas.height };
        }
        const t = i / fps;
        renderFrame(ctx, state, t, last, cache, 1, bgFrame);
        await videoSource.add(t, 1 / fps);
        i++;
        const now = performance.now();
        if (now - lastReport > 200 || i === total) {
          lastReport = now;
          const elapsed = (now - started) / 1000;
          const eta = i > 10 ? (elapsed / i) * (total - i) : null;
          job.onProgress({ done: i, total, eta, phase: 'rendering' });
          job.onFrame?.(canvas);
        }
        if (i >= total) break;
      }
      // Pad if the source ran out of frames early (rare, but keeps duration exact).
      while (i < total) {
        if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
        const t = i / fps;
        renderFrame(ctx, state, t, last, cache, 1, null);
        await videoSource.add(t, 1 / fps);
        i++;
      }
      videoSource.close();
    };

    await Promise.all([videoPump(), audioPump ? audioPump() : Promise.resolve()]);
    job.onProgress({ done: total, total, eta: 0, phase: 'finishing' });
    await output.finalize();
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new ExportError('The export produced no data.', 'Try again, or reload the page.');
    return new Blob([buffer], { type: 'video/mp4' });
  } catch (err) {
    if (output && output.state !== 'finalized' && output.state !== 'canceled') {
      await output.cancel().catch(() => {});
    }
    throw err;
  } finally {
    input.dispose();
    bgInput?.dispose();
  }
}

/** Adds the audio track to the output and returns a function that pumps all audio into it. */
async function setupAudio(output: Output, track: InputAudioTrack, t0: number, duration: number, signal: AbortSignal): Promise<(() => Promise<void>) | null> {
  // Fast path: AAC source, copy packets without re-encoding (bit exact, perfectly in sync).
  if (track.codec === 'aac') {
    const decoderConfig = await track.getDecoderConfig();
    if (decoderConfig) {
      const source = new EncodedAudioPacketSource('aac');
      output.addAudioTrack(source);
      return async () => {
        const sink = new EncodedPacketSink(track);
        let first = true;
        for await (const packet of sink.packets()) {
          if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
          // Negative timestamps (encoder priming) are kept; MP4 trims them with an edit list.
          const ts = packet.timestamp - t0;
          if (ts + packet.duration <= -0.5) continue;
          if (ts >= duration) break;
          await source.add(packet.clone({ timestamp: ts }), first ? { decoderConfig } : undefined);
          first = false;
        }
        source.close();
      };
    }
  }

  // Otherwise decode and re-encode to AAC.
  if (!(await track.canDecode())) return null;
  const opts = { numberOfChannels: Math.min(2, track.numberOfChannels), sampleRate: track.sampleRate, bitrate: AAC_BITRATE };
  if (!(await canEncodeAudio('aac', opts))) {
    const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
    registerAacEncoder();
  }
  const source = new AudioSampleSource({ codec: 'aac', bitrate: AAC_BITRATE });
  output.addAudioTrack(source);
  return async () => {
    const sink = new AudioSampleSink(track);
    for await (const sample of sink.samples()) {
      if (signal.aborted) {
        sample.close();
        throw new DOMException('Export cancelled', 'AbortError');
      }
      const ts = sample.timestamp - t0;
      if (ts >= duration) {
        sample.close();
        break;
      }
      if (ts + sample.duration <= 0) {
        sample.close();
        continue;
      }
      sample.setTimestamp(ts);
      await source.add(sample);
      sample.close();
    }
    source.close();
  };
}

// ---------- real-time fallback ----------

export function pickRecorderMime(): { mime: string; ext: 'mp4' | 'webm' } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates: [string, 'mp4' | 'webm'][] = [
    ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'mp4'],
    ['video/mp4;codecs=avc1,mp4a', 'mp4'],
    ['video/mp4;codecs=avc1', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm;codecs=vp8,opus', 'webm'],
    ['video/webm', 'webm'],
  ];
  for (const [mime, ext] of candidates) if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  return null;
}

/** Real-time capture. Takes as long as the video. */
export async function exportWithRecorder(job: ExportJob, bgVideoEl: HTMLVideoElement | null): Promise<{ blob: Blob; ext: 'mp4' | 'webm' }> {
  const picked = pickRecorderMime();
  if (!picked) throw new ExportError('Your browser cannot record video.', 'Please use the latest Chrome or Edge.');
  const { state, signal } = job;
  const { w: W, h: H } = state.style.canvas;
  const fps = fpsValue(state.style.fps);
  const total = frameCount(state.duration, fps);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const video = document.createElement('video');
  video.src = URL.createObjectURL(job.videoFile);
  video.playsInline = true;
  video.preload = 'auto';
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new ExportError("This video can't be played by your browser.", 'Try converting it to H.264 MP4 first.'));
  });

  const audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  try {
    audioCtx.createMediaElementSource(video).connect(dest);
  } catch {
    /* no audio */
  }
  const stream = canvas.captureStream(Math.round(fps));
  for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
  const recorder = new MediaRecorder(stream, { mimeType: picked.mime, videoBitsPerSecond: videoBitrate(W, H, job.quality), audioBitsPerSecond: AAC_BITRATE });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const cache = new StaticLayerCache();

  const draw = () => {
    const t = Math.min(video.currentTime, state.duration);
    const bg = bgVideoEl && bgVideoEl.readyState >= 2 ? { image: bgVideoEl, width: bgVideoEl.videoWidth, height: bgVideoEl.videoHeight } : null;
    renderFrame(ctx, state, t, { image: video, width: video.videoWidth, height: video.videoHeight }, cache, 1, bg);
    job.onProgress({ done: Math.min(total, Math.round(t * fps)), total, eta: Math.max(0, state.duration - t), phase: 'rendering' });
    job.onFrame?.(canvas);
  };

  try {
    draw();
    await audioCtx.resume();
    recorder.start(1000);
    video.currentTime = 0;
    await video.play();
    await new Promise<void>((resolve, reject) => {
      let raf = 0;
      const tick = () => {
        if (signal.aborted) {
          cancelAnimationFrame(raf);
          video.pause();
          reject(new DOMException('Export cancelled', 'AbortError'));
          return;
        }
        draw();
        if (video.ended) {
          resolve();
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    draw();
    await new Promise((r) => setTimeout(r, 150));
    const stopped = new Promise((r) => (recorder.onstop = r));
    recorder.stop();
    await stopped;
    return { blob: new Blob(chunks, { type: picked.mime.split(';')[0] }), ext: picked.ext };
  } finally {
    if (recorder.state !== 'inactive') recorder.stop();
    video.pause();
    URL.revokeObjectURL(video.src);
    audioCtx.close().catch(() => {});
  }
}
