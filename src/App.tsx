import { useEffect, useMemo, useState } from 'react';
import type { Project, TemplateId, TemplateState } from './types';
import { defaultTemplateState, TEMPLATES, templateStyle } from './lib/templates';
import { BUILT_IN_PRESETS, cloneStyle, ORANGE, type Preset } from './lib/presets';
import { newId } from './lib/segments';
import {
  clearCurrent,
  currentProjectId,
  getBlob,
  loadProject,
  loadUserPresets,
  musicLibrary,
  recentProjects,
  removeRecent,
  saveUserPresets,
  videoKey,
  type RecentEntry,
} from './store/storage';
import { readProjectFile } from './store/projectFile';
import { StartScreen } from './components/StartScreen';
import { Editor, isVideoFile } from './components/Editor';
import { hasWebCodecs } from './media/export';

interface Session {
  project: Project;
  video: Blob | null;
  videoName: string | null;
  fromStorage: boolean;
  key: string;
  extraClips?: File[];
}

/** A new showreel starts with the newest track from the music library, if there is one. */
function withLatestMusic(tpl: TemplateState): TemplateState {
  const track = musicLibrary()[0];
  if (tpl.id !== 'showreel' || !track) return tpl;
  return { ...tpl, sources: { ...tpl.sources, [track.id]: { name: track.name, duration: track.duration } }, audio: { sourceId: track.id, offset: 0, fade: true } };
}

function browserNote(): string | null {
  if (!hasWebCodecs()) {
    return 'This browser is missing fast video export. Everything works, but export will run in real time. For the best result, use Chrome or Edge.';
  }
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua) || (/Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua))) {
    return 'Breakdown Studio is built for Chrome and Edge. Other browsers may not export audio correctly.';
  }
  return null;
}

export default function App() {
  const [userPresets, setUserPresets] = useState<Preset[]>(() => loadUserPresets());
  const presets = useMemo(() => [...BUILT_IN_PRESETS, ...userPresets], [userPresets]);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [template, setTemplate] = useState<TemplateId>(() => {
    const saved = localStorage.getItem('bs:template');
    return TEMPLATES.some((t) => t.id === saved) ? (saved as TemplateId) : 'breakdown';
  });
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [recent, setRecent] = useState<RecentEntry[]>(() => recentProjects());
  const [error, setError] = useState<string | null>(null);
  const [storageNote, setStorageNote] = useState<string | null>(null);
  const note = useMemo(browserNote, []);

  const openProject = async (id: string) => {
    const project = loadProject(id);
    if (!project) {
      setError("That project couldn't be found in this browser.");
      removeRecent(id);
      setRecent(recentProjects());
      return;
    }
    let stored = null;
    try {
      stored = await getBlob(videoKey(id));
    } catch {
      stored = null;
    }
    setStorageNote(stored || project.duration === 0 ? null : 'The video for this project is not saved in this browser. Drop it on the preview to keep going. All your sections and styles are restored.');
    setSession({ project, video: stored?.blob ?? null, videoName: stored?.name ?? null, fromStorage: !!stored, key: newId('s') });
  };

  // Restore the last project on load.
  useEffect(() => {
    const id = currentProjectId();
    if (id) openProject(id).finally(() => setRestoring(false));
    else setRestoring(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startWithVideo = (files: File[]) => {
    const videos = files.filter(isVideoFile);
    const f = videos[0];
    if (!f) {
      setError('That file is not a video. Use an MP4, MOV or WebM file.');
      return;
    }
    const preset = template === 'breakdown' ? presets.find((p) => p.id === presetId) : undefined;
    const project: Project = {
      id: newId('proj'),
      name: f.name.replace(/\.[^.]+$/, '') || 'Untitled',
      duration: 0,
      segments: [],
      style: template === 'breakdown' ? cloneStyle((preset ?? ORANGE).style) : templateStyle(template),
      presetId: preset?.id ?? null,
      tpl: withLatestMusic(defaultTemplateState(template)),
      texts: [],
      fonts: [],
      updatedAt: Date.now(),
    };
    setError(null);
    setStorageNote(null);
    setSession({ project, video: f, videoName: f.name, fromStorage: false, key: newId('s'), extraClips: template === 'showreel' ? videos.slice(1) : undefined });
  };

  const importJson = async (f: File) => {
    try {
      const project = await readProjectFile(f);
      setStorageNote('Project loaded. Drop the matching video on the preview to continue.');
      setSession({ project, video: null, videoName: null, fromStorage: false, key: newId('s') });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (restoring) return <div className="loading">Loading…</div>;

  if (!session) {
    return (
      <StartScreen
        presets={presets}
        presetId={presetId}
        onPresetChange={setPresetId}
        template={template}
        onTemplateChange={(id) => {
          setTemplate(id);
          try {
            localStorage.setItem('bs:template', id);
          } catch {
            /* ignore */
          }
        }}
        onVideo={startWithVideo}
        recent={recent}
        onOpenRecent={openProject}
        onRemoveRecent={(id) => {
          removeRecent(id);
          setRecent(recentProjects());
        }}
        onImportJson={importJson}
        error={error}
        browserNote={note}
      />
    );
  }

  return (
    <Editor
      key={session.key}
      project={session.project}
      initialVideo={session.video}
      initialVideoName={session.videoName}
      videoFromStorage={session.fromStorage}
      presets={presets}
      onUserPresetsChange={(p) => {
        setUserPresets(p);
        saveUserPresets(p);
      }}
      onNewProject={() => {
        clearCurrent();
        setSession(null);
        setRecent(recentProjects());
        setError(null);
      }}
      storageNote={storageNote}
      onStorageNote={setStorageNote}
      initialClips={session.extraClips}
    />
  );
}
