// Renders a set of Stroke objects onto a plain <canvas> (white background,
// normalized to fit) so battle entries and admin drawing previews can be
// shown anywhere without running the live engine. Mirrors the engine's
// neon stroke rendering with a fixed identity transform.

import type { Stroke, Pt } from './engine';

function shapePoints(s: Stroke): Pt[] {
  if (s.type === 'line') return [s.a!, s.b!];
  if (s.type === 'rect') {
    const { a, b } = s as { a: Pt; b: Pt };
    return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a];
  }
  if (s.type === 'circle') {
    const a = s.a!;
    const b = s.b!;
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const rx = Math.abs(b.x - a.x) / 2;
    const ry = Math.abs(b.y - a.y) / 2;
    const pts: Pt[] = [];
    for (let i = 0; i <= 32; i++) {
      const t = (i / 32) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry });
    }
    return pts;
  }
  return s.pts || [];
}

function neonSeg(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, r: number, g: number, b: number, sz: number, erase: boolean) {
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
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  if (s.type === 'fill') {
    if (s.imgSrc) {
      const img = new Image();
      img.onload = () => {
        if (s.wx != null && s.ww != null && s.wh != null) {
          ctx.drawImage(img, (s.wx || 0) + s.ox, (s.wy || 0) + s.oy, s.ww, s.wh);
        }
      };
      img.src = s.imgSrc;
    }
    return;
  }
  const isShape = s.type && s.type !== 'freehand';
  const worldPts = isShape ? shapePoints(s) : s.pts || [];
  const col = s.col;
  const col2 = s.col2;
  for (let i = 1; i < worldPts.length; i++) {
    const p0 = worldPts[i - 1];
    const p1 = worldPts[i];
    if (!isShape && Math.hypot(p1.x - p0.x, p1.y - p0.y) > 260) continue;
    let c = col;
    if (col2) {
      const t = i / Math.max(1, worldPts.length - 1);
      c = {
        r: Math.round(col.r + (col2.r - col.r) * t),
        g: Math.round(col.g + (col2.g - col.g) * t),
        b: Math.round(col.b + (col2.b - col.b) * t),
      };
    }
    neonSeg(ctx, p0.x + s.ox, p0.y + s.oy, p1.x + s.ox, p1.y + s.oy, c.r, c.g, c.b, Math.max(s.size, 0.8), s.erase);
  }
}

export function renderStrokesToCanvas(canvas: HTMLCanvasElement, strokes: Stroke[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  if (!strokes?.length) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const absorb = (p: Pt) => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  };
  for (const s of strokes) {
    const ox = s.ox || 0;
    const oy = s.oy || 0;
    if (s.type === 'fill') {
      if (s.wx != null && s.ww != null) {
        absorb({ x: ox + (s.wx || 0), y: oy + (s.wy || 0) });
        absorb({ x: ox + (s.wx || 0) + (s.ww || 0), y: oy + (s.wy || 0) + (s.wh || 0) });
      }
    } else if (s.type && s.type !== 'freehand') {
      for (const p of shapePoints(s)) absorb({ x: p.x + ox, y: p.y + oy });
    } else {
      for (const p of s.pts || []) absorb({ x: p.x + ox, y: p.y + oy });
    }
  }
  if (!isFinite(minX) || !isFinite(minY)) return;

  const pad = 28;
  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);
  const scale = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
  ctx.save();
  ctx.translate(pad + (W - 2 * pad - bw * scale) / 2 - minX * scale, pad + (H - 2 * pad - bh * scale) / 2 - minY * scale);
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) drawStroke(ctx, s);
  ctx.restore();
}