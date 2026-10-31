import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MAIN, type CustomFont, type Project, type Segment, type SourceInfo, type Style, type TemplateId, type TemplateState, type TextLayer } from '../types';
import { useHistory, type Doc } from '../store/history';
import { Player, type SlaveDef } from '../store/player';
import { Preview, type PreviewHandle } from './Preview';
import { Timeline } from './Timeline';
import { SegmentList } from './SegmentList';
import { StylePanel, type SetStyle } from './StylePanel';
import { ExportDialog } from './ExportDialog';
import { PresetManager } from './PresetManager';
import { HighlightsPanel } from './HighlightsPanel';
import { BtsPanel, StoryboardHead } from './TemplatePanels';
import { TextPanel } from './TextPanel';
import { ShowreelPanel } from './ShowreelPanel';
import { MusicLibrary, SoundPanel } from './SoundPanel';
import { defaultTextLayer } from '../render/text';
import { FileButton } from './controls';
import { VIDEO_ACCEPT } from './StartScreen';
import { computePeaks, computeThumbnails, type Thumbnails } from '../media/analyze';
import { activeIndex, deleteSegment, makeEvenSegments, MIN_SEGMENT, moveBoundary, newId, rescaleSegments, setSegmentEnd, setSegmentStart, splitSegment } from '../lib/segments';
import { cloneStyle, DEFAULT_LABELS, ORANGE, type Preset } from '../lib/presets';
import { clipCount, clipTime, defaultTemplateState, initTemplate, isHighlights, outputDuration, rescaleClips, showreelClip, showreelWindows, TEMPLATES, templateStyle, usesFreeClock, usesSegments } from '../lib/templates';
import { fpsValue } from '../lib/time';
import { assetKey, getBlob, musicLibrary, putBlob, saveMusicLibrary, saveProject, storeProjectVideo, type MusicTrack } from '../store/storage';
import { buildProjectFile, downloadJson, readProjectFile } from '../store/projectFile';
import type { Frames, RenderState } from '../render/renderFrame';
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
  /** Showreel: more clips dropped on the start screen together with the first one. */
  initialClips?: File[];
}

export function isVideoFile(f: File) {
  return f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(f.name);
}

function isAudioFile(f: File) {
  return f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|opus)$/i.test(f.name);
}

/** Duration of any audio or video file, falling back to demuxing when the browser won't tell. */
async function mediaDuration(file: Blob): Promise<number> {
  const viaElement = await new Promise<number>((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (d: number) => {
      // Detach the element before releasing the URL, or it may still try to read from it.
      v.onloadedmetadata = v.onerror = null;
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
      resolve(d);
    };
    v.preload = 'metadata';
    v.onloadedmetadata = () => done(v.duration);
    v.onerror = () => done(NaN);
    v.src = url;
  });
  if (Number.isFinite(viaElement) && viaElement > 0) return viaElement;
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
    let el: HTMLVideoElement | null = null;
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
          el = v;
          v.muted = true;
          v.playsInline = true;
          v.preload = 'auto';
          v.onloadeddata = () => !cancelled && setAsset({ id, el: v, name: stored.name, blob: stored.blob });
          v.src = url;
        }
      })
      .catch(() => setAsset(null));
    return () => {
      cancelled = true;
      if (el) {
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, kind]);
  return asset && asset.id === id ? asset : null;
}

interface LoadedSource {
  blob: Blob;
  url: string;
}

/** Uploaded clips (and audio) by asset id, loaded from IndexedDB. */
function useSources(ids: string[]) {
  const [map, setMap] = useState<Record<string, LoadedSource>>({});
  const key = [...ids].sort().join('|');
  useEffect(() => {
    let cancelled = false;
    const wanted = key ? key.split('|') : [];
    setMap((cur) => {
      const next: Record<string, LoadedSource> = {};
      for (const [id, v] of Object.entries(cur)) {
        if (wanted.includes(id)) next[id] = v;
        else URL.revokeObjectURL(v.url);
      }
      return next;
    });
    for (const id of wanted) {
      getBlob(assetKey(id))
        .then((stored) => {
          if (!stored || cancelled) return;
          setMap((cur) => (cur[id] ? cur : { ...cur, [id]: { blob: stored.blob, url: URL.createObjectURL(stored.blob) } }));
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [key]);
  return map;
}

/** Filmstrip thumbnails for uploaded clips, made one clip at a time in the background. */
function useSourceThumbs(sources: Record<string, LoadedSource>, info: TemplateState['sources']) {
  const [thumbs, setThumbs] = useState<Record<string, Thumbnails>>({});
  const done = useRef(new Set<string>());
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      for (const [id, src] of Object.entries(sources)) {
        if (ctrl.signal.aborted) return;
        if (done.current.has(id) || !info[id] || src.blob.type.startsWith('audio/')) continue;
        done.current.add(id);
        // Short clips get 2 per second so their lane still shows enough frames to pick from.
        const t = await computeThumbnails(src.blob, info[id].duration, undefined, ctrl.signal, 40, 2).catch(() => null);
        if (t && !ctrl.signal.aborted) setThumbs((m) => ({ ...m, [id]: t }));
        else if (ctrl.signal.aborted) done.current.delete(id);
      }
    })();
    return () => ctrl.abort();
  }, [sources, info]);
  return thumbs;
}

/** Storyboard frame images by asset id. */
function useImages(ids: string[]) {
  const [state, setState] = useState<{ els: Record<string, HTMLImageElement>; urls: Record<string, string> }>({ els: {}, urls: {} });
  const key = [...new Set(ids)].sort().join('|');
  useEffect(() => {
    let cancelled = false;
    const wanted = key ? key.split('|') : [];
    for (const id of wanted) {
      getBlob(assetKey(id))
        .then((stored) => {
          if (!stored || cancelled) return;
          const url = URL.createObjectURL(stored.blob);
          const img = new Image();
          img.onload = () => !cancelled && setState((s) => (s.els[id] ? s : { els: { ...s.els, [id]: img }, urls: { ...s.urls, [id]: url } }));
          img.src = url;
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [key]);
  return state;
}

/** Add storyboard frames: into empty time if there is none, otherwise split the last frame's time. */
function appendFrames(segments: Segment[], frames: { label: string; assetId: string }[], duration: number): Segment[] {
  if (segments.length === 0) return makeEvenSegments(frames.map((f) => f.label), duration).map((s, i) => ({ ...s, assetId: frames[i].assetId }));
  const last = segments[segments.length - 1];
  const parts = frames.length + 1;
  const len = (last.end - last.start) / parts;
  if (len < MIN_SEGMENT) {
    const all = [...segments.map((s) => ({ label: s.label, assetId: s.assetId ?? '' })), ...frames];
    return makeEvenSegments(all.map((f) => f.label), duration).map((s, i) => ({ ...s, ...(all[i].assetId ? { assetId: all[i].assetId } : {}) }));
  }
  const out = [...segments.slice(0, -1), { ...last, end: last.start + len }];
  frames.forEach((f, k) => out.push({ id: newId(), label: f.label, assetId: f.assetId, start: last.start + len * (k + 1), end: k === frames.length - 1 ? last.end : last.start + len * (k + 2) }));
  return out;
}

export function Editor({ project, initialVideo, initialVideoName, videoFromStorage, presets, onUserPresetsChange, onNewProject, onStorageNote, storageNote, initialClips }: Props) {
  const player = useMemo(() => new Player(), []);
  useEffect(() => () => player.destroy(), [player]);

  const { doc, apply, undo, redo, reset, canUndo, canRedo } = useHistory({
    name: project.name,
    segments: project.segments,
    style: project.style,
    presetId: project.presetId,
    tpl: project.tpl,
    texts: project.texts,
    fonts: project.fonts,
  });
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  /** Length of the main (launch) video. */
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
  const tpl = doc.tpl;
  const outDur = outputDuration(tpl, duration);

  useEffect(() => {
    player.fps = fpsValue(doc.style.fps);
  }, [player, doc.style.fps]);

  const mainUrl = useMemo(() => (video ? URL.createObjectURL(video.blob) : null), [video]);
  useEffect(() => () => void (mainUrl && URL.revokeObjectURL(mainUrl)), [mainUrl]);

  // ---------- main video loading ----------
  useEffect(() => {
    if (!video || !mainUrl) return;
    const ctrl = new AbortController();
    setVideoReady(false);
    setVideoError(null);
    setPeaks(null);
    setThumbs(null);
    player
      .load(mainUrl)
      .then(() => (Number.isFinite(player.video.duration) && player.video.duration > 0 ? player.video.duration : mediaDuration(video.blob)))
      .then((d) => {
        if (ctrl.signal.aborted) return;
        const old = durationRef.current;
        const cur = docRef.current;
        const changed = old > 0 && Math.abs(old - d) > 0.001;
        let next = cur;
        if (cur.tpl.id === 'breakdown' && cur.segments.length === 0) {
          const labels = presets.find((p) => p.id === cur.presetId)?.labels ?? DEFAULT_LABELS;
          next = { ...next, segments: makeEvenSegments(labels, d) };
        } else if (changed) next = { ...next, segments: rescaleSegments(cur.segments, old, d) };
        if ((clipCount(cur.tpl) > 0 || cur.tpl.id === 'showreel') && cur.tpl.clips.length === 0) next = { ...next, tpl: initTemplate(cur.tpl, d) };
        else if (changed) next = { ...next, tpl: { ...next.tpl, clips: rescaleClips(cur.tpl.clips, old, d) } };
        if (next !== cur) {
          if (old === 0) reset(next);
          else apply(() => next);
        }
        if (changed) setNotice(`New video is ${d.toFixed(1)}s long. Sections and highlights were stretched to fit.`);
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
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, mainUrl, player]);

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
      saveProject({ id: project.id, name: doc.name, duration, segments: doc.segments, style: doc.style, presetId: doc.presetId, tpl: doc.tpl, texts: doc.texts, fonts: doc.fonts, updatedAt: Date.now() });
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
  const bgVideoEl = (bgVideo?.el as HTMLVideoElement | undefined) ?? null;
  const sources = useSources(Object.keys(tpl.sources));
  const sourceThumbs = useSourceThumbs(sources, tpl.sources);
  const frameIds = useMemo(() => doc.segments.map((s) => s.assetId).filter((x): x is string => !!x), [doc.segments]);
  const images = useImages(frameIds);

  const assets = useMemo(
    () => ({ peaks, logoImage: doc.style.logo.mode === 'image' ? (logo?.el ?? null) : null, bgImage: bgImage?.el ?? null, images: images.els }),
    [peaks, logo, bgImage, doc.style.logo.mode, images.els],
  );
  const renderState: RenderState = useMemo(
    () => ({ style: doc.style, segments: doc.segments, duration: outDur, assets, tpl, texts: doc.texts }),
    [doc.style, doc.segments, outDur, assets, tpl, doc.texts],
  );

  // ---------- playback wiring: which videos follow the clock ----------
  useEffect(() => {
    const urlOf = (sid: string | null) => (!sid ? null : sid === MAIN ? mainUrl : (sources[sid]?.url ?? null));
    const slaves: SlaveDef[] = [];
    if (tpl.id === 'showreel') {
      // One clip at a time; the others wait paused on their first frame so every cut is instant.
      const windows = showreelWindows(tpl.clips);
      tpl.clips.forEach((c, i) => {
        const url = urlOf(c.sourceId);
        const w = windows[i];
        const last = i === tpl.clips.length - 1;
        if (url) slaves.push({ key: `clip:${c.id}`, url, rest: c.start, target: (t) => (t >= w.start && (t < w.end || (last && t <= w.end)) ? c.start + (t - w.start) : null) });
      });
    } else {
      for (const c of tpl.clips) {
        const url = urlOf(c.sourceId);
        if (url) slaves.push({ key: `clip:${c.id}`, url, target: (t) => clipTime(c, t) });
      }
    }
    if (tpl.id === 'bts' && tpl.secondary.sourceId) {
      const url = urlOf(tpl.secondary.sourceId);
      const off = tpl.secondary.offset;
      if (url) slaves.push({ key: 'secondary', url, target: (t) => Math.max(0, t + off) });
    }
    if (bgVideoEl) slaves.push({ key: 'bg', el: bgVideoEl, target: (t) => (bgVideoEl.duration > 0 ? t % bgVideoEl.duration : 0) });
    const free = usesFreeClock(tpl.id);
    const a = tpl.audio;
    let mainTarget: ((t: number) => number | null) | undefined;
    const mainAudible = a.sourceId === MAIN;
    if (free && a.sourceId === MAIN) mainTarget = (t) => (t + a.offset < duration ? t + a.offset : null);
    if (a.sourceId && a.sourceId !== MAIN) {
      // Music (or uploaded audio): plays from its start point, stops when the track ends, fades at the end.
      const url = urlOf(a.sourceId);
      const len = tpl.sources[a.sourceId]?.duration ?? Infinity;
      const fade = Math.min(1.5, outDur / 3);
      if (url)
        slaves.push({
          key: 'audio',
          url,
          audible: true,
          target: (t) => (t + a.offset < len - 0.05 ? t + a.offset : null),
          volume: a.fade ? (t) => (outDur - t) / fade : undefined,
        });
    }
    player.configure({ mode: free ? 'free' : 'main', duration: outDur, slaves, mainTarget, mainAudible });
  }, [player, tpl, outDur, duration, mainUrl, sources, bgVideoEl]);

  const getFrames = useCallback(
    (): Frames => ({
      main: player.mainFrame(),
      clips: tpl.clips.map((c) => player.frame(`clip:${c.id}`)),
      secondary: player.frame('secondary'),
      bg: player.frame('bg'),
    }),
    [player, tpl.clips],
  );

  // ---------- uploads ----------
  const storeSource = async (f: File): Promise<{ id: string; info: SourceInfo } | null> => {
    const id = newId('asset');
    try {
      const d = await mediaDuration(f);
      if (!Number.isFinite(d) || d <= 0) throw new Error('no duration');
      await putBlob(assetKey(id), f, f.name);
      return { id, info: { name: f.name, duration: d } };
    } catch {
      setNotice(`Couldn't read ${f.name}. Use an MP4, MOV or WebM file that plays in your browser.`);
      return null;
    }
  };

  const setTpl = useCallback((fn: (t: TemplateState) => TemplateState, key?: string) => apply((d) => ({ ...d, tpl: fn(d.tpl) }), key), [apply]);

  const uploadClip = async (i: number, f: File) => {
    if (!isVideoFile(f)) return setNotice('That file is not a video. Use an MP4, MOV or WebM file.');
    const s = await storeSource(f);
    if (!s) return;
    setTpl((t) => {
      const clips = t.clips.map((c, j) => (j === i ? { ...c, sourceId: s.id, start: 0, end: t.id === 'launch2' ? Math.min(s.info.duration, t.loopLength) : s.info.duration } : c));
      // A full compilation: make the post as long as the longest clip.
      const allOwn = isHighlights(t.id) && clips.every((c) => c.sourceId !== MAIN);
      const longest = Math.max(...clips.map((c) => c.end - c.start));
      return { ...t, sources: { ...t.sources, [s.id]: s.info }, clips, duration: allOwn ? longest : t.duration };
    });
  };

  // ---------- music library ----------
  const [library, setLibrary] = useState<MusicTrack[]>(() => musicLibrary());
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const pickTrack = (t: MusicTrack) =>
    setTpl((x) => ({ ...x, sources: { ...x.sources, [t.id]: { name: t.name, duration: t.duration } }, audio: { sourceId: t.id, offset: 0, fade: true } }));
  const uploadMusic = async (files: File[]) => {
    setLibraryBusy(true);
    const added: MusicTrack[] = [];
    for (const f of files) {
      if (!isAudioFile(f) && !isVideoFile(f)) {
        setNotice(`${f.name} isn't an audio file.`);
        continue;
      }
      const s = await storeSource(f);
      if (s) added.push({ id: s.id, name: f.name.replace(/\.[^.]+$/, ''), duration: s.info.duration, addedAt: Date.now() });
    }
    const next = [...added.reverse(), ...musicLibrary()];
    saveMusicLibrary(next);
    setLibrary(next);
    setLibraryBusy(false);
    // First track in a post with no music yet: use it right away.
    if (added.length && (!tpl.audio.sourceId || tpl.audio.sourceId === MAIN) && tpl.id === 'showreel') pickTrack(added[added.length - 1]);
  };
  const removeTrack = (id: string) => {
    // The file stays stored, so posts already using the track keep working.
    const next = musicLibrary().filter((t) => t.id !== id);
    saveMusicLibrary(next);
    setLibrary(next);
  };

  // ---------- showreel ----------
  const [addingClips, setAddingClips] = useState(false);
  const addClips = async (files: File[]) => {
    const vids = files.filter(isVideoFile);
    if (vids.length < files.length) setNotice('Some files were skipped because they are not videos.');
    if (!vids.length) return;
    setAddingClips(true);
    const stored: { id: string; info: SourceInfo }[] = [];
    for (const f of vids) {
      const s = await storeSource(f);
      if (s) stored.push(s);
    }
    setAddingClips(false);
    if (!stored.length) return;
    setTpl((t) => ({
      ...t,
      sources: { ...t.sources, ...Object.fromEntries(stored.map((s) => [s.id, s.info])) },
      clips: [...t.clips, ...stored.map((s) => showreelClip(s.id, s.info.duration, t.loopLength))],
    }));
  };
  const replaceClip = async (i: number, f: File) => {
    if (!isVideoFile(f)) return setNotice('That file is not a video. Use an MP4, MOV or WebM file.');
    const s = await storeSource(f);
    if (!s) return;
    setTpl((t) => ({
      ...t,
      sources: { ...t.sources, [s.id]: s.info },
      clips: t.clips.map((c, j) => (j === i ? { ...showreelClip(s.id, s.info.duration, t.loopLength), id: c.id } : c)),
    }));
  };
  // Clips dropped on the start screen with the first one are added once the first one has loaded.
  const pendingClips = useRef(initialClips ?? []);
  useEffect(() => {
    if (!videoReady || tpl.id !== 'showreel' || pendingClips.current.length === 0 || tpl.clips.length === 0) return;
    const files = pendingClips.current;
    pendingClips.current = [];
    addClips(files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoReady, tpl.id, tpl.clips.length]);

  const uploadBts = async (f: File) => {
    if (!isVideoFile(f)) return setNotice('That file is not a video. Use an MP4, MOV or WebM file.');
    const s = await storeSource(f);
    if (!s) return;
    setTpl((t) => ({ ...t, sources: { ...t.sources, [s.id]: s.info }, secondary: { sourceId: s.id, offset: 0 } }));
  };

  const storeImage = async (f: File) => {
    if (!f.type.startsWith('image/')) return null;
    const id = newId('asset');
    await putBlob(assetKey(id), f, f.name);
    return id;
  };

  const addFrames = async (files: File[]) => {
    if (duration <= 0) return setNotice('Add the launch video first, then the storyboard frames.');
    const frames: { label: string; assetId: string }[] = [];
    for (const f of files) {
      const id = await storeImage(f).catch(() => null);
      if (id) frames.push({ label: f.name.replace(/\.[^.]+$/, ''), assetId: id });
    }
    if (frames.length === 0) return setNotice('Choose PNG, JPG or WebP images.');
    apply((d) => ({ ...d, segments: appendFrames(d.segments, frames, duration) }));
  };

  const replaceFrame = async (i: number, f: File) => {
    const id = await storeImage(f).catch(() => null);
    if (!id) return setNotice('Choose a PNG, JPG or WebP image.');
    apply((d) => ({ ...d, segments: d.segments.map((s, j) => (j === i ? { ...s, assetId: id } : s)) }));
  };

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
    if (segs.length === 0) return;
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

  const keepBrand = (style: Style, from: Style): Style => ({
    ...style,
    fps: from.fps,
    logo: { ...style.logo, mode: from.logo.mode, assetId: from.logo.assetId, text: from.logo.text, color: from.logo.color },
  });

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

  const switchTemplate = (id: TemplateId) => {
    player.pause();
    apply((d) => {
      const tplNext = duration > 0 ? initTemplate({ ...defaultTemplateState(id), sources: d.tpl.sources }, duration) : { ...defaultTemplateState(id), sources: d.tpl.sources };
      const style = keepBrand(id === 'breakdown' ? cloneStyle(ORANGE.style) : templateStyle(id), d.style);
      let segments = d.segments;
      if (id === 'breakdown') segments = d.segments.length && !d.segments.some((s) => s.assetId) ? d.segments : duration > 0 ? makeEvenSegments(DEFAULT_LABELS, duration) : [];
      if (id === 'storyboard') segments = d.segments.length && d.segments.every((s) => s.assetId) ? d.segments : [];
      return { ...d, tpl: tplNext, style, segments, presetId: id === 'breakdown' ? ORANGE.id : d.presetId };
    });
    player.seek(0);
  };

  // ---------- project file ----------
  const exportJson = async () => {
    const { file, skipped } = await buildProjectFile({
      id: project.id,
      name: doc.name,
      duration,
      segments: doc.segments,
      style: doc.style,
      presetId: doc.presetId,
      tpl: doc.tpl,
      texts: doc.texts,
      fonts: doc.fonts,
      updatedAt: Date.now(),
    });
    downloadJson(file, `${(doc.name || 'project').replace(/[^\w\- ]+/g, '').trim() || 'project'}.breakdown.json`);
    if (skipped.length) setNotice(`Saved. These videos are not included, send them separately: ${skipped.join(', ')}.`);
  };
  const importJson = async (f: File) => {
    try {
      const p = await readProjectFile(f);
      const scale = duration > 0 && p.duration > 0;
      const segs = scale ? rescaleSegments(p.segments, p.duration, duration) : duration > 0 && p.segments.length === 0 && p.tpl.id === 'breakdown' ? makeEvenSegments(DEFAULT_LABELS, duration) : p.segments;
      const tplIn = scale ? { ...p.tpl, clips: rescaleClips(p.tpl.clips, p.duration, duration) } : p.tpl;
      apply((d) => ({ ...d, name: p.name, style: p.style, presetId: p.presetId, segments: segs, tpl: tplIn, texts: p.texts, fonts: p.fonts }));
      if (scale && Math.abs(p.duration - duration) > 0.05) {
        setNotice(`This project was made for a ${p.duration.toFixed(1)}s video. Everything was stretched to fit this ${duration.toFixed(1)}s video.`);
      } else setNotice('Project file loaded.');
    } catch (err) {
      setNotice((err as Error).message);
    }
  };

  // ---------- text ----------
  const setTexts = useCallback((fn: (t: TextLayer[]) => TextLayer[], key?: string) => apply((d) => ({ ...d, texts: fn(d.texts) }), key), [apply]);
  const addText = () => {
    const n = docRef.current.texts.length;
    const layer = defaultTextLayer({ y: Math.min(0.85, 0.5 + n * 0.08) });
    setTexts((t) => [...t, layer]);
    setSelectedTextId(layer.id);
    requestAnimationFrame(() => document.querySelector('.text-chip.active')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };
  const changeText = (id: string, patch: Partial<TextLayer>, key?: string) => setTexts((t) => t.map((l) => (l.id === id ? { ...l, ...patch } : l)), key);
  const duplicateText = (id: string) => {
    const src = docRef.current.texts.find((l) => l.id === id);
    if (!src) return;
    const copy: TextLayer = { ...src, box: { ...src.box }, id: defaultTextLayer().id, y: Math.min(0.95, src.y + 0.08) };
    setTexts((t) => [...t, copy]);
    setSelectedTextId(copy.id);
  };
  const deleteText = (id: string) => {
    setTexts((t) => t.filter((l) => l.id !== id));
    setSelectedTextId(null);
  };
  const uploadFont = async (f: File) => {
    if (!/\.(ttf|otf|woff2?)$/i.test(f.name) && !f.type.startsWith('font/')) return setNotice('Choose a font file: TTF, OTF, WOFF or WOFF2.');
    const id = newId('asset');
    const family = `bsf_${id}`;
    try {
      const face = new FontFace(family, await f.arrayBuffer());
      await face.load();
      document.fonts.add(face);
      await putBlob(assetKey(id), f, f.name);
    } catch {
      return setNotice(`Couldn't read ${f.name} as a font.`);
    }
    const font: CustomFont = { assetId: id, family, name: f.name.replace(/\.[^.]+$/, '') };
    apply((d) => ({
      ...d,
      fonts: [...d.fonts, font],
      texts: selectedTextId ? d.texts.map((l) => (l.id === selectedTextId ? { ...l, font: family } : l)) : d.texts,
    }));
  };
  // Uploaded fonts live in browser storage; register them with the page when the project opens.
  useEffect(() => {
    let cancelled = false;
    for (const f of doc.fonts) {
      if ([...document.fonts].some((ff) => ff.family === f.family || ff.family === `"${f.family}"`)) continue;
      getBlob(assetKey(f.assetId))
        .then(async (stored) => {
          if (!stored || cancelled) return;
          const face = new FontFace(f.family, await stored.blob.arrayBuffer());
          await face.load();
          document.fonts.add(face);
        })
        .catch(() => setNotice(`The font ${f.name} isn't in this browser. Upload it again.`));
    }
    return () => {
      cancelled = true;
    };
  }, [doc.fonts]);

  // ---------- keyboard ----------
  const segmentsOn = usesSegments(tpl.id);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (exportOpen || presetsOpen || libraryOpen) return;
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
      if (e.key === 'Escape') setSelectedTextId(null);
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
          if (!segmentsOn) return;
          e.preventDefault();
          split();
          break;
        case '[':
          if (!segmentsOn) return;
          e.preventDefault();
          if (i >= 0) setSegments(setSegmentStart(segs, i, player.time).segments);
          break;
        case ']':
          if (!segmentsOn) return;
          e.preventDefault();
          if (i >= 0) setSegments(setSegmentEnd(segs, i, player.time).segments);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exportOpen, presetsOpen, libraryOpen, selected, player, split, setSegments, undo, redo, segmentsOn]);

  // Keep the selected section following the playhead while playing.
  useEffect(
    () =>
      player.subscribe(() => {
        if (!player.playing || !usesSegments(docRef.current.tpl.id)) return;
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
  const exportSources = useMemo(() => {
    const m: Record<string, Blob> = {};
    if (video) m[MAIN] = video.blob;
    for (const [id, v] of Object.entries(sources)) m[id] = v.blob;
    return m;
  }, [video, sources]);
  const missingSources = [
    ...tpl.clips.map((c) => c.sourceId),
    ...(tpl.id === 'bts' && tpl.secondary.sourceId ? [tpl.secondary.sourceId] : []),
    ...(tpl.audio.sourceId ? [tpl.audio.sourceId] : []),
  ].filter((id, i, a) => id !== MAIN && a.indexOf(id) === i && !sources[id]);

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
          <label className="visually-hidden" htmlFor="template-select">
            Template
          </label>
          <select id="template-select" value={tpl.id} disabled={locked} onChange={(e) => switchTemplate(e.target.value as TemplateId)} title="Template">
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {tpl.id === 'breakdown' && (
            <>
              <label className="visually-hidden" htmlFor="preset-select">
                Look
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
            </>
          )}
        </div>
        <div className="topbar-group">
          <button type="button" className="btn icon-btn" onClick={undo} disabled={!canUndo || locked} aria-label="Undo" title="Undo (Ctrl+Z)">
            ↶
          </button>
          <button type="button" className="btn icon-btn" onClick={redo} disabled={!canRedo || locked} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            ↷
          </button>
        </div>
        <div className="topbar-group">
          <button type="button" className="btn" onClick={addText} disabled={locked} title="Add a text layer">
            + Text
          </button>
        </div>
        <div className="topbar-group grow-left">
          <FileButton label="Replace video" accept={VIDEO_ACCEPT} onFile={onVideoFile} className="btn ghost" />
          <button type="button" className="btn ghost" onClick={exportJson} disabled={locked} title="Download the project settings as a file you can share">
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

      {(notice || storageNote || videoError || missingSources.length > 0) && (
        <div className="notices" aria-live="polite">
          {videoError && <p className="banner error">{videoError}</p>}
          {storageNote && <p className="banner">{storageNote}</p>}
          {missingSources.length > 0 && (
            <p className="banner">
              Some clips for this project aren't in this browser ({missingSources.map((id) => tpl.sources[id]?.name ?? id).join(', ')}). Upload them again on their highlight.
            </p>
          )}
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
            getFrames={getFrames}
            projectName={doc.name}
            selectedTextId={selectedTextId}
            onSelectText={setSelectedTextId}
            onMoveText={(id, x, y, key) => changeText(id, { x, y }, key)}
          />
          {(isHighlights(tpl.id) || tpl.id === 'launch2') && (
            <HighlightsPanel tpl={tpl} mainDuration={duration} thumbnails={thumbs} sourceThumbs={sourceThumbs} onChange={setTpl} onUploadClip={uploadClip} locked={locked || duration <= 0} />
          )}
          {tpl.id === 'showreel' && (
            <ShowreelPanel
              tpl={tpl}
              mainDuration={duration}
              mainName={video?.name ?? 'Clip 1'}
              thumbnails={thumbs}
              sourceThumbs={sourceThumbs}
              onChange={setTpl}
              onAddClips={addClips}
              onReplaceClip={replaceClip}
              adding={addingClips}
              locked={locked || duration <= 0}
            />
          )}
          {tpl.id === 'bts' && <BtsPanel tpl={tpl} onChange={setTpl} onUploadBts={uploadBts} locked={locked} />}
          {tpl.id === 'storyboard' && <StoryboardHead tpl={tpl} onChange={setTpl} onAddFrames={addFrames} locked={locked || duration <= 0} count={doc.segments.length} />}
          {segmentsOn && (doc.segments.length > 0 || tpl.id === 'breakdown') && (
            <>
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
                title={tpl.id === 'storyboard' ? 'Frames' : 'Sections'}
                addLabel={tpl.id === 'storyboard' ? '+ Split frame' : '+ Add section'}
                frames={tpl.id === 'storyboard' ? { urls: images.urls, onPick: replaceFrame } : undefined}
              />
            </>
          )}
          <p className="shortcuts hint">
            Shortcuts: Space play/pause · ←/→ one frame · Shift+←/→ one second
            {segmentsOn ? ' · S split · [ set start · ] set end' : ''} · Ctrl+Z undo · Ctrl+Shift+Z redo
          </p>
        </div>
        <aside className="side" inert={locked ? true : undefined}>
          <TextPanel
            texts={doc.texts}
            fonts={doc.fonts}
            selectedId={selectedTextId}
            onSelect={setSelectedTextId}
            onAdd={addText}
            onChange={changeText}
            onDuplicate={duplicateText}
            onDelete={deleteText}
            onUploadFont={uploadFont}
            player={player}
            duration={outDur}
          />
          <SoundPanel
            tpl={tpl}
            library={library}
            mainDuration={duration}
            onChange={(patch, key) => setTpl((t) => ({ ...t, audio: { ...t.audio, ...patch } }), key)}
            onPickTrack={pickTrack}
            onOpenLibrary={() => setLibraryOpen(true)}
          />
          <StylePanel
            style={doc.style}
            template={tpl.id}
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
          sources={exportSources}
          bgVideoFile={doc.style.background.type === 'video' ? (bgVideo?.blob ?? null) : null}
          bgVideoEl={bgVideoEl}
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
      {libraryOpen && (
        <MusicLibrary
          library={library}
          currentId={tpl.audio.sourceId}
          onUpload={uploadMusic}
          onUse={(t) => {
            pickTrack(t);
            setLibraryOpen(false);
          }}
          onRemove={removeTrack}
          onClose={() => setLibraryOpen(false)}
          busy={libraryBusy}
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
