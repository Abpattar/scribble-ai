// Neon Air Draw — drawing / hand-tracking engine
// Ported 1:1 (same constants, same math) from the original vanilla implementation
// so gesture accuracy and stroke rendering are unchanged. This class owns the
// canvases + MediaPipe loop; React only calls its public methods and listens
// to its callbacks.

export type Pt = { x: number; y: number };
export type Color = { r: number; g: number; b: number };
export type ToolType = 'freehand' | 'line' | 'circle' | 'rect' | 'fill';

export interface Stroke {
  type: ToolType;
  pts?: Pt[];
  a?: Pt;
  b?: Pt;
  col: Color;
  col2?: Color | null;
  size: number;
  erase: boolean;
  ox: number;
  oy: number;
  // 'fill' strokes only — a raster patch positioned in world space so it
  // pans/zooms with everything else. imgSrc is a small PNG data URL, kept
  // as a plain string so strokes stay JSON-serialisable for saving.
  imgSrc?: string;
  wx?: number;
  wy?: number;
  ww?: number;
  wh?: number;
}

export interface EngineCallbacks {
  onProgress: (pct: number, msg: string) => void;
  onReady: () => void;
  onHint: (text: string) => void;
  onModeBadge: (cls: string, text: string) => void;
  onZoomFlash: (pct: number) => void;
  onStrokesChanged: () => void; // fired on any commit/undo/clear/drag -> caller should debounce-save
  onDot: (show: boolean, x: number, y: number, size: number, color: string, glow: string) => void;
  // Fired when the camera auto-hibernates (idle) and when it wakes back up.
  onCamIdle?: () => void;
  onCamWake?: () => void;
}

const SMOOTH = 5;
const PEACE_CONFIRM_FRAMES = 4;
const HAND_MISS_GRACE_FRAMES = 6;
const UP_FRACTION = 0.22;
const DEFAULT_HINT = '🖐 Draw (any finger)  |  ✌️ Move/Pan';
// No hand in frame for this long → release the webcam (privacy + battery).
const IDLE_CAMERA_OFF_MS = 45_000;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Script load failed: ' + src));
    document.head.appendChild(s);
  });
}
async function loadScriptWithFallbacks(urls: string[]) {
  for (const url of urls) {
    try {
      await loadScript(url);
      return;
    } catch {
      console.warn('Failed to load:', url, '— trying next fallback…');
    }
  }
  throw new Error('All CDN sources failed for: ' + urls[0]);
}

export class DrawEngine {
  bgCanvas: HTMLCanvasElement;
  drawCanvas: HTMLCanvasElement;
  cam: HTMLVideoElement;
  bgCtx: CanvasRenderingContext2D;
  drawCtx: CanvasRenderingContext2D;
  cb: EngineCallbacks;

  strokeCache = document.createElement('canvas');
  strokeCacheCtx: CanvasRenderingContext2D;
  cacheScale: number | null = null;
  cacheOffX: number | null = null;
  cacheOffY: number | null = null;
  cacheExcludeIdx = -1;

  // public-ish state
  color: Color = { r: 0, g: 220, b: 255 };
  brushSize = 2;
  isEraser = false;
  gradientOn = false;
  currentTool: ToolType = 'freehand';
  transparentExport = false;
  camPaused = false;
  bgImage: HTMLImageElement | null = null;
  canvasMode = false;
  pipPosition: 'right' | 'left' = 'right';

  strokes: Stroke[] = [];
  activePts: Pt[] = [];
  activeCol: Color | null = null;
  wasDrawing = false;
  shapeStart: Pt | null = null;
  shapeLive: Pt | null | false = false;
  isDragging = false;
  dragStrokeIdx = -1;
  dragStartX = 0;
  dragStartY = 0;
  dragOrigOX = 0;
  dragOrigOY = 0;
  posHist: Pt[] = [];

  confirmedGesture: 'none' | 'draw' | 'peace' = 'none';
  peaceStreak = 0;
  handMissStreak = 0;

  // Fires the bucket fill once per draw-gesture "tap", not every frame.
  fillTriggered = false;
  // Loaded <img> for each 'fill' stroke, keyed off the stroke object itself
  // (never stored on the stroke, so strokes stay plain JSON for saving).
  fillImageCache = new WeakMap<Stroke, HTMLImageElement>();

  viewScale = 1;
  viewOffX = 0;
  viewOffY = 0;
  isPanning = false;
  panStartX = 0;
  panStartY = 0;
  panOrigOffX = 0;
  panOrigOffY = 0;

  mpReady = false;
  isReplaying = false;
  hands: any = null;
  camera: any = null;
  stream: MediaStream | null = null;
  destroyed = false;
  // True while the camera is hibernated (idle timeout or leaving the canvas).
  cameraOffForIdle = false;
  // Timestamp of the last frame that actually saw a hand. 0 = never seen one.
  lastHandSeen = 0;

  constructor(
    bgCanvas: HTMLCanvasElement,
    drawCanvas: HTMLCanvasElement,
    cam: HTMLVideoElement,
    cb: EngineCallbacks
  ) {
    this.bgCanvas = bgCanvas;
    this.drawCanvas = drawCanvas;
    this.cam = cam;
    this.cb = cb;
    this.bgCtx = bgCanvas.getContext('2d')!;
    this.drawCtx = drawCanvas.getContext('2d')!;
    this.strokeCacheCtx = this.strokeCache.getContext('2d')!;
    this.resize();
  }

  resize() {
    const vv = (window as any).visualViewport;
    const w = Math.round(vv ? vv.width : window.innerWidth);
    const h = Math.round(vv ? vv.height : window.innerHeight);
    this.bgCanvas.width = this.drawCanvas.width = w;
    this.bgCanvas.height = this.drawCanvas.height = h;
    this.strokeCache.width = w;
    this.strokeCache.height = h;
    this.redrawAll();
  }

  screenToWorld(x: number, y: number) {
    return { x: (x - this.viewOffX) / this.viewScale, y: (y - this.viewOffY) / this.viewScale };
  }
  worldToScreen(x: number, y: number) {
    return { x: x * this.viewScale + this.viewOffX, y: y * this.viewScale + this.viewOffY };
  }

  zoomBy(factor: number) {
    const cx = this.drawCanvas.width / 2,
      cy = this.drawCanvas.height / 2;
    const before = this.screenToWorld(cx, cy);
    this.viewScale = Math.min(6, Math.max(0.25, this.viewScale * factor));
    const after = this.worldToScreen(before.x, before.y);
    this.viewOffX += cx - after.x;
    this.viewOffY += cy - after.y;
    this.redrawAll();
    this.cb.onZoomFlash(Math.round(this.viewScale * 100));
  }
  zoomReset() {
    this.viewScale = 1;
    this.viewOffX = 0;
    this.viewOffY = 0;
    this.redrawAll();
    this.cb.onZoomFlash(Math.round(this.viewScale * 100));
  }

  setTool(t: ToolType) {
    this.currentTool = t;
    this.isEraser = false;
    this.shapeStart = null;
    this.shapeLive = false;
    this.fillTriggered = false;
  }
  setColor(c: Color) {
    this.color = c;
    this.isEraser = false;
  }
  setSize(v: number) {
    this.brushSize = v;
  }
  toggleEraser() {
    this.isEraser = !this.isEraser;
    return this.isEraser;
  }
  toggleGradient() {
    this.gradientOn = !this.gradientOn;
    return this.gradientOn;
  }
  toggleTransparentExport() {
    this.transparentExport = !this.transparentExport;
    return this.transparentExport;
  }
  toggleCamPause() {
    this.camPaused = !this.camPaused;
    if (!this.camPaused) this.bgImage = null;
    return this.camPaused;
  }
  toggleCanvasMode() {
    this.canvasMode = !this.canvasMode;
    return this.canvasMode;
  }
  flipPip() {
    this.pipPosition = this.pipPosition === 'right' ? 'left' : 'right';
  }
  importBgImage(file: File) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        this.bgImage = img;
        this.camPaused = true;
      };
      img.src = ev.target!.result as string;
    };
    reader.readAsDataURL(file);
  }

  // Used by the template/trace gallery: loads a bundled outline image as the
  // paused background so the user can draw over it. Returns a promise so the
  // caller can close the picker / update UI once it's actually on screen.
  setBgImageFromUrl(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.bgImage = img;
        this.camPaused = true;
        resolve();
      };
      img.onerror = () => reject(new Error('Failed to load template image'));
      img.src = url;
    });
  }

  // Removes the current paused background image (from a template or an
  // uploaded file) and resumes the live webcam feed.
  clearBgImage() {
    this.bgImage = null;
    this.camPaused = false;
  }

  undo() {
    this.strokes.pop();
    this.redrawAll();
    this.cb.onStrokesChanged();
  }
  clear() {
    this.strokes = [];
    this.activePts = [];
    this.drawCtx.clearRect(0, 0, this.drawCanvas.width, this.drawCanvas.height);
    this.cb.onStrokesChanged();
  }

  setStrokes(strokes: Stroke[]) {
    this.strokes = strokes;
    this.redrawAll();
  }
  getStrokes() {
    return this.strokes;
  }

  hueRotate(c: Color, deg: number): Color {
    let { r, g, b } = c;
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    let h = 0,
      s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    h = (h + deg / 360) % 1;
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    let r2, g2, b2;
    if (s === 0) {
      r2 = g2 = b2 = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r2 = hue2rgb(p, q, h + 1 / 3);
      g2 = hue2rgb(p, q, h);
      b2 = hue2rgb(p, q, h - 1 / 3);
    }
    return { r: Math.round(r2 * 255), g: Math.round(g2 * 255), b: Math.round(b2 * 255) };
  }

  neonSeg(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    r: number,
    g: number,
    b: number,
    sz: number,
    erase: boolean
  ) {
    if (erase) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(x2, y2, sz * 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = `rgba(${r},${g},${b},0.06)`;
    ctx.lineWidth = sz * 4.5;
    ctx.shadowBlur = 0;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = `rgba(${r},${g},${b},0.30)`;
    ctx.lineWidth = sz * 1.8;
    ctx.shadowBlur = sz * 2.5;
    ctx.shadowColor = `rgba(${r},${g},${b},1)`;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = `rgba(${r},${g},${b},1)`;
    ctx.lineWidth = Math.max(sz * 0.6, 0.5);
    ctx.shadowBlur = sz * 1.3;
    ctx.shadowColor = `rgba(${r},${g},${b},1)`;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = 'rgba(255,255,255,0.88)';
    ctx.lineWidth = Math.max(sz * 0.15, 0.35);
    ctx.shadowBlur = 2;
    ctx.shadowColor = '#fff';
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  shapePoints(s: Stroke): Pt[] {
    if (s.type === 'line') return [s.a!, s.b!];
    if (s.type === 'rect') {
      const { a, b } = s as { a: Pt; b: Pt };
      return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a];
    }
    if (s.type === 'circle') {
      const a = s.a!,
        b = s.b!;
      const cx = (a.x + b.x) / 2,
        cy = (a.y + b.y) / 2;
      const rx = Math.abs(b.x - a.x) / 2,
        ry = Math.abs(b.y - a.y) / 2;
      const pts: Pt[] = [];
      for (let i = 0; i <= 32; i++) {
        const t = (i / 32) * Math.PI * 2;
        pts.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry });
      }
      return pts;
    }
    return s.pts || [];
  }

  renderStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
    if (s.type === 'fill') {
      let img = this.fillImageCache.get(s);
      if (!img && s.imgSrc) {
        img = new Image();
        img.onload = () => this.redrawAll();
        img.src = s.imgSrc;
        this.fillImageCache.set(s, img);
      }
      if (!img || !img.complete || !img.naturalWidth) return;
      const topLeft = this.worldToScreen((s.wx || 0) + s.ox, (s.wy || 0) + s.oy);
      const bottomRight = this.worldToScreen((s.wx || 0) + (s.ww || 0) + s.ox, (s.wy || 0) + (s.wh || 0) + s.oy);
      ctx.drawImage(img, topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
      return;
    }
    const isShape = s.type && s.type !== 'freehand';
    const worldPts = isShape ? this.shapePoints(s) : s.pts || [];
    const col = s.col,
      col2 = s.col2;
    for (let i = 1; i < worldPts.length; i++) {
      const p0 = this.worldToScreen(worldPts[i - 1].x + s.ox, worldPts[i - 1].y + s.oy);
      const p1 = this.worldToScreen(worldPts[i].x + s.ox, worldPts[i].y + s.oy);
      if (
        !isShape &&
        Math.hypot(worldPts[i].x - worldPts[i - 1].x, worldPts[i].y - worldPts[i - 1].y) * this.viewScale > 260
      )
        continue;
      let c = col;
      if (col2) {
        const t = i / Math.max(1, worldPts.length - 1);
        c = {
          r: Math.round(col.r + (col2.r - col.r) * t),
          g: Math.round(col.g + (col2.g - col.g) * t),
          b: Math.round(col.b + (col2.b - col.b) * t),
        };
      }
      this.neonSeg(ctx, p0.x, p0.y, p1.x, p1.y, c.r, c.g, c.b, s.size * this.viewScale, s.erase);
    }
  }

  redrawAll() {
    this.rebuildCache(-1);
    this.drawCtx.clearRect(0, 0, this.drawCanvas.width, this.drawCanvas.height);
    this.drawCtx.drawImage(this.strokeCache, 0, 0);
  }
  rebuildCache(excludeIdx: number) {
    this.strokeCacheCtx.clearRect(0, 0, this.strokeCache.width, this.strokeCache.height);
    this.strokes.forEach((s, i) => {
      if (i !== excludeIdx) this.renderStroke(this.strokeCacheCtx, s);
    });
    this.cacheScale = this.viewScale;
    this.cacheOffX = this.viewOffX;
    this.cacheOffY = this.viewOffY;
    this.cacheExcludeIdx = excludeIdx;
  }
  fastComposite() {
    this.drawCtx.clearRect(0, 0, this.drawCanvas.width, this.drawCanvas.height);
    if (this.cacheScale === this.viewScale) {
      this.drawCtx.drawImage(this.strokeCache, this.viewOffX - this.cacheOffX!, this.viewOffY - this.cacheOffY!);
    } else {
      this.rebuildCache(this.cacheExcludeIdx);
      this.drawCtx.drawImage(this.strokeCache, 0, 0);
    }
  }

  smooth(rx: number, ry: number): Pt {
    this.posHist.push({ x: rx, y: ry });
    if (this.posHist.length > SMOOTH) this.posHist.shift();
    let sx = 0,
      sy = 0,
      w = 0;
    this.posHist.forEach((p, i) => {
      const wt = i + 1;
      sx += p.x * wt;
      sy += p.y * wt;
      w += wt;
    });
    return { x: sx / w, y: sy / w };
  }

  commitActiveStroke() {
    if (this.wasDrawing && this.currentTool === 'freehand' && this.activePts.length > 1) {
      const s: Stroke = {
        type: 'freehand',
        pts: [...this.activePts],
        col: { ...this.activeCol! },
        size: this.brushSize,
        erase: this.isEraser,
        ox: 0,
        oy: 0,
      };
      if (this.gradientOn && !this.isEraser) s.col2 = this.hueRotate(this.activeCol!, 140);
      this.strokes.push(s);
      this.redrawAll();
      this.cb.onStrokesChanged();
    }
    this.activePts = [];
    this.wasDrawing = false;
    this.posHist = [];
  }

  commitShape() {
    if (this.shapeStart && this.shapeLive) {
      const s: Stroke = {
        type: this.currentTool,
        a: { ...this.shapeStart },
        b: { ...(this.shapeLive as Pt) },
        col: { ...this.color },
        size: this.brushSize,
        erase: this.isEraser,
        ox: 0,
        oy: 0,
      };
      if (this.gradientOn && !this.isEraser) s.col2 = this.hueRotate(this.color, 140);
      this.strokes.push(s);
      this.redrawAll();
      this.cb.onStrokesChanged();
    }
    this.shapeStart = null;
    this.shapeLive = false;
  }

  exportPNG(name: string) {
    const tmp = document.createElement('canvas');
    tmp.width = this.drawCanvas.width;
    tmp.height = this.drawCanvas.height;
    const tctx = tmp.getContext('2d')!;
    if (!this.transparentExport) {
      tctx.fillStyle = '#000';
      tctx.fillRect(0, 0, tmp.width, tmp.height);
    }
    tctx.drawImage(this.drawCanvas, 0, 0);
    const link = document.createElement('a');
    const safeName = (name || 'drawing').replace(/[^a-z0-9-_]/gi, '_');
    link.download = 'neon-' + safeName + '-' + Date.now() + '.png';
    link.href = tmp.toDataURL('image/png');
    link.click();
  }

  replay(onDone?: () => void) {
    if (this.isReplaying || !this.strokes.length) {
      onDone?.();
      return;
    }
    this.isReplaying = true;
    this.drawCtx.clearRect(0, 0, this.drawCanvas.width, this.drawCanvas.height);
    let si = 0;
    const nextStroke = () => {
      if (si >= this.strokes.length) {
        this.isReplaying = false;
        onDone?.();
        return;
      }
      const s = this.strokes[si];
      const worldPts = s.type && s.type !== 'freehand' ? this.shapePoints(s) : s.pts || [];
      let pi = 1;
      const nextPt = () => {
        if (pi >= worldPts.length) {
          si++;
          setTimeout(nextStroke, 60);
          return;
        }
        const p0 = this.worldToScreen(worldPts[pi - 1].x + s.ox, worldPts[pi - 1].y + s.oy);
        const p1 = this.worldToScreen(worldPts[pi].x + s.ox, worldPts[pi].y + s.oy);
        let c = s.col;
        if (s.col2) {
          const t = pi / Math.max(1, worldPts.length - 1);
          c = {
            r: Math.round(s.col.r + (s.col2.r - s.col.r) * t),
            g: Math.round(s.col.g + (s.col2.g - s.col.g) * t),
            b: Math.round(s.col.b + (s.col2.b - s.col.b) * t),
          };
        }
        this.neonSeg(this.drawCtx, p0.x, p0.y, p1.x, p1.y, c.r, c.g, c.b, s.size * this.viewScale, s.erase);
        pi++;
        requestAnimationFrame(nextPt);
      };
      nextPt();
    };
    nextStroke();
  }

  record(name: string) {
    if (this.isReplaying) return;
    const dc = this.drawCanvas as any;
    if (!dc.captureStream) {
      alert('Video recording is not supported in this browser.');
      return;
    }
    const stream = dc.captureStream(30);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    } catch {
      try {
        recorder = new MediaRecorder(stream);
      } catch {
        alert('Recording not supported.');
        return;
      }
    }
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const link = document.createElement('a');
      const safeName = (name || 'drawing').replace(/[^a-z0-9-_]/gi, '_');
      link.download = 'neon-' + safeName + '-replay.webm';
      link.href = URL.createObjectURL(blob);
      link.click();
    };
    recorder.start();
    this.replay(() => {
      setTimeout(() => recorder.stop(), 300);
    });
    return recorder;
  }

  // ── gestures ──
  handScale(lm: any[]) {
    return Math.max(0.02, Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y));
  }
  fingerUp(lm: any[], tip: number, pip: number) {
    const scale = this.handScale(lm);
    return lm[pip].y - lm[tip].y > scale * UP_FRACTION;
  }
  fingerDown(lm: any[], tip: number, pip: number) {
    const scale = this.handScale(lm);
    return lm[tip].y - lm[pip].y > scale * (UP_FRACTION * 0.6);
  }
  getGesture(lm: any[]): 'none' | 'draw' | 'peace' {
    const indexUp = this.fingerUp(lm, 8, 6);
    const middleUp = this.fingerUp(lm, 12, 10);
    const ringDown = this.fingerDown(lm, 16, 14);
    const pinkyDown = this.fingerDown(lm, 20, 18);
    const fist = this.fingerDown(lm, 8, 6) && this.fingerDown(lm, 12, 10) && ringDown && pinkyDown;
    if (fist) return 'none';
    if (indexUp && middleUp && ringDown && pinkyDown) return 'peace';
    return 'draw';
  }
  closestStroke(screenX: number, screenY: number, thr: number) {
    let best = -1,
      bestD = thr;
    this.strokes.forEach((s, si) => {
      const worldPts = s.type && s.type !== 'freehand' ? this.shapePoints(s) : s.pts || [];
      for (const p of worldPts) {
        const sp = this.worldToScreen(p.x + s.ox, p.y + s.oy);
        const d = Math.hypot(sp.x - screenX, sp.y - screenY);
        if (d < bestD) {
          bestD = d;
          best = si;
        }
      }
    });
    return best;
  }

  // Paint-bucket fill, MS-Paint style: point inside a closed shape and the
  // enclosed transparent pixels get filled with the current color. Reads
  // the actual rendered pixels of drawCanvas, so it works for any
  // combination of freehand/line/circle/rect strokes forming a boundary.
  doFill(screenX: number, screenY: number) {
    const w = this.drawCanvas.width,
      h = this.drawCanvas.height;
    const sx = Math.round(screenX),
      sy = Math.round(screenY);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;

    const imgData = this.drawCtx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const ALPHA_WALL = 40; // pixels at/above this alpha count as a boundary line
    const seedIdx = (sy * w + sx) * 4;
    if (data[seedIdx + 3] >= ALPHA_WALL) {
      this.cb.onHint('🪣 Point inside the shape, not on the line');
      return;
    }

    const visited = new Uint8Array(w * h);
    const stack: number[] = [sx, sy];
    let minX = sx,
      maxX = sx,
      minY = sy,
      maxY = sy;
    let count = 0;
    const maxAllowed = w * h * 0.6; // if we blow past this, the shape isn't closed

    while (stack.length) {
      const y = stack.pop()!;
      const x = stack.pop()!;
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      const i = y * w + x;
      if (visited[i]) continue;
      const di = i * 4;
      if (data[di + 3] >= ALPHA_WALL) continue;
      visited[i] = 1;
      count++;
      if (count > maxAllowed) {
        this.cb.onHint('🪣 Shape isn\u2019t fully closed — close the gap and try again');
        return;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }

    const bw = maxX - minX + 1,
      bh = maxY - minY + 1;
    const patch = document.createElement('canvas');
    patch.width = bw;
    patch.height = bh;
    const pctx = patch.getContext('2d')!;
    const patchData = pctx.createImageData(bw, bh);
    const { r, g, b } = this.color;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = y * w + x;
        if (!visited[i]) continue;
        const pi = ((y - minY) * bw + (x - minX)) * 4;
        patchData.data[pi] = r;
        patchData.data[pi + 1] = g;
        patchData.data[pi + 2] = b;
        patchData.data[pi + 3] = 235;
      }
    }
    pctx.putImageData(patchData, 0, 0);

    const topLeft = this.screenToWorld(minX, minY);
    const bottomRight = this.screenToWorld(minX + bw, minY + bh);
    const dataUrl = patch.toDataURL('image/png');

    const s: Stroke = {
      type: 'fill',
      col: { ...this.color },
      size: this.brushSize,
      erase: false,
      ox: 0,
      oy: 0,
      imgSrc: dataUrl,
      wx: topLeft.x,
      wy: topLeft.y,
      ww: bottomRight.x - topLeft.x,
      wh: bottomRight.y - topLeft.y,
    };

    const img = new Image();
    img.onload = () => this.redrawAll();
    img.src = dataUrl;

    this.strokes.push(s);
    this.fillImageCache.set(s, img);
    this.redrawAll();
    this.cb.onStrokesChanged();
    this.cb.onHint('🪣 Filled');
  }

  roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  drawPiP(img: CanvasImageSource) {
    if (!img) return;
    const W = this.bgCanvas.width,
      H = this.bgCanvas.height;
    const pw = Math.min(200, W * 0.24),
      ph = pw * 0.75,
      margin = 18;
    const px = this.pipPosition === 'right' ? W - pw - margin : margin;
    const py = H - ph - margin;
    const ctx = this.bgCtx;

    ctx.save();
    ctx.shadowBlur = 20;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    this.roundedRectPath(ctx, px, py, pw, ph, 14);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();

    ctx.save();
    this.roundedRectPath(ctx, px, py, pw, ph, 14);
    ctx.clip();
    ctx.translate(px + pw, py);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0, pw, ph);
    ctx.restore();

    ctx.save();
    this.roundedRectPath(ctx, px, py, pw, ph, 14);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,220,255,0.55)';
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(0,220,255,0.5)';
    ctx.stroke();
    ctx.restore();
  }

  onResults = (results: any) => {
    if (this.destroyed || this.cameraOffForIdle) return;
    if (!this.mpReady) {
      this.mpReady = true;
      this.cb.onReady();
      this.cb.onHint(DEFAULT_HINT);
    }
    if (this.isReplaying) return;

    const W = this.bgCanvas.width,
      H = this.bgCanvas.height;
    if (this.canvasMode) {
      this.bgCtx.fillStyle = '#ffffff';
      this.bgCtx.fillRect(0, 0, W, H);
      this.drawPiP(results.image);
    } else if (this.camPaused && this.bgImage) {
      this.bgCtx.fillStyle = '#000';
      this.bgCtx.fillRect(0, 0, W, H);
      const scale = Math.min(W / this.bgImage.width, H / this.bgImage.height);
      const iw = this.bgImage.width * scale,
        ih = this.bgImage.height * scale;
      this.bgCtx.drawImage(this.bgImage, (W - iw) / 2, (H - ih) / 2, iw, ih);
    } else if (this.camPaused) {
      // FIX: camera paused but no bg image was ever set (e.g. the user just
      // hit "Toggle camera" on its own). Previously this fell through to the
      // `else` branch below and kept redrawing the live webcam feed every
      // frame, so pausing appeared to do nothing at all. Now we simply stop
      // repainting the background — whatever was last drawn there (the last
      // live frame) stays frozen on screen until the camera is unpaused.
    } else {
      this.bgCtx.save();
      this.bgCtx.scale(-1, 1);
      if (results.image) this.bgCtx.drawImage(results.image, -W, 0, W, H);
      this.bgCtx.restore();
      this.bgCtx.fillStyle = 'rgba(0,0,0,0.18)';
      this.bgCtx.fillRect(0, 0, W, H);
    }

    const detected = results.multiHandLandmarks || [];
    if (!detected.length) {
      this.handMissStreak++;
      if (this.handMissStreak <= HAND_MISS_GRACE_FRAMES) return;
      this.commitActiveStroke();
      this.commitShape();
      this.isDragging = false;
      this.dragStrokeIdx = -1;
      this.isPanning = false;
      this.cb.onDot(false, 0, 0, 0, '', '');
      this.cb.onModeBadge('', '');
      this.cb.onHint(DEFAULT_HINT);
      this.confirmedGesture = 'none';
      this.peaceStreak = 0;
      this.fillTriggered = false;
      if (this.lastHandSeen > 0 && Date.now() - this.lastHandSeen >= IDLE_CAMERA_OFF_MS) {
        this.hibernate();
      }
      return;
    }
    this.handMissStreak = 0;
    this.lastHandSeen = Date.now();

    const lm = detected[0];
    const rawX = (1 - lm[8].x) * W;
    const rawY = lm[8].y * H;
    const pos = this.smooth(rawX, rawY);
    const world = this.screenToWorld(pos.x, pos.y);
    const rawGesture = this.getGesture(lm);
    let g: 'none' | 'draw' | 'peace';
    if (rawGesture === 'none') {
      // Fist / closed hand — stop drawing immediately, no confirm delay.
      // (Debounce is only useful for the draw<->peace ambiguity below; a
      // closed fist is unambiguous and should cut the stroke right away.)
      this.peaceStreak = 0;
      this.confirmedGesture = 'none';
      g = 'none';
    } else if (rawGesture === 'peace') {
      this.peaceStreak++;
      if (this.peaceStreak >= PEACE_CONFIRM_FRAMES) {
        this.confirmedGesture = 'peace';
        g = 'peace';
      } else {
        g = this.confirmedGesture === 'peace' ? 'peace' : 'draw';
      }
    } else {
      this.peaceStreak = 0;
      this.confirmedGesture = 'draw';
      g = 'draw';
    }
    const dc = g === 'peace' ? { r: 255, g: 220, b: 0 } : this.isEraser ? { r: 255, g: 160, b: 50 } : this.color;

    this.cb.onDot(
      true,
      pos.x,
      pos.y,
      this.brushSize * 2 + 6,
      `rgba(${dc.r},${dc.g},${dc.b},0.85)`,
      `0 0 ${this.brushSize * 3}px rgba(${dc.r},${dc.g},${dc.b},0.9)`
    );

    if (g === 'peace') {
      this.fillTriggered = false;
      this.commitActiveStroke();
      this.commitShape();
      if (!this.isDragging && !this.isPanning) {
        const idx = this.closestStroke(pos.x, pos.y, 80);
        if (idx !== -1) {
          this.isDragging = true;
          this.dragStrokeIdx = idx;
          this.dragStartX = world.x;
          this.dragStartY = world.y;
          this.dragOrigOX = this.strokes[idx].ox;
          this.dragOrigOY = this.strokes[idx].oy;
          this.rebuildCache(idx);
        } else {
          this.isPanning = true;
          this.panStartX = pos.x;
          this.panStartY = pos.y;
          this.panOrigOffX = this.viewOffX;
          this.panOrigOffY = this.viewOffY;
        }
      } else if (this.isDragging) {
        this.strokes[this.dragStrokeIdx].ox = this.dragOrigOX + (world.x - this.dragStartX);
        this.strokes[this.dragStrokeIdx].oy = this.dragOrigOY + (world.y - this.dragStartY);
        this.fastComposite();
        this.renderStroke(this.drawCtx, this.strokes[this.dragStrokeIdx]);
        this.cb.onStrokesChanged();
        this.cb.onHint('✌️ Moving stroke');
        this.cb.onModeBadge('move', '✌️ MOVE');
      } else if (this.isPanning) {
        this.viewOffX = this.panOrigOffX + (pos.x - this.panStartX);
        this.viewOffY = this.panOrigOffY + (pos.y - this.panStartY);
        this.fastComposite();
        this.cb.onHint('✌️ Panning canvas');
        this.cb.onModeBadge('pan', '✌️ PAN');
      }
      return;
    }

    if (this.isDragging) {
      this.isDragging = false;
      this.dragStrokeIdx = -1;
      this.redrawAll();
    }
    if (this.isPanning) this.isPanning = false;

    if (g === 'draw') {
      if (this.currentTool === 'fill') {
        this.cb.onHint('🪣 Point inside a shape to fill');
        this.cb.onModeBadge('draw', '🪣 FILL');
        if (!this.fillTriggered) {
          this.fillTriggered = true;
          this.doFill(pos.x, pos.y);
        }
        return;
      }
      if (this.currentTool === 'freehand') {
        this.cb.onHint('✏️ Drawing…');
        this.cb.onModeBadge('draw', '🖐 DRAW');
        if (!this.wasDrawing) {
          this.wasDrawing = true;
          this.activeCol = { ...this.color };
          this.activePts = [{ x: world.x, y: world.y }];
        } else {
          const last = this.activePts[this.activePts.length - 1];
          if (Math.hypot(world.x - last.x, world.y - last.y) > 1 / this.viewScale) {
            this.activePts.push({ x: world.x, y: world.y });
            if (this.activePts.length >= 2) {
              const prev = this.activePts[this.activePts.length - 2];
              const p0 = this.worldToScreen(prev.x, prev.y),
                p1 = this.worldToScreen(world.x, world.y);
              this.neonSeg(
                this.drawCtx,
                p0.x,
                p0.y,
                p1.x,
                p1.y,
                this.activeCol.r,
                this.activeCol.g,
                this.activeCol.b,
                this.brushSize * this.viewScale,
                this.isEraser
              );
            }
          }
        }
      } else {
        const label = { line: 'Line', circle: 'Circle', rect: 'Rectangle' }[this.currentTool];
        this.cb.onHint('✏️ Drawing ' + label + '…');
        this.cb.onModeBadge('draw', '🖐 ' + label!.toUpperCase());
        if (!this.shapeStart) this.shapeStart = { x: world.x, y: world.y };
        this.shapeLive = { x: world.x, y: world.y };
        this.fastComposite();
        const preview: Stroke = {
          type: this.currentTool,
          a: this.shapeStart,
          b: this.shapeLive as Pt,
          col: { ...this.color },
          col2: this.gradientOn ? this.hueRotate(this.color, 140) : null,
          size: this.brushSize,
          erase: this.isEraser,
          ox: 0,
          oy: 0,
        };
        this.renderStroke(this.drawCtx, preview);
      }
      return;
    }

    // g === 'none' -> fist detected, stop immediately.
    this.fillTriggered = false;
    this.commitActiveStroke();
    this.commitShape();
    this.cb.onModeBadge('', '');
    this.cb.onHint(DEFAULT_HINT);
  };

  // Releases the webcam entirely (idle timeout, or the user left the canvas /
  // opened the admin page). The frame loop stops, so waking needs a tap or a
  // route back into the studio via resumeCamera().
  hibernate() {
    if (this.cameraOffForIdle || this.destroyed) return;
    this.cameraOffForIdle = true;
    this.confirmedGesture = 'none';
    this.peaceStreak = 0;
    try {
      this.camera?.stop?.();
    } catch {}
    try {
      this.stream?.getTracks().forEach((t) => t.stop());
    } catch {}
    this.stream = null;
    this.cam.srcObject = null;
    this.cb.onCamIdle?.();
  }

  async resumeCamera() {
    if (!this.cameraOffForIdle || this.destroyed) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch {
      return false;
    }
    this.cam.srcObject = this.stream;
    try {
      await this.cam.play();
    } catch {}
    this.cameraOffForIdle = false;
    this.lastHandSeen = Date.now();
    try {
      await this.camera?.start?.();
    } catch {}
    this.cb.onCamWake?.();
    if (!this.camPaused) this.cb.onHint(DEFAULT_HINT);
    return true;
  }

  async start() {
    this.cameraOffForIdle = false;
    this.lastHandSeen = 0;
    this.cb.onProgress(5, 'Loading MediaPipe camera utils…');
    try {
      await loadScriptWithFallbacks([
        'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js',
        'https://unpkg.com/@mediapipe/camera_utils@0.3/camera_utils.js',
        'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1666577135/camera_utils.js',
      ]);
    } catch {
      this.cb.onProgress(5, '⚠ Failed to load camera_utils — try a different browser or disable extensions');
      return;
    }

    this.cb.onProgress(25, 'Loading hand tracking script…');
    try {
      await loadScriptWithFallbacks([
        'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js',
        'https://unpkg.com/@mediapipe/hands@0.4/hands.js',
        'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/hands.js',
      ]);
    } catch {
      this.cb.onProgress(25, '⚠ Failed to load hands.js — try a different browser or disable extensions');
      return;
    }

    this.cb.onProgress(45, 'Requesting webcam…');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch {
      this.cb.onProgress(45, '⚠ Camera denied — click the 🔒 icon in the address bar, allow camera, then reload');
      return;
    }

    this.cam.srcObject = this.stream;
    this.cb.onProgress(60, 'Waiting for video…');

    try {
      await Promise.race([
        new Promise<void>((res) => {
          if (this.cam.readyState >= 2) {
            this.cam.play();
            res();
            return;
          }
          this.cam.onloadedmetadata = () => {
            this.cam.play();
            res();
          };
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000)),
      ]);
    } catch {
      this.cb.onProgress(60, '⚠ Video stream timed out — reload the page');
      return;
    }

    this.cb.onProgress(75, 'Building hand model… (first visit downloads ~10 MB)');

    try {
      const Hands = (window as any).Hands;
      this.hands = new Hands({ locateFile: (f: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
      this.hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.8, minTrackingConfidence: 0.75 });
      this.hands.onResults(this.onResults);
    } catch {
      this.cb.onProgress(75, '⚠ Failed to initialise hand model — reload and try again');
      return;
    }

    this.cb.onProgress(90, 'Starting frame loop… (almost there)');

    try {
      const Camera = (window as any).Camera;
      this.camera = new Camera(this.cam, {
        onFrame: async () => {
          try {
            await this.hands.send({ image: this.cam });
          } catch {}
        },
        width: 1280,
        height: 720,
      });
      this.camera.start();
    } catch {
      this.cb.onProgress(90, '⚠ Could not start camera loop — reload and try again');
    }
  }

  destroy() {
    this.destroyed = true;
    try {
      this.camera?.stop?.();
    } catch {}
    try {
      this.stream?.getTracks().forEach((t) => t.stop());
    } catch {}
  }
}