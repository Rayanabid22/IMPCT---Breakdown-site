import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, Segment, Style } from '../types';
import { useHistory, type Doc } from '../store/history';
import { Player } from '../store/player';
import { Preview, type PreviewHandle } from './Preview';
import { Timeline } from './Timeline';
import { SegmentList } from './SegmentList';
import { StylePanel, type SetStyle } from './StylePanel';
import { ExportDialog } from './ExportDialog';
import { PresetManager } from './PresetManager';
import { FileButton } from './controls';
import { VIDEO_ACCEPT } from './StartScreen';
import { computePeaks, computeThumbnails, type Thumbnails } from '../media/analyze';
import { activeIndex, deleteSegment, makeEvenSegments, moveBoundary, newId, rescaleSegments, setSegmentEnd, setSegmentStart, splitSegment } from '../lib/segments';
import { cloneStyle, DEFAULT_LABELS, type Preset } from '../lib/presets';
import { fpsValue } from '../lib/time';
import { assetKey, getBlob, putBlob, saveProject, storeProjectVideo } from '../store/storage';
import { buildProjectFile, downloadJson, readProjectFile } from '../store/projectFile';
import type { RenderState } from '../render/renderFrame';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';

interface Props {
  project: Project;
  initialVideo: Blob | null;
  initialVideoName: string | null;
  /** True when the video comes from IndexedDB already, so it isn't stored again. */
  videoFromStorage: boolean;
  presets: Preset[];
  onUserPresetsChange: (p: Preset[]) => void;
  onNewProject: () => void;
  onStorageNote: (msg: string | null) => void;
  storageNote: string | null;
}

export function isVideoFile(f: File) {
  return f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(f.name);
}

async function readDuration(player: Player, file: Blob): Promise<number> {
  const d = player.video.duration;
  if (Number.isFinite(d) && d > 0) return d;
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    return await input.computeDuration();
  } finally {
    input.dispose();
  }
}

function useAsset(id: string | null, kind: 'image' | 'video') {
  const [asset, setAsset] = useState<{ id: string; el: HTMLImageElement | HTMLVideoElement; name: string; blob: Blob } | null>(null);
  useEffect(() => {
    if (!id) {
      setAsset(null);
      return;
    }
    let url = '';
    let cancelled = false;
    getBlob(assetKey(id))
      .then((stored) => {
        if (!stored || cancelled) return;
        url = URL.createObjectURL(stored.blob);
        if (kind === 'image') {
          const img = new Image();
          img.onload = () => !cancelled && setAsset({ id, el: img, name: stored.name, blob: stored.blob });
          img.src = url;
        } else {
          const v = document.createElement('video');
          v.muted = true;
          v.loop = true;
          v.playsInline = true;
          v.preload = 'auto';
          v.onloadeddata = () => !cancelled && setAsset({ id, el: v, name: stored.name, blob: stored.blob });
          v.src = url;
        }
      })
      .catch(() => setAsset(null));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, kind]);
  return asset && asset.id === id ? asset : null;
}

export function Editor({ project, initialVideo, initialVideoName, videoFromStorage, presets, onUserPresetsChange, onNewProject, onStorageNote, storageNote }: Props) {
  const player = useMemo(() => new Player(), []);
  useEffect(() => () => player.destroy(), [player]);

  const { doc, apply, undo, redo, reset, canUndo, canRedo } = useHistory({
    name: project.name,
    segments: project.segments,
    style: project.style,
    presetId: project.presetId,
  });
  const [duration, setDuration] = useState(project.duration);
  const durationRef = useRef(project.duration);
  const [video, setVideo] = useState<{ blob: Blob; name: string; stored: boolean } | null>(initialVideo ? { blob: initialVideo, name: initialVideoName ?? 'video', stored: videoFromStorage } : null);
  const [videoReady, setVideoReady] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [thumbs, setThumbs] = useState<Thumbnails | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [selected, setSelected] = useState(0);
  const [half, setHalf] = useState(() => localStorage.getItem('bs:half') === '1');
  const [snapping, setSnapping] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const previewRef = useRef<PreviewHandle>(null);
  const docRef = useRef<Doc>(doc);
  docRef.current = doc;

  useEffect(() => {
    player.fps = fpsValue(doc.style.fps);
  }, [player, doc.style.fps]);

  // ---------- video loading ----------
  useEffect(() => {
    if (!video) return;
    const url = URL.createObjectURL(video.blob);
    const ctrl = new AbortController();
    setVideoReady(false);
    setVideoError(null);
    setPeaks(null);
    setThumbs(null);
    player
      .load(url)
      .then(() => readDuration(player, video.blob))
      .then((d) => {
        if (ctrl.signal.aborted) return;
        player.duration = d;
        const old = durationRef.current;
        const current = docRef.current;
        if (current.segments.length === 0) {
          const labels = presets.find((p) => p.id === current.presetId)?.labels ?? DEFAULT_LABELS;
          reset({ ...current, segments: makeEvenSegments(labels, d) });
        } else if (Math.abs(old - d) > 0.001) {
          apply((x) => ({ ...x, segments: rescaleSegments(x.segments, old, d) }));
          if (old > 0) setNotice(`New video is ${d.toFixed(1)}s long. Sections were stretched to fit, keeping their relative sizes.`);
        }
        durationRef.current = d;
        setDuration(d);
        setVideoReady(true);
        player.seek(0);
        setAnalyzing(true);
        Promise.all([
          computePeaks(video.blob, d, ctrl.signal).then((p) => !ctrl.signal.aborted && setPeaks(p)),
          computeThumbnails(video.blob, d, (t) => !ctrl.signal.aborted && setThumbs(t), ctrl.signal).then((t) => !ctrl.signal.aborted && t && setThumbs(t)),
        ]).finally(() => !ctrl.signal.aborted && setAnalyzing(false));
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setVideoError((err as Error).message);
      });
    if (!video.stored) {
      storeProjectVideo(project.id, video.blob, video.name)
        .then(() => onStorageNote(null))
        .catch(() => onStorageNote("This browser couldn't save the video for next time. Your edits are still saved; after a refresh you'll be asked to drop the video again."));
    }
    return () => {
      ctrl.abort();
      URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, player]);

  const onVideoFile = useCallback(
    (f: File) => {
      if (!isVideoFile(f)) {
        setNotice('That file is not a video. Use an MP4, MOV or WebM file.');
        return;
      }
      player.pause();
      setVideo({ blob: f, name: f.name, stored: false });
    },
    [player],
  );

  // ---------- autosave ----------
  useEffect(() => {
    const t = setTimeout(() => {
      saveProject({ id: project.id, name: doc.name, duration, segments: doc.segments, style: doc.style, presetId: doc.presetId, updatedAt: Date.now() });
    }, 300);
    return () => clearTimeout(t);
  }, [doc, duration, project.id]);

  useEffect(() => {
    try {
      localStorage.setItem('bs:half', half ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [half]);

  // ---------- assets ----------
  const logo = useAsset(doc.style.logo.assetId, 'image');
  const bgImage = useAsset(doc.style.background.type === 'image' ? doc.style.background.assetId : null, 'image');
  const bgVideo = useAsset(doc.style.background.type === 'video' ? doc.style.background.assetId : null, 'video');
  useEffect(() => {
    const el = (bgVideo?.el as HTMLVideoElement) ?? null;
    player.bgVideo = el;
    if (el) {
      if (player.playing) el.play().catch(() => {});
      else if (el.duration > 0) el.currentTime = player.time % el.duration;
    }
    return () => {
      el?.pause();
      if (player.bgVideo === el) player.bgVideo = null;
    };
  }, [bgVideo, player]);

  const assets = useMemo(
    () => ({ peaks, logoImage: doc.style.logo.mode === 'image' ? (logo?.el ?? null) : null, bgImage: bgImage?.el ?? null }),
    [peaks, logo, bgImage, doc.style.logo.mode],
  );
  const renderState: RenderState = useMemo(() => ({ style: doc.style, segments: doc.segments, duration, assets }), [doc.style, doc.segments, duration, assets]);

  const uploadAsset = async (f: File, kind: 'logo' | 'bg') => {
    const isImage = f.type.startsWith('image/');
    const isVideo = isVideoFile(f);
    if (kind === 'logo' && !isImage) return setNotice('The logo must be a PNG, SVG or WebP image.');
    if (kind === 'bg' && doc.style.background.type === 'image' && !isImage) return setNotice('Choose a PNG, JPG or WebP image.');
    if (kind === 'bg' && doc.style.background.type === 'video' && !isVideo) return setNotice('Choose an MP4, MOV or WebM video.');
    const id = newId('asset');
    try {
      await putBlob(assetKey(id), f, f.name);
    } catch {
      return setNotice("Couldn't store that file in this browser. Try a smaller file.");
    }
    if (kind === 'logo') setStyle('logo', { assetId: id, mode: 'image' });
    else setStyle('background', { assetId: id });
  };

  // ---------- edits ----------
  const setStyle: SetStyle = useCallback(
    (section, patch) => {
      apply((d) => {
        const cur = d.style[section];
        const next = typeof cur === 'object' && cur !== null ? { ...cur, ...(patch as object) } : patch;
        return { ...d, style: { ...d.style, [section]: next } as Style };
      }, `style-${String(section)}-${typeof patch === 'object' && patch ? Object.keys(patch).join(',') : ''}`);
    },
    [apply],
  );

  const setSegments = useCallback((segments: Segment[], key?: string) => apply((d) => ({ ...d, segments }), key), [apply]);

  const split = useCallback(() => {
    const segs = docRef.current.segments;
    const i = Math.min(selected, segs.length - 1);
    const next = splitSegment(segs, i, player.time);
    if (next === segs) return setNotice('That section is too short to split. Sections must be at least 0.5s.');
    setSegments(next);
    setSelected(i + 1);
  }, [selected, player, setSegments]);

  const remove = useCallback(
    (i: number) => {
      setSegments(deleteSegment(docRef.current.segments, i));
      setSelected((s) => Math.max(0, Math.min(s, docRef.current.segments.length - 2)));
    },
    [setSegments],
  );

  const applyPreset = (p: Preset) => {
    apply((d) => {
      const style = cloneStyle(p.style);
      style.canvas = d.style.canvas;
      style.fps = d.style.fps;
      if (!style.logo.assetId && d.style.logo.assetId) style.logo = { ...style.logo, assetId: d.style.logo.assetId, mode: d.style.logo.mode };
      const oldLabels = presets.find((x) => x.id === d.presetId)?.labels ?? DEFAULT_LABELS;
      const current = d.segments.map((s) => s.label);
      const untouched = current.length === oldLabels.length && current.every((l, i) => l === oldLabels[i]) && duration > 0;
      const segments = untouched || d.segments.length === 0 ? (duration > 0 ? makeEvenSegments(p.labels, duration) : []) : d.segments;
      return { ...d, style, presetId: p.id, segments };
    });
  };

  // ---------- project file ----------
  const exportJson = async () => {
    const { file, skipped } = await buildProjectFile({ id: project.id, name: doc.name, duration, segments: doc.segments, style: doc.style, presetId: doc.presetId, updatedAt: Date.now() });
    downloadJson(file, `${(doc.name || 'project').replace(/[^\w\- ]+/g, '').trim() || 'project'}.breakdown.json`);
    if (skipped.length) setNotice(`Saved. The background video (${skipped.join(', ')}) is not included; send it separately.`);
  };
  const importJson = async (f: File) => {
    try {
      const p = await readProjectFile(f);
      const segs = duration > 0 && p.duration > 0 ? rescaleSegments(p.segments, p.duration, duration) : duration > 0 && p.segments.length === 0 ? makeEvenSegments(DEFAULT_LABELS, duration) : p.segments;
      apply((d) => ({ ...d, name: p.name, style: p.style, presetId: p.presetId, segments: segs }));
      if (duration > 0 && p.duration > 0 && Math.abs(p.duration - duration) > 0.05) {
        setNotice(`This project was made for a ${p.duration.toFixed(1)}s video. Sections were stretched to fit this ${duration.toFixed(1)}s video.`);
      } else setNotice('Project file loaded.');
    } catch (err) {
      setNotice((err as Error).message);
    }
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (exportOpen || presetsOpen) return;
      const target = e.target as HTMLElement;
      const typing = target.closest('input, textarea, select, [contenteditable="true"]') && !(target as HTMLInputElement).type?.match(/range|checkbox|radio|button/);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        if (typing) return;
        e.preventDefault();
        redo();
        return;
      }
      if (typing || mod || e.altKey) return;
      if (target.getAttribute('role') === 'slider' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
      const segs = docRef.current.segments;
      const i = Math.min(selected, segs.length - 1);
      switch (e.key) {
        case ' ':
          if (target.tagName === 'BUTTON') return;
          e.preventDefault();
          player.toggle();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) player.seek(player.time - 1);
          else player.step(-1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) player.seek(player.time + 1);
          else player.step(1);
          break;
        case 's':
        case 'S':
          e.preventDefault();
          split();
          break;
        case '[':
          e.preventDefault();
          if (i >= 0) setSegments(setSegmentStart(segs, i, player.time).segments);
          break;
        case ']':
          e.preventDefault();
          if (i >= 0) setSegments(setSegmentEnd(segs, i, player.time).segments);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exportOpen, presetsOpen, selected, player, split, setSegments, undo, redo]);

  // Keep the selected section following the playhead while playing.
  useEffect(
    () =>
      player.subscribe(() => {
        if (!player.playing) return;
        const i = activeIndex(docRef.current.segments, player.time);
        setSelected((s) => (s === i ? s : i));
      }),
    [player],
  );

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const locked = exporting;
  const presetValue = presets.some((p) => p.id === doc.presetId) ? doc.presetId! : '';

  return (
    <div className={`editor ${locked ? 'is-locked' : ''}`}>
      <header className="topbar">
        <div className="brand small">
          <span className="brand-mark" aria-hidden />
        </div>
        <input
          className="project-name"
          aria-label="Project name"
          value={doc.name}
          disabled={locked}
          onChange={(e) => apply((d) => ({ ...d, name: e.target.value }), 'name')}
        />
        <div className="topbar-group">
          <label className="visually-hidden" htmlFor="preset-select">
            Preset
          </label>
          <select
            id="preset-select"
            value={presetValue}
            disabled={locked}
            onChange={(e) => {
              const p = presets.find((x) => x.id === e.target.value);
              if (p) applyPreset(p);
            }}
          >
            {!presetValue && <option value="">Custom look</option>}
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn ghost" onClick={() => setPresetsOpen(true)} disabled={locked}>
            Presets…
          </button>
        </div>
        <div className="topbar-group">
          <button type="button" className="btn icon-btn" onClick={undo} disabled={!canUndo || locked} aria-label="Undo" title="Undo (Ctrl+Z)">
            ↶
          </button>
          <button type="button" className="btn icon-btn" onClick={redo} disabled={!canRedo || locked} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            ↷
          </button>
        </div>
        <div className="topbar-group grow-left">
          <FileButton label="Replace video" accept={VIDEO_ACCEPT} onFile={onVideoFile} className="btn ghost" />
          <button type="button" className="btn ghost" onClick={exportJson} disabled={locked} title="Download segments and style as a file you can share">
            Save project file
          </button>
          <FileButton label="Open project file" accept="application/json,.json" onFile={importJson} className="btn ghost" />
          <button type="button" className="btn ghost" onClick={onNewProject} disabled={locked}>
            New
          </button>
          <button type="button" className="btn primary" onClick={() => setExportOpen(true)} disabled={!videoReady || locked}>
            Export MP4
          </button>
        </div>
      </header>

      {(notice || storageNote || videoError) && (
        <div className="notices" aria-live="polite">
          {videoError && <p className="banner error">{videoError}</p>}
          {storageNote && <p className="banner">{storageNote}</p>}
          {notice && <p className="banner">{notice}</p>}
        </div>
      )}

      <main className="workspace">
        <div className="center">
          <Preview
            ref={previewRef}
            player={player}
            state={renderState}
            half={half}
            onHalfChange={setHalf}
            locked={locked}
            hasVideo={videoReady}
            onVideoFile={onVideoFile}
          />
          <Timeline
            player={player}
            segments={doc.segments}
            duration={duration}
            selected={selected}
            onSelect={setSelected}
            onMoveBoundary={(i, t, key) => setSegments(moveBoundary(docRef.current.segments, i, t), key)}
            snapping={snapping}
            onSnappingChange={setSnapping}
            thumbnails={thumbs}
            analyzing={analyzing}
            locked={locked || duration <= 0}
          />
          <SegmentList
            player={player}
            segments={doc.segments}
            selected={selected}
            onSelect={setSelected}
            onChange={setSegments}
            onSplit={split}
            onDelete={remove}
            locked={locked || duration <= 0}
          />
          <p className="shortcuts hint">
            Shortcuts: Space play/pause · ←/→ one frame · Shift+←/→ one second · S split · [ set start · ] set end · Ctrl+Z undo · Ctrl+Shift+Z redo
          </p>
        </div>
        <aside className="side" inert={locked ? true : undefined}>
          <StylePanel
            style={doc.style}
            setStyle={setStyle}
            onBackgroundFile={(f) => uploadAsset(f, 'bg')}
            onLogoFile={(f) => uploadAsset(f, 'logo')}
            bgAssetName={(doc.style.background.type === 'video' ? bgVideo?.name : bgImage?.name) ?? null}
            logoAssetName={logo?.name ?? null}
          />
        </aside>
      </main>

      {exportOpen && (
        <ExportDialog
          state={renderState}
          projectName={doc.name}
          videoFile={video?.blob ?? null}
          bgVideoFile={doc.style.background.type === 'video' ? (bgVideo?.blob ?? null) : null}
          bgVideoEl={(bgVideo?.el as HTMLVideoElement) ?? null}
          fps={doc.style.fps}
          onFpsChange={(fps) => setStyle('fps', fps)}
          onClose={() => setExportOpen(false)}
          onBusyChange={(b) => {
            setExporting(b);
            if (b) player.pause();
          }}
          onFrame={(c) => previewRef.current?.showExternalFrame(c)}
        />
      )}
      {presetsOpen && (
        <PresetManager
          presets={presets}
          currentStyle={doc.style}
          currentLabels={doc.segments.map((s) => s.label)}
          onChange={onUserPresetsChange}
          onClose={() => setPresetsOpen(false)}
        />
      )}
    </div>
  );
}
