import { useEffect, useRef } from 'react';
import type { Style, TemplateId } from '../types';
import { renderFrame, StaticLayerCache, type Frames } from '../render/renderFrame';
import { makeEvenSegments } from '../lib/segments';
import { defaultTemplateState, initTemplate } from '../lib/templates';

/** Colored stand-in frames, so template thumbnails show where each video goes. */
let swatches: HTMLCanvasElement[] | null = null;
function swatch(i: number) {
  if (!swatches) {
    swatches = Array.from({ length: 14 }, (_, k) => {
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = 90;
      const x = c.getContext('2d')!;
      const g = x.createLinearGradient(0, 0, 160, 90);
      g.addColorStop(0, `hsl(${(k * 41 + 200) % 360} 55% 42%)`);
      g.addColorStop(1, `hsl(${(k * 41 + 250) % 360} 60% 22%)`);
      x.fillStyle = g;
      x.fillRect(0, 0, 160, 90);
      return c;
    });
  }
  const c = swatches[i % swatches.length];
  return { image: c, width: c.width, height: c.height };
}

/** A small still of a template or look, drawn with the real renderer. */
export function PresetThumb({ style, labels, template = 'breakdown' }: { style: Style; labels: string[]; template?: TemplateId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scale = 0.2;
  useEffect(() => {
    const draw = () => {
      const c = ref.current;
      const ctx = c?.getContext('2d');
      if (!ctx) return;
      const tpl = initTemplate({ ...defaultTemplateState(template), secondary: { sourceId: 'x', offset: 0 } }, 20);
      const segments = makeEvenSegments(labels, 20);
      const peaks = new Float32Array(200).map((_, i) => 0.3 + 0.7 * Math.abs(Math.sin(i / 9)) * Math.abs(Math.cos(i / 23)));
      const images: Record<string, CanvasImageSource> = {};
      if (template === 'storyboard') segments.forEach((s, i) => ((s.assetId = `sb${i}`), (images[s.assetId] = swatch(i + 6).image)));
      const frames: Frames = template === 'breakdown' ? {} : { main: swatch(0), clips: tpl.clips.map((_, i) => swatch(i + 1)), secondary: swatch(9) };
      renderFrame(ctx, { style, segments, duration: 20, tpl, assets: { peaks, logoImage: null, bgImage: null, images } }, 7, frames, new StaticLayerCache(), scale);
    };
    draw();
    document.fonts.ready.then(draw);
  }, [style, labels, template]);
  return <canvas ref={ref} width={Math.round(style.canvas.w * scale)} height={Math.round(style.canvas.h * scale)} className="preset-thumb" aria-hidden />;
}
