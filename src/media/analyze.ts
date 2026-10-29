import { ALL_FORMATS, AudioSampleSink, BlobSource, CanvasSink, Input } from 'mediabunny';

export const PEAK_BUCKETS = 2000;

/** RMS per bucket across the full duration, normalized to 0..1. Streams the audio, so memory stays low. */
export async function computePeaks(file: Blob, duration: number, signal?: AbortSignal): Promise<Float32Array | null> {
  try {
    return await peaksWithMediabunny(file, duration, signal);
  } catch (err) {
    if (signal?.aborted) return null;
    console.warn('Streaming audio analysis failed, trying decodeAudioData', err);
    try {
      return await peaksWithWebAudio(file);
    } catch (err2) {
      console.warn('No audio waveform available', err2);
      return null;
    }
  }
}

async function peaksWithMediabunny(file: Blob, duration: number, signal?: AbortSignal): Promise<Float32Array | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return null;
    if (!(await track.canDecode())) throw new Error('Audio codec not decodable');
    const first = await track.getFirstTimestamp();
    const sums = new Float64Array(PEAK_BUCKETS);
    const counts = new Uint32Array(PEAK_BUCKETS);
    const sink = new AudioSampleSink(track);
    let scratch = new Float32Array(0);
    let lastYield = performance.now();
    for await (const sample of sink.samples()) {
      if (signal?.aborted) {
        sample.close();
        return null;
      }
      const frames = sample.numberOfFrames;
      if (scratch.length < frames) scratch = new Float32Array(frames);
      // Mix down using channel 0 only, plenty for a visual waveform.
      sample.copyTo(scratch, { planeIndex: 0, format: 'f32-planar' });
      const rate = sample.sampleRate;
      const t0 = sample.timestamp - first;
      for (let i = 0; i < frames; i++) {
        const t = t0 + i / rate;
        const b = Math.min(PEAK_BUCKETS - 1, Math.max(0, Math.floor((t / duration) * PEAK_BUCKETS)));
        const v = scratch[i];
        sums[b] += v * v;
        counts[b]++;
      }
      sample.close();
      if (performance.now() - lastYield > 30) {
        await new Promise((r) => setTimeout(r, 0));
        lastYield = performance.now();
      }
    }
    return normalize(sums, counts);
  } finally {
    input.dispose();
  }
}

async function peaksWithWebAudio(file: Blob): Promise<Float32Array | null> {
  const buf = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const audio = await ctx.decodeAudioData(buf);
  const data = audio.getChannelData(0);
  const sums = new Float64Array(PEAK_BUCKETS);
  const counts = new Uint32Array(PEAK_BUCKETS);
  for (let i = 0; i < data.length; i++) {
    const b = Math.min(PEAK_BUCKETS - 1, Math.floor((i / data.length) * PEAK_BUCKETS));
    sums[b] += data[i] * data[i];
    counts[b]++;
  }
  return normalize(sums, counts);
}

function normalize(sums: Float64Array, counts: Uint32Array): Float32Array {
  const out = new Float32Array(sums.length);
  let max = 0;
  for (let i = 0; i < sums.length; i++) {
    out[i] = counts[i] ? Math.sqrt(sums[i] / counts[i]) : 0;
    if (out[i] > max) max = out[i];
  }
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] /= max;
  return out;
}

export interface Thumbnails {
  /** One image per entry, evenly spaced in time. */
  images: (HTMLCanvasElement | OffscreenCanvas)[];
  times: number[];
  width: number;
  height: number;
}

/** About one thumbnail per second, capped, generated once after upload. */
export async function computeThumbnails(
  file: Blob,
  duration: number,
  onProgress?: (t: Thumbnails) => void,
  signal?: AbortSignal,
): Promise<Thumbnails | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const first = await track.getFirstTimestamp();
    const height = 54;
    const width = Math.round((height * track.displayWidth) / track.displayHeight) || 96;
    const count = Math.max(2, Math.min(120, Math.round(duration)));
    const times = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * duration);
    const sink = new CanvasSink(track, { width, height, fit: 'cover', poolSize: 0 });
    const result: Thumbnails = { images: [], times: [], width, height };
    let i = 0;
    let lastReport = performance.now();
    for await (const wrapped of sink.canvasesAtTimestamps(times.map((t) => t + first))) {
      if (signal?.aborted) return null;
      if (wrapped) {
        result.images.push(wrapped.canvas);
        result.times.push(times[i]);
      }
      i++;
      if (performance.now() - lastReport > 250) {
        onProgress?.({ ...result, images: [...result.images], times: [...result.times] });
        lastReport = performance.now();
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    return result;
  } catch (err) {
    console.warn('Thumbnails unavailable', err);
    return null;
  } finally {
    input.dispose();
  }
}
