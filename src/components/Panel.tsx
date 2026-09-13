import { useEffect, useRef, useState } from 'react';
import {
  Menu,
  Pencil,
  Slash,
  Circle,
  Square,
  PaintBucket,
  Eraser,
  Undo2,
  Trash2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Image as ImageIcon,
  Camera,
  Paintbrush,
  FlipHorizontal2,
  Download,
  Play,
  Video,
  Sun,
  Moon,
  Sparkles,
  Plus,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import type { Color, ToolType } from '../lib/engine';

const SWATCHES: Color[] = [
  { r: 0, g: 220, b: 255 },
  { r: 255, g: 0, b: 200 },
  { r: 255, g: 230, b: 0 },
  { r: 60, g: 255, b: 100 },
  { r: 255, g: 255, b: 255 },
  { r: 180, g: 80, b: 255 },
  { r: 255, g: 80, b: 30 },
  { r: 255, g: 140, b: 200 },
  { r: 90, g: 160, b: 255 },
  { r: 0, g: 255, b: 170 },
  { r: 255, g: 210, b: 120 },
  { r: 140, g: 255, b: 60 },
];

const TOOLS: { id: ToolType; label: string; Icon: typeof Pencil }[] = [
  { id: 'freehand', label: 'Freehand', Icon: Pencil },
  { id: 'line', label: 'Line', Icon: Slash },
  { id: 'circle', label: 'Circle', Icon: Circle },
  { id: 'rect', label: 'Rectangle', Icon: Square },
  { id: 'fill', label: 'Fill', Icon: PaintBucket },
];

function rgbToHex(c: Color) {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}
function hexToRgb(hex: string): Color {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

interface Props {
  collapsed: boolean;
  color: Color;
  onColor: (c: Color) => void;
  tool: ToolType;
  onTool: (t: ToolType) => void;
  gradientOn: boolean;
  onGradient: () => void;
  size: number;
  onSize: (v: number) => void;
  isEraser: boolean;
  onEraser: () => void;
  onUndo: () => void;
  onClear: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onBgImage: () => void;
  camPaused: boolean;
  onCamToggle: () => void;
  canvasMode: boolean;
  onCanvasMode: () => void;
  onPipFlip: () => void;
  transparentExport: boolean;
  onTransparent: () => void;
  onExport: () => void;
  onReplay: () => void;
  onRecord: () => void;
  recording: boolean;
  theme: 'dark' | 'light';
  onTheme: () => void;
}

const SCROLL_STEP = 9;
const SCROLL_INTERVAL_MS = 16;

export default function Panel(p: Props) {
  const sameColor = (c: Color) => c.r === p.color.r && c.g === p.color.g && c.b === p.color.b;
  const isCustomColor = !p.isEraser && !SWATCHES.some(sameColor);

  const [expanded, setExpanded] = useState(false);
  const customInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<number | null>(null);

  const stopScroll = () => {
    if (scrollTimerRef.current !== null) {
      window.clearInterval(scrollTimerRef.current);
      scrollTimerRef.current = null;
    }
  };
  const startScroll = (dir: 1 | -1) => {
    stopScroll();
    if (scrollRef.current) scrollRef.current.scrollTop += dir * SCROLL_STEP;
    scrollTimerRef.current = window.setInterval(() => {
      if (scrollRef.current) scrollRef.current.scrollTop += dir * SCROLL_STEP;
    }, SCROLL_INTERVAL_MS);
  };

  useEffect(() => {
    window.addEventListener('pointerup', stopScroll);
    window.addEventListener('pointercancel', stopScroll);
    return () => {
      window.removeEventListener('pointerup', stopScroll);
      window.removeEventListener('pointercancel', stopScroll);
      stopScroll();
    };
  }, []);

  const activeToolLabel = p.isEraser ? 'Eraser' : TOOLS.find((t) => t.id === p.tool)?.label || 'Freehand';

  function Row({
    Icon,
    label,
    active,
    onClick,
    title,
  }: {
    Icon: typeof Pencil;
    label: string;
    active?: boolean;
    onClick: () => void;
    title?: string;
  }) {
    return (
      <button type="button" className={'ibtn-labeled' + (active ? ' active' : '')} onClick={onClick} title={title || label}>
        <Icon size={15} strokeWidth={2} />
        {expanded && <span>{label}</span>}
      </button>
    );
  }

  return (
    <div className={'panel' + (p.collapsed ? ' collapsed' : '') + (expanded ? ' expanded' : '')}>
      <div className="panel-scroll-btn top" title="Scroll up" onPointerDown={() => startScroll(-1)} onPointerUp={stopScroll} onPointerLeave={stopScroll} onPointerCancel={stopScroll}>
        <ChevronUp size={18} />
      </div>

      <div className="panel-scroll-inner" ref={scrollRef}>
        {/* hamburger + current-mode readout */}
        <div className="panel-header" onClick={() => setExpanded((v) => !v)} title="Toggle labels">
          <Menu size={20} />
          {expanded && (
            <div className="panel-header-status">
              <span
                className="panel-header-dot"
                style={{ background: p.isEraser ? 'transparent' : `rgb(${p.color.r},${p.color.g},${p.color.b})`, borderColor: p.isEraser ? 'rgba(255,255,255,0.5)' : 'transparent' }}
              />
              <span>{activeToolLabel}</span>
            </div>
          )}
        </div>

        <div className="panel-label">Color</div>
        <div className={expanded ? undefined : undefined} style={expanded ? { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, width: '100%' } : undefined}>
          {SWATCHES.map((c, i) => (
            <div
              key={i}
              className={'swatch' + (sameColor(c) && !p.isEraser ? ' active' : '')}
              style={{ background: `rgb(${c.r},${c.g},${c.b})` }}
              onClick={() => p.onColor(c)}
            />
          ))}
          {/* custom color swatch */}
          <div
            className={'swatch swatch-custom' + (isCustomColor ? ' active' : '')}
            style={{
              background: isCustomColor ? `rgb(${p.color.r},${p.color.g},${p.color.b})` : 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)',
            }}
            title="Custom color"
            onClick={() => customInputRef.current?.click()}
          >
            {!isCustomColor && <Plus size={14} color="#fff" style={{ filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.8))' }} />}
          </div>
          <input
            ref={customInputRef}
            type="color"
            value={rgbToHex(p.color)}
            onChange={(e) => p.onColor(hexToRgb(e.target.value))}
            style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
          />
        </div>

        <div className="sep" />
        <div className="panel-label">Tool</div>
        <div className={expanded ? undefined : 'ibtn-row'}>
          {TOOLS.map((t) => (
            <Row key={t.id} Icon={t.Icon} label={t.label} active={p.tool === t.id && !p.isEraser} onClick={() => p.onTool(t.id)} />
          ))}
        </div>
        <Row Icon={Sparkles} label="Gradient stroke" active={p.gradientOn} onClick={p.onGradient} />

        <div className="sep" />
        <div className="size-wrap">
          <div className="size-lbl">Size {expanded ? `— ${p.size}` : ''}</div>
          <div className={expanded ? undefined : 'slider-rotate-wrap'}>
            <input
              className={expanded ? 'size-slider-flat' : 'size-slider'}
              type="range"
              min={0.5}
              max={40}
              step={0.5}
              value={p.size}
              onChange={(e) => p.onSize(+e.target.value)}
            />
          </div>
        </div>

        <div className="sep" />
        <div className={expanded ? undefined : 'ibtn-row'}>
          <Row Icon={Eraser} label="Eraser" active={p.isEraser} onClick={p.onEraser} />
          <Row Icon={Undo2} label="Undo" onClick={p.onUndo} />
          <Row Icon={Trash2} label="Clear" onClick={p.onClear} />
        </div>

        <div className="sep" />
        <div className="panel-label">View</div>
        <div className={expanded ? undefined : 'ibtn-row'}>
          <Row Icon={ZoomIn} label="Zoom in" onClick={p.onZoomIn} />
          <Row Icon={ZoomOut} label="Zoom out" onClick={p.onZoomOut} />
          <Row Icon={RotateCcw} label="Reset view" onClick={p.onZoomReset} />
        </div>

        <div className="sep" />
        <div className="panel-label">Media</div>
        <div className={expanded ? undefined : 'ibtn-row'}>
          <Row Icon={ImageIcon} label="Background image" onClick={p.onBgImage} />
          <Row Icon={Camera} label="Toggle camera" active={p.camPaused} onClick={p.onCamToggle} />
        </div>
        <div className={expanded ? undefined : 'ibtn-row'}>
          <Row Icon={Paintbrush} label="White canvas mode" active={p.canvasMode} onClick={p.onCanvasMode} />
          <Row Icon={FlipHorizontal2} label="Flip camera bubble" onClick={p.onPipFlip} />
        </div>
        <div className={expanded ? undefined : 'ibtn-row'}>
          <Row Icon={Download} label="Export PNG" onClick={p.onExport} />
          <Row Icon={Square} label="Transparent PNG" active={p.transparentExport} onClick={p.onTransparent} />
        </div>
        <div className={expanded ? undefined : 'ibtn-row'}>
          <Row Icon={Play} label="Replay drawing" onClick={p.onReplay} />
          <Row Icon={Video} label="Record video" active={p.recording} onClick={p.onRecord} />
        </div>

        <div className="sep" />
        <Row Icon={p.theme === 'light' ? Moon : Sun} label={p.theme === 'light' ? 'Switch to dark' : 'Switch to light'} onClick={p.onTheme} />
      </div>

      <div className="panel-scroll-btn bottom" title="Scroll down" onPointerDown={() => startScroll(1)} onPointerUp={stopScroll} onPointerLeave={stopScroll} onPointerCancel={stopScroll}>
        <ChevronDown size={18} />
      </div>
    </div>
  );
}