import { useEffect, useRef } from "react";

/**
 * ARGUS, the eye over the city. One small WebGL canvas, one shader pass, no textures.
 * Six bands of armour plates turn round a nine-blade iris; every input is network state:
 *  - aperture: how much of the city is flowing (wide open when free, tight when jammed)
 *  - heat: share of junctions jammed, plates flare with it and the light turns red
 *  - gaze: the eye looks toward the selected junction from the centre of the map
 *  - pulse: a ripple runs through the iris each time fresh readings land
 */
const FS = `#extension GL_OES_standard_derivatives:enable
precision highp float;
uniform float Res,T,Ap,Amp,Turb,Spin,Blade,Glow;uniform vec3 Tint;uniform vec2 Gz;uniform mat3 M;
const float TAU=6.2831853,EXT=1.5,TOP=2.;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec3 env(vec3 r){float a=max(dot(r,vec3(-.55,.65,.52)),0.),b=max(dot(r,vec3(.75,-.27,.6)),0.);
return vec3(.018,.018,.02)+vec3(.86,.87,.9)*(pow(a,46.)*1.6+pow(a,7.)*.18)+Tint*pow(b,14.)*.5+vec3(.16)*exp(-r.y*r.y*24.)*.36;}
void main(){vec2 u=(gl_FragCoord.xy/Res*2.-1.)*EXT;float a=atan(u.y,u.x),r=length(u)/(1.+Amp*.022*sin(a*7.-T*9.)),px=2.*EXT/Res;
float rays=.5+.5*sin(a*13.+T*.31)*sin(a*29.-T*.47)*sin(a*5.+T*.19),d=max(r-1.,0.),e0=max(1.-r/EXT,0.);
vec3 out_=Tint*(exp(-d*8.)*(.26+Glow*.3)+rays*rays*rays*exp(-d*3.8)*(.22+Glow*.4)+exp(-d*d*9000.)*.5)*e0;
vec2 ds=u-Gz;out_+=Tint*exp(-abs(ds.y)*46.)*exp(-abs(ds.x)*1.9)*(.12+Ap*.4)*e0;
float mask=1.-smoothstep(1.-px*1.5,1.,r);vec3 col=vec3(0.);out_*=1.-mask;
if(mask>0.){vec2 sp_=u*min(r,1.)/max(length(u),1e-4);vec3 n=vec3(sp_,sqrt(max(1.-dot(sp_,sp_),0.))),L=M*n;
float th=acos(clamp(L.z,-1.,1.)),ph=atan(L.y,L.x),th0=.5+Ap*.14,H;vec3 glow=vec3(0.);
if(th<th0){float q=th/th0,hole=.16+Ap*.74,w=TAU/9.,k=mod(ph+Blade,w)-w*.5,poly=q*cos(k)/cos(w*.5),bq=fract((ph+Blade-(q-hole)*2.1)/w);
H=bq*.32+smoothstep(.0,.05,bq)*.3;float gl=exp(-max(poly-hole,0.)*9.);glow=Tint*(gl*(.5+Ap)*.7+smoothstep(.07,0.,bq)*(.22+gl*1.1));
if(poly<hole){float c=poly/hole,tn=fract(log(c+.03)*1.15+T*.23+Amp*.6),ring=smoothstep(.13,0.,abs(tn-.5)),fil=pow(.5+.5*sin(ph*11.-Blade*2.+sin(c*9.-T*4.)*1.4),4.),hot=exp(-c*c*3.1);
col=Tint*(.4+fil*.9+ring*.55)*(1.2+Amp*2.)+vec3(1.)*hot*hot*(1.4+Amp*3.);col*=mix(.36,1.,smoothstep(1.,.8,c));H=-1.;}}
else{float bw=(TOP-th0)/6.,b=(th-th0)/bw,i=floor(b),f=b-i,sg=mod(i,2.)*2.-1.,cnt=10.+i*4.,s=(ph+sg*Spin*(1.-i*.09)+i*.7+(f-.5)*.2*sg)/TAU*cnt,sid=floor(s),q=s-sid,id=hash(vec2(mod(sid,cnt),i));
float eq=min(q,1.-q)*TAU/cnt*max(sin(th),.15),ef=min(f,1.-f)*bw,e=min(eq,ef),fire=pow(.5+.5*sin(id*TAU+T*(.8+Turb*7.)-i*.9),10.)*(.18+Turb*1.6+Amp*.9);
float w=.0075+Glow*.0075,sl=exp(-e*e/(w*w)),pl=.55+.45*sin(th*14.-T*2.4+ph*2.)*sin(ph*5.+T*1.1);
H=smoothstep(0.,.032,e)+(id-.5)*.16;glow=(Tint*1.15+vec3(.5)*sl)*sl*pl*(.8+Glow*1.5+fire*1.8)+Tint*fire*.1+Tint*exp(-(th-th0)*4.2)*.3*(.35+Ap);
H-=step(.62,id)*step(.9,fract(f*5.+id*3.))*smoothstep(.02,.05,e)*.035;}
if(H>-.5){vec2 g=vec2(dFdx(H),dFdy(H))/max(px,1e-5)*.018;vec3 N=normalize(n-vec3(clamp(g,-.9,.9),0.)),R=reflect(vec3(0.,0.,-1.),N);float fr=pow(1.-max(N.z,0.),3.);
col=env(R)*(.72+fr*.5)+Tint*fr*.4+glow;col*=mix(.42,1.,smoothstep(-.5,.6,dot(N,vec3(-.42,.5,.75))));}
col+=Tint*exp(-dot(ds,ds)*2.5)*(.08+Ap*.25);}
vec3 o=1.-exp(-(col*mask+out_)*1.25);gl_FragColor=vec4(o,max(mask,max(o.r,max(o.g,o.b))*.82));}`;

export type EyeState = {
  /** 0 = whole city jammed, 1 = everything flowing. */
  aperture: number;
  /** Share of junctions jammed, 0..1. */
  heat: number;
  /** Where to look, each axis -1..1 (x right, y up). */
  gaze: [number, number];
  /** Changes whenever fresh readings land; the eye ripples once. */
  pulseKey: string | null;
};

const WHITE = [0.9, 0.91, 0.94] as const;
const RED = [0.98, 0.24, 0.26] as const;
const mix = (i: 0 | 1 | 2, h: number) => WHITE[i] + (RED[i] - WHITE[i]) * h;

export function ArgusEye({
  state,
  size = 168,
  reducedMotion,
}: {
  state: EyeState;
  size?: number;
  reducedMotion: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef(state);
  live.current = state;
  const pulse = useRef(0);
  const lastKey = useRef<string | null>(null);
  if (state.pulseKey !== lastKey.current) {
    if (lastKey.current !== null) pulse.current = 1;
    lastKey.current = state.pulseKey;
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl", { premultipliedAlpha: false, antialias: false });
    if (!canvas || !gl) return;
    gl.getExtension("OES_standard_derivatives");
    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        console.error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(
      program,
      compile(gl.VERTEX_SHADER, "attribute vec2 p;void main(){gl_Position=vec4(p,0,1);}"),
    );
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(program);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const names = [
      "Res",
      "T",
      "Ap",
      "Amp",
      "Turb",
      "Spin",
      "Blade",
      "Glow",
      "Tint",
      "Gz",
      "M",
    ] as const;
    const u = Object.fromEntries(
      names.map((k) => [k, gl.getUniformLocation(program, k)]),
    ) as Record<(typeof names)[number], WebGLUniformLocation | null>;

    const res = Math.round(size * Math.min(window.devicePixelRatio || 1, 1.5));
    canvas.width = canvas.height = res;
    gl.viewport(0, 0, res, res);
    gl.uniform1f(u.Res, res);

    // Smoothed values, so data changes glide instead of jump.
    const s = {
      ap: live.current.aperture,
      heat: live.current.heat,
      gx: 0,
      gy: 0,
      spin: 0,
      blade: 0,
    };
    let t = 0;
    let last = performance.now();
    let raf = 0;
    let visible = true;

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const want = live.current;
      const k = 1 - Math.exp(-dt * 2.2);
      s.ap += (want.aperture - s.ap) * k;
      s.heat += (want.heat - s.heat) * k;
      // Glance about a little round the target when nothing changes, like an eye at rest.
      const idle = reducedMotion ? 0 : 0.06;
      const gx = want.gaze[0] * 0.42 + Math.sin(t * 0.37) * idle;
      const gy = want.gaze[1] * 0.42 + Math.sin(t * 0.23 + 1) * idle;
      s.gx += (gx - s.gx) * k * 1.5;
      s.gy += (gy - s.gy) * k * 1.5;
      t += dt;
      s.spin += dt * (0.05 + s.heat * 0.5);
      s.blade += dt * 0.08;
      pulse.current = Math.max(0, pulse.current - dt * 0.8);

      // Turn the sphere so its pole faces the gaze.
      const yaw = s.gx;
      const pitch = s.gy;
      const cy = Math.cos(yaw),
        sy = Math.sin(yaw),
        cp = Math.cos(pitch),
        sp = Math.sin(pitch);
      // Rows of R = Ry(yaw) * Rx(pitch), applied as L = M * n (column-major upload of the transpose).
      const m = [cy, sy * sp, -sy * cp, 0, cp, sp, sy, -cy * sp, cy * cp];
      gl.uniformMatrix3fv(u.M, false, m);
      gl.uniform2f(u.Gz, -sy * cp * 1, sp);
      gl.uniform1f(u.T, t);
      gl.uniform1f(u.Ap, Math.max(0.05, Math.min(1, s.ap)));
      gl.uniform1f(u.Amp, pulse.current);
      gl.uniform1f(u.Turb, s.heat);
      gl.uniform1f(u.Spin, s.spin);
      gl.uniform1f(u.Blade, s.blade);
      gl.uniform1f(u.Glow, 0.3 + s.heat * 0.7);
      const h = Math.min(1, s.heat * 3);
      gl.uniform3f(u.Tint, mix(0, h), mix(1, h), mix(2, h));
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (visible && !reducedMotion) raf = requestAnimationFrame(draw);
    };

    // Rest while off screen or in a background tab.
    const io = new IntersectionObserver(([entry]) => {
      const was = visible;
      visible = Boolean(entry?.isIntersecting) && !document.hidden;
      if (visible && !was && !reducedMotion) {
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    });
    io.observe(canvas);
    const onVis = () => {
      visible = !document.hidden;
      if (visible && !reducedMotion) {
        cancelAnimationFrame(raf);
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(draw);
    // Reduced motion: still redraw when the data changes, a few times a second at most.
    const still = reducedMotion ? window.setInterval(() => draw(performance.now()), 500) : 0;

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(still);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [size, reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="argus-eye block"
      style={{ width: size, height: size }}
    />
  );
}
