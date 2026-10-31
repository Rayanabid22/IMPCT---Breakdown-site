export interface Segment {
  id: string;
  label: string;
  start: number;
  end: number;
  /** Optional label size override, in reference px (1440x1080 stage). */
  fontSize?: number;
  /** Storyboard template: the frame image shown for this section. */
  assetId?: string;
}

export type BackgroundType = 'solid' | 'gradient' | 'image' | 'video';

export interface Style {
  canvas: { w: number; h: number };
  fps: 29.97 | 30;
  background: {
    type: BackgroundType;
    color: string;
    gradient: {
      from: string;
      to: string;
      kind: 'linear' | 'radial';
      angle: number; // degrees, linear only
      cx: number; // 0..1, radial only
      cy: number; // 0..1, radial only
    };
    /** Asset id of an uploaded image or video (stored in IndexedDB). */
    assetId: string | null;
    fit: 'cover' | 'contain';
    overlay: number; // 0..1 darkening
  };
  glow: {
    on: boolean;
    color: string;
    intensity: number; // 0..1
    radius: number; // reference px
    offsetY: number; // reference px, relative to row center (positive = lower)
    stretch: number; // horizontal stretch factor
  };
  grid: { on: boolean; size: number; spacing: number; opacity: number };
  waveform: {
    on: boolean;
    color: string;
    opacity: number;
    barWidth: number;
    spacing: number;
    height: number;
    highlight: boolean;
  };
  logo: {
    /** Corner logo. The 6-8 highlights template always shows the logo in its center cell. */
    show: boolean;
    mode: 'text' | 'image';
    text: string;
    assetId: string | null;
    size: number; // cap height in reference px
    x: number;
    y: number; // vertical center
    color: string;
  };
  card: {
    radius: number;
    border: boolean;
    borderColor: string;
    borderOpacity: number;
    borderWidth: number;
    shadow: boolean;
  };
  boxes: {
    fillColor: string;
    fillOpacity: number;
    borderColor: string;
    borderOpacity: number;
    borderWidth: number;
    radius: number;
    gap: number;
    height: number;
    font: string;
    labelSize: number;
    labelWeight: 400 | 500 | 600;
    labelColor: string;
    labelOpacity: number;
    activeHighlight: boolean;
  };
  playhead: { color: string; size: number; lineWidth: number };
  /** Multi-card templates: space between cards and around the edge, in px at 1080 reference. */
  layout: { gap: number; margin: number; line: number; lineColor: string };
  /** Titles above cards (Storyboard:, Result:, BTS:). */
  heading: { size: number; color: string; weight: 400 | 500 | 600; gap: number };
  /** Gap between the bottom of the video card and the top of the segment row, reference px. */
  rowOffset: number;
}

/** Free text placed on the post. Positions are fractions of the canvas, sizes px at 1080 reference. */
export interface TextLayer {
  id: string;
  text: string;
  font: string;
  weight: 400 | 500 | 600 | 700 | 800;
  size: number;
  color: string;
  opacity: number;
  align: 'left' | 'center' | 'right';
  /** Anchor x (left edge, center or right edge, per align), 0..1. */
  x: number;
  /** Vertical center of the text block, 0..1. */
  y: number;
  letterSpacing: number;
  lineHeight: number;
  box: { on: boolean; color: string; opacity: number; padding: number; radius: number };
  shadow: boolean;
  /** Visible from `start` until `end` (seconds); end null = until the end of the post. */
  start: number;
  end: number | null;
}

/** A font file the user uploaded, registered under `family`. */
export interface CustomFont {
  assetId: string;
  family: string;
  name: string;
}

export interface Project {
  id: string;
  name: string;
  /** Duration of the uploaded video, seconds. 0 until a video is loaded. */
  duration: number;
  segments: Segment[];
  style: Style;
  presetId: string | null;
  tpl: TemplateState;
  texts: TextLayer[];
  fonts: CustomFont[];
  updatedAt: number;
}

export type TemplateId = 'breakdown' | 'grid4' | 'ring' | 'launch2' | 'grid16' | 'storyboard' | 'bts' | 'showreel';

/** The project video is source 'main'; uploaded clips are assets with their own ids. */
export const MAIN = 'main';

/** A piece of a source video, looped for as long as the output runs. */
export interface Clip {
  id: string;
  sourceId: string;
  start: number;
  end: number;
}

export interface SourceInfo {
  name: string;
  duration: number;
}

export interface TemplateState {
  id: TemplateId;
  /** Output length for the highlight grids. Other templates last as long as the main video. */
  duration: number;
  /** Highlight tiles (grids, ring) or the two loops under the launch video. */
  clips: Clip[];
  /** 6 to 8 for the ring template. */
  ringCount: number;
  /** Launch + 2 highlights: loop length of each highlight. Showreel: default cut length. */
  loopLength: number;
  /**
   * Soundtrack: MAIN (the video's own sound), a music track or uploaded audio (asset id), or null.
   * `offset` is where in the track to start; `fade` fades music out over the last seconds.
   */
  audio: { sourceId: string | null; offset: number; fade: boolean };
  /** BTS template: the behind-the-scenes recording, and its offset from the result video. */
  secondary: { sourceId: string | null; offset: number };
  headings: { top: string; bottom: string };
  /** BTS template: put the result on top instead. */
  swap: boolean;
  /** Durations and names of uploaded clips, keyed by asset id. */
  sources: Record<string, SourceInfo>;
}

/** Things the renderer needs beyond the project itself. */
export interface RenderAssets {
  /** Normalized RMS peaks (0..1) across the full duration. */
  peaks: Float32Array | null;
  logoImage: CanvasImageSource | null;
  bgImage: CanvasImageSource | null;
  /** Storyboard frame images by asset id. */
  images?: Record<string, CanvasImageSource>;
}

export interface FrameSource {
  image: CanvasImageSource;
  width: number;
  height: number;
}
