import type { Project } from '../types';
import { assetKey, blobToDataUrl, dataUrlToBlob, getBlob, putBlob, sanitizeProject } from './storage';
import { newId } from '../lib/segments';

/** Portable project file: segments + style + small assets (logo, background image). Never the video. */
export interface ProjectFile {
  app: 'breakdown-studio';
  version: 1;
  project: Omit<Project, 'id' | 'updatedAt'>;
  assets: Record<string, { name: string; dataUrl: string }>;
}

const MAX_EMBED = 8 * 1024 * 1024;

export async function buildProjectFile(project: Project): Promise<{ file: ProjectFile; skipped: string[] }> {
  const assets: ProjectFile['assets'] = {};
  const skipped: string[] = [];
  const ids = [
    project.style.logo.assetId,
    project.style.background.assetId,
    ...project.segments.map((s) => s.assetId),
    ...Object.keys(project.tpl.sources),
    ...project.fonts.map((f) => f.assetId),
  ].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
  for (const id of ids) {
    const stored = await getBlob(assetKey(id)).catch(() => null);
    if (!stored) continue;
    if (stored.blob.size > MAX_EMBED || stored.type.startsWith('video/') || stored.type.startsWith('audio/')) {
      skipped.push(stored.name);
      continue;
    }
    assets[id] = { name: stored.name, dataUrl: await blobToDataUrl(stored.blob) };
  }
  const { id: _id, updatedAt: _u, ...rest } = project;
  void _id;
  void _u;
  return { file: { app: 'breakdown-studio', version: 1, project: rest, assets }, skipped };
}

export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Parse a project file and store its assets. Returns a project with a fresh id. */
export async function readProjectFile(file: File): Promise<Project> {
  let data: ProjectFile;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't a valid project file.");
  }
  if (!data || data.app !== 'breakdown-studio' || !data.project) throw new Error("That file isn't a Breakdown Studio project.");
  for (const [id, a] of Object.entries(data.assets ?? {})) {
    try {
      await putBlob(assetKey(id), await dataUrlToBlob(a.dataUrl), a.name);
    } catch (err) {
      console.warn('Could not restore asset', id, err);
    }
  }
  return sanitizeProject({ ...data.project, id: newId('proj'), updatedAt: Date.now() });
}
