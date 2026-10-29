# Breakdown Studio

A browser tool for making IMPCT Studio "breakdown" posts. The launch video plays inside a card, with a row of labeled boxes (Hook, Body, Features, CTA...) underneath and a playhead moving across them. It exports a finished MP4 that's ready to post on X or LinkedIn.

Everything runs in the browser. There's no server and nothing to install, and files never leave the computer. It's built for Chrome or Edge on an ordinary laptop.

## How to use (for the team)

1. Open the site in Chrome or Edge and drop your launch video on the big box. You can pick a look first (Orange or Blue) if you want.
2. Play the video and pause where a section changes. Click **Playhead ⇥** on that row to end the section there. You can also drag the white handles on the timeline.
3. Rename the sections by typing in the label boxes. Use **+ Add section** (or press `S`) to split one.
4. Change colors, background, glow and logo in the **Style** panel on the right.
5. Click **Export MP4**. 4K is the default (sharpest text); pick HD for a faster export. Keep the tab open until it finishes, then post the downloaded file.

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
