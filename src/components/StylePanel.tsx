import type { Style, TemplateId } from '../types';
import { CANVAS_SIZES } from '../lib/layout';
import { FONTS } from '../lib/presets';
import { ColorField, FileButton, Section, Segmented, SelectField, Slider, Toggle, pct } from './controls';

export type SetStyle = <K extends keyof Style>(section: K, patch: Style[K] extends object ? Partial<Style[K]> : Style[K]) => void;

interface Props {
  style: Style;
  template: TemplateId;
  setStyle: SetStyle;
  onBackgroundFile: (f: File) => void;
  onLogoFile: (f: File) => void;
  bgAssetName: string | null;
  logoAssetName: string | null;
}

export function StylePanel({ style, template, setStyle, onBackgroundFile, onLogoFile, bgAssetName, logoAssetName }: Props) {
  const breakdown = template === 'breakdown';
  const titles = template === 'storyboard' || template === 'bts';
  const bg = style.background;
  const sizeValue = `${style.canvas.w}x${style.canvas.h}`;
  return (
    <div className="style-panel">
      <div className="panel-head">
        <span className="panel-title">Style</span>
      </div>

      <Section title="Canvas">
        <SelectField
          label="Size"
          value={sizeValue}
          options={CANVAS_SIZES.map((c) => ({ value: `${c.w}x${c.h}`, label: c.label }))}
          onChange={(v) => {
            const [w, h] = v.split('x').map(Number);
            setStyle('canvas', { w, h });
          }}
        />
        <SelectField
          label="Frame rate"
          value={style.fps}
          options={[
            { value: 29.97, label: '29.97 fps' },
            { value: 30, label: '30 fps' },
          ]}
          onChange={(v) => setStyle('fps', v)}
        />
      </Section>

      <Section title="Background">
        <Segmented
          value={bg.type}
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'gradient', label: 'Gradient' },
            { value: 'image', label: 'Image' },
            { value: 'video', label: 'Video' },
          ]}
          onChange={(type) => setStyle('background', { type })}
        />
        {bg.type === 'solid' && <ColorField label="Color" value={bg.color} onChange={(color) => setStyle('background', { color })} />}
        {bg.type === 'gradient' && (
          <>
            <ColorField label="From" value={bg.gradient.from} onChange={(from) => setStyle('background', { gradient: { ...bg.gradient, from } })} />
            <ColorField label="To" value={bg.gradient.to} onChange={(to) => setStyle('background', { gradient: { ...bg.gradient, to } })} />
            <Segmented
              label="Type"
              value={bg.gradient.kind}
              options={[
                { value: 'linear', label: 'Linear' },
                { value: 'radial', label: 'Radial' },
              ]}
              onChange={(kind) => setStyle('background', { gradient: { ...bg.gradient, kind } })}
            />
            {bg.gradient.kind === 'linear' ? (
              <Slider label="Angle" min={0} max={360} value={bg.gradient.angle} format={(v) => `${v}°`} onChange={(angle) => setStyle('background', { gradient: { ...bg.gradient, angle } })} />
            ) : (
              <>
                <Slider label="Center left/right" min={0} max={1} step={0.01} value={bg.gradient.cx} format={pct} onChange={(cx) => setStyle('background', { gradient: { ...bg.gradient, cx } })} />
                <Slider label="Center up/down" min={0} max={1} step={0.01} value={bg.gradient.cy} format={pct} onChange={(cy) => setStyle('background', { gradient: { ...bg.gradient, cy } })} />
              </>
            )}
          </>
        )}
        {(bg.type === 'image' || bg.type === 'video') && (
          <>
            <div className="field">
              <FileButton
                label={bg.type === 'image' ? 'Upload image' : 'Upload looping video'}
                accept={bg.type === 'image' ? 'image/png,image/jpeg,image/webp' : 'video/mp4,video/quicktime,video/webm,.mov'}
                onFile={onBackgroundFile}
              />
              <p className="hint">{bgAssetName ? `Using ${bgAssetName}` : bg.type === 'image' ? 'PNG, JPG or WebP.' : 'Plays muted and loops behind everything.'}</p>
            </div>
            <Segmented
              label="Fit"
              value={bg.fit}
              options={[
                { value: 'cover', label: 'Fill (crop)' },
                { value: 'contain', label: 'Fit whole' },
              ]}
              onChange={(fit) => setStyle('background', { fit })}
            />
            <ColorField label="Fill behind" value={bg.color} onChange={(color) => setStyle('background', { color })} />
            <Slider label="Darken" min={0} max={0.9} step={0.01} value={bg.overlay} format={pct} onChange={(overlay) => setStyle('background', { overlay })} />
          </>
        )}
      </Section>

      <Section title={breakdown ? 'Glow behind sections' : 'Glow'} defaultOpen={breakdown}>
        <Toggle label="Show glow" checked={style.glow.on} onChange={(on) => setStyle('glow', { on })} />
        {style.glow.on && (
          <>
            <ColorField label="Color" value={style.glow.color} onChange={(color) => setStyle('glow', { color })} />
            <Slider label="Intensity" min={0} max={1} step={0.01} value={style.glow.intensity} format={pct} onChange={(intensity) => setStyle('glow', { intensity })} />
            <Slider label="Size" min={80} max={900} value={style.glow.radius} onChange={(radius) => setStyle('glow', { radius })} />
            <Slider label="Width" min={1} max={4} step={0.1} value={style.glow.stretch} format={(v) => `${v.toFixed(1)}x`} onChange={(stretch) => setStyle('glow', { stretch })} />
            <Slider label="Up / down" min={-400} max={400} value={style.glow.offsetY} onChange={(offsetY) => setStyle('glow', { offsetY })} hint="Positive moves the glow lower." />
          </>
        )}
      </Section>

      <Section title="Dot grid" defaultOpen={false}>
        <Toggle label="Show dot grid" checked={style.grid.on} onChange={(on) => setStyle('grid', { on })} />
        {style.grid.on && (
          <>
            <Slider label="Dot size" min={1} max={6} step={0.5} value={style.grid.size} onChange={(size) => setStyle('grid', { size })} />
            <Slider label="Spacing" min={6} max={40} value={style.grid.spacing} onChange={(spacing) => setStyle('grid', { spacing })} />
            <Slider label="Opacity" min={0} max={0.3} step={0.005} value={style.grid.opacity} format={pct} onChange={(opacity) => setStyle('grid', { opacity })} />
          </>
        )}
      </Section>

{breakdown && (
      <Section title="Waveform" defaultOpen={false}>
        <Toggle label="Show waveform" checked={style.waveform.on} onChange={(on) => setStyle('waveform', { on })} hint="Bar heights come from the video's real audio." />
        {style.waveform.on && (
          <>
            <ColorField label="Bar color" value={style.waveform.color} onChange={(color) => setStyle('waveform', { color })} />
            <Slider label="Opacity" min={0} max={1} step={0.01} value={style.waveform.opacity} format={pct} onChange={(opacity) => setStyle('waveform', { opacity })} />
            <Slider label="Bar width" min={1} max={12} step={0.5} value={style.waveform.barWidth} onChange={(barWidth) => setStyle('waveform', { barWidth })} />
            <Slider label="Spacing" min={4} max={30} step={0.5} value={style.waveform.spacing} onChange={(spacing) => setStyle('waveform', { spacing })} />
            <Slider label="Height" min={20} max={200} value={style.waveform.height} onChange={(height) => setStyle('waveform', { height })} />
            <Toggle label="Brighter near playhead" checked={style.waveform.highlight} onChange={(highlight) => setStyle('waveform', { highlight })} />
          </>
        )}
      </Section>
)}

      <Section title={template === 'ring' ? 'Logo (center)' : 'Logo'} defaultOpen={false}>
        {template !== 'ring' && <Toggle label="Show logo in the corner" checked={style.logo.show} onChange={(show) => setStyle('logo', { show })} />}
        <Segmented
          value={style.logo.mode}
          options={[
            { value: 'text', label: 'Text logo' },
            { value: 'image', label: 'Image logo' },
          ]}
          onChange={(mode) => setStyle('logo', { mode })}
        />
        {style.logo.mode === 'text' ? (
          <div className="field field-inline">
            <label htmlFor="logo-text">Text</label>
            <input id="logo-text" value={style.logo.text} onChange={(e) => setStyle('logo', { text: e.target.value })} />
          </div>
        ) : (
          <div className="field">
            <FileButton label="Upload PNG or SVG" accept="image/png,image/svg+xml,image/webp" onFile={onLogoFile} />
            <p className="hint">{logoAssetName ? `Using ${logoAssetName}` : 'Until you upload one, the text logo is used.'}</p>
          </div>
        )}
        <ColorField label="Color (text logo)" value={style.logo.color} onChange={(color) => setStyle('logo', { color })} />
        <Slider label="Size" min={12} max={120} value={style.logo.size} onChange={(size) => setStyle('logo', { size })} />
        <Slider label="Left" min={0} max={600} value={style.logo.x} onChange={(x) => setStyle('logo', { x })} />
        <Slider label="Top" min={10} max={400} value={style.logo.y} onChange={(y) => setStyle('logo', { y })} />
      </Section>

      <Section title={breakdown ? 'Video card' : 'Cards'} defaultOpen={false}>
        <Slider label="Corner radius" min={0} max={60} value={style.card.radius} onChange={(radius) => setStyle('card', { radius })} />
        <Toggle label="Border" checked={style.card.border} onChange={(border) => setStyle('card', { border })} />
        {style.card.border && (
          <>
            <ColorField label="Border color" value={style.card.borderColor} onChange={(borderColor) => setStyle('card', { borderColor })} />
            <Slider label="Border opacity" min={0} max={1} step={0.01} value={style.card.borderOpacity} format={pct} onChange={(borderOpacity) => setStyle('card', { borderOpacity })} />
            <Slider label="Border width" min={0.5} max={8} step={0.5} value={style.card.borderWidth} onChange={(borderWidth) => setStyle('card', { borderWidth })} />
          </>
        )}
        <Toggle label="Shadow" checked={style.card.shadow} onChange={(shadow) => setStyle('card', { shadow })} />
      </Section>

{breakdown ? (
        <>
      <Section title="Section boxes" defaultOpen={false}>
        <Slider label="Row position" min={20} max={200} value={style.rowOffset} onChange={(rowOffset) => setStyle('rowOffset', rowOffset)} hint="Space between the video and the boxes." />
        <ColorField label="Fill color" value={style.boxes.fillColor} onChange={(fillColor) => setStyle('boxes', { fillColor })} />
        <Slider label="Fill opacity" min={0} max={1} step={0.01} value={style.boxes.fillOpacity} format={pct} onChange={(fillOpacity) => setStyle('boxes', { fillOpacity })} />
        <ColorField label="Border color" value={style.boxes.borderColor} onChange={(borderColor) => setStyle('boxes', { borderColor })} />
        <Slider label="Border opacity" min={0} max={1} step={0.01} value={style.boxes.borderOpacity} format={pct} onChange={(borderOpacity) => setStyle('boxes', { borderOpacity })} />
        <Slider label="Border width" min={0} max={8} step={0.5} value={style.boxes.borderWidth} onChange={(borderWidth) => setStyle('boxes', { borderWidth })} />
        <Slider label="Corner radius" min={0} max={38} value={style.boxes.radius} onChange={(radius) => setStyle('boxes', { radius })} />
        <Slider label="Gap" min={0} max={30} value={style.boxes.gap} onChange={(gap) => setStyle('boxes', { gap })} />
        <Slider label="Height" min={40} max={140} value={style.boxes.height} onChange={(height) => setStyle('boxes', { height })} />
        <SelectField label="Font" value={style.boxes.font} options={FONTS.map((f) => ({ value: f, label: f }))} onChange={(font) => setStyle('boxes', { font })} />
        <Slider label="Label size" min={12} max={48} value={style.boxes.labelSize} onChange={(labelSize) => setStyle('boxes', { labelSize })} />
        <Segmented
          label="Label weight"
          value={String(style.boxes.labelWeight) as '400' | '500' | '600'}
          options={[
            { value: '400', label: 'Regular' },
            { value: '500', label: 'Medium' },
            { value: '600', label: 'Semibold' },
          ]}
          onChange={(w) => setStyle('boxes', { labelWeight: Number(w) as 400 | 500 | 600 })}
        />
        <ColorField label="Label color" value={style.boxes.labelColor} onChange={(labelColor) => setStyle('boxes', { labelColor })} />
        <Toggle label="Highlight active section" checked={style.boxes.activeHighlight} onChange={(activeHighlight) => setStyle('boxes', { activeHighlight })} />
      </Section>

      <Section title="Playhead" defaultOpen={false}>
        <ColorField label="Color" value={style.playhead.color} onChange={(color) => setStyle('playhead', { color })} />
        <Slider label="Triangle size" min={10} max={48} value={style.playhead.size} onChange={(size) => setStyle('playhead', { size })} />
        <Slider label="Line width" min={0.5} max={6} step={0.5} value={style.playhead.lineWidth} onChange={(lineWidth) => setStyle('playhead', { lineWidth })} />
      </Section>
        </>
      ) : (
        <Section title="Layout" defaultOpen={false}>
          <Slider label="Gap between cards" min={0} max={80} value={style.layout.gap} onChange={(gap) => setStyle('layout', { gap })} />
          <Slider label="Edge margin" min={0} max={160} value={style.layout.margin} onChange={(margin) => setStyle('layout', { margin })} />
        </Section>
      )}
      {titles && (
        <Section title="Titles" defaultOpen={false}>
          <SelectField label="Font" value={style.boxes.font} options={FONTS.map((f) => ({ value: f, label: f }))} onChange={(font) => setStyle('boxes', { font })} />
          <Slider label="Size" min={16} max={90} value={style.heading.size} onChange={(size) => setStyle('heading', { size })} />
          <Segmented
            label="Weight"
            value={String(style.heading.weight) as '400' | '500' | '600'}
            options={[
              { value: '400', label: 'Regular' },
              { value: '500', label: 'Medium' },
              { value: '600', label: 'Semibold' },
            ]}
            onChange={(w) => setStyle('heading', { weight: Number(w) as 400 | 500 | 600 })}
          />
          <ColorField label="Color" value={style.heading.color} onChange={(color) => setStyle('heading', { color })} />
          <Slider label="Space under title" min={0} max={60} value={style.heading.gap} onChange={(gap) => setStyle('heading', { gap })} />
        </Section>
      )}
    </div>
  );
}
