import { useEffect, useRef } from 'react';
import { useFrame, useReducedMotion } from './beat';

/**
 * The light behind the page.
 *
 * A single full-viewport WebGL canvas, fixed, sitting under everything. It
 * draws seven spectral ribbons through a warped haze, rings out on every bar,
 * and flares when someone hits a pad further down the page. The palette runs
 * from the deck-A blue to the console accent, crossfaded by how far down the
 * page you are — so the page literally changes colour as you read it.
 *
 * Rules it keeps:
 *  - No dependency. It is ~120 lines of GLSL and a quad; a 600KB 3D library to
 *    draw a full-screen shader would be the whole bundle for one background.
 *  - It never blocks the page. If WebGL is missing, refused or lost, the class
 *    falls back to a CSS wash that looks like the same idea, more quietly.
 *  - It stops when it is not being watched — hidden tab, or reduced motion, in
 *    which case it paints one still frame and shuts the loop down.
 */

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform float uBeat;     // 0 -> 1, once per beat
uniform float uBar;      // 0 -> 1, once per bar
uniform float uEnergy;   // pad hits, decaying
uniform vec2  uPointer;  // -1 .. 1, eased
uniform float uScroll;   // 0 .. 1 down the page

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec2 p = uv + uPointer * 0.055;

  // A sharp attack that falls away across the beat: the same shape as a
  // gain-reduction needle, which is what makes it read as musical rather
  // than as a blinking light.
  float pulse = pow(1.0 - uBeat, 3.0);
  float lift = 0.62 + 0.38 * pulse + uEnergy * 0.55;

  vec3 blue  = vec3(0.24, 0.53, 0.87);
  vec3 amber = vec3(1.00, 0.61, 0.17);
  float warm = clamp(uScroll * 1.15, 0.0, 1.0);

  // --- haze ------------------------------------------------------------
  vec2 q = p * 1.2;
  float w = fbm(q + vec2(uTime * 0.031, uTime * -0.019) + fbm(q * 1.9 + uTime * 0.017) * 0.75);
  vec3 col = mix(blue, amber, clamp(w * 1.25 - 0.2 + warm * 0.5, 0.0, 1.0));
  col *= 0.055 + 0.2 * w;

  // --- ribbons ---------------------------------------------------------
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float speed = 0.2 + fi * 0.07;
    float band = 0.5 + 0.5 * sin(fi * 1.73 + uTime * 0.62);
    float y = (fi - 3.0) * 0.132
            + sin(p.x * (1.45 + fi * 0.38) + uTime * speed * 2.0 + fi * 1.3) * (0.05 + 0.022 * band)
            + (noise(vec2(p.x * 0.85 + uTime * 0.06 * speed, fi * 7.0 + uTime * 0.04)) - 0.5) * 0.44;
    float d = abs(p.y - y);
    float core = 0.0016 + 0.0021 * band;
    float glow = core / (d * d * 55.0 + core);
    vec3 tint = mix(blue, amber, fract(fi / 6.5 + warm * 0.45));
    col += tint * glow * (0.38 + 0.46 * pulse) * lift;
  }

  // --- bars --------------------------------------------------------------
  // One ring leaves the middle every bar, and a second half a bar behind it,
  // so the page keeps a visible count of four.
  float r = length(p * vec2(1.0, 1.18));
  for (int k = 0; k < 2; k++) {
    float age = fract(uBar + float(k) * 0.5);
    float ring = smoothstep(0.05, 0.0, abs(r - age * 1.7)) * (1.0 - age) * (1.0 - age);
    col += mix(blue, amber, warm) * ring * (0.35 + uEnergy * 0.9);
  }

  // --- the twelve columns the console is built on ------------------------
  float gx = abs(fract(p.x * 6.0 + 0.5) - 0.5);
  col += vec3(0.30, 0.40, 0.50) * smoothstep(0.012, 0.0, gx) * (0.045 + 0.03 * pulse);

  // --- finish ------------------------------------------------------------
  col *= 1.0 - 0.6 * smoothstep(0.4, 1.25, length(uv));
  col += (hash(gl_FragCoord.xy * 0.7 + uTime) - 0.5) * 0.028;

  vec3 base = vec3(0.0745, 0.0824, 0.0902);
  gl_FragColor = vec4(max(base + col, 0.0), 1.0);
}
`;

type Rig = {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  uniform: Record<string, WebGLUniformLocation | null>;
};

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function build(canvas: HTMLCanvasElement): Rig | null {
  const gl = (canvas.getContext('webgl', { antialias: false, alpha: false, depth: false }) ??
    canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
  if (!gl) return null;

  const vert = compile(gl, gl.VERTEX_SHADER, VERT);
  const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram();
  if (!vert || !frag || !program) return null;

  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const attribute = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);

  const names = ['uRes', 'uTime', 'uBeat', 'uBar', 'uEnergy', 'uPointer', 'uScroll'];
  const uniform: Rig['uniform'] = {};
  for (const name of names) uniform[name] = gl.getUniformLocation(program, name);

  return { gl, program, uniform };
}

export function Backdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rigRef = useRef<Rig | null>(null);
  const alive = useRef(false);
  // Where the pointer is going, and where the shader has got to — the gap is
  // the parallax easing, which is what stops it feeling glued to the cursor.
  const target = useRef<[number, number]>([0, 0]);
  const eased = useRef<[number, number]>([0, 0]);
  const scroll = useRef(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rig = build(canvas);
    if (!rig) {
      canvas.parentElement?.classList.add('is-flat');
      return;
    }
    rigRef.current = rig;
    alive.current = true;

    // A full-screen shader is fill-rate bound and nothing here is a hard edge,
    // so it renders under-sized and lets the compositor scale it up. The blur
    // that costs is a blur the glow wanted anyway.
    const size = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.72;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
      rig.gl.viewport(0, 0, canvas.width, canvas.height);
    };
    size();

    const onPointer = (event: PointerEvent) => {
      target.current = [
        (event.clientX / window.innerWidth) * 2 - 1,
        1 - (event.clientY / window.innerHeight) * 2,
      ];
    };
    const onLost = (event: Event) => {
      event.preventDefault();
      alive.current = false;
      canvas.parentElement?.classList.add('is-flat');
    };

    window.addEventListener('resize', size);
    window.addEventListener('pointermove', onPointer, { passive: true });
    canvas.addEventListener('webglcontextlost', onLost);

    return () => {
      window.removeEventListener('resize', size);
      window.removeEventListener('pointermove', onPointer);
      canvas.removeEventListener('webglcontextlost', onLost);
      alive.current = false;
      rigRef.current = null;
      // Deliberately not calling `loseContext` here. A canvas hands back the
      // same context every time it is asked, so a forced loss on the way out
      // would leave the remount — StrictMode does exactly this — holding a
      // dead context and falling back for the rest of the visit.
    };
  }, []);

  // Reduced motion still gets a picture — one frame, held. The clock stays
  // unsubscribed, so nothing is running behind the page at all.
  useEffect(() => {
    if (!reduced) return;
    const id = window.setTimeout(() => draw({ t: 4.2, beat: 0.4, bar: 0.2, energy: 0 }), 0);
    return () => window.clearTimeout(id);
  }, [reduced]);

  function draw(frame: { t: number; beat: number; bar: number; energy: number }) {
    const rig = rigRef.current;
    const canvas = canvasRef.current;
    if (!rig || !canvas || !alive.current) return;
    const { gl, uniform } = rig;
    gl.uniform2f(uniform.uRes, canvas.width, canvas.height);
    gl.uniform1f(uniform.uTime, frame.t);
    gl.uniform1f(uniform.uBeat, frame.beat);
    gl.uniform1f(uniform.uBar, frame.bar);
    gl.uniform1f(uniform.uEnergy, frame.energy);
    gl.uniform2f(uniform.uPointer, eased.current[0], eased.current[1]);
    gl.uniform1f(uniform.uScroll, scroll.current);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  useFrame((frame) => {
    if (reduced || document.hidden) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    eased.current = [
      eased.current[0] + (target.current[0] - eased.current[0]) * 0.045,
      eased.current[1] + (target.current[1] - eased.current[1]) * 0.045,
    ];

    // The light stays with you the whole way down, but steps back once the
    // hero has gone by — it is a backdrop for reading at that point. Both
    // numbers come off `scrollY` and the viewport height, never off the
    // document height: that is a layout read, and this runs every frame.
    const past = window.scrollY / Math.max(1, window.innerHeight);
    scroll.current = Math.min(1, past / 5);
    canvas.style.opacity = String(Math.max(0.34, 1 - past * 0.72));

    draw(frame);
  });

  return (
    <div className="home-backdrop" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
