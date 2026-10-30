# IMPCT Studio

A browser tool that turns a launch video into a finished X / LinkedIn post in about a minute. Pick a template, drop the video, adjust, export an MP4 (4K by default).

## Templates

| Template | What it makes |
|---|---|
| **Breakdown** | The video in a card, a row of labeled sections (Hook, Body, Features, CTA...) underneath and a playhead moving across them. |
| **4 Highlights** | A 2x2 grid, edge to edge with thin lines between clips (width and color adjustable). Each tile loops its own part of the launch video. Choose the post length and each tile's start and end, or upload your own clip per tile for a compilation. |
| **6-8 Highlights** | A full-width row of clips on top and at the bottom (6 = 3 + 3, 7 = 4 + 3, 8 = 4 + 4) with the logo on a styled background band in the middle. Own clips work here too. |
| **Launch + 2 Highlights** | The full video in a big card, two equal cards underneath looping short highlights (loop length adjustable, Shuffle picks new moments). |
| **16 Highlights** | A full 4x4 grid of sixteen highlights, edge to edge. |
| **Storyboard + Result** | Storyboard frames slide along a filmstrip on top, in sync with the final video below. Each frame's time is set like a breakdown section. |
| **BTS + Result** | Two equal cards: the behind-the-scenes recording and the final video playing in sync, with a sync offset, swap and editable titles. |

In every template:
- **+ Text** adds a text layer: font (built-in Google fonts or your own TTF/OTF/WOFF), weight, size, color, opacity, alignment, letter spacing, line height, background box, shadow, and when it appears. Drag it on the preview to place it.
- The camera button next to the play controls saves the current frame as a 4K PNG.

On the default 16:9 canvas, every highlight tile is exactly 16:9.

Everything runs in the browser. There's no server and nothing to install, and files never leave the computer. It's built for Chrome or Edge on an ordinary laptop.

## How to use (for the team)

1. Open the site in Chrome or Edge, pick a template, and drop your launch video on the big box. For Breakdown you can also pick a look (Orange or Blue).
2. Breakdown: play the video and pause where a section changes. Click **Playhead ⇥** on that row to end the section there. You can also drag the white handles on the timeline.
3. Rename the sections by typing in the label boxes. Use **+ Add section** (or press `S`) to split one.
4. Highlights templates: drag each highlight window on its lane, or type its start and end. Use **Own clip** to swap in a separate video. Storyboard: **+ Add frames**. BTS: **Upload BTS video**.
5. Change colors, background, glow and logo in the **Style** panel on the right.
6. Click **Export MP4**. 4K is the default (sharpest text); pick HD for a faster export. Keep the tab open until it finishes, then post the downloaded file.

Your work saves itself. If you refresh or close the tab, the project comes back. To hand a project to someone, use **Save project file** and send them the `.json` file along with the video.

## Run locally

Requires Node 20 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for time parsing, segments, playhead and layout math
npm run build      # production build into dist/
npm run preview    # serve the production build
```

## End-to-end tests

`e2e/suite.mjs` drives the real app in Chromium (Playwright) and checks every exported file with ffmpeg: frame counts, codecs, A/V sync against flash/beep test videos, frame-by-frame match with the source, and preview-vs-export pixel match. It also covers MOV, no-audio, 60 fps, rotated, portrait, BT.709 and VP9 inputs, keyboard shortcuts, presets, recent projects, styles, cancel, and idle rendering.

```bash
e2e/fixtures.sh                          # once, generates test videos (needs ffmpeg)
npm run build && npx vite preview --port 4173 &
npm run test:e2e                         # or: node e2e/suite.mjs keyboard   (filter by test name)
```

## Deploy

It's a static site. Any static host works.

**GitHub Pages (set up in this repo):** `.github/workflows/deploy.yml` runs the unit tests, builds, and publishes on every push. One-time setup: in the repo go to Settings, then Pages, and set Source to "GitHub Actions". The site is then at `https://rayanabid22.github.io/IMPCT---Breakdown-site/`.

**Vercel:** import the repo at vercel.com/new. The included `vercel.json` sets the build command (`npm run build`) and the output folder (`dist`). Or from a terminal: `npx vercel --prod`.

**Netlify:** "Add new site" then "Import from Git", pick the repo. `netlify.toml` already sets the build command and the `dist` folder. Or: `npx netlify deploy --prod --dir dist` after `npm run build`.

No environment variables are needed.

## How it works

- **One renderer.** `src/render/renderFrame.ts` draws every frame on a canvas. The live preview and the export both call the same `renderFrame(ctx, state, time, ...)`, so the exported file matches the preview pixel for pixel. Static layers (background, glow, grid, waveform, logo, boxes) are cached in an offscreen canvas and only redrawn when their settings change. Each frame only draws the video, the active box and the playhead.
- **Layout.** `src/lib/layout.ts` holds the reference measurements from our posts at 1440x1080 (card at x 78 to 1362, y 100, 16:9, row below it). Other canvas sizes scale and center the same layout.
- **Playhead.** `playheadX()` in `src/lib/segments.ts` finds the active segment and places the playhead inside that box, so it never sits in a gap. The timing is stretched by less than one frame so the final frame lands exactly at the end of the last box.
- **Export.** `src/media/export.ts` uses WebCodecs through [Mediabunny](https://mediabunny.dev). Source frames are decoded in order, each output frame is rendered offline, encoded as H.264 (4K renders the whole frame natively at 2x, e.g. 2880x2160, about 32 Mbps High; HD is 14 Mbps High or 7 Mbps Standard at 1440x1080; keyframe every 2s). The source video is scaled up to fill the card, and muxed into an MP4 with the moov atom at the front. AAC audio is copied through untouched. Other audio (Opus in WebM, for example) is re-encoded to AAC, with a WebAssembly encoder as a fallback when the browser has no AAC encoder. If WebCodecs is missing, it falls back to `MediaRecorder`, which records in real time.
- **Persistence.** The project (segments, style, name) autosaves to `localStorage`. The video and uploaded images go to IndexedDB, and the 3 most recent project videos are kept. Project files (`.breakdown.json`) contain segments, style and small images, but never the video.

### State shape

```ts
Project { id, name, duration, segments: Segment[], style: Style, presetId, updatedAt }
Segment { id, label, start, end, fontSize? }            // contiguous: seg[i].end === seg[i+1].start
Style   { canvas {w,h}, fps, background, glow, grid, waveform, logo, card, boxes, playhead, rowOffset }
```

### Files

```
src/
  lib/          pure logic + unit tests (time.ts, segments.ts, layout.ts, presets.ts)
  render/       renderFrame.ts, the single renderer
  media/        analyze.ts (waveform RMS + thumbnails), export.ts (WebCodecs + MediaRecorder fallback)
  store/        history.ts (undo/redo), player.ts (preview playback), storage.ts, projectFile.ts
  components/   Editor, Preview, Timeline, SegmentList, StylePanel, ExportDialog, StartScreen, PresetManager
```

## Notes and limits

- X accepts videos up to 512 MB and 2:20 on most accounts. The export dialog warns when either limit is likely to be exceeded.
- Untagged source videos (no color info in the file) are interpreted differently per codec by Chrome's player. The export decodes one frame both ways and uses whichever matches the preview, so colors always match what you saw.
- The real-time fallback (non-Chromium browsers) produces MP4 when the browser supports it, otherwise WebM.
