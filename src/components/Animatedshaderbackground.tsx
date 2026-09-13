import { useRef, useEffect } from 'react';

/**
 * Full-bleed animated, pointer-reactive WebGL2 shader background.
 * Adapted from the "animated-shader-hero" component for this Vite + React
 * setup (no Next.js `style jsx`, no headline/button UI baked in — just the
 * canvas, so LandingScreen and LoginScreen can lay their own content on top).
 * Recolored to the app's coral (--accent) / violet (--accent2) / navy palette.
 * Renders nothing (empty canvas) if the browser has no WebGL2 support.
 */

const vertexSrc = `#version 300 es
precision highp float;
in vec4 position;
void main(){gl_Position=position;}`;

const fragmentSrc = `#version 300 es
precision highp float;
out vec4 O;
uniform vec2 resolution;
uniform float time;
uniform vec2 move;
uniform vec2 touch;
uniform int pointerCount;
uniform vec2 pointers[10];
#define FC gl_FragCoord.xy
#define T time
#define R resolution
#define MN min(R.x,R.y)
float rnd(vec2 p) {
  p=fract(p*vec2(12.9898,78.233));
  p+=dot(p,p+34.56);
  return fract(p.x*p.y);
}
float noise(in vec2 p) {
  vec2 i=floor(p), f=fract(p), u=f*f*(3.-2.*f);
  float
  a=rnd(i),
  b=rnd(i+vec2(1,0)),
  c=rnd(i+vec2(0,1)),
  d=rnd(i+1.);
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float fbm(vec2 p) {
  float t=.0, a=1.; mat2 m=mat2(1.,-.5,.2,1.2);
  for (int i=0; i<5; i++) {
    t+=a*noise(p);
    p*=2.*m;
    a*=.5;
  }
  return t;
}
float clouds(vec2 p) {
	float d=1., t=.0;
	for (float i=.0; i<3.; i++) {
		float a=d*fbm(i*10.+p.x*.2+.2*(1.+i)*p.y+d+i*i+p);
		t=mix(t,d,a);
		d=a;
		p*=2./(i+1.);
	}
	return t;
}
void main(void) {
	vec2 uv=(FC-.5*R)/MN,st=uv*vec2(2,1);
	vec3 col=vec3(0);
  // palette: soft periwinkle base -> coral (#ff6b4a) + sky violet sparks
  vec3 coral=vec3(1.0,0.42,0.29);
  vec3 violet=vec3(0.49,0.36,0.96);
	vec3 base=vec3(0.93,0.96,1.0);

	// gentle pointer influence: nudges the field toward the cursor/touch
	vec2 mv=move*0.00035;
	float touchPull=0.0;
	if (pointerCount > 0) {
		vec2 tuv=(touch-.5*R)/MN;
		touchPull=1.0/(length(uv-tuv)*4.0+0.6);
	}

	float bg=clouds(vec2(st.x+T*.5,-st.y)+mv);
	uv+=mv*0.6;
	uv*=1.-.3*(sin(T*.2)*.5+.5);
	for (float i=1.; i<12.; i++) {
		uv+=.1*cos(i*vec2(.1+.01*i, .8)+i*i+T*.5+.1*uv.x);
		vec2 p=uv;
		float d=length(p);
		vec3 spark=mix(coral,violet,sin(i*.8)*.5+.5);
		col+=.00125/d*(spark+.15)*(1.0+touchPull*0.6);
		float b=noise(i+p+bg*1.731);
		col+=.0022*b/length(max(p,vec2(b*p.x*.02,p.y)))*mix(coral,violet,b);
		col=mix(col,base+bg*vec3(0.06,0.05,0.04),d*.85);
	}
	O=vec4(col,1);
}`;

class WebGLRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private vs: WebGLShader | null = null;
  private fs: WebGLShader | null = null;
  private buffer: WebGLBuffer | null = null;
  private scale: number;
  private vertices = [-1, 1, -1, -1, 1, 1, 1, -1];
  private mouseMove = [0, 0];
  private mouseCoords = [0, 0];
  private pointerCoords: number[] = [0, 0];
  private nbrOfPointers = 0;

  constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, scale: number) {
    this.canvas = canvas;
    this.gl = gl;
    this.scale = scale;
    this.gl.viewport(0, 0, canvas.width * scale, canvas.height * scale);
  }

  updateScale(scale: number) {
    this.scale = scale;
    this.gl.viewport(0, 0, this.canvas.width * scale, this.canvas.height * scale);
  }
  updateMove(deltas: number[]) { this.mouseMove = deltas; }
  updateMouse(coords: number[]) { this.mouseCoords = coords; }
  updatePointerCoords(coords: number[]) { this.pointerCoords = coords; }
  updatePointerCount(nbr: number) { this.nbrOfPointers = nbr; }

  private compile(shader: WebGLShader, source: string) {
    const gl = this.gl;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    }
  }

  setup() {
    const gl = this.gl;
    this.vs = gl.createShader(gl.VERTEX_SHADER)!;
    this.fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    this.compile(this.vs, vertexSrc);
    this.compile(this.fs, fragmentSrc);
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, this.vs);
    gl.attachShader(this.program, this.fs);
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(this.program));
    }
  }

  init() {
    const gl = this.gl;
    const program = this.program!;
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.vertices), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    (program as any).resolution = gl.getUniformLocation(program, 'resolution');
    (program as any).time = gl.getUniformLocation(program, 'time');
    (program as any).move = gl.getUniformLocation(program, 'move');
    (program as any).touch = gl.getUniformLocation(program, 'touch');
    (program as any).pointerCount = gl.getUniformLocation(program, 'pointerCount');
    (program as any).pointers = gl.getUniformLocation(program, 'pointers');
  }

  render(now = 0) {
    const gl = this.gl;
    const program = this.program;
    if (!program || gl.getProgramParameter(program, gl.DELETE_STATUS)) return;
    gl.clearColor(0.93, 0.96, 1.0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.uniform2f((program as any).resolution, this.canvas.width, this.canvas.height);
    gl.uniform1f((program as any).time, now * 1e-3);
    gl.uniform2f((program as any).move, this.mouseMove[0] || 0, this.mouseMove[1] || 0);
    gl.uniform2f((program as any).touch, this.mouseCoords[0] || 0, this.mouseCoords[1] || 0);
    gl.uniform1i((program as any).pointerCount, this.nbrOfPointers);
    const padded = this.pointerCoords.length ? this.pointerCoords : [0, 0];
    gl.uniform2fv((program as any).pointers, padded);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    const gl = this.gl;
    if (this.program) {
      if (this.vs) { gl.detachShader(this.program, this.vs); gl.deleteShader(this.vs); }
      if (this.fs) { gl.detachShader(this.program, this.fs); gl.deleteShader(this.fs); }
      gl.deleteProgram(this.program);
    }
  }
}

class PointerHandler {
  private active = false;
  private pointers = new Map<number, number[]>();
  private lastCoords = [0, 0];
  private moves = [0, 0];
  private cleanup: () => void;

  constructor(element: HTMLElement, canvas: HTMLCanvasElement, getScale: () => number) {
    const map = (x: number, y: number) => {
      const rect = canvas.getBoundingClientRect();
      const scale = getScale();
      const localX = (x - rect.left) * (canvas.width / rect.width) * (scale / getScale());
      const localY = (y - rect.top) * (canvas.height / rect.height);
      return [localX * getScale() === localX ? localX : (x - rect.left) * (canvas.width / rect.width), canvas.height - (y - rect.top) * (canvas.height / rect.height)];
    };

    const onDown = (e: PointerEvent) => {
      this.active = true;
      this.pointers.set(e.pointerId, map(e.clientX, e.clientY));
    };
    const onUp = (e: PointerEvent) => {
      if (this.count === 1) this.lastCoords = this.first;
      this.pointers.delete(e.pointerId);
      this.active = this.pointers.size > 0;
    };
    const onMove = (e: PointerEvent) => {
      this.lastCoords = [e.clientX, e.clientY];
      if (this.active) {
        this.pointers.set(e.pointerId, map(e.clientX, e.clientY));
      }
      this.moves = [this.moves[0] + e.movementX, this.moves[1] + e.movementY];
    };

    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointerleave', onUp);
    element.addEventListener('pointermove', onMove);

    this.cleanup = () => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointerleave', onUp);
      element.removeEventListener('pointermove', onMove);
    };
  }

  get count() { return this.pointers.size; }
  get move() { return this.moves; }
  get coords() { return this.pointers.size > 0 ? Array.from(this.pointers.values()).flat() : [0, 0]; }
  get first() { return this.pointers.size > 0 ? (this.pointers.values().next().value as number[]) : this.lastCoords; }
  destroy() { this.cleanup(); }
}

interface Props {
  className?: string;
}

export default function AnimatedShaderBackground({ className = '' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const pointersRef = useRef<PointerHandler | null>(null);
  const rafRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2');
    if (!gl) return; // graceful no-op on unsupported browsers

    const dpr = Math.max(1, 0.5 * window.devicePixelRatio);
    const renderer = new WebGLRenderer(canvas, gl, dpr);
    rendererRef.current = renderer;

    const pointers = new PointerHandler(canvas, canvas, () => dpr);
    pointersRef.current = pointers;

    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      renderer.updateScale(dpr);
    };

    renderer.setup();
    renderer.init();
    resize();

    const loop = (now: number) => {
      renderer.updateMouse(pointers.first);
      renderer.updatePointerCount(pointers.count);
      renderer.updatePointerCoords(pointers.coords);
      renderer.updateMove(pointers.move);
      renderer.render(now);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      pointers.destroy();
      renderer.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 w-full h-full object-contain touch-none ${className}`}
      style={{ background: '#e9eeff' }}
    />
  );
}