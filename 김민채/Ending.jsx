/**
 * Ending.jsx — 게임 엔딩 클로징 시퀀스 (React + three.js)
 *
 * 설치:  npm i three
 * 사용:  import Ending from "./Ending";
 *        {gameOver && <Ending />}
 *
 * props
 *  - title        배너 문구 (기본 "MISSION COMPLETE", "THE END" 등으로 변경 가능)
 *  - subtitle     배너 아래 문구
 *  - fullscreen   true면 화면 전체를 덮음(position: fixed), false면 부모 요소를 채움(부모에 position: relative 필요)
 *  - music        배경 음악 재생 여부
 *  - onBanner     배너가 펼쳐지는 순간 호출되는 콜백
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

// 오래된 브라우저용 roundRect 대체
if (typeof window !== "undefined" && window.CanvasRenderingContext2D && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    const q = Math.min(r, w / 2, h / 2);
    this.moveTo(x + q, y); this.arcTo(x + w, y, x + w, y + h, q); this.arcTo(x + w, y + h, x, y + h, q);
    this.arcTo(x, y + h, x, y, q); this.arcTo(x, y, x + w, y, q); this.closePath();
  };
}

// three 버전에 상관없이 캔버스 텍스처 색을 sRGB로 처리
function setSRGB(t) {
  if (THREE["SRGBColorSpace"] !== undefined && "colorSpace" in t) t.colorSpace = THREE["SRGBColorSpace"];
  else t.encoding = THREE["sRGBEncoding"];
}

/* ================= 타임라인 (초) ================= */
const T = {
  raise: 0.2,        // 지팡이 들어올리기
  bookIn: 0.6,       // 책 하강 시작
  bookLand: 4.2,     // 책 도착
  closeStart: 4.3,   // 책 닫힘 시작
  closed: 6.0,       // 완전히 닫힘
  banner: 6.15,      // 배너 펼침
  rain: 6.0,         // 색종이·별 비
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = {
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};
let seed = 3;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const rr = (a, b) => a + (b - a) * rand();

/* ================= 배경 음악 (Web Audio 합성) ================= */
function createMusic() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ac = new AC();
  const BPM = 124, E = 60 / BPM / 2; // 8분음표 길이
  const mf = (m) => 440 * Math.pow(2, (m - 69) / 12);
  // I–IV–V–I–vi–IV–V7–I (C장조)
  const CH = [
    { b: 36, c: [60, 64, 67] }, { b: 41, c: [65, 69, 72] }, { b: 43, c: [67, 71, 74] }, { b: 36, c: [60, 64, 67] },
    { b: 45, c: [69, 72, 76] }, { b: 41, c: [65, 69, 72] }, { b: 43, c: [67, 71, 74, 77] }, { b: 36, c: [60, 64, 67, 72] },
  ];
  // 팡파르 멜로디 [음, 8분음표 개수]
  const MEL = [
    [[67, 1], [72, 1], [76, 1], [79, 3], [76, 1], [79, 1]],
    [[81, 4], [79, 2], [77, 2]],
    [[71, 2], [74, 2], [79, 2], [77, 2]],
    [[76, 2], [72, 4], [0, 2]],
    [[72, 2], [76, 2], [81, 3], [79, 1]],
    [[77, 2], [81, 2], [84, 3], [81, 1]],
    [[83, 2], [81, 1], [79, 1], [77, 2], [74, 2]],
    [[72, 1], [76, 1], [79, 2], [84, 4]],
  ];
  const melMap = MEL.map((bar) => { const m = {}; let p = 0; bar.forEach(([n, l]) => { if (n) m[p] = [n, l]; p += l; }); return m; });
  let noiseBuf = null;
  const noise = () => {
    if (noiseBuf) return noiseBuf;
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  };
  let master = null, timer = null, nextTime = 0, step = 0;

  function tone(type, freq, t, dur, vol, cut, dest) {
    const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o.type = type; o.frequency.value = freq; f.type = "lowpass"; f.frequency.value = cut;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.setValueAtTime(vol, t + Math.max(0.02, dur - 0.05)); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(f); f.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.03);
  }
  function kick(t, dest) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
    g.gain.setValueAtTime(0.45, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.25);
  }
  function noiseHit(t, dest, hp, vol, len) {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noise(); f.type = "highpass"; f.frequency.value = hp;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t); s.stop(t + len + 0.02);
  }
  function schedule(s, t) {
    const bar = Math.floor(s / 8) % 8, e = s % 8, ch = CH[bar];
    if (e === 0) {
      ch.c.forEach((n) => tone("sawtooth", mf(n), t, E * 8, 0.03, 1500, master));
      tone("triangle", mf(ch.b + 12), t, E * 8, 0.05, 900, master);
    }
    if (e % 2 === 0) tone("square", mf(ch.b + (e % 4 === 2 ? 12 : 0)), t, E * 1.6, 0.08, 480, master);
    tone("triangle", mf(ch.c[e % ch.c.length] + 12), t, E * 0.9, 0.04, 5200, master);
    const m = melMap[bar][e];
    if (m) {
      tone("square", mf(m[0]), t, E * m[1] * 0.95, 0.065, 2600, master);
      tone("triangle", mf(m[0] + 12), t, E * m[1] * 0.95, 0.03, 6000, master);
    }
    if (e === 0 || e === 4) kick(t, master);
    if (e === 2 || e === 6) noiseHit(t, master, 1400, 0.2, 0.16);
    noiseHit(t, master, 7000, 0.05, 0.05);
    if (bar === 7 && e >= 5) noiseHit(t + E / 2, master, 1400, 0.14, 0.12);
  }
  function tick() { while (nextTime < ac.currentTime + 0.15) { schedule(step, nextTime); nextTime += E; step++; } }

  return {
    start() {
      if (ac.state === "suspended") ac.resume();
      this.stop();
      master = ac.createGain(); master.gain.value = 0;
      const comp = ac.createDynamicsCompressor();
      master.connect(comp); comp.connect(ac.destination);
      master.gain.setValueAtTime(0, ac.currentTime);
      master.gain.linearRampToValueAtTime(0.55, ac.currentTime + 0.8);
      step = 0; nextTime = ac.currentTime + 0.1;
      tick(); timer = setInterval(tick, 40);
    },
    destroy() { this.stop(); setTimeout(() => { if (ac.state !== "closed") ac.close(); }, 500); },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
      if (master) {
        const m = master, now = ac.currentTime;
        m.gain.cancelScheduledValues(now); m.gain.setValueAtTime(m.gain.value, now); m.gain.linearRampToValueAtTime(0, now + 0.3);
        setTimeout(() => m.disconnect(), 450); master = null;
      }
    },
    resume() { if (ac.state === "suspended") ac.resume(); },
    isSuspended() { return ac.state !== "running"; },
    // 배너가 펼쳐질 때 반짝이는 글리산도
    chime() {
      if (ac.state !== "running") return;
      const out = ac.createGain(); out.gain.value = 0.9; out.connect(ac.destination);
      [84, 88, 91, 96, 100, 103, 108].forEach((n, i) => tone("triangle", mf(n), ac.currentTime + i * 0.06, 0.7, 0.06, 9000, out));
    },
  };
}

/* ================= 텍스처 ================= */
function cnv(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function sTex(c) { const t = new THREE.CanvasTexture(c); setSRGB(t); t.anisotropy = 4; return t; }
function starPath(g, cx, cy, spikes, outer, inner) {
  g.beginPath();
  for (let i = 0; i < spikes * 2; i++) { const r = i % 2 ? inner : outer, a = -Math.PI / 2 + (i * Math.PI) / spikes; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  g.closePath();
}
function starShape(outer, inner) {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? inner : outer, a = Math.PI / 2 + (i * Math.PI) / 5; i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  return sh;
}
function makeCoverTexture() {
  const c = cnv(512, 732), g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 512, 732);
  grd.addColorStop(0, "#2d5aa8"); grd.addColorStop(0.55, "#23488c"); grd.addColorStop(1, "#162f63");
  g.fillStyle = grd; g.fillRect(0, 0, 512, 732);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; g.fillRect(Math.random() * 512, Math.random() * 732, 2, 2); }
  g.strokeStyle = "#e8c46a"; g.lineWidth = 10; g.strokeRect(26, 26, 460, 680);
  g.lineWidth = 3; g.strokeRect(46, 46, 420, 640);
  [[46, 46], [466, 46], [46, 686], [466, 686]].forEach(([x, y]) => { g.fillStyle = "#e8c46a"; starPath(g, x, y, 4, 18, 6); g.fill(); });
  g.shadowColor = "rgba(255,210,120,0.8)"; g.shadowBlur = 20;
  const sg = g.createLinearGradient(170, 250, 340, 480); sg.addColorStop(0, "#fff0b0"); sg.addColorStop(1, "#d9a338");
  g.fillStyle = sg; starPath(g, 256, 366, 5, 110, 46); g.fill();
  g.shadowBlur = 0; g.strokeStyle = "#8a5d14"; g.lineWidth = 3; g.stroke();
  return sTex(c);
}
function makeEndpaperTexture() {
  const c = cnv(256, 366), g = c.getContext("2d");
  g.fillStyle = "#1a2d5e"; g.fillRect(0, 0, 256, 366);
  g.fillStyle = "rgba(232,196,106,0.35)";
  for (let y = 20; y < 366; y += 36) for (let x = (y / 36) % 2 ? 20 : 38; x < 256; x += 36) { starPath(g, x, y, 4, 6, 2); g.fill(); }
  return sTex(c);
}
function makePageTexture() {
  const c = cnv(512, 732), g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 512, 0);
  grd.addColorStop(0, "#c9b58a"); grd.addColorStop(0.12, "#efe1bd"); grd.addColorStop(1, "#f7ecd0");
  g.fillStyle = grd; g.fillRect(0, 0, 512, 732);
  g.fillStyle = "rgba(90,60,30,0.35)";
  for (let y = 90; y < 660; y += 26) { let x = 80; while (x < 450) { const w = 12 + Math.random() * 46; if (x + w > 450) break; g.fillRect(x, y, w, 5); x += w + 8; } }
  g.strokeStyle = "rgba(160,110,40,0.5)"; g.lineWidth = 2;
  g.beginPath(); g.arc(265, 55, 22, 0, Math.PI * 2); g.stroke(); starPath(g, 265, 55, 5, 16, 7); g.stroke();
  return sTex(c);
}
function makeGlowTexture() {
  const c = cnv(256, 256), g = c.getContext("2d");
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, "rgba(255,248,220,1)"); gr.addColorStop(0.25, "rgba(255,215,130,0.55)"); gr.addColorStop(1, "rgba(255,180,80,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  return sTex(c);
}
function makeRingTexture() {
  const c = cnv(256, 256), g = c.getContext("2d");
  const gr = g.createRadialGradient(128, 128, 88, 128, 128, 126);
  gr.addColorStop(0, "rgba(255,220,140,0)"); gr.addColorStop(0.6, "rgba(255,240,200,0.9)"); gr.addColorStop(1, "rgba(255,200,120,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  return sTex(c);
}
function makeShadowTexture() {
  const c = cnv(128, 128), g = c.getContext("2d");
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(0,0,20,0.5)"); gr.addColorStop(1, "rgba(0,0,20,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return sTex(c);
}

/* ================= 셰이더 ================= */
const starFrag = `
  varying vec3 vColor; varying float vAlpha;
  void main(){
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float core = exp(-d*d*70.0);
    float halo = exp(-d*d*14.0) * 0.3;
    float rays = max(0.0, 1.0 - abs(uv.x)*16.0) * max(0.0, 1.0 - abs(uv.y)*2.0)
               + max(0.0, 1.0 - abs(uv.y)*16.0) * max(0.0, 1.0 - abs(uv.x)*2.0);
    float a = (core + halo + rays*0.5) * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor * a, a);
  }`;
const HIDE = "gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vAlpha = 0.0; return;";
// 책 주위를 맴돌며 흩날리는 금빛 별가루
const orbitVert = `
  uniform float uTime; uniform float uPR; uniform float uAmp; uniform vec3 uCenter;
  attribute float aA0; attribute float aR; attribute float aLife; attribute float aOff; attribute float aSpin; attribute float aSize; attribute vec3 aColor;
  varying vec3 vColor; varying float vAlpha;
  void main(){
    vColor = aColor;
    if (uAmp <= 0.001) { ${HIDE} }
    float lt = mod(uTime + aOff, aLife);
    float p = lt / aLife;
    float ang = aA0 + lt * aSpin;
    float y = mix(2.6, -3.2, p);
    float r = aR * (1.0 + 0.25 * p);
    vec3 pos = uCenter + vec3(cos(ang) * r, y, sin(ang) * r * 0.55);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.55 + 0.45 * sin(uTime * 7.0 + aA0 * 19.0);
    gl_PointSize = aSize * uPR * tw * (300.0 / -mv.z);
    vAlpha = uAmp * smoothstep(0.0, 0.1, p) * (1.0 - smoothstep(0.7, 1.0, p));
  }`;
// 지팡이 끝에서 책으로 흐르는 빛의 실
const threadVert = `
  uniform float uTime; uniform float uPR; uniform float uAmp; uniform vec3 uFrom; uniform vec3 uTo;
  attribute float aOff; attribute float aSpeed; attribute float aSize; attribute vec3 aColor;
  varying vec3 vColor; varying float vAlpha;
  void main(){
    vColor = aColor;
    if (uAmp <= 0.001) { ${HIDE} }
    float p = fract(uTime * aSpeed + aOff);
    float arc = sin(p * 3.14159);
    vec3 pos = mix(uFrom, uTo, p) + vec3(sin(p * 11.0 + aOff * 31.0) * 0.28, arc * 0.9 + cos(p * 9.0 + aOff * 17.0) * 0.22, sin(p * 7.0 + aOff * 13.0) * 0.2) * (0.3 + arc);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPR * (300.0 / -mv.z);
    vAlpha = uAmp * arc;
  }`;
// 은은한 폭죽
const fireVert = `
  uniform float uTime; uniform float uPR; uniform float uPeriod;
  attribute vec3 aOrigin; attribute vec3 aDir; attribute float aStart; attribute float aSpeed; attribute float aSize; attribute vec3 aColor;
  varying vec3 vColor; varying float vAlpha;
  void main(){
    vColor = aColor;
    float t = uTime - aStart;
    if (t < 0.0) { ${HIDE} }
    float lt = mod(t, uPeriod);
    if (lt > 2.6) { ${HIDE} }
    float travel = aSpeed * (1.0 - exp(-lt * 2.2)) / 2.2;
    vec3 pos = aOrigin + aDir * travel + vec3(0.0, -0.4 * lt * lt, 0.0);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.65 + 0.35 * sin(uTime * 18.0 + aSpeed * 40.0);
    gl_PointSize = aSize * uPR * (300.0 / -mv.z);
    vAlpha = 0.8 * exp(-lt * 1.3) * smoothstep(0.0, 0.05, lt) * mix(1.0, tw, smoothstep(0.8, 1.6, lt));
  }`;
// 쏟아지는 반짝이 별
const rainVert = `
  uniform float uTime; uniform float uPR;
  attribute vec3 aBase; attribute float aStart; attribute float aSpeed; attribute float aPhase; attribute float aSize; attribute vec3 aColor;
  varying vec3 vColor; varying float vAlpha;
  void main(){
    vColor = aColor;
    float t = uTime - aStart;
    if (t < 0.0) { ${HIDE} }
    float y = aBase.y - mod(t * aSpeed, 14.0);
    vec3 pos = vec3(aBase.x + sin(uTime * 1.3 + aPhase) * 0.35, y, aBase.z);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.45 + 0.55 * abs(sin(uTime * 4.0 + aPhase * 7.0));
    gl_PointSize = aSize * uPR * tw * (300.0 / -mv.z);
    vAlpha = smoothstep(0.0, 0.5, t) * 0.95;
  }`;

const GOLD = [1.0, 0.84, 0.45], CREAM = [1.0, 0.95, 0.82], AMBER = [1.0, 0.72, 0.32];
const FIRE = [[1.0, 0.84, 0.45], [1.0, 0.62, 0.72], [0.62, 0.86, 1.0], [0.78, 0.66, 1.0], [0.6, 0.95, 0.78]];

function pointsFrom(attrs, count, vert, uniforms) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  Object.keys(attrs).forEach((k) => geo.setAttribute(k, new THREE.BufferAttribute(attrs[k].arr, attrs[k].size)));
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: starFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
  return pts;
}
const A = (n, size) => ({ arr: new Float32Array(n * size), size });

/* ================= 씬 ================= */
function createEndingScene(mount, opts) {
  const CM = THREE["ColorManagement"];
  if (CM) { if ("enabled" in CM) CM.enabled = true; else if ("legacyMode" in CM) CM.legacyMode = false; }
  seed = 3;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const PR = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(PR); renderer.setClearColor(0x000000, 0);
  if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE["SRGBColorSpace"];
  else renderer.outputEncoding = THREE["sRGBEncoding"];
  // three r155~r164: 예전 조명 세기 방식 유지 / r165+: 물리 기반 조명이라 세기를 보정
  if ("useLegacyLights" in renderer) renderer.useLegacyLights = true;
  const REV = parseInt(THREE.REVISION, 10) || 0;
  const LI = REV >= 165 ? Math.PI : 1, PLI = REV >= 165 ? Math.PI * 9 : 1;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  const camBase = new THREE.Vector3(0, 4.2, 13.5), camTarget = new THREE.Vector3(0, 3.4, 0);
  let camFactor = 1;

  scene.add(new THREE.HemisphereLight(0xc8d6ff, 0x3a2d60, 0.95 * LI));
  const keyL = new THREE.DirectionalLight(0xfff1dc, 1.0 * LI); keyL.position.set(3, 6, 6); scene.add(keyL);
  const bookLight = new THREE.PointLight(0xffd08a, 0, 12, 2); scene.add(bookLight);

  /* ---- 배경 별 ---- */
  {
    const n = 500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([rr(-40, 40), rr(-2, 26), rr(-30, -16)], i * 3);
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.35, map: makeGlowTexture(), color: 0xb9c6ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  }

  /* ---- 파란 마법사 ---- */
  const gm = new THREE.DataTexture(new Uint8Array([80, 80, 80, 255, 165, 165, 165, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  gm.minFilter = gm.magFilter = THREE.NearestFilter; gm.needsUpdate = true;
  const toon = (c, extra) => new THREE.MeshToonMaterial(Object.assign({ color: c, gradientMap: gm }, extra || {}));
  const M = {
    robe: toon("#2f63c4"), robeDark: toon("#244c99"), gold: toon("#e8c46a"), skin: toon("#f2c8a2"),
    white: toon("#f7f4ee"), black: toon("#1a1a2a"), shoe: toon("#5a3a26"), nose: toon("#eca48f"), wood: toon("#6b4526"),
  };
  const mesh = (geo, mat, parent, pos, rot, scl) => {
    const m = new THREE.Mesh(geo, mat);
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    if (scl) m.scale.set(scl[0], scl[1], scl[2]);
    parent.add(m); return m;
  };

  const wizardSpot = new THREE.Group(); scene.add(wizardSpot);
  mesh(new THREE.CircleGeometry(2.0, 48), toon("#2a2f6b"), wizardSpot, [0, 0, 0], [-Math.PI / 2, 0, 0]);
  mesh(new THREE.RingGeometry(1.92, 1.98, 48), new THREE.MeshBasicMaterial({ color: 0xe8c46a, transparent: true, opacity: 0.4 }), wizardSpot, [0, 0.005, 0], [-Math.PI / 2, 0, 0]);
  const shadow = mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: makeShadowTexture(), transparent: true, depthWrite: false }), wizardSpot, [0, 0.01, 0], [-Math.PI / 2, 0, 0]);

  // ---- 참고 이미지의 꼬마 마법사: 일러스트 느낌의 2D 컷아웃 리그 ----
  // 파츠(몸·머리·모자·팔·지팡이)를 캔버스에 따로 그려 평면에 붙이고, 관절 피벗으로 움직입니다.
  const U = 200; // 그림 좌표 200px = 월드 1
  const C = {
    out: "#27335f", blue: "#3867bd", blueD: "#2b5099", blueL: "#5584d6",
    gold: "#f6c945", goldD: "#d19a26", skin: "#fde3d3", skinD: "#f1c6b2",
    hair: "#e1e4ea", hairD: "#b6bdca", red: "#d9443f", redD: "#a93230",
    boot: "#7b4a2b", bootL: "#a06842", leg: "#3b3654", shirt: "#dfe7f7", eye: "#2e2940",
  };
  function ln(g, w, col) { g.lineWidth = w; g.strokeStyle = col || C.out; g.lineJoin = "round"; g.lineCap = "round"; }
  function fillStroke(g, fill, w) { g.fillStyle = fill; g.fill(); ln(g, w == null ? 5 : w); g.stroke(); }
  function star(g, cx, cy, r, rot) {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const rr2 = i % 2 ? r * 0.45 : r, a2 = (rot || 0) - Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(cx + Math.cos(a2) * rr2, cy + Math.sin(a2) * rr2); }
    g.closePath(); g.fillStyle = C.gold; g.fill(); ln(g, 2.5, C.goldD); g.stroke();
  }
  function partTexture(bbox, draw) {
    const [x0, y0, w, h] = bbox, S = 2;
    const c = cnv(w * S, h * S), g = c.getContext("2d");
    g.scale(S, S); g.translate(-x0, -y0); draw(g);
    return sTex(c);
  }
  function makePart(bbox, pivot, draw, order) {
    const [x0, y0, w, h] = bbox;
    const geo = new THREE.PlaneGeometry(w / U, h / U);
    geo.translate((x0 + w / 2 - pivot[0]) / U, -(y0 + h / 2 - pivot[1]) / U, 0);
    const mat = new THREE.MeshBasicMaterial({ map: partTexture(bbox, draw), transparent: true, depthWrite: false, toneMapped: false });
    const m = new THREE.Mesh(geo, mat); m.renderOrder = 20 + order; m.position.z = order * 0.004;
    return m;
  }
  const rel = (child, parent) => [(child[0] - parent[0]) / U, -(child[1] - parent[1]) / U];

  const P = { feet: [280, 700], neck: [280, 445], brim: [280, 258], shL: [228, 466], shR: [332, 466], handR: [332, 584] };

  // 몸통: 다리, 부츠, 망토, 스카프
  function drawBody(g) {
    g.beginPath(); g.roundRect(248, 585, 22, 62, 8); fillStroke(g, C.leg, 4);
    g.beginPath(); g.roundRect(290, 585, 22, 62, 8); fillStroke(g, C.leg, 4);
    [[259, -1], [301, 1]].forEach(([x, d]) => {
      g.beginPath(); g.roundRect(x - 17, 628, 32, 48, 6); fillStroke(g, C.boot, 4.5);
      g.beginPath(); g.ellipse(x + 8 * d, 682, 27, 15, 0, 0, Math.PI * 2); fillStroke(g, C.boot, 4.5);
      g.beginPath(); g.roundRect(x - 21, 620, 40, 15, 7); fillStroke(g, C.bootL, 4);
    });
    g.beginPath();
    g.moveTo(232, 452);
    g.quadraticCurveTo(206, 472, 196, 520); g.quadraticCurveTo(184, 572, 170, 606);
    g.quadraticCurveTo(280, 638, 390, 606);
    g.quadraticCurveTo(376, 572, 364, 520); g.quadraticCurveTo(354, 472, 328, 452);
    g.closePath();
    g.fillStyle = C.blue; g.fill();
    g.save(); g.clip(); g.fillStyle = C.blueD; g.fillRect(338, 440, 80, 200); g.restore();
    ln(g, 5); g.stroke();
    g.beginPath(); g.moveTo(268, 462); g.lineTo(292, 462); g.quadraticCurveTo(298, 540, 302, 618); g.quadraticCurveTo(280, 624, 258, 618); g.quadraticCurveTo(262, 540, 268, 462);
    fillStroke(g, C.shirt, 3.5);
    g.beginPath(); g.moveTo(176, 598); g.quadraticCurveTo(280, 628, 384, 598); ln(g, 6, C.gold); g.stroke();
    star(g, 214, 560, 14, 0.2); star(g, 346, 548, 12, -0.3); star(g, 236, 506, 9, 0.5); star(g, 330, 592, 9, 0.1);
    // 스카프
    g.beginPath(); g.moveTo(272, 474); g.lineTo(258, 522); g.lineTo(274, 516); g.lineTo(282, 478); g.closePath(); fillStroke(g, C.redD, 3.5);
    g.beginPath(); g.moveTo(288, 474); g.lineTo(304, 526); g.lineTo(290, 520); g.lineTo(278, 478); g.closePath(); fillStroke(g, C.red, 3.5);
    g.beginPath(); g.roundRect(234, 440, 92, 28, 14); fillStroke(g, C.red, 4.5);
    g.beginPath(); g.moveTo(280, 466); g.quadraticCurveTo(250, 444, 242, 470); g.quadraticCurveTo(250, 492, 280, 472); g.closePath(); fillStroke(g, C.red, 4);
    g.beginPath(); g.moveTo(280, 466); g.quadraticCurveTo(310, 444, 318, 470); g.quadraticCurveTo(310, 492, 280, 472); g.closePath(); fillStroke(g, C.red, 4);
    g.beginPath(); g.arc(280, 469, 9, 0, Math.PI * 2); fillStroke(g, C.redD, 3.5);
  }
  // 머리: 뒷머리, 얼굴, 표정, 앞머리 (표정별 3장)
  function drawHead(face) {
    return (g) => {
      g.beginPath();
      g.moveTo(145, 345); g.bezierCurveTo(140, 225, 420, 225, 415, 345);
      g.quadraticCurveTo(418, 405, 402, 442); g.quadraticCurveTo(386, 454, 370, 438);
      g.lineTo(190, 438); g.quadraticCurveTo(174, 454, 158, 442); g.quadraticCurveTo(142, 405, 145, 345);
      fillStroke(g, C.hairD, 5);
      g.beginPath(); g.ellipse(280, 352, 108, 100, 0, 0, Math.PI * 2); fillStroke(g, C.skin, 5);
      // 볼
      g.fillStyle = "rgba(244,132,142,0.45)";
      g.beginPath(); g.ellipse(208, 404, 19, 10, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(352, 404, 19, 10, 0, 0, Math.PI * 2); g.fill();
      // 눈
      [240, 320].forEach((x) => {
        if (face === "normal") {
          g.beginPath(); g.ellipse(x, 374, 15, 21, 0, 0, Math.PI * 2); g.fillStyle = C.eye; g.fill();
          g.beginPath(); g.ellipse(x, 382, 10, 11, 0, 0, Math.PI * 2); g.fillStyle = "#5c5286"; g.fill();
          g.fillStyle = "#fff";
          g.beginPath(); g.arc(x - 5, 364, 6, 0, Math.PI * 2); g.fill();
          g.beginPath(); g.arc(x + 6, 385, 2.6, 0, Math.PI * 2); g.fill();
        } else if (face === "blink") {
          g.beginPath(); g.arc(x, 370, 14, 0.15 * Math.PI, 0.85 * Math.PI); ln(g, 4.5, C.eye); g.stroke();
        } else {
          g.beginPath(); g.arc(x, 384, 14, 1.15 * Math.PI, 1.85 * Math.PI); ln(g, 5, C.eye); g.stroke();
        }
      });
      // 입
      if (face === "happy") {
        g.beginPath(); g.moveTo(266, 404); g.quadraticCurveTo(280, 430, 294, 404); g.closePath(); fillStroke(g, "#c4474d", 3.5);
      } else {
        g.beginPath(); g.arc(280, 402, 9, 0.2 * Math.PI, 0.8 * Math.PI); ln(g, 3.5, "#7a3d42"); g.stroke();
      }
      // 옆머리
      [[1], [-1]].forEach(([d]) => {
        const x = 280 - 110 * d;
        g.beginPath(); g.moveTo(x + 2 * d, 318); g.quadraticCurveTo(x - 12 * d, 390, x + 2 * d, 446);
        g.quadraticCurveTo(x + 20 * d, 422, x + 22 * d, 380); g.quadraticCurveTo(x + 22 * d, 344, x + 14 * d, 318); g.closePath();
        fillStroke(g, C.hair, 4.5);
      });
      // 앞머리
      g.beginPath();
      g.moveTo(166, 352); g.bezierCurveTo(158, 240, 402, 240, 394, 352);
      const tips = [[372, 322], [352, 342], [330, 312], [306, 338], [282, 308], [258, 338], [232, 312], [210, 342], [188, 322]];
      let px2 = 394, py2 = 352;
      tips.forEach(([x, y]) => { g.quadraticCurveTo((px2 + x) / 2 + 2, Math.min(py2, y) - 6, x, y); px2 = x; py2 = y; });
      g.quadraticCurveTo(176, 330, 166, 352);
      g.closePath(); fillStroke(g, C.hair, 5);
      // 머릿결과 윤기
      ln(g, 3, C.hairD);
      [[230, 272, 214, 312], [280, 262, 280, 300], [330, 272, 346, 312]].forEach(([a1, b1, a2, b2]) => { g.beginPath(); g.moveTo(a1, b1); g.quadraticCurveTo((a1 + a2) / 2 + 6, (b1 + b2) / 2, a2, b2); g.stroke(); });
      g.beginPath(); g.arc(280, 330, 92, 1.18 * Math.PI, 1.42 * Math.PI); ln(g, 6, "rgba(255,255,255,0.8)"); g.stroke();
    };
  }
  // 모자: 넓은 챙 + 왼쪽으로 축 늘어진 고깔
  function drawHat(g) {
    g.save(); g.translate(280, 258); g.rotate(-0.05); g.translate(-280, -258);
    g.beginPath(); g.ellipse(280, 264, 186, 40, 0, 0, Math.PI * 2); fillStroke(g, C.blueD, 5);
    g.beginPath(); g.ellipse(280, 256, 182, 35, 0, 0, Math.PI * 2); g.fillStyle = C.blue; g.fill();
    const crown = new Path2D();
    crown.moveTo(206, 256);
    crown.quadraticCurveTo(224, 172, 256, 122);
    crown.quadraticCurveTo(206, 100, 140, 138);
    crown.quadraticCurveTo(186, 62, 272, 60);
    crown.quadraticCurveTo(326, 58, 330, 126);
    crown.quadraticCurveTo(342, 200, 356, 256);
    const crownLine = new Path2D(crown); // 아랫단 선 없이 외곽만
    crown.closePath();
    g.fillStyle = C.blue; g.fill(crown);
    g.save(); g.clip(crown); g.fillStyle = C.blueD; g.beginPath(); g.moveTo(318, 60); g.quadraticCurveTo(310, 180, 322, 262); g.lineTo(380, 262); g.lineTo(380, 50); g.fill();
    g.fillStyle = "rgba(255,255,255,0.14)"; g.beginPath(); g.moveTo(236, 250); g.quadraticCurveTo(246, 170, 272, 118); g.lineTo(282, 122); g.quadraticCurveTo(260, 180, 256, 252); g.fill();
    g.restore();
    ln(g, 5); g.stroke(crownLine);
    // 챙 앞부분이 고깔 아랫단을 덮도록 다시 그림
    g.save(); g.beginPath(); g.rect(80, 256, 400, 60); g.clip();
    g.beginPath(); g.ellipse(280, 256, 182, 35, 0, 0, Math.PI * 2); g.fillStyle = C.blue; g.fill();
    g.restore();
    g.beginPath(); g.ellipse(280, 256, 182, 35, 0, 0, Math.PI); ln(g, 4); g.stroke();
    g.beginPath(); g.ellipse(280, 256, 182, 35, 0, 0.93 * Math.PI, 2.07 * Math.PI); ln(g, 3, "rgba(39,51,95,0.5)"); g.stroke();
    star(g, 298, 186, 17, 0.2); star(g, 252, 156, 10, -0.2); star(g, 178, 112, 9, 0.3); star(g, 316, 110, 9, 0);
    star(g, 150, 262, 11, 0.1); star(g, 408, 252, 11, -0.2); star(g, 284, 276, 12, 0.3);
    g.restore();
  }
  function drawArm(sx) {
    return (g) => {
      g.beginPath(); g.arc(sx, 582, 15, 0, Math.PI * 2); fillStroke(g, C.skin, 4.5);
      g.beginPath();
      g.moveTo(sx - 13, 458); g.lineTo(sx + 13, 458);
      g.quadraticCurveTo(sx + 17, 520, sx + 27, 566); g.quadraticCurveTo(sx, 578, sx - 27, 566);
      g.quadraticCurveTo(sx - 17, 520, sx - 13, 458);
      fillStroke(g, C.blue, 5);
      g.beginPath(); g.ellipse(sx, 567, 27, 8, 0, 0, Math.PI * 2); fillStroke(g, C.gold, 3.5);
    };
  }
  function drawWand(g) {
    g.beginPath(); g.roundRect(328, 432, 8, 176, 4); fillStroke(g, "#5a3a24", 3.5);
    g.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 13 : 30, a2 = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(332 + Math.cos(a2) * r, 420 + Math.sin(a2) * r); }
    g.closePath(); g.fillStyle = C.gold; g.fill(); ln(g, 4); g.stroke();
    g.fillStyle = "rgba(255,255,255,0.75)"; g.beginPath(); g.ellipse(325, 412, 5, 8, -0.5, 0, Math.PI * 2); g.fill();
  }

  const root = new THREE.Group(); wizardSpot.add(root);
  const body = new THREE.Group(); root.add(body);
  body.add(makePart([150, 428, 262, 280], P.feet, drawBody, 0));

  const headG = new THREE.Group(); const hp0 = rel(P.neck, P.feet); headG.position.set(hp0[0], hp0[1], 0); body.add(headG);
  const HEAD_Y = hp0[1];
  const headBox = [132, 222, 296, 240];
  const faceTex = { normal: partTexture(headBox, drawHead("normal")), blink: partTexture(headBox, drawHead("blink")), happy: partTexture(headBox, drawHead("happy")) };
  const headMesh = makePart(headBox, P.neck, drawHead("normal"), 1); headMesh.material.map = faceTex.normal; headG.add(headMesh);

  const hatG = new THREE.Group(); const hp1 = rel(P.brim, P.neck); hatG.position.set(hp1[0], hp1[1], 0.01); headG.add(hatG);
  hatG.add(makePart([84, 44, 392, 272], P.brim, drawHat, 2));

  const armL = new THREE.Group(), armR = new THREE.Group();
  const aL0 = rel(P.shL, P.feet), aR0 = rel(P.shR, P.feet);
  armL.position.set(aL0[0], aL0[1], 0.03); armR.position.set(aR0[0], aR0[1], 0.03); body.add(armL, armR);
  armL.add(makePart([P.shL[0] - 36, 448, 72, 156], P.shL, drawArm(P.shL[0]), 4));
  armR.add(makePart([P.shR[0] - 36, 448, 72, 156], P.shR, drawArm(P.shR[0]), 4));
  const wandG = new THREE.Group(); const w0 = rel(P.handR, P.shR); wandG.position.set(w0[0], w0[1], -0.002); armR.add(wandG);
  wandG.add(makePart([294, 384, 76, 230], P.handR, drawWand, 3));
  const tipMarker = new THREE.Object3D(); tipMarker.position.set(0, (P.handR[1] - 420) / U, 0.05); wandG.add(tipMarker);

  const gemGlowMat = new THREE.SpriteMaterial({ map: makeGlowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 });
  const gemGlow = new THREE.Sprite(gemGlowMat); gemGlow.renderOrder = 30; scene.add(gemGlow);

  /* ---- 거대한 마법책 ---- */
  const W = 1.4, D = 2.0, N = 28, GAP = 0.0036, BASE = 0.018, BOOK_S = 2.0;
  const bookOuter = new THREE.Group(); scene.add(bookOuter);
  const book = new THREE.Group(); book.rotation.x = Math.PI / 2 - 0.06; bookOuter.add(book); // 세워서 카메라를 향하게
  book.scale.setScalar(BOOK_S);
  const coverTex = makeCoverTexture(), endTex = makeEndpaperTexture(), pageTex = makePageTexture();
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x1b3163, roughness: 0.6 });
  const outMat = new THREE.MeshStandardMaterial({ map: coverTex, roughness: 0.5, metalness: 0.15 });
  const inMat = new THREE.MeshStandardMaterial({ map: endTex, roughness: 0.8 });
  const pageMat = new THREE.MeshStandardMaterial({ map: pageTex, roughness: 0.92, side: THREE.DoubleSide, emissive: new THREE.Color(0xffc46a), emissiveIntensity: 0.1 });
  const coverGeo = new THREE.BoxGeometry(W + 0.05, 0.05, D + 0.1); coverGeo.translate((W + 0.05) / 2, 0, 0);
  const pageGeo = new THREE.PlaneGeometry(W * 0.97, D * 0.95); pageGeo.rotateX(-Math.PI / 2); pageGeo.translate((W * 0.97) / 2, 0, 0);
  const pivot = (m) => { const p = new THREE.Group(); p.add(m); book.add(p); return p; };
  const leftCover = pivot(new THREE.Mesh(coverGeo, [edgeMat, edgeMat, outMat, inMat, edgeMat, edgeMat]));
  const rightCover = pivot(new THREE.Mesh(coverGeo, [edgeMat, edgeMat, inMat, outMat, edgeMat, edgeMat]));
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1, D + 0.1), edgeMat); book.add(spine);
  const pages = [];
  for (let i = 0; i < N; i++) {
    const pv = pivot(new THREE.Mesh(pageGeo, pageMat));
    const right = i >= N / 2, k = N - 1 - i;
    pages.push({
      pv, right,
      closedY: BASE + i * GAP,
      openY: right ? BASE + k * GAP : BASE + i * GAP,
      openAng: right ? 0.06 + k * 0.0032 : Math.PI - 0.06 - i * 0.0032,
      start: right ? T.closeStart + (i - N / 2) * 0.055 : T.closeStart,
      dur: right ? 0.6 : 1.7,
    });
  }
  const closedTop = BASE + N * GAP + 0.03;
  const additive = (tex, color, op) => new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: op || 0 }));
  const bookGlow = additive(makeGlowTexture(), 0xffc870); scene.add(bookGlow);
  const closeRing = additive(makeRingTexture(), 0xffe2a0); scene.add(closeRing);
  const coverStarGlow = additive(makeGlowTexture(), 0xffe0a0); scene.add(coverStarGlow);

  /* ---- 파티클 ---- */
  // 책 주위 금빛 별가루
  const ON = 1400, oA = { aA0: A(ON, 1), aR: A(ON, 1), aLife: A(ON, 1), aOff: A(ON, 1), aSpin: A(ON, 1), aSize: A(ON, 1), aColor: A(ON, 3) };
  for (let i = 0; i < ON; i++) {
    oA.aA0.arr[i] = rr(0, Math.PI * 2); oA.aR.arr[i] = rr(1.2, 4.2); oA.aLife.arr[i] = rr(3, 6); oA.aOff.arr[i] = rr(0, 6);
    oA.aSpin.arr[i] = rr(0.4, 1.1) * (rand() < 0.85 ? 1 : -1); oA.aSize.arr[i] = rand() < 0.07 ? rr(0.22, 0.34) : rr(0.06, 0.15);
    oA.aColor.arr.set(rand() < 0.5 ? GOLD : rand() < 0.6 ? CREAM : AMBER, i * 3);
  }
  const orbit = pointsFrom(oA, ON, orbitVert, { uTime: { value: 0 }, uPR: { value: PR }, uAmp: { value: 0 }, uCenter: { value: new THREE.Vector3() } });
  scene.add(orbit);
  // 지팡이 → 책 빛줄기
  const TN = 320, tA = { aOff: A(TN, 1), aSpeed: A(TN, 1), aSize: A(TN, 1), aColor: A(TN, 3) };
  for (let i = 0; i < TN; i++) { tA.aOff.arr[i] = rand(); tA.aSpeed.arr[i] = rr(0.35, 0.7); tA.aSize.arr[i] = rr(0.06, 0.16); tA.aColor.arr.set(rand() < 0.6 ? GOLD : CREAM, i * 3); }
  const thread = pointsFrom(tA, TN, threadVert, { uTime: { value: 0 }, uPR: { value: PR }, uAmp: { value: 0 }, uFrom: { value: new THREE.Vector3() }, uTo: { value: new THREE.Vector3() } });
  scene.add(thread);
  // 폭죽
  const starts = [2.4, 3.1, 3.8, 4.6, 5.2, 6.05, 6.15, 6.3, 7.0, 7.7];
  const PER = 170, FN = starts.length * PER;
  const fA = { aOrigin: A(FN, 3), aDir: A(FN, 3), aStart: A(FN, 1), aSpeed: A(FN, 1), aSize: A(FN, 1), aColor: A(FN, 3) };
  starts.forEach((st, b) => {
    const o = [rr(-9, 9), rr(5.5, 10), rr(-9, -5)];
    const c1 = FIRE[Math.floor(rand() * FIRE.length)], c2 = rand() < 0.5 ? CREAM : GOLD;
    const big = st > 6 && st < 6.4;
    for (let j = 0; j < PER; j++) {
      const i = b * PER + j, u = rr(-1, 1), th = rr(0, Math.PI * 2), s = Math.sqrt(1 - u * u);
      fA.aOrigin.arr.set(o, i * 3); fA.aDir.arr.set([s * Math.cos(th), u, s * Math.sin(th)], i * 3);
      fA.aStart.arr[i] = st; fA.aSpeed.arr[i] = rr(3.2, 4.2) * (big ? 1.3 : 1); fA.aSize.arr[i] = rr(0.12, 0.24);
      fA.aColor.arr.set(rand() < 0.7 ? c1 : c2, i * 3);
    }
  });
  const fire = pointsFrom(fA, FN, fireVert, { uTime: { value: 0 }, uPR: { value: PR }, uPeriod: { value: 8.0 } });
  scene.add(fire);
  // 쏟아지는 별
  const RN = 380, rA = { aBase: A(RN, 3), aStart: A(RN, 1), aSpeed: A(RN, 1), aPhase: A(RN, 1), aSize: A(RN, 1), aColor: A(RN, 3) };
  for (let i = 0; i < RN; i++) {
    rA.aBase.arr.set([rr(-12, 12), rr(10, 12), rr(-4, 5)], i * 3);
    rA.aStart.arr[i] = T.rain + rr(0, 2.5); rA.aSpeed.arr[i] = rr(1.2, 2.4); rA.aPhase.arr[i] = rr(0, 6.28);
    rA.aSize.arr[i] = rr(0.12, 0.3); rA.aColor.arr.set(rand() < 0.55 ? GOLD : CREAM, i * 3);
  }
  const rain = pointsFrom(rA, RN, rainVert, { uTime: { value: 0 }, uPR: { value: PR } });
  scene.add(rain);
  // 색종이
  const CN = 420;
  const confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.17, 0.1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), CN);
  confetti.frustumCulled = false; scene.add(confetti);
  const CC = ["#f5c451", "#f28fb1", "#7fd6b5", "#7fb6f2", "#b59af0", "#fff3d6", "#ff9d6c"];
  const conf = [];
  const col = new THREE.Color();
  for (let i = 0; i < CN; i++) {
    col.set(CC[Math.floor(rand() * CC.length)]); confetti.setColorAt(i, col);
    conf.push({ x: rr(-12, 12), z: rr(-4, 6), top: rr(10, 13), start: T.rain + rr(0, 2.2), speed: rr(1.1, 2.1), fx: rr(1.5, 3.5), ph: rr(0, 6.28), sx: rr(2, 6), sy: rr(1, 4), sc: rr(0.8, 1.4) });
  }
  confetti.instanceColor.needsUpdate = true;
  const dummy = new THREE.Object3D();

  /* ---- 리사이즈 ---- */
  let wizX = -4.4, wizS = 1.15, bookX = 0.9;
  function resize() {
    const w = mount.clientWidth || 1, h = mount.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const portrait = camera.aspect < 1;
    camFactor = portrait ? 1 + (1 - camera.aspect) * 1.5 : 1;
    wizX = portrait ? -2.0 : -4.4; wizS = portrait ? 0.95 : 1.15; bookX = portrait ? 0.4 : 0.9;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize); ro.observe(mount);

  /* ---- 루프 ---- */
  let simTime = 0, running = false, last = performance.now(), raf = 0, bannerFired = false;
  const tmpQ = new THREE.Quaternion(), tipW = new THREE.Vector3(), bookC = new THREE.Vector3();

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (running) simTime += dt;
    const t = simTime;

    /* 마법사 */
    wizardSpot.position.set(wizX, 0, 1.2); wizardSpot.scale.setScalar(wizS); wizardSpot.rotation.y = 0;
    const raise = ease.inOutSine(seg(t, T.raise, T.raise + 1.2));
    const cheer = ease.outCubic(seg(t, T.banner, T.banner + 0.6));
    const breathe = Math.sin(t * 2.2);
    const sq = 1 + breathe * 0.012 + 0.05 * Math.sin(seg(t, T.raise, T.raise + 0.8) * Math.PI);
    const hop = cheer * Math.abs(Math.sin((t - T.banner) * 3.6)) * 0.22;
    root.position.y = hop;
    body.scale.set(1 / Math.sqrt(sq), sq, 1);
    shadow.scale.setScalar(1 - hop);
    armR.rotation.z = lerp(0.22, 2.45, raise) + Math.sin(t * 2) * 0.04 * raise;
    wandG.rotation.z = lerp(-2.6, -2.62, raise) + Math.sin(t * 3) * 0.03;
    armL.rotation.z = lerp(-0.2 - 0.25 * raise + 0.03 * Math.sin(t * 1.5), -2.35 + Math.sin(t * 7) * 0.25, cheer);
    headG.position.y = HEAD_Y + 0.012 * breathe;
    headG.rotation.z = 0.035 * Math.sin(t * 1.3) - 0.07 * raise * (1 - cheer) + 0.07 * Math.sin(t * 3.6) * cheer;
    hatG.rotation.z = 0.03 * Math.sin(t * 1.7 + 1) + 0.05 * Math.sin(t * 3.6 + 0.5) * cheer;
    const blinking = (t % 3.4) < 0.13;
    headMesh.material.map = cheer > 0.3 ? faceTex.happy : blinking ? faceTex.blink : faceTex.normal;

    tipMarker.getWorldPosition(tipW);
    gemGlow.position.copy(tipW);
    gemGlowMat.opacity = clamp(0.35 + raise * 0.45 + 0.08 * Math.sin(t * 5), 0, 0.85);
    gemGlow.scale.setScalar(0.8 + raise * 1.0 + 0.12 * Math.sin(t * 6));

    /* 책 */
    const descend = ease.outCubic(seg(t, T.bookIn, T.bookLand));
    const closeP = ease.inOutSine(seg(t, T.closeStart, T.closed));
    bookOuter.position.set(
      bookX + (W / 2) * BOOK_S * closeP,
      lerp(13, 4.4, descend) + 0.12 * Math.sin(t * 1.3) * descend,
      -1.0
    );
    bookOuter.rotation.y = 0.08 * Math.sin(t * 0.7) - 0.05;
    bookOuter.rotation.z = 0.03 * Math.sin(t * 0.9);

    leftCover.rotation.z = lerp(Math.PI - 0.05, Math.PI, closeP);
    const rc = ease.inOutSine(seg(t, T.closeStart + 0.85, T.closed));
    rightCover.rotation.z = lerp(0.05, Math.PI - 0.005, rc);
    rightCover.position.y = lerp(0, closedTop, rc);
    spine.scale.y = lerp(0.03, closedTop + 0.03, closeP);
    spine.position.y = spine.scale.y / 2 - 0.03;
    for (const p of pages) {
      const e = ease.inOutSine(seg(t, p.start, p.start + p.dur));
      p.pv.rotation.z = lerp(p.openAng, Math.PI - 0.01, e);
      p.pv.position.y = lerp(p.openY, p.closedY, e);
    }

    bookC.set(bookX, bookOuter.position.y, -1.0);
    const closedAmt = seg(t, T.closed - 0.1, T.closed + 0.4);
    const pulse = t > T.closed ? Math.exp(-(t - T.closed) * 2.2) : 0;
    bookGlow.position.set(bookC.x, bookC.y, -1.6);
    bookGlow.material.opacity = descend * (0.42 + 0.06 * Math.sin(t * 2)) + pulse * 0.3;
    bookGlow.scale.setScalar(8.5 + pulse * 3 + 0.3 * Math.sin(t * 1.5));
    bookLight.position.set(bookC.x, bookC.y, 1.2);
    bookLight.intensity = (descend * 1.4 + pulse * 1.5) * PLI;
    pageMat.emissiveIntensity = 0.1 + 0.1 * (1 - closeP);
    if (t > T.closed && t < T.closed + 1.6) {
      const q = (t - T.closed) / 1.6;
      closeRing.position.set(bookC.x, bookC.y, -0.4);
      closeRing.material.opacity = (1 - q) * 0.6;
      closeRing.scale.setScalar(2 + ease.outCubic(q) * 14);
    } else closeRing.material.opacity = 0;
    coverStarGlow.position.set(bookC.x, bookC.y + 0.25, -0.6);
    coverStarGlow.material.opacity = closedAmt * (0.35 + 0.12 * Math.sin(t * 2.4));
    coverStarGlow.scale.setScalar(2.2 + 0.2 * Math.sin(t * 2.4));

    /* 파티클 */
    orbit.material.uniforms.uTime.value = t;
    orbit.material.uniforms.uAmp.value = seg(t, T.bookIn + 0.4, T.bookIn + 2.0);
    orbit.material.uniforms.uCenter.value.copy(bookC);
    thread.material.uniforms.uTime.value = t;
    thread.material.uniforms.uAmp.value = seg(t, T.raise + 0.9, T.raise + 1.6) * (1 - seg(t, T.closed, T.closed + 0.8));
    thread.material.uniforms.uFrom.value.copy(tipW);
    thread.material.uniforms.uTo.value.copy(bookC);
    fire.material.uniforms.uTime.value = t;
    rain.material.uniforms.uTime.value = t;

    for (let i = 0; i < CN; i++) {
      const c = conf[i], tt = t - c.start;
      if (tt < 0) { dummy.position.set(0, -50, 0); dummy.scale.setScalar(0.0001); }
      else {
        const y = c.top - ((tt * c.speed) % 15);
        dummy.position.set(c.x + Math.sin(t * c.fx + c.ph) * 0.45, y, c.z);
        dummy.rotation.set(t * c.sx + c.ph, t * c.sy, Math.sin(t * 2 + c.ph) * 0.8);
        dummy.scale.setScalar(c.sc * Math.min(1, tt * 3));
      }
      dummy.updateMatrix(); confetti.setMatrixAt(i, dummy.matrix);
    }
    confetti.instanceMatrix.needsUpdate = true;

    /* 카메라: 천천히 다가감 */
    const push = ease.inOutSine(seg(t, 0, T.banner + 1));
    camera.position.copy(camBase).sub(camTarget).multiplyScalar(camFactor * lerp(1.06, 0.97, push)).add(camTarget);
    camera.lookAt(camTarget);

    if (!bannerFired && t >= T.banner) { bannerFired = true; opts.onBanner && opts.onBanner(); }
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  return {
    start() { simTime = 0; bannerFired = false; running = true; last = performance.now(); },
    dispose() {
      cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    },
  };
}

/* ================= React 컴포넌트 ================= */
const STYLES = `@import url("https://fonts.googleapis.com/css2?family=Cinzel:wght@600;800&family=Nanum+Myeongjo:wght@700&family=Gowun+Dodum&display=swap");
.ending-root {
  --night: #0d1233; --dusk: #2b2a6e; --gilt: #e8c46a; --gilt-hi: #fff1c2; --parch: #f3ead3;
  --ribbon: rgba(18, 26, 68, 0.52);
  inset: 0; overflow: hidden; box-sizing: border-box;
  background: var(--night); color: var(--parch);
  font-family: "Gowun Dodum", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
}
.ending-root.is-fullscreen { position: fixed; z-index: 1000; }
.ending-root.is-inline { position: absolute; }
.ending-root *, .ending-root *::before, .ending-root *::after { box-sizing: border-box; }
@media (prefers-color-scheme: dark) { .ending-root { --ribbon: rgba(12, 18, 52, 0.55); } }
.ending-stage {
  position: absolute; inset: 0;
  background:
    radial-gradient(ellipse at 55% 40%, rgba(255, 200, 120, 0.12) 0%, rgba(255, 200, 120, 0) 45%),
    linear-gradient(180deg, #0a0f2b 0%, var(--dusk) 70%, #3d2f6e 100%);
}
.ending-stage canvas { position: absolute; inset: 0; width: 100% !important; height: 100% !important; display: block; }
.ending-banner {
  position: absolute; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 7vh);
  transform: translateX(-50%); width: min(90vw, 820px);
  padding: 18px 24px 20px; text-align: center; pointer-events: none;
  background: linear-gradient(90deg, rgba(0,0,0,0) 0%, var(--ribbon) 14%, var(--ribbon) 86%, rgba(0,0,0,0) 100%);
  border-top: 1px solid rgba(232, 196, 106, 0.55); border-bottom: 1px solid rgba(232, 196, 106, 0.55);
  backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
  clip-path: inset(0 50% 0 50%); opacity: 0;
}
.ending-banner.show { animation: ending-unfurl 1.2s cubic-bezier(.2, .8, .2, 1) forwards; }
@keyframes ending-unfurl {
  0% { clip-path: inset(0 50% 0 50%); opacity: 0; }
  12% { opacity: 1; }
  100% { clip-path: inset(0 0 0 0); opacity: 1; }
}
.ending-banner h2 {
  margin: 0; font-family: "Cinzel", Georgia, serif; font-weight: 800;
  font-size: clamp(30px, 6.4vw, 68px); letter-spacing: 0.1em; line-height: 1.15;
  background: linear-gradient(100deg, #c9953a 0%, var(--gilt) 30%, var(--gilt-hi) 50%, var(--gilt) 70%, #c9953a 100%);
  background-size: 250% 100%; -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 14px rgba(255, 200, 110, 0.35));
}
.ending-banner.show h2 { animation: ending-shimmer 3.2s linear 1.2s infinite, ending-track 1.6s cubic-bezier(.2,.8,.2,1) both; }
@keyframes ending-shimmer { from { background-position: 100% 0; } to { background-position: -150% 0; } }
@keyframes ending-track { from { letter-spacing: 0.32em; opacity: 0; } to { letter-spacing: 0.1em; opacity: 1; } }
.ending-banner p {
  margin: 10px 0 0; font-family: "Nanum Myeongjo", serif; font-size: clamp(14px, 1.8vw, 18px);
  color: rgba(243, 234, 211, 0.85); opacity: 0;
}
.ending-banner.show p { animation: ending-fade 0.8s ease 1.1s forwards; }
@keyframes ending-fade { to { opacity: 1; } }
.ending-error { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; text-align: center; }
@media (prefers-reduced-motion: reduce) { .ending-banner.show h2 { animation: none; } }
`;

export default function Ending({
  title = "MISSION COMPLETE",
  subtitle = "끝까지 함께 모험해 줘서 고마워요",
  fullscreen = true,
  music = true,
  onBanner,
}) {
  const stageRef = useRef(null);
  const apiRef = useRef(null);
  const musicRef = useRef(null);
  const onBannerRef = useRef(onBanner);
  const musicOnRef = useRef(music);
  const [banner, setBanner] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { onBannerRef.current = onBanner; }, [onBanner]);
  useEffect(() => {
    musicOnRef.current = music;
    if (!musicRef.current) return;
    if (music) musicRef.current.start(); else musicRef.current.stop();
  }, [music]);

  useEffect(() => {
    try {
      apiRef.current = createEndingScene(stageRef.current, {
        onBanner: () => {
          setBanner(true);
          if (musicOnRef.current && musicRef.current) musicRef.current.chime();
          if (onBannerRef.current) onBannerRef.current();
        },
      });
    } catch (e) {
      setError("WebGL을 시작하지 못했습니다. 하드웨어 가속을 켠 브라우저에서 열어 주세요.");
      return undefined;
    }

    // 버튼 없이 자동 재생
    musicRef.current = createMusic();
    const id = setTimeout(() => {
      if (apiRef.current) apiRef.current.start();
      if (musicOnRef.current && musicRef.current) musicRef.current.start();
    }, 400);

    // 브라우저가 소리 자동 재생을 막은 경우, 화면을 처음 건드리는 순간 음악이 이어서 나옵니다
    const unlock = () => { if (musicRef.current) musicRef.current.resume(); };
    const evs = ["pointerdown", "keydown", "touchstart"];
    evs.forEach((e) => window.addEventListener(e, unlock, { passive: true }));

    return () => {
      clearTimeout(id);
      evs.forEach((e) => window.removeEventListener(e, unlock));
      if (apiRef.current) apiRef.current.dispose();
      if (musicRef.current) musicRef.current.destroy();
      apiRef.current = null;
      musicRef.current = null;
      setBanner(false);
    };
  }, []);

  return (
    <div className={"ending-root " + (fullscreen ? "is-fullscreen" : "is-inline")}>
      <style>{STYLES}</style>
      <div
        className="ending-stage"
        ref={stageRef}
        role="img"
        aria-label="꼬마 마법사가 지팡이를 들고 거대한 마법책이 닫히는 엔딩 장면"
      >
        {error && <div className="ending-error">{error}</div>}
      </div>
      <div className={"ending-banner" + (banner ? " show" : "")} aria-live="polite">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}
