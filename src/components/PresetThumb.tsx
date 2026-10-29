import { useEffect, useRef } from 'react';
import type { Style } from '../types';
import { renderFrame, StaticLayerCache } from '../render/renderFrame';
import { makeEvenSegments } from '../lib/segments';

/** A small still of a preset, drawn with the real renderer. */
export function PresetThumb({ style, labels }: { style: Style; labels: string[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scale = 0.2;
  useEffect(() => {
    const draw = () => {
      const c = ref.current;
      const ctx = c?.getContext('2d');
      if (!ctx) return;
      const segments = makeEvenSegments(labels, 20);
      const peaks = new Float32Array(200).map((_, i) => 0.3 + 0.7 * Math.abs(Math.sin(i / 9)) * Math.abs(Math.cos(i / 23)));
      renderFrame(ctx, { style, segments, duration: 20, assets: { peaks, logoImage: null, bgImage: null } }, 7, null, new StaticLayerCache(), scale);
    };
    draw();
    document.fonts.ready.then(draw);
  }, [style, labels]);
  return <canvas ref={ref} width={Math.round(style.canvas.w * scale)} height={Math.round(style.canvas.h * scale)} className="preset-thumb" aria-hidden />;
}
