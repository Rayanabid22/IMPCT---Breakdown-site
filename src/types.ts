export interface Segment {
  id: string;
  label: string;
  start: number;
  end: number;
  /** Optional label size override, in reference px (1440x1080 stage). */
  fontSize?: number;
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
    fillOpacity: number;
    borderOpacity: number;
    radius: number;
    gap: number;
    height: number;
    font: string;
    labelSize: number;
    labelColor: string;
    labelOpacity: number;
    activeHighlight: boolean;
  };
  playhead: { color: string; size: number; lineWidth: number };
  /** Gap between the bottom of the video card and the top of the segment row, reference px. */
  rowOffset: number;
}

export interface Project {
  id: string;
  name: string;
  /** Duration of the uploaded video, seconds. 0 until a video is loaded. */
  duration: number;
  segments: Segment[];
  style: Style;
  presetId: string | null;
  updatedAt: number;
}

/** Things the renderer needs beyond the project itself. */
export interface RenderAssets {
  /** Normalized RMS peaks (0..1) across the full duration. */
  peaks: Float32Array | null;
  logoImage: CanvasImageSource | null;
  bgImage: CanvasImageSource | null;
}

export interface FrameSource {
  image: CanvasImageSource;
  width: number;
  height: number;
}
