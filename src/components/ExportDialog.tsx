import { useEffect, useRef, useState } from 'react';
import type { RenderState } from '../render/renderFrame';
import {
  canEncodeSize,
  estimateBytes,
  outputSize,
  type ExportScale,
  ExportError,
  exportWithRecorder,
  exportWithWebCodecs,
  hasWebCodecs,
  pickRecorderMime,
  type ExportProgress,
  type Quality,
} from '../media/export';
import { formatTime } from '../lib/time';
import { MAIN } from '../types';

interface Props {
  state: RenderState;
  projectName: string;
  /** Source files by id (MAIN = the launch video). */
  sources: Record<string, Blob>;
  bgVideoFile: Blob | null;
  bgVideoEl: HTMLVideoElement | null;
  fps: 29.97 | 30;
  onFpsChange: (fps: 29.97 | 30) => void;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onFrame: (c: CanvasImageSource) => void;
}

const X_MAX_BYTES = 500 * 1024 * 1024;

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
const X_MAX_SECONDS = 140;

function fileSafe(name: string) {
  return (name.trim() || 'project').replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'project';
}

function fmtBytes(b: number) {
  return b > 1024 * 1024 * 1024 ? `${(b / 1024 / 1024 / 1024).toFixed(2)} GB` : `${Math.round(b / 1024 / 1024)} MB`;
}

function fmtEta(s: number | null) {
  if (s === null || !Number.isFinite(s)) return 'estimating…';
  if (s < 60) return `${Math.ceil(s)}s left`;
  return `${Math.floor(s / 60)}m ${Math.ceil(s % 60)}s left`;
}

export function ExportDialog({ state, projectName, sources, bgVideoFile, bgVideoEl, fps, onFpsChange, onClose, onBusyChange, onFrame }: Props) {
  const [quality, setQuality] = useState<Quality>('high');
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<{ message: string; hint: string } | null>(null);
  const [result, setResult] = useState<{ url: string; name: string; size: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const videoFile = sources[MAIN] ?? null;
  const webcodecs = hasWebCodecs();
  // The real-time fallback records one video element, so it only handles the breakdown template.
  const recorder = state.tpl.id === 'breakdown' ? pickRecorderMime() : null;
  const [scale, setScale] = useState<ExportScale>(() => (readPref('bs:exportScale') === '1' ? 1 : 2));
  const [can4k, setCan4k] = useState<boolean | null>(null);
  const fourK = outputSize(state.style.canvas, 2);
  const hd = outputSize(state.style.canvas, 1);
  const effectiveScale: ExportScale = scale === 2 && can4k !== false ? 2 : 1;
  const { w, h } = effectiveScale === 2 ? fourK : hd;
  const est = estimateBytes(state.duration, w, h, quality);

  useEffect(() => {
    let alive = true;
    if (!webcodecs) {
      setCan4k(false);
      return;
    }
    canEncodeSize(fourK.w, fourK.h, 'high').then((ok) => alive && setCan4k(ok));
    return () => {
      alive = false;
    };
  }, [fourK.w, fourK.h, webcodecs]);
  const busy = progress !== null && !result && !error;

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result]);

  const download = (url: string, name: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const start = async () => {
    if (!videoFile) return;
    setError(null);
    setResult(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProgress({ done: 0, total: 1, eta: null, phase: 'preparing' });
    onBusyChange(true);
    let lastFrame = 0;
    const job = {
      state,
      sources,
      bgVideoFile,
      quality,
      scale: effectiveScale,
      signal: ctrl.signal,
      onProgress: setProgress,
      onFrame: (c: CanvasImageSource) => {
        const now = performance.now();
        if (now - lastFrame > 150) {
          lastFrame = now;
          onFrame(c);
        }
      },
    };
    try {
      // Make sure every font the frame uses is loaded before the first frame is drawn.
      const b = state.style.boxes;
      await Promise.all([
        document.fonts.load(`${b.labelWeight} 40px "${b.font}"`),
        document.fonts.load('500 40px "JetBrains Mono"'),
        ...(state.texts ?? []).map((t) => document.fonts.load(`${t.weight} 40px "${t.font}"`)),
      ]).catch(() => {});
      await document.fonts.ready;
      let blob: Blob;
      let ext = 'mp4';
      if (webcodecs) {
        blob = await exportWithWebCodecs(job);
      } else {
        const r = await exportWithRecorder(job, bgVideoEl);
        blob = r.blob;
        ext = r.ext;
      }
      const name = `${fileSafe(projectName)}_breakdown.${ext}`;
      const url = URL.createObjectURL(blob);
      setResult({ url, name, size: blob.size });
      download(url, name);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || ctrl.signal.aborted) {
        setProgress(null);
      } else if (err instanceof ExportError) {
        setError({ message: err.message, hint: err.hint });
      } else {
        console.error(err);
        const msg = (err as Error)?.message || String(err);
        setError({
          message: `Export failed: ${msg}`,
          hint: /memory|allocation/i.test(msg)
            ? 'Your laptop ran out of memory. Close other tabs and apps, choose Standard quality, and try again.'
            : 'Try again. If it keeps failing, convert the video to H.264 MP4 first, or try Standard quality.',
        });
      }
    } finally {
      abortRef.current = null;
      onBusyChange(false);
    }
  };

  const cancel = () => abortRef.current?.abort();
  const pctDone = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div className="modal">
        <h2 id="export-title">Export MP4</h2>
        {!busy && !result && (
          <>
            <div className="field">
              <div className="field-label">Resolution</div>
              <div className="segmented" role="radiogroup" aria-label="Resolution">
                <button
                  type="button"
                  role="radio"
                  aria-checked={effectiveScale === 2}
                  className={effectiveScale === 2 ? 'active' : ''}
                  disabled={can4k === false}
                  onClick={() => {
                    setScale(2);
                    writePref('bs:exportScale', '2');
                  }}
                >
                  4K ({fourK.w} x {fourK.h})
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={effectiveScale === 1}
                  className={effectiveScale === 1 ? 'active' : ''}
                  onClick={() => {
                    setScale(1);
                    writePref('bs:exportScale', '1');
                  }}
                >
                  HD ({hd.w} x {hd.h})
                </button>
              </div>
              <p className="hint">
                {can4k === false
                  ? "This computer can't encode 4K video, so HD is used."
                  : effectiveScale === 2
                    ? 'Sharpest text and edges. Your video is scaled up to fill the card. Takes longer than HD.'
                    : 'Faster export and smaller file.'}
              </p>
            </div>
            <div className="field">
              <div className="field-label">Quality</div>
              <div className="segmented" role="radiogroup" aria-label="Quality">
                {(['high', 'standard'] as Quality[]).map((q) => (
                  <button key={q} type="button" role="radio" aria-checked={quality === q} className={quality === q ? 'active' : ''} onClick={() => setQuality(q)}>
                    {q === 'high' ? 'High (recommended)' : 'Standard (smaller file)'}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <div className="field-label">Frame rate</div>
              <div className="segmented" role="radiogroup" aria-label="Frame rate">
                {([29.97, 30] as const).map((f) => (
                  <button key={f} type="button" role="radio" aria-checked={fps === f} className={fps === f ? 'active' : ''} onClick={() => onFpsChange(f)}>
                    {f} fps
                  </button>
                ))}
              </div>
            </div>
            <ul className="export-facts">
              <li>
                {w} x {h}, {formatTime(state.duration)} long, H.264 video with AAC audio
              </li>
              <li>Estimated file size: about {fmtBytes(est)}</li>
            </ul>
            {est > X_MAX_BYTES && <p className="warn">This will likely be over 500 MB, which X won't accept. Choose Standard quality{effectiveScale === 2 ? ' or HD' : ''}.</p>}
            {state.duration > X_MAX_SECONDS && <p className="warn">This video is longer than 2:20. Most X accounts can't post videos that long.</p>}
            {!webcodecs && (
              <p className="warn">
                {recorder
                  ? [
                      `Your browser doesn't support fast export, so it will record in real time (about ${formatTime(state.duration)}). Keep this tab in front.`,
                      recorder.ext === 'webm' ? 'The file will be WebM, not MP4.' : '',
                      'For the best result, use Chrome or Edge.',
                    ]
                      .filter(Boolean)
                      .join(' ')
                  : state.tpl.id === 'breakdown'
                    ? "Your browser can't export video. Please open this page in Chrome or Edge."
                    : "This template needs Chrome or Edge to export. Please open this page in one of them."}
              </p>
            )}
            {!videoFile && <p className="warn">Upload the video for this project first.</p>}
          </>
        )}

        {progress && !result && !error && (
          <div className="progress-block" aria-live="polite">
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pctDone}>
              <div style={{ width: `${pctDone}%` }} />
            </div>
            <div className="progress-meta">
              <strong>{pctDone}%</strong>
              <span>
                {progress.phase === 'preparing' ? 'Preparing…' : progress.phase === 'finishing' ? 'Finishing the file…' : `Frame ${progress.done} of ${progress.total}`}
              </span>
              <span>{progress.phase === 'rendering' ? fmtEta(progress.eta) : ''}</span>
            </div>
            <p className="hint">You can watch the frames render in the preview. Keep this tab open.</p>
          </div>
        )}

        {error && (
          <div className="error-block" role="alert">
            <strong>{error.message}</strong>
            <p>{error.hint}</p>
          </div>
        )}

        {result && (
          <div className="done-block">
            <strong>Done. Your file is downloading.</strong>
            <p>
              {result.name}, {fmtBytes(result.size)}
            </p>
            {result.size > X_MAX_BYTES && <p className="warn">This file is over 500 MB. X may reject it. Try Standard quality.</p>}
          </div>
        )}

        <div className="modal-actions">
          {busy ? (
            <button type="button" className="btn" onClick={cancel}>
              Cancel export
            </button>
          ) : (
            <>
              <button type="button" className="btn" onClick={onClose}>
                Close
              </button>
              {result ? (
                <button type="button" className="btn primary" onClick={() => download(result.url, result.name)}>
                  Download again
                </button>
              ) : (
                <button type="button" className="btn primary" onClick={start} disabled={!videoFile || (!webcodecs && !recorder)}>
                  {error ? 'Try again' : 'Start export'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
