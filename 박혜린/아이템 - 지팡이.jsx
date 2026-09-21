// WandFloat.jsx — 마운트되자마자 지팡이가 튀어나와 금색 후광 속에 둥둥 떠 있는 애니메이션 + 신비로운 마법 효과음
// npm i three   (react 18+) / 같은 폴더에 wand.png, wand_glow.png
//
// ▶ 처음 등장부터 소리가 나게 하려면
//   브라우저는 "사용자가 페이지를 한 번이라도 누르기 전"에는 소리를 막습니다.
//   이 파일은 import 되는 순간 앱 어디든 첫 클릭/터치/키 입력에서 오디오를 미리 깨워 둡니다.
//   그래서 사용자가 앱에서 무엇이든 한 번 누른 뒤(예: 아이템 획득 버튼) <WandFloat />가 나타나면
//   등장과 동시에 소리가 납니다. 버튼 핸들러 안에서 primeWandAudio()를 직접 불러도 됩니다.
//   페이지를 연 직후 아무 입력도 없던 상태라면 어떤 코드로도 소리를 낼 수 없어서,
//   그때만 조용히 등장하고 첫 터치에서 소리와 함께 다시 등장합니다.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import wandUrl from "./wand.png";
import glowUrl from "./wand_glow.png";

/* ---------- 신비로운 마법 효과음: Web Audio 합성 (외부 파일 없음) ---------- */
export function createSummonSound(){
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return { ready: () => false, unlock: async () => false, play(){}, close(){} };
  const ctx = new AC();
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.connect(ctx.destination);
  const out = ctx.createGain(); out.gain.value = 0.6; out.connect(comp);

  // 긴 잔향 (4초) — 동굴 같은 신비감
  const len = ctx.sampleRate * 4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++){ const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random()*2 - 1) * Math.pow(1 - i/len, 2.5); }
  const verb = ctx.createConvolver(); verb.buffer = ir;
  const wet = ctx.createGain(); wet.gain.value = 0.9; verb.connect(wet); wet.connect(comp);
  out.connect(verb);

  // 메아리 (좌우로 번지는 딜레이)
  const delay = ctx.createDelay(1); delay.delayTime.value = 0.36;
  const fb = ctx.createGain(); fb.gain.value = 0.42;
  const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 3500;
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
  if (pan.pan) pan.pan.value = 0.5;
  const echoIn = ctx.createGain(); echoIn.gain.value = 0.5;
  echoIn.connect(delay); delay.connect(dlp); dlp.connect(fb); fb.connect(delay); dlp.connect(pan); pan.connect(verb); pan.connect(comp);

  const noiseBuf = (() => { const b = ctx.createBuffer(1, ctx.sampleRate*3, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random()*2 - 1; return b; })();

  // 유리 종(글래스 하모니카) — 비정수배 배음으로 신비로운 울림
  function glassBell(freq, start, dur, vol){
    [[1, 1], [2.76, 0.35], [5.4, 0.12]].forEach(([m, v]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq * m;
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); // 살짝 떨리는 비브라토
      lfo.frequency.value = 5 + Math.random()*1.5; lg.gain.value = freq*m*0.004;
      lfo.connect(lg); lg.connect(o.frequency);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(vol*v, start + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur / m**0.3);
      o.connect(g); g.connect(out); g.connect(echoIn);
      o.start(start); lfo.start(start); o.stop(start + dur + 0.1); lfo.stop(start + dur + 0.1);
    });
  }

  function play(arrive, lead){
    const t = ctx.currentTime + (lead || 0) + 0.02, a = t + arrive;

    // 1) 부풀어 오르는 신비한 화음 패드 (D 리디안: D-A-E-G#)
    [146.8, 220, 329.6, 415.3, 587.3].forEach((f, i) => {
      [-7, 7].forEach(cent => {
        const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = cent + (Math.random()*4 - 2);
        lp.type = 'lowpass'; lp.Q.value = 3;
        lp.frequency.setValueAtTime(200, t); lp.frequency.exponentialRampToValueAtTime(2800, a);
        lp.frequency.exponentialRampToValueAtTime(600, a + 3);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.022, a);
        g.gain.exponentialRampToValueAtTime(0.0001, a + 3.2 - i*0.2);
        o.connect(lp); lp.connect(g); g.connect(out);
        o.start(t); o.stop(a + 3.5);
      });
    });

    // 2) 빨려 들어가듯 차오르는 바람 소리 (역재생 심벌 느낌)
    const n = ctx.createBufferSource(); n.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.Q.value = 2;
    hp.frequency.setValueAtTime(600, t); hp.frequency.exponentialRampToValueAtTime(7000, a);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.18, a - 0.02);
    ng.gain.exponentialRampToValueAtTime(0.0001, a + 0.12);
    n.connect(hp); hp.connect(ng); ng.connect(out); n.start(t); n.stop(a + 0.2);

    // 3) 도착: 깊고 부드러운 "우웅" + 반짝이는 공기
    const sub = ctx.createOscillator(), sg = ctx.createGain();
    sub.frequency.setValueAtTime(220, a); sub.frequency.exponentialRampToValueAtTime(55, a + 1.2);
    sg.gain.setValueAtTime(0.0001, a); sg.gain.exponentialRampToValueAtTime(0.45, a + 0.03);
    sg.gain.exponentialRampToValueAtTime(0.0001, a + 1.6);
    sub.connect(sg); sg.connect(out); sub.start(a); sub.stop(a + 1.7);
    const air = ctx.createBufferSource(); air.buffer = noiseBuf;
    const ahp = ctx.createBiquadFilter(); ahp.type = 'highpass'; ahp.frequency.value = 8000;
    const ag = ctx.createGain();
    ag.gain.setValueAtTime(0.0001, a); ag.gain.exponentialRampToValueAtTime(0.12, a + 0.02);
    ag.gain.exponentialRampToValueAtTime(0.0001, a + 2);
    air.connect(ahp); ahp.connect(ag); ag.connect(out); ag.connect(verb); air.start(a); air.stop(a + 2.1);

    // 4) 유리 종 아르페지오 — 위로 흩어지듯
    [1174.7, 1760, 2637, 3322, 2349, 4434].forEach((f, i) => glassBell(f, a + 0.03 + i*0.09, 2.6, 0.11));

    // 5) 오래 남는 반짝임 (리디안 음계의 높은 음들이 무작위로)
    const sparkle = [2349, 2637, 3322, 3520, 4434, 4699];
    for (let i = 0; i < 14; i++)
      glassBell(sparkle[(Math.random()*sparkle.length)|0], a + 0.6 + Math.random()*2.2, 1.2, 0.025 + Math.random()*0.02);
  }

  return {
    ready: () => ctx.state === 'running',
    unlock: () => ctx.resume().then(() => ctx.state === 'running').catch(() => false),
    play, close(){ ctx.close(); }
  };
}

/* ---------- three.js 장면 ---------- */
export function createWandScene(container, opts){
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace; else renderer.outputEncoding = THREE.sRGBEncoding;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  const loader = new THREE.TextureLoader();
  const tex = src => { const t = loader.load(src); t.anisotropy = 4;
    if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace; else t.encoding = THREE.sRGBEncoding; return t; };

  const root = new THREE.Group(); scene.add(root);
  const wandGroup = new THREE.Group(); root.add(wandGroup);
  const WAND_W = 2.10, WAND_H = 2.38;

  // 금색 후광
  const haloMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: {value: 0}, uIntensity: {value: 0} },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `
      varying vec2 vUv; uniform float uTime; uniform float uIntensity;
      void main(){
        vec2 p = vUv - 0.5; float r = length(p) * 2.0; float a = atan(p.y, p.x);
        float core = exp(-r*r*5.0);
        float ring = exp(-pow((r - 0.52) * 10.0, 2.0)) * (0.75 + 0.25*sin(uTime*2.0));
        float rays = pow(0.5 + 0.5*sin(a*12.0 + uTime*0.5), 7.0) * 0.7
                   + pow(0.5 + 0.5*sin(a*7.0 - uTime*0.8 + 1.3), 9.0) * 0.5;
        rays *= smoothstep(1.0, 0.18, r) * smoothstep(0.05, 0.3, r);
        vec3 col = mix(vec3(1.0, 0.62, 0.18), vec3(1.0, 0.93, 0.68), clamp(core*1.2, 0.0, 1.0));
        float alpha = (core*0.85 + ring*0.45 + rays*0.55) * uIntensity * smoothstep(1.0, 0.8, r);
        gl_FragColor = vec4(col * alpha, alpha);
      }`
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), haloMat);
  halo.position.set(0.35, 0.45, -0.3); wandGroup.add(halo);

  // 등장 순간 퍼지는 빛의 고리
  const waveMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uR: {value: 0}, uA: {value: 0} },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `
      varying vec2 vUv; uniform float uR; uniform float uA;
      void main(){ float r = length(vUv - 0.5) * 2.0;
        float a = exp(-pow((r - uR) * 18.0, 2.0)) * uA;
        gl_FragColor = vec4(vec3(1.0, 0.85, 0.5) * a, a); }`
  });
  const wave = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), waveMat);
  wave.position.set(0.25, 0.35, -0.2); root.add(wave);

  // 지팡이 윤곽의 금빛
  const glowMat = new THREE.MeshBasicMaterial({ map: tex(opts.glow), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: 0 });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(WAND_W*540/420, WAND_H*596/476), glowMat);
  glow.position.z = -0.02; wandGroup.add(glow);

  const wand = new THREE.Mesh(new THREE.PlaneGeometry(WAND_W, WAND_H),
    new THREE.MeshBasicMaterial({ map: tex(opts.wand), transparent: true, depthWrite: false }));
  wandGroup.add(wand);

  // 금가루
  const dc = document.createElement('canvas'); dc.width = dc.height = 64;
  const g = dc.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,248,220,1)'); grd.addColorStop(.25, 'rgba(255,210,120,.8)'); grd.addColorStop(1, 'rgba(255,180,60,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const N = 150, pos = new Float32Array(N*3), seeds = [];
  for (let i = 0; i < N; i++) seeds.push({ a: Math.random()*Math.PI*2, r: 0.5 + Math.random()*1.9,
    y: Math.random(), sp: 0.15 + Math.random()*0.35, z: (Math.random() - 0.5)*1.2 });
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dustMat = new THREE.PointsMaterial({ size: 0.09, map: new THREE.CanvasTexture(dc), transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const dust = new THREE.Points(dustGeo, dustMat); dust.position.set(0.1, 0.2, 0); root.add(dust);

  const clamp01 = x => Math.min(1, Math.max(0, x));
  const easeOutBack = x => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3*Math.pow(x - 1, 3) + c1*Math.pow(x - 1, 2); };
  const easeOutCubic = x => 1 - Math.pow(1 - x, 3);
  const lerp = (a, b, t) => a + (b - a)*t;

  const POP = 1.1;                // 지팡이가 도착하기까지 걸리는 시간(초) — 효과음 타이밍과 공유
  let t0 = null, arrived = false, raf = 0;
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  const onMove = e => { const r = container.getBoundingClientRect();
    mouse.tx = ((e.clientX - r.left)/r.width - 0.5)*2; mouse.ty = ((e.clientY - r.top)/r.height - 0.5)*2; };
  window.addEventListener('pointermove', onMove);

  function resize(){
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.position.z = camera.aspect < 0.8 ? 6.5 / Math.max(camera.aspect/0.8, 0.55) : 6.5;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  function frame(now){
    const t = t0 === null ? -1 : (now - t0)/1000;
    const p = clamp01(t / POP), pb = easeOutBack(p), pc = easeOutCubic(p);
    const floatAmt = clamp01((t - POP*0.7) / 1.2) * (reduce ? 0.4 : 1);
    const T = now / 1000;

    // 등장: 작게 회전하며 멀리서 튀어나와 크기가 튕김
    wandGroup.visible = t >= 0;
    wandGroup.scale.setScalar(Math.max(0.0001, pb * 1.3));
    wandGroup.position.set(0, Math.sin(T*1.6)*0.14*floatAmt, lerp(-2.5, 0.4, pc));
    wandGroup.rotation.z = (1 - pc) * -Math.PI * 1.5 + Math.sin(T*1.1)*0.06*floatAmt;
    wandGroup.rotation.y = Math.sin(T*0.9)*0.18*floatAmt;
    wandGroup.rotation.x = Math.sin(T*1.3 + 1)*0.06*floatAmt;
    halo.rotation.y = -wandGroup.rotation.y;

    // 후광·윤곽빛·섬광
    const hIn = clamp01((t - POP*0.4) / 0.8);
    const flash = t >= 0 ? Math.exp(-Math.pow((t - POP) * 3.5, 2)) * 0.9 : 0;
    haloMat.uniforms.uTime.value = T;
    haloMat.uniforms.uIntensity.value = easeOutCubic(hIn)*(0.9 + 0.1*Math.sin(T*2.4)) + flash;
    halo.scale.setScalar(lerp(0.3, 1, easeOutCubic(hIn)) * (1 + 0.03*Math.sin(T*1.7)));
    glowMat.opacity = easeOutCubic(hIn)*(0.55 + 0.2*Math.sin(T*2.4)) + flash*0.5;

    // 빛의 고리
    const w = clamp01((t - POP) / 0.9);
    waveMat.uniforms.uR.value = easeOutCubic(w) * 0.95;
    waveMat.uniforms.uA.value = t >= POP ? (1 - w) * 0.9 : 0;

    // 금가루: 중심에서 터져 나와 나선을 그리며 상승
    const burst = easeOutCubic(clamp01((t - POP*0.8) / 0.7));
    dustMat.opacity = easeOutCubic(hIn) * 0.95;
    for (let i = 0; i < N; i++){ const s = seeds[i]; const yy = (s.y + T*s.sp*0.25) % 1;
      const ang = s.a + T*s.sp, rr = s.r * burst * (0.8 + 0.2*Math.sin(T + i));
      pos[i*3] = Math.cos(ang)*rr; pos[i*3 + 1] = (yy - 0.5)*3.4*burst; pos[i*3 + 2] = s.z + Math.sin(ang)*0.4; }
    dustGeo.attributes.position.needsUpdate = true;

    mouse.x += (mouse.tx - mouse.x)*0.05; mouse.y += (mouse.ty - mouse.y)*0.05;
    root.rotation.y = mouse.x*0.12; root.rotation.x = mouse.y*0.08;

    if (t >= 0 && !arrived && p >= 1){ arrived = true; opts.onArrived && opts.onArrived(); }
    renderer.render(scene, camera); raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    POP,
    summon(lead){ t0 = performance.now() + (lead || 0)*1000; arrived = false; },
    dispose(){ cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('pointermove', onMove);
      renderer.dispose(); container.removeChild(renderer.domElement); }
  };
}


/* ---------- 앱 전체에서 하나만 쓰는 오디오 (첫 사용자 입력에서 미리 깨움) ---------- */
let sharedSound = null;
function getSummonSound(){ if (!sharedSound) sharedSound = createSummonSound(); return sharedSound; }
export function primeWandAudio(){ return getSummonSound().unlock(); }
if (typeof window !== "undefined") {
  const prime = () => { primeWandAudio(); ["pointerdown", "keydown", "touchend"].forEach(e => window.removeEventListener(e, prime, true)); };
  ["pointerdown", "keydown", "touchend"].forEach(e => window.addEventListener(e, prime, true));
}

export default function WandFloat({ height = "100vh" }) {
  const mountRef = useRef(null);
  const [needsTap, setNeedsTap] = useState(false);

  useEffect(() => {
    const scene = createWandScene(mountRef.current, { wand: wandUrl, glow: glowUrl });
    const sound = getSummonSound();
    const LEAD = 0.4;
    const start = (withSound) => { scene.summon(LEAD); if (withSound) sound.play(scene.POP, LEAD); };
    let waiting = false;
    const onTap = () => {
      if (!waiting) return; waiting = false; setNeedsTap(false);
      sound.unlock().then((ok) => start(ok));
    };
    (sound.ready() ? Promise.resolve(true) : Promise.race([sound.unlock(), new Promise((r) => setTimeout(() => r(false), 200))])).then((ok) => {
      start(ok);
      if (!ok) { waiting = true; setNeedsTap(true); }
    });
    window.addEventListener("pointerdown", onTap);
    window.addEventListener("keydown", onTap);
    return () => {
      window.removeEventListener("pointerdown", onTap);
      window.removeEventListener("keydown", onTap);
      scene.dispose(); // 공유 오디오는 닫지 않음
    };
  }, []);

  return (
    <div style={{ position: "relative", height, overflow: "hidden",
      background: "radial-gradient(120% 90% at 50% 42%, #321d4d 0%, #170c27 55%, #07030d 100%)" }}>
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />
      <p aria-live="polite" style={{ position: "absolute", left: "50%", bottom: 26, transform: "translateX(-50%)",
        margin: 0, fontSize: 14, color: "#fff3d6", opacity: needsTap ? 0.7 : 0, transition: "opacity .6s",
        pointerEvents: "none" }}>
        화면을 누르면 소리와 함께 다시 나타나요
      </p>
    </div>
  );
}
