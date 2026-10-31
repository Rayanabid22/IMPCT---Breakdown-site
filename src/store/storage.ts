import { MAIN, type Project, type Style, type TemplateState } from '../types';
import { clipCount, defaultTemplateState, evenClips, TEMPLATES } from '../lib/templates';
import { mergeStyle, type Preset } from '../lib/presets';
import { defaultTextLayer } from '../render/text';
import { normalizeSegments } from '../lib/segments';

const CURRENT_KEY = 'bs:current';
const RECENT_KEY = 'bs:recent';
const PROJECT_PREFIX = 'bs:project:';
const PRESETS_KEY = 'bs:presets';
const MAX_RECENT = 8;
/** Only the newest few projects keep their video in IndexedDB, to save disk space. */
const MAX_STORED_VIDEOS = 3;

export interface RecentEntry {
  id: string;
  name: string;
  updatedAt: number;
  duration: number;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('localStorage write failed', err);
  }
}

export function sanitizeProject(raw: Partial<Project> & { id: string }): Project {
  const duration = typeof raw.duration === 'number' && raw.duration > 0 ? raw.duration : 0;
  const segments = Array.isArray(raw.segments)
    ? raw.segments
        .filter((s) => s && typeof s.start === 'number' && typeof s.end === 'number')
        .map((s) => ({
          id: String(s.id),
          label: String(s.label ?? ''),
          start: s.start,
          end: s.end,
          ...(s.fontSize ? { fontSize: Number(s.fontSize) } : {}),
          ...(s.assetId ? { assetId: String(s.assetId) } : {}),
        }))
    : [];
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : 'Untitled',
    duration,
    segments: normalizeSegments(segments, duration),
    style: mergeStyle(raw.style as Partial<Style>),
    presetId: raw.presetId ?? null,
    tpl: sanitizeTemplate(raw.tpl),
    texts: Array.isArray(raw.texts) ? raw.texts.filter((t) => t && typeof t.text === 'string').map((t) => defaultTextLayer({ ...t, box: { ...defaultTextLayer().box, ...(t.box ?? {}) } })) : [],
    fonts: Array.isArray(raw.fonts) ? raw.fonts.filter((f) => f && f.assetId && f.family) : [],
    updatedAt: raw.updatedAt ?? Date.now(),
  };
}

/** Projects saved before templates existed are breakdown projects. */
function sanitizeTemplate(raw: Partial<TemplateState> | undefined): TemplateState {
  // 12 Highlights became 16 Highlights (a full 4x4 grid).
  if ((raw?.id as string) === 'grid12') raw = { ...raw, id: 'grid16' };
  const d = defaultTemplateState(TEMPLATES.some((t) => t.id === raw?.id) ? raw!.id : 'breakdown');
  if (!raw) return d;
  const clips = Array.isArray(raw.clips)
    ? raw.clips
        .filter((c) => c && typeof c.start === 'number' && typeof c.end === 'number')
        .map((c) => ({ id: String(c.id), sourceId: String(c.sourceId ?? MAIN), start: c.start, end: c.end }))
    : [];
  // Add tiles if the template now has more than were saved.
  const need = clipCount({ id: d.id, ringCount: raw.ringCount ?? d.ringCount });
  if (clips.length > 0 && clips.length < need) {
    const total = clips.reduce((m, c) => Math.max(m, c.end), 0);
    clips.push(...evenClips(need, total).slice(clips.length));
  }
  return {
    ...d,
    ...raw,
    clips,
    audio: { ...d.audio, ...(raw.audio ?? {}) },
    secondary: { ...d.secondary, ...(raw.secondary ?? {}) },
    headings: { ...d.headings, ...(raw.headings ?? {}) },
    sources: raw.sources && typeof raw.sources === 'object' ? raw.sources : {},
  };
}

export function saveProject(project: Project) {
  writeJson(PROJECT_PREFIX + project.id, project);
  writeJson(CURRENT_KEY, project.id);
  const recent = readJson<RecentEntry[]>(RECENT_KEY, []).filter((r) => r.id !== project.id);
  recent.unshift({ id: project.id, name: project.name, updatedAt: project.updatedAt, duration: project.duration });
  const dropped = recent.slice(MAX_RECENT);
  writeJson(RECENT_KEY, recent.slice(0, MAX_RECENT));
  for (const d of dropped) {
    localStorage.removeItem(PROJECT_PREFIX + d.id);
    deleteBlob(videoKey(d.id)).catch(() => {});
  }
}

export function loadProject(id: string): Project | null {
  const raw = readJson<Project | null>(PROJECT_PREFIX + id, null);
  return raw ? sanitizeProject(raw) : null;
}

export function currentProjectId(): string | null {
  return readJson<string | null>(CURRENT_KEY, null);
}

export function clearCurrent() {
  localStorage.removeItem(CURRENT_KEY);
}

export function recentProjects(): RecentEntry[] {
  return readJson<RecentEntry[]>(RECENT_KEY, []);
}

export function removeRecent(id: string) {
  writeJson(RECENT_KEY, recentProjects().filter((r) => r.id !== id));
  localStorage.removeItem(PROJECT_PREFIX + id);
  deleteBlob(videoKey(id)).catch(() => {});
}

// ---------- user presets ----------

export function loadUserPresets(): Preset[] {
  return readJson<Preset[]>(PRESETS_KEY, []).map((p) => ({ ...p, style: mergeStyle(p.style), builtIn: false }));
}

export function saveUserPresets(presets: Preset[]) {
  writeJson(PRESETS_KEY, presets);
}

// ---------- IndexedDB blobs (videos, images) ----------

const DB_NAME = 'breakdown-studio';
const STORE = 'blobs';
let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export interface StoredBlob {
  blob: Blob;
  name: string;
  type: string;
  savedAt: number;
}

export const videoKey = (projectId: string) => `video:${projectId}`;
export const assetKey = (assetId: string) => `asset:${assetId}`;

export async function putBlob(key: string, blob: Blob, name: string): Promise<void> {
  await tx('readwrite', (s) => s.put({ blob, name, type: blob.type, savedAt: Date.now() } satisfies StoredBlob, key));
}

export async function getBlob(key: string): Promise<StoredBlob | null> {
  const v = await tx<StoredBlob | undefined>('readonly', (s) => s.get(key));
  return v ?? null;
}

export async function deleteBlob(key: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(key));
}

/** Store the project video and evict older project videos. */
export async function storeProjectVideo(projectId: string, file: Blob, name: string): Promise<void> {
  await putBlob(videoKey(projectId), file, name);
  const keep = new Set(recentProjects().slice(0, MAX_STORED_VIDEOS).map((r) => videoKey(r.id)));
  keep.add(videoKey(projectId));
  const keys = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
  for (const k of keys) {
    if (typeof k === 'string' && k.startsWith('video:') && !keep.has(k)) await deleteBlob(k).catch(() => {});
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}

// ---------- music library (shared by every project in this browser) ----------

const MUSIC_KEY = 'bs:music';

export interface MusicTrack {
  /** Asset id; the file itself is stored like any other asset. */
  id: string;
  name: string;
  duration: number;
  addedAt: number;
}

export function musicLibrary(): MusicTrack[] {
  return readJson<MusicTrack[]>(MUSIC_KEY, []);
}

export function saveMusicLibrary(tracks: MusicTrack[]) {
  writeJson(MUSIC_KEY, tracks);
}
