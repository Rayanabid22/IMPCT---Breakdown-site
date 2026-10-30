// End-to-end tests. Drives the real app in Chromium and checks exported files with ffmpeg.
//   e2e/fixtures.sh            (once, needs ffmpeg)
//   npm run build && npx vite preview --port 4173 &
//   node e2e/suite.mjs [filter]
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, '.fixtures');
const OUT = path.join(HERE, '.out');
const BASE = process.env.BASE ?? 'http://localhost:4173/';
const FILTER = process.argv[2] ?? '';
const FPS = 30000 / 1001;
fs.mkdirSync(OUT, { recursive: true });

// ---------- tiny test runner ----------
const results = [];
let current = '';
function check(cond, msg, detail = '') {
  results.push({ test: current, ok: !!cond, msg, detail });
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}${detail ? `  [${detail}]` : ''}`);
}
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------- media helpers ----------
function run(cmd, args) {
  const r = spawnSync(cmd, args, { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr}`);
  return r.stdout;
}
function probe(file) {
  return JSON.parse(run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]).toString());
}
function grayFrames(file, vf = '', w = 64, h = 36) {
  const buf = run('ffmpeg', ['-v', 'error', '-i', file, '-vf', `${vf}scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-']);
  const n = buf.length / (w * h);
  const frames = [];
  for (let i = 0; i < n; i++) frames.push(buf.subarray(i * w * h, (i + 1) * w * h));
  return frames;
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const diff = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};
function flashTimes(file, vf, fps) {
  const m = grayFrames(file, vf).map(mean);
  const out = [];
  for (let i = 0; i < m.length; i++) if (m[i] > 235 && (i === 0 || m[i - 1] <= 235)) out.push(i / fps);
  return { count: m.length, times: out };
}
function beepTimes(file) {
  const buf = run('ffmpeg', ['-v', 'error', '-i', file, '-af', 'highpass=f=700,highpass=f=700', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']);
  const a = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  const win = 240;
  const out = [];
  let prev = 0;
  for (let i = 0; i + win <= a.length; i += win) {
    let m = 0;
    for (let j = i; j < i + win; j++) m = Math.max(m, Math.abs(a[j]));
    if (m > 0.3 && prev <= 0.3) out.push(i / 48000);
    prev = m;
  }
  return out;
}
/** Mean audio-minus-video offset in ms, using flash frames and beeps. */
function syncOffset(file, vf, fps) {
  const f = flashTimes(file, vf, fps).times;
  const b = beepTimes(file);
  const d = b.map((o) => (o - f.reduce((best, x) => (Math.abs(x - o) < Math.abs(best - o) ? x : best), Infinity)) * 1000);
  return { flashes: f.length, beeps: b.length, mean: mean(d), min: Math.min(...d), max: Math.max(...d), firstFlash: f[0] };
}
function rgbFrame(file, n, w, h) {
  return run('ffmpeg', ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${n}),scale=${w}:${h}:flags=area`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
}
const CARD_CROP = 'crop=1284:722:78:100,';

// ---------- page helpers ----------
let browser;
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...opts });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && page.errors.push(m.text()));
  await page.goto(BASE);
  return page;
}
const fx = (f) => path.join(FIX, f);
async function upload(page, file, preset) {
  if (preset) await page.click(`.preset-card:has-text("${preset}")`);
  await page.setInputFiles('.dropzone input[type=file]', fx(file));
  await waitReady(page);
}
async function waitReady(page) {
  await page.waitForSelector('button.btn.primary:has-text("Export MP4"):not([disabled])', { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('.pill'), null, { timeout: 60000 }).catch(() => {});
}
async function seek(page, t) {
  await page.evaluate((tt) => {
    const r = document.querySelector('.scrub');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(r, tt);
    r.dispatchEvent(new Event('input', { bubbles: true }));
  }, t);
  await page.waitForTimeout(150);
  await page.waitForFunction(() => !document.querySelector('.stage[data-busy]'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
}
const times = (p) => p.$$eval('.time-input', (els) => els.map((e) => e.value));
const labels = (p) => p.$$eval('.seg-label', (els) => els.map((e) => e.value));
const timecode = (p) => p.textContent('.timecode');
/** Current playhead time as shown in the transport (hundredths). */
async function now(p) {
  const m = (await timecode(p)).match(/(\d+):(\d+)\.(\d+)/);
  return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 100;
}
async function previewPixels(page, w, h) {
  const arr = await page.evaluate(
    ([w, h]) => {
      const src = document.querySelector('.stage canvas');
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h).data;
      const rgb = new Array((d.length / 4) * 3);
      for (let i = 0, j = 0; i < d.length; i += 4) {
        rgb[j++] = d[i];
        rgb[j++] = d[i + 1];
        rgb[j++] = d[i + 2];
      }
      return rgb;
    },
    [w, h],
  );
  return Uint8Array.from(arr);
}
async function exportVideo(page, name, { quality, fps, cancelAfter, res = 'HD' } = {}) {
  await page.click('button:has-text("Export MP4")');
  await page.click(`.modal button:has-text("${res} (")`);
  if (quality) await page.click(`.modal button:has-text("${quality}")`);
  if (fps) await page.click(`.modal button:has-text("${fps} fps")`);
  const warnings = await page.$$eval('.modal .warn', (els) => els.map((e) => e.textContent));
  const t0 = Date.now();
  if (cancelAfter) {
    await page.click('button:has-text("Start export")');
    await page.waitForTimeout(cancelAfter);
    await page.click('button:has-text("Cancel export")');
    return { warnings };
  }
  const dl = page.waitForEvent('download', { timeout: 900000 });
  await page.click('button:has-text("Start export")');
  const d = await dl;
  const file = path.join(OUT, `${name}.mp4`);
  await d.saveAs(file);
  const seconds = (Date.now() - t0) / 1000;
  await page.click('.modal button:has-text("Close")');
  return { file, seconds, filename: d.suggestedFilename(), warnings };
}
/** Preview frame at output frame n vs. the exported frame n. Returns mean abs diff (0..255). */
async function wysiwyg(page, file, n, fps = FPS) {
  const { w, h } = await page.evaluate(() => {
    const c = document.querySelector('.stage canvas');
    return { w: c.width, h: c.height };
  });
  const sw = Math.round(w / 4);
  const sh = Math.round(h / 4);
  await seek(page, n / fps + 0.001);
  const a = await previewPixels(page, sw, sh);
  const b = rgbFrame(file, n, sw, sh);
  return diff(a, b);
}
function videoStream(p) {
  return p.streams.find((s) => s.codec_type === 'video');
}
function audioStream(p) {
  return p.streams.find((s) => s.codec_type === 'audio');
}

// ================= tests =================

test('inputs: MOV, no audio, 60fps, rotated, portrait, BT.709, VP9 WebM', async () => {
  const cases = [
    { file: 'clip.mov', dur: 20, audio: true, flash: true },
    { file: 'noaudio.mp4', dur: 15, audio: false, flash: true },
    { file: 'fps60.mp4', dur: 15, audio: true, flash: true },
    { file: 'rotated.mp4', dur: 10, audio: true },
    { file: 'portrait.mp4', dur: 10, audio: true },
    { file: 'bt709.mp4', dur: 10, audio: true },
    { file: 'vp9.webm', dur: 12, audio: true },
  ];
  for (const c of cases) {
    const page = await newPage();
    await upload(page, c.file);
    const tc = (await timecode(page)).trim();
    const shown = tc.split('/')[1].trim().split(/[:.]/).map(Number);
    check(Math.abs(shown[0] * 60 + shown[1] + shown[2] / 100 - c.dur) <= 0.05, `${c.file}: duration read`, tc);
    const r = await exportVideo(page, `in-${c.file}`);
    const p = probe(r.file);
    const v = videoStream(p);
    const a = audioStream(p);
    const expected = Math.round(c.dur * FPS);
    check(v.codec_name === 'h264' && v.width === 1440 && v.height === 1080, `${c.file}: H.264 1440x1080`, `${v.codec_name} ${v.width}x${v.height} ${v.profile}`);
    check(Math.abs(Number(v.nb_frames) - expected) <= 1, `${c.file}: frame count`, `${v.nb_frames} vs ${expected}`);
    check(c.audio ? a?.codec_name === 'aac' : !a, `${c.file}: audio ${c.audio ? 'AAC' : 'absent'}`, a?.codec_name ?? 'none');
    if (c.flash) {
      const ft = flashTimes(r.file, CARD_CROP, FPS).times;
      check(ft[0] < 0.001 && ft.length === c.dur, `${c.file}: flashes start on frame 0, one per second`, `${ft.length} flashes, first ${ft[0]}`);
      const so = c.audio ? syncOffset(r.file, CARD_CROP, FPS) : null;
      if (so) check(so.min > -40 && so.max < 40, `${c.file}: A/V within one frame`, `mean ${so.mean.toFixed(1)}ms, range ${so.min.toFixed(1)}..${so.max.toFixed(1)}`);
    }
    const d = await wysiwyg(page, r.file, 45);
    check(d < 6, `${c.file}: preview matches export`, `mean diff ${d.toFixed(2)}`);
    if (c.file === 'rotated.mp4' || c.file === 'portrait.mp4') {
      // Portrait content inside the landscape card: cover-fit crops it, but it must not be squashed.
      const mid = rgbFrame(r.file, 30, 144, 108);
      check(mid.length === 144 * 108 * 3, `${c.file}: frame decodes`);
    }
    check(page.errors.length === 0, `${c.file}: no console errors`, page.errors.join(' | '));
    await page.context().close();
  }
});

test('60s export: frame exact, in sync, faster than real time', async () => {
  const page = await newPage();
  await upload(page, 'test60.mp4', 'Blue');
  const r = await exportVideo(page, 'test60');
  const v = videoStream(probe(r.file));
  check(r.filename === 'test60_breakdown.mp4', 'file name', r.filename);
  check(r.seconds < 60, 'faster than real time', `${r.seconds.toFixed(1)}s`);
  const src = grayFrames(fx('test60.mp4'), '', 128, 72);
  const out = grayFrames(r.file, CARD_CROP, 128, 72);
  let mismatched = 0;
  let dups = 0;
  for (let i = 0; i < out.length; i++) {
    const j = Math.min(i, src.length - 1);
    let best = Infinity;
    for (let k = Math.max(0, i - 2); k <= Math.min(src.length - 1, i + 2); k++) best = Math.min(best, diff(out[i], src[k]));
    if (diff(out[i], src[j]) > best + 0.5) mismatched++;
    if (i > 0 && diff(out[i], out[i - 1]) < 0.3 && mean(out[i]) < 230) dups++;
  }
  check(out.length === src.length, 'frame count equals source', `${out.length} vs ${src.length}`);
  check(mismatched === 0 && dups === 0, 'no dropped or duplicated frames', `mismatched ${mismatched}, duplicates ${dups}`);
  const so = syncOffset(r.file, CARD_CROP, FPS);
  const ss = syncOffset(fx('test60.mp4'), '', FPS);
  check(Math.abs(so.mean - ss.mean) < 2, 'A/V offset identical to source', `out ${so.mean.toFixed(1)}ms, source ${ss.mean.toFixed(1)}ms`);
  check(Math.abs(Number(v.duration) - 60) < 0.05, 'duration 60s', v.duration);
  // Playhead at the end of the last box on the final frame.
  const last = rgbFrame(r.file, Number(v.nb_frames) - 1, 1440, 1080);
  const px = (x, y) => last[(y * 1440 + x) * 3];
  const tipY = 908 - 8;
  check(px(1361, tipY) > 200 && px(1300, tipY) < 120, 'playhead ends at right edge of last box', `x1361=${px(1361, tipY)} x1300=${px(1300, tipY)}`);
  await page.context().close();
});

test('30 fps export and Standard quality', async () => {
  const page = await newPage();
  await upload(page, 'test30.mp4');
  const r = await exportVideo(page, 'fps30', { fps: 30, quality: 'Standard' });
  const p = probe(r.file);
  const v = videoStream(p);
  check(v.r_frame_rate === '30/1', '30 fps stream', v.r_frame_rate);
  check(Math.abs(Number(v.nb_frames) - 900) <= 1, '900 frames', v.nb_frames);
  const mbps = Number(p.format.bit_rate) / 1e6;
  check(mbps < 9, 'standard bitrate is smaller', `${mbps.toFixed(1)} Mbps`);
  await page.context().close();
});

test('cancel export, then export again', async () => {
  const page = await newPage();
  await upload(page, 'test30.mp4');
  await exportVideo(page, 'cancel', { cancelAfter: 2500 });
  await page.waitForTimeout(500);
  const startVisible = await page.isVisible('button:has-text("Start export")');
  check(startVisible, 'dialog back to idle after cancel');
  await page.click('.modal button:has-text("Close")');
  const sideInert = await page.$eval('.side', (e) => e.inert);
  check(!sideInert, 'UI unlocked after cancel');
  const r = await exportVideo(page, 'after-cancel');
  check(fs.statSync(r.file).size > 1e6, 'second export succeeds', `${(fs.statSync(r.file).size / 1e6).toFixed(1)} MB`);
  check(page.errors.length === 0, 'no console errors', page.errors.join(' | '));
  await page.context().close();
});

test('long video warns about the X limit', async () => {
  const page = await newPage();
  await upload(page, 'long150.mp4');
  await page.click('button:has-text("Export MP4")');
  const warn = await page.$$eval('.modal .warn', (els) => els.map((e) => e.textContent).join(' '));
  check(/2:20/.test(warn), 'warns about 2:20 limit', warn);
  await page.context().close();
});

test('replace video rescales sections proportionally', async () => {
  const page = await newPage();
  await upload(page, 'test30.mp4');
  const el = (await page.$$('.time-input'))[1];
  await el.fill('10');
  await el.press('Enter');
  await page.setInputFiles('.topbar input[type=file][accept^="video"]', fx('test60.mp4'));
  await page.waitForFunction(() => document.querySelector('.timecode')?.textContent.includes('1:00.00'));
  await waitReady(page);
  const t = await times(page);
  check(t[1] === '0:20.00' && t[t.length - 1] === '1:00.00', 'boundaries doubled', t.join(','));
  const notice = await page.textContent('.notices').catch(() => '');
  check(/stretched/.test(notice), 'tells the user', notice.trim());
  await page.context().close();
});

test('keyboard shortcuts', async () => {
  const page = await newPage();
  await upload(page, 'test30.mp4');
  const focusPage = () => page.click('.shortcuts'); // plain text, so keys go to the window
  const selectRow = (i) => page.click(`.seg-item >> nth=${i}`, { position: { x: 900, y: 10 } });
  await focusPage();
  await page.keyboard.press('Space');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  const playedTo = await now(page);
  check(playedTo > 0.8 && playedTo < 2.5, 'Space plays and pauses', `${playedTo.toFixed(2)}s`);
  await seek(page, 5);
  await focusPage();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  const a = await now(page);
  check(Math.abs(a - (Math.round(5 * FPS) + 1) / FPS) < 0.011, 'Right steps one frame', a.toFixed(2));
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(200);
  const b = await now(page);
  check(Math.abs(b - Math.round(5 * FPS) / FPS) < 0.011, 'Left steps back one frame', b.toFixed(2));
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(200);
  check(Math.abs((await now(page)) - b - 1) < 0.011, 'Shift+Right steps one second', (await now(page)).toFixed(2));
  await selectRow(0);
  await seek(page, 4);
  await focusPage();
  await page.keyboard.press('s');
  await page.waitForTimeout(100);
  check((await labels(page)).length === 5 && (await times(page))[1] === '0:04.00', 'S splits selected section at playhead', (await times(page)).slice(0, 3).join(','));
  await selectRow(0);
  await seek(page, 2);
  await focusPage();
  await page.keyboard.press(']');
  await page.waitForTimeout(100);
  check((await times(page))[1] === '0:02.00', '] sets end of selected to playhead', (await times(page))[1]);
  await selectRow(1);
  await seek(page, 3);
  await focusPage();
  await page.keyboard.press('[');
  await page.waitForTimeout(100);
  check((await times(page))[2] === '0:03.00' && (await times(page))[1] === '0:03.00', '[ sets start of selected (neighbor follows)', (await times(page)).slice(0, 3).join(','));
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  check((await times(page))[1] === '0:04.00', 'Ctrl+Z twice undoes both', (await times(page))[1]);
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(100);
  check((await times(page))[1] === '0:02.00', 'Ctrl+Y redoes', (await times(page))[1]);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(100);
  check((await times(page))[2] === '0:03.00', 'Ctrl+Shift+Z redoes', (await times(page))[2]);
  const label = (await page.$$('.seg-label'))[0];
  await label.focus();
  await page.keyboard.press('s');
  check((await labels(page)).length === 5 && (await labels(page))[0].endsWith('s'), 'typing S in a label does not split', (await labels(page))[0]);
  await page.context().close();
});

test('section management edge cases', async () => {
  const page = await newPage();
  await upload(page, 'test30.mp4');
  for (let i = 0; i < 3; i++) await page.click('.seg-item .btn.danger >> nth=0');
  check((await labels(page)).length === 1, 'delete down to one section');
  check(await page.isDisabled('.seg-item .btn.danger'), 'last section cannot be deleted');
  const t = await times(page);
  check(t[0] === '0:00.00' && t[1] === '0:30.00', 'single section covers the whole video', t.join(','));
  for (let i = 0; i < 11; i++) {
    await seek(page, 2.5 * (i + 1));
    await page.click('.seg-item >> nth=-1', { position: { x: 900, y: 10 } });
    await page.click('button:has-text("+ Add section")');
  }
  check((await labels(page)).length === 12, '12 sections');
  await page.click('.seg-item >> nth=0', { position: { x: 900, y: 10 } });
  await seek(page, 0.2);
  // Split the first section (2.5s long) repeatedly until too short.
  for (let i = 0; i < 4; i++) await page.click('button:has-text("+ Add section")');
  const msg = await page.textContent('.notices').catch(() => '');
  check(/too short/.test(msg), 'too-short split explains why', msg.trim());
  const label = (await page.$$('.seg-label'))[0];
  await label.fill('');
  await page.waitForTimeout(300);
  const d = await page.evaluate(() => document.querySelector('.stage canvas').toDataURL().length);
  check(d > 1000 && page.errors.length === 0, 'empty label renders without errors', page.errors.join(' | '));
  await page.context().close();
});

test('errors are explained', async () => {
  const page = await newPage();
  await page.setInputFiles('.dropzone input[type=file]', fx('notvideo.txt'));
  check(/not a video/.test(await page.textContent('.error-line')), 'non-video upload rejected');
  await page.setInputFiles('.start-head input[type=file]', fx('bad.json'));
  await page.waitForSelector('.error-line:has-text("project")', { timeout: 5000 }).catch(() => {});
  check(/isn't a Breakdown Studio project/.test(await page.textContent('.error-line')), 'bad project file rejected');
  await page.context().close();
});

test('presets: save, rename, duplicate, delete, persist, apply', async () => {
  const page = await newPage();
  await upload(page, 'test30.mp4', 'Blue');
  await page.click('button:has-text("Presets…")');
  await page.fill('#preset-name', 'Team look');
  await page.click('.modal button:has-text("Save")');
  await page.click('.preset-list li:has-text("Orange") button:has-text("Duplicate")');
  const names = () => page.$$eval('.preset-list li', (els) => els.map((e) => e.querySelector('input')?.value ?? e.querySelector('.preset-name')?.textContent));
  let n = await names();
  check(n.some((x) => x === 'Team look') && n.some((x) => x === 'Orange / Waveform copy'), 'save + duplicate', n.join(' | '));
  await page.fill('input[aria-label="Rename Team look"]', 'Team look v2');
  await page.click('.preset-list li:has(input[value="Orange / Waveform copy"]) button:has-text("Delete")');
  n = await names();
  check(n.includes('Team look v2') && !n.includes('Orange / Waveform copy'), 'rename + delete', n.join(' | '));
  await page.click('.modal button:has-text("Done")');
  await page.reload();
  await waitReady(page);
  const opts = await page.$$eval('#preset-select option', (els) => els.map((e) => e.textContent));
  check(opts.includes('Team look v2'), 'user preset persists after reload', opts.join(' | '));
  await page.selectOption('#preset-select', 'builtin-orange');
  await page.waitForTimeout(200);
  const orangeBg = await page.inputValue('.hex >> nth=0');
  const teamId = await page.$eval('#preset-select', (s) => [...s.options].find((o) => o.textContent === 'Team look v2').value);
  await page.selectOption('#preset-select', teamId);
  await page.waitForTimeout(200);
  const teamBg = await page.inputValue('.hex >> nth=0');
  check(orangeBg === '#FF5A00' && teamBg === '#05070D', 'applying presets switches the look', `${orangeBg} -> ${teamBg}`);
  await page.context().close();
});

test('recent projects: list, reopen with video, remove', async () => {
  const page = await newPage();
  await upload(page, 'test30.mp4');
  await page.fill('.project-name', 'First project');
  await page.waitForTimeout(500);
  await page.click('button:has-text("New")');
  await upload(page, 'clip.mov');
  await page.fill('.project-name', 'Second project');
  await page.waitForTimeout(500);
  await page.click('button:has-text("New")');
  const items = await page.$$eval('.recent-open strong', (els) => els.map((e) => e.textContent));
  check(items[0] === 'Second project' && items[1] === 'First project', 'recent list, newest first', items.join(' | '));
  await page.click('.recent-open:has-text("First project")');
  await waitReady(page);
  check((await timecode(page)).includes('0:30.00'), 'reopened project has its video back');
  await page.click('button:has-text("New")');
  await page.click('li:has-text("Second project") button[aria-label^="Remove"]');
  const after = await page.$$eval('.recent-open strong', (els) => els.map((e) => e.textContent));
  check(!after.includes('Second project'), 'remove from recent', after.join(' | '));
  await page.context().close();
});

test('style: logo PNG/SVG, image, gradient, video background, highlight, sizes', async () => {
  const page = await newPage();
  await upload(page, 'test30.mp4');
  const region = async (x, y, w, h) =>
    page.evaluate(
      ([x, y, w, h]) => {
        const c = document.querySelector('.stage canvas');
        const s = c.width / 1440;
        const d = c.getContext('2d').getImageData(x * s, y * s, w * s, h * s).data;
        let g = 0;
        for (let i = 0; i < d.length; i += 4) g += d[i + 1];
        return g / (d.length / 4);
      },
      [x, y, w, h],
    );
  await page.click('.section-toggle:has-text("Logo")');
  await page.click('.segmented button:has-text("Image logo")');
  await page.setInputFiles('.style-panel input[type=file][accept*="svg"]', fx('logo.png'));
  await page.waitForTimeout(800);
  const g1 = await region(54, 34, 36, 36);
  check(g1 > 200, 'PNG logo drawn (green square)', g1.toFixed(0));
  await page.setInputFiles('.style-panel input[type=file][accept*="svg"]', fx('logo.svg'));
  await page.waitForTimeout(800);
  const svgSeen = await page.textContent('.style-panel').then((t) => t.includes('logo.svg'));
  check(svgSeen, 'SVG logo accepted');
  const r1 = await exportVideo(page, 'style-logo');
  const d1 = await wysiwyg(page, r1.file, 30);
  check(d1 < 6, 'logo export matches preview', d1.toFixed(2));

  await page.click('.segmented button:has-text("Gradient")');
  await page.click('.segmented button:has-text("Radial")');
  await page.click('.section-toggle:has-text("Section boxes")');
  await page.click('.field:has(label:text-is("Highlight active section")) button[role=switch]');
  await seek(page, 3);
  const r2 = await exportVideo(page, 'style-gradient');
  const d2 = await wysiwyg(page, r2.file, 90);
  check(d2 < 6, 'radial gradient + highlight export matches preview', d2.toFixed(2));

  await page.click('.segmented button:has-text("Image")');
  await page.setInputFiles('.style-panel input[type=file][accept^="image/png,image/jpeg"]', fx('bg.jpg'));
  await page.waitForTimeout(800);
  await page.selectOption('.style-panel select >> nth=0', '1080x1350');
  const r3 = await exportVideo(page, 'style-image-45');
  const v3 = videoStream(probe(r3.file));
  check(v3.width === 1080 && v3.height === 1350, '4:5 export size', `${v3.width}x${v3.height}`);
  const d3 = await wysiwyg(page, r3.file, 60);
  check(d3 < 6, 'image background 4:5 export matches preview', d3.toFixed(2));

  await page.click('.segmented button:has-text("Video")');
  await page.setInputFiles('.style-panel input[type=file][accept^="video"]', fx('bgloop.mp4'));
  await page.waitForTimeout(1200);
  await page.selectOption('.style-panel select >> nth=0', '1920x1080');
  const r4 = await exportVideo(page, 'style-bgvideo');
  // The looping background must actually move in the export.
  const f = grayFrames(r4.file, 'crop=200:200:0:880,', 32, 32);
  check(diff(f[10], f[70]) > 3, 'background video animates in export', diff(f[10], f[70]).toFixed(1));
  check(videoStream(probe(r4.file)).width === 1920, '16:9 export size');
  check(page.errors.length === 0, 'no console errors', page.errors.join(' | '));
  await page.context().close();
});

test('4K export: native 2x render, video scaled up, in sync', async () => {
  const page = await newPage();
  await upload(page, 'test30.mp4', 'Blue');
  await page.click('button:has-text("Export MP4")');
  const def = await page.$eval('.modal button[aria-checked="true"]', (e) => e.textContent);
  check(/4K \(2880 x 2160\)/.test(def), '4K is the default', def);
  const est = await page.textContent('.export-facts');
  check(/2880 x 2160/.test(est), 'facts show 4K size', est.replace(/\s+/g, ' '));
  await page.click('.modal button:has-text("Close")');
  const r = await exportVideo(page, '4k', { res: '4K' });
  const p = probe(r.file);
  const v = videoStream(p);
  check(v.width === 2880 && v.height === 2160 && v.codec_name === 'h264', '2880x2160 H.264', `${v.width}x${v.height} ${v.profile} level ${v.level}`);
  check(Math.abs(Number(v.nb_frames) - 899) <= 1, 'frame count', v.nb_frames);
  check(audioStream(p)?.codec_name === 'aac', 'AAC audio');
  const mb = Number(p.format.size) / 1e6;
  check(mb < 300, 'reasonable file size', `${mb.toFixed(0)} MB, ${(Number(p.format.bit_rate) / 1e6).toFixed(1)} Mbps, export ${r.seconds.toFixed(0)}s`);
  const crop = 'crop=2568:1444:156:200,';
  const so = syncOffset(r.file, crop, FPS);
  check(so.firstFlash < 0.001 && so.flashes === 30, 'flashes on the right frames', `${so.flashes}, first ${so.firstFlash}`);
  check(so.min > -40 && so.max < 40, 'A/V in sync', `mean ${so.mean.toFixed(1)}ms`);
  // The 1080p video fills the whole 4K card (scaled up, edge to edge).
  const f = rgbFrame(r.file, 45, 2880, 2160);
  const at = (x, y) => [...f.subarray((y * 2880 + x) * 3, (y * 2880 + x) * 3 + 3)];
  const inCard = at(170, 1100);
  const outside = at(100, 1100);
  check(inCard[0] > 150 && inCard[1] < 80 && outside[2] > outside[0], 'video fills the card edge to edge', `card ${inCard} bg ${outside}`);
  const d = await wysiwyg(page, r.file, 45);
  check(d < 6, '4K export matches the preview', d.toFixed(2));
  await page.context().close();
});

test('16:9 4K and border colors', async () => {
  const page = await newPage();
  await upload(page, 'test30.mp4');
  await page.selectOption('.style-panel select >> nth=0', '1920x1080');
  await page.click('.section-toggle:has-text("Section boxes")');
  const color = (label) => page.locator(`.field:has(label:text-is("${label}")) input.hex`);
  await color('Border color').fill('#00FF00');
  await color('Fill color').fill('#0000FF');
  await page.locator('.field:has(label:text-is("Border width")) input[type=range]').first().fill('6');
  await page.locator('.field:has(label:text-is("Border opacity")) input[type=range]').first().fill('1');
  await page.click('.segmented button:has-text("Semibold")');
  await page.click('.section-toggle:has-text("Video card")');
  await page.click('.field:has(label:text-is("Border")) button[role=switch]');
  const cardSection = page.locator('.style-panel .section:has(.section-toggle:has-text("Video card"))');
  await cardSection.locator('.field:has(label:text-is("Border color")) input.hex').fill('#FF00FF');
  await cardSection.locator('.field:has(label:text-is("Border opacity")) input[type=range]').fill('1');
  await cardSection.locator('.field:has(label:text-is("Border width")) input[type=range]').fill('6');
  await page.waitForTimeout(400);
  const r = await exportVideo(page, '4k-169', { res: '4K' });
  const v = videoStream(probe(r.file));
  check(v.width === 3840 && v.height === 2160, '3840x2160', `${v.width}x${v.height}`);
  const f = rgbFrame(r.file, 30, 3840, 2160);
  // Find the box row: scan down the first box's left border column for green pixels.
  let green = 0;
  let magenta = 0;
  for (let i = 0; i < f.length; i += 3) {
    if (f[i] < 90 && f[i + 1] > 200 && f[i + 2] < 90) green++;
    if (f[i] > 200 && f[i + 1] < 90 && f[i + 2] > 200) magenta++;
  }
  check(green > 20000, 'box borders use the chosen color', `${green} green px`);
  check(magenta > 5000, 'card border uses the chosen color', `${magenta} magenta px`);
  const d = await wysiwyg(page, r.file, 30);
  check(d < 6, 'export matches preview', d.toFixed(2));
  check(page.errors.length === 0, 'no console errors', page.errors.join(' | '));
  await page.context().close();
});

test('rendering idles when paused and runs while playing', async () => {
  const page = await newPage();
  await page.addInitScript(() => {});
  await upload(page, 'test30.mp4');
  await page.evaluate(() => {
    window.__draws = 0;
    const orig = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...a) {
      if (this.canvas.closest?.('.stage')) window.__draws++;
      return orig.apply(this, a);
    };
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => (window.__draws = 0));
  await page.waitForTimeout(1000);
  const idle = await page.evaluate(() => window.__draws);
  check(idle === 0, 'no redraws while paused', `${idle} draws/s`);
  await page.click('.stage', { position: { x: 5, y: 5 } });
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await page.evaluate(() => (window.__draws = 0));
  await page.waitForTimeout(1000);
  const playing = await page.evaluate(() => window.__draws);
  check(playing >= 40, 'redraws every frame while playing', `${playing} draws/s (2 per frame)`);
  await page.click('.segmented.small button:has-text("Half")');
  const w = await page.$eval('.stage canvas', (c) => c.width);
  check(w === 720, 'Half preview renders at half resolution', `${w}px`);
  await page.context().close();
});


// ================= templates =================

async function startTemplate(page, name, file, preset) {
  await page.click(`.template-grid .preset-card:has-text("${name}")`);
  if (preset) await page.click(`.preset-card:has-text("${preset}")`);
  await page.setInputFiles('.dropzone input[type=file]', fx(file));
  await waitReady(page);
  await page.waitForTimeout(800);
}
const crop = (x, y, w, h) => `crop=${w}:${h}:${Math.round(x)}:${Math.round(y)},`;
/** Times (s) at which a region of the export flashes white. */
const flashesIn = (file, x, y, w, h, fps = FPS) => flashTimes(file, crop(x, y, w, h), fps).times;
async function screenshot(page, name) {
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page.click('button[aria-label="Save this frame as a 4K PNG"]');
  const d = await dl;
  const file = path.join(OUT, `${name}.png`);
  await d.saveAs(file);
  const p = probe(file);
  return { file, w: p.streams[0].width, h: p.streams[0].height, filename: d.suggestedFilename() };
}

test('4 Highlights: each tile plays its own part, export, 4K screenshot', async () => {
  const page = await newPage();
  await startTemplate(page, '4 Highlights', 'test30.mp4');
  const lanes = await page.$$eval('.lane-meta .time-input', (els) => els.map((e) => e.value));
  check(lanes.join(',') === '0:00.00,0:07.50,0:07.50,0:15.00,0:15.00,0:22.50,0:22.50,0:30.00', 'split evenly into 4', lanes.join(','));
  check((await timecode(page)).includes('0:07.50'), 'post length = a quarter of the video', (await timecode(page)).trim());
  const shot = await screenshot(page, 'grid4-shot');
  check(shot.w === 3840 && shot.h === 2160 && shot.filename.endsWith('.png'), 'camera saves a 4K PNG', `${shot.w}x${shot.h} ${shot.filename}`);
  const r = await exportVideo(page, 'grid4');
  const p = probe(r.file);
  const v = videoStream(p);
  check(v.width === 1920 && v.height === 1080, '1920x1080', `${v.width}x${v.height}`);
  check(Math.abs(Number(v.nb_frames) - Math.round(7.5 * FPS)) <= 1, 'frames = post length', v.nb_frames);
  check(Math.abs(Number(audioStream(p)?.duration) - 7.5) < 0.1, 'audio cut to the post length', audioStream(p)?.duration);
  // Tile i shows the source from 7.5*i, so its flashes land at (whole seconds - 7.5*i).
  const cells = [
    [0, 0],
    [967, 0],
    [0, 547],
    [967, 547],
  ];
  const firsts = cells.map(([x, y]) => flashesIn(r.file, x + 270, y + 120, 400, 300)[0]);
  const want = [0, 0.5, 0, 0.5];
  check(firsts.every((f, i) => Math.abs(f - want[i]) < 0.04), 'every tile plays its own range', firsts.map((f) => f?.toFixed(3)).join(', '));
  const d = await wysiwyg(page, r.file, 60);
  check(d < 6, 'preview matches export', d.toFixed(2));
  // The 4K screenshot is the same picture as the export at that moment (frame 0 here is a flash, so compare frame 60 instead).
  check(page.errors.length === 0, 'no console errors', page.errors.join(' | '));
  await page.context().close();
});

test('4 Highlights compilation: own clips, uploaded music, post length follows clips', async () => {
  const page = await newPage();
  await startTemplate(page, '4 Highlights', 'test30.mp4');
  const own = ['clip.mov', 'noaudio.mp4', 'fps60.mp4', 'rotated.mp4'];
  for (let i = 0; i < 4; i++) {
    await page.setInputFiles(`.lane >> nth=${i} >> input[type=file]`, fx(own[i]));
    await page.waitForFunction((i) => document.querySelectorAll('.lane-src')[i]?.textContent !== 'Launch video', i, { timeout: 10000 });
  }
  const srcs = await page.$$eval('.lane-src', (els) => els.map((e) => e.textContent));
  check(srcs.join(',') === own.join(','), 'each tile uses its own clip', srcs.join(','));
  check((await timecode(page)).includes('0:20.00'), 'post length grows to the longest clip', (await timecode(page)).trim());
  await page.setInputFiles('input[accept^="audio"]', fx('music.m4a'));
  await page.waitForFunction(() => document.querySelector('#audio-src')?.selectedOptions[0]?.textContent === 'music.m4a', null, { timeout: 10000 });
  check(true, 'uploaded music becomes the sound');
  await page.waitForTimeout(800);
  const r = await exportVideo(page, 'grid4-own');
  const p = probe(r.file);
  check(Math.abs(Number(videoStream(p).nb_frames) - Math.round(20 * FPS)) <= 1, '20s of frames', videoStream(p).nb_frames);
  const a = audioStream(p);
  check(a?.codec_name === 'aac' && Math.abs(Number(a.duration) - 20) < 0.1, 'music track, 20s, AAC', `${a?.codec_name} ${a?.duration}`);
  // clip.mov (tile 1) flashes on whole seconds from its own start.
  const f1 = flashesIn(r.file, 270, 120, 400, 300);
  check(f1[0] < 0.04 && f1.length >= 19, 'tile 1 plays clip.mov from its start', `${f1.length} flashes, first ${f1[0]}`);
  const d = await wysiwyg(page, r.file, 75);
  check(d < 7, 'preview matches export', d.toFixed(2));
  // Survives a reload: clips come back from browser storage.
  await page.reload();
  await waitReady(page);
  await page.waitForTimeout(1500);
  const after = await page.$$eval('.lane-src', (els) => els.map((e) => e.textContent));
  check(after.join(',') === own.join(','), 'own clips restored after refresh', after.join(','));
  const banner = await page.$('.notices .banner:has-text("aren\'t in this browser")');
  check(!banner, 'no missing-clip warning');
  check(page.errors.length === 0, 'no console errors', page.errors.join(' | '));
  await page.context().close();
});

test('6-8 Highlights: count lever, logo in the middle', async () => {
  const page = await newPage();
  await startTemplate(page, '6-8 Highlights', 'test30.mp4');
  check((await page.$$('.lane')).length === 8, 'starts with 8');
  await page.fill('#ring-count', '6');
  await page.waitForTimeout(300);
  check((await page.$$('.lane')).length === 6, 'lever down to 6');
  await page.fill('#ring-count', '7');
  await page.waitForTimeout(300);
  check((await page.$$('.lane')).length === 7, 'lever up to 7');
  const r = await exportVideo(page, 'ring7', { res: '4K' });
  const v = videoStream(probe(r.file));
  check(v.width === 3840 && v.height === 2160, '4K export', `${v.width}x${v.height}`);
  // The logo cell (middle row, right two thirds) is black with white logo pixels; tiles are elsewhere.
  const f = rgbFrame(r.file, 20, 384, 216);
  let white = 0;
  for (let y = 80; y < 136; y++) for (let x = 140; x < 370; x++) if (f[(y * 384 + x) * 3] > 200 && f[(y * 384 + x) * 3 + 2] > 200) white++;
  check(white > 40, 'logo drawn in the middle', `${white} logo px`);
  const d = await wysiwyg(page, r.file, 40);
  check(d < 6, 'preview matches export', d.toFixed(2));
  const shot = await screenshot(page, 'ring-shot');
  check(shot.w === 3840, 'screenshot 4K', `${shot.w}x${shot.h}`);
  await page.context().close();
});

test('Launch + 2 Highlights: full video on top, loops below, in sync', async () => {
  const page = await newPage();
  await startTemplate(page, 'Launch + 2 Highlights', 'test30.mp4');
  const before = await page.$$eval('.lane-meta .time-input', (els) => els.map((e) => e.value));
  await page.click('button:has-text("Shuffle")');
  const after = await page.$$eval('.lane-meta .time-input', (els) => els.map((e) => e.value));
  check(before.join() !== after.join(), 'shuffle picks new moments', `${before.join()} -> ${after.join()}`);
  await page.fill('#sec-Loop-length', '3');
  await page.press('#sec-Loop-length', 'Enter');
  await page.waitForTimeout(200);
  const lens = await page.$$eval('.lane-meta .seg-dur', (els) => els.map((e) => e.textContent));
  check(lens.every((l) => l === '3.00s'), 'loop length applies to both', lens.join(','));
  check((await timecode(page)).includes('0:30.00'), 'post is as long as the launch video');
  const r = await exportVideo(page, 'launch2');
  const p = probe(r.file);
  check(Math.abs(Number(videoStream(p).nb_frames) - 899) <= 1, 'all 899 frames', videoStream(p).nb_frames);
  const mainCrop = crop(130 + 390, 36 + 180, 400, 300);
  const so = syncOffset(r.file, mainCrop, FPS);
  check(so.flashes === 30 && so.firstFlash < 0.001 && so.min > -40 && so.max < 40, 'main video in sync with audio', `${so.flashes} flashes, mean ${so.mean.toFixed(1)}ms`);
  const d = await wysiwyg(page, r.file, 100);
  check(d < 7, 'preview matches export', d.toFixed(2));
  await page.context().close();
});

test('12 Highlights: 4K export of 12 tiles', async () => {
  const page = await newPage();
  await startTemplate(page, '12 Highlights', 'test60.mp4');
  check((await page.$$('.lane')).length === 12, '12 tiles');
  const r = await exportVideo(page, 'grid12', { res: '4K' });
  const v = videoStream(probe(r.file));
  check(v.width === 3840 && v.height === 2160 && Math.abs(Number(v.nb_frames) - Math.round(5 * FPS)) <= 1, '3840x2160, 5s', `${v.width}x${v.height} ${v.nb_frames} frames, ${r.seconds.toFixed(0)}s to export`);
  const d = await wysiwyg(page, r.file, 40);
  check(d < 7, 'preview matches export', d.toFixed(2));
  check(page.errors.length === 0, 'no console errors', page.errors.join(' | '));
  await page.context().close();
});

test('Storyboard + Result: frames slide in on time', async () => {
  const page = await newPage();
  await startTemplate(page, 'Storyboard + Result', 'test30.mp4');
  await page.setInputFiles('.segment-list input[type=file][multiple]', [1, 2, 3, 4, 5].map((i) => fx(`sb${i}.png`)));
  await page.waitForSelector('.seg-frame img');
  const t = await times(page);
  check((await labels(page)).join(',') === 'sb1,sb2,sb3,sb4,sb5' && t[1] === '0:06.00', 'five frames spread over the video', t.join(','));
  await page.fill('#head-top', 'Storyboard');
  const r = await exportVideo(page, 'storyboard');
  const v = videoStream(probe(r.file));
  check(v.width === 1080 && v.height === 1080 && Math.abs(Number(v.nb_frames) - 899) <= 1, '1080x1080, all frames', `${v.width}x${v.height} ${v.nb_frames}`);
  // Center of the strip shows the storyboard frame that is current: sb2 (teal) at 9s, sb4 (dark) at 21s.
  const colorAt = (n) => {
    const f = rgbFrame(r.file, n, 1080, 1080);
    const i = (290 * 1080 + 540) * 3;
    return [f[i], f[i + 1], f[i + 2]];
  };
  const c9 = colorAt(Math.round(9 * FPS));
  const c21 = colorAt(Math.round(21 * FPS));
  check(c9[1] > 130 && c9[0] < 90, 'sb2 centered at 0:09', c9.join(','));
  check(c21[0] < 70 && c21[2] > 60 && c21[2] < 120, 'sb4 centered at 0:21', c21.join(','));
  const so = syncOffset(r.file, crop(116 + 224, 567 + 90, 400, 300), FPS);
  check(so.flashes === 30 && so.min > -40 && so.max < 40, 'result video in sync', `mean ${so.mean.toFixed(1)}ms`);
  const d = await wysiwyg(page, r.file, Math.round(11.8 * FPS));
  check(d < 6, 'preview matches export mid-slide', d.toFixed(2));
  check(page.errors.length === 0, 'no console errors', page.errors.join(' | '));
  await page.context().close();
});

test('BTS + Result: two synced videos, offset, swap', async () => {
  const page = await newPage();
  await startTemplate(page, 'BTS + Result', 'test30.mp4');
  await page.setInputFiles('.segment-list input[type=file]', fx('bts30.mp4'));
  await page.waitForSelector('text=Replace BTS video');
  const r = await exportVideo(page, 'bts');
  const top = flashesIn(r.file, 159 + 180, 100 + 64, 400, 300);
  const bottom = flashesIn(r.file, 159 + 180, 616 + 64, 400, 300);
  check(top.length === 30 && bottom.length === 30 && top.every((x, i) => Math.abs(x - bottom[i]) < 0.001), 'BTS and result flash on the same frames', `${top.length}/${bottom.length}`);
  const f = rgbFrame(r.file, 45, 1080, 1080);
  let green = 0;
  for (let y = 100; y < 528; y++) for (let x = 160; x < 920; x++) {
    const i = (y * 1080 + x) * 3;
    if (f[i] < 80 && f[i + 1] > 200 && f[i + 2] > 80 && f[i + 2] < 190) green++;
  }
  check(green > 300, 'top card shows the BTS (grid lines)', `${green} grid px`);
  await page.fill('#bts-offset', '0.5');
  await page.press('#bts-offset', 'Enter');
  await page.click('#bts-swap');
  await page.waitForTimeout(300);
  const r2 = await exportVideo(page, 'bts-offset');
  const top2 = flashesIn(r2.file, 159 + 180, 100 + 64, 400, 300);
  const bottom2 = flashesIn(r2.file, 159 + 180, 616 + 64, 400, 300);
  check(top2[0] < 0.001 && Math.abs(bottom2[0] - 0.5) < 0.04, 'swapped: result on top; BTS shifted by the offset', `top ${top2[0]}, bottom ${bottom2[0]?.toFixed(3)}`);
  const d = await wysiwyg(page, r2.file, 70);
  check(d < 6, 'preview matches export', d.toFixed(2));
  check(page.errors.length === 0, 'no console errors', page.errors.join(' | '));
  await page.context().close();
});

test('switching templates keeps the project', async () => {
  const page = await newPage();
  await upload(page, 'test30.mp4');
  await (await page.$$('.seg-label'))[0].fill('Opening');
  await page.selectOption('#template-select', 'grid4');
  await page.waitForSelector('.lane');
  check((await page.$$('.lane')).length === 4, 'breakdown to 4 highlights');
  await page.selectOption('#template-select', 'breakdown');
  await page.waitForSelector('.seg-label');
  check((await labels(page))[0] === 'Opening', 'back to breakdown keeps the sections', (await labels(page)).join(','));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  check((await page.$$('.lane')).length === 4, 'undo returns to the previous template');
  check(page.errors.length === 0, 'no console errors', page.errors.join(' | '));
  await page.context().close();
});

// ---------- main ----------
browser = await chromium.launch({ channel: 'chromium' });
const started = Date.now();
for (const t of tests) {
  if (FILTER && !t.name.includes(FILTER)) continue;
  current = t.name;
  console.log(`\n▶ ${t.name}`);
  try {
    await t.fn();
  } catch (err) {
    check(false, 'threw', String(err?.message ?? err).split('\n')[0]);
  }
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${((Date.now() - started) / 1000).toFixed(0)}s`);
for (const f of failed) console.log(`  FAIL ${f.test}: ${f.msg} ${f.detail}`);
process.exit(failed.length ? 1 : 0);
