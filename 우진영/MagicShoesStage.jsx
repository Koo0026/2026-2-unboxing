// MagicShoesStage.jsx
// 입 모양 칸을 모두 맞추면 ref.play() 를 호출하세요.
//   1) 마법사가 마이크를 잡고 "우와아!" 외침
//   2) 발밑에서 소용돌이 바람(토네이도)이 솟아오름
//   3) 날개 신발이 바람을 타고 내려와 발 아래에서 쏙 올라오며 꽉 맞게 신겨짐
//      (부츠 목은 바지·코트 자락 속으로 들어가고, 원래 갈색 부츠는 사라짐)
//   4) 통통 튀는 점프 3번 + 날개 파닥임
//
// 필요 패키지: react, three@0.128.0
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import wizardUrl from './assets/wizard.png';
import wizardNoBootsUrl from './assets/wizard_noboots.png';
import legsUrl from './assets/legs_overlay.png';
import bootUrl from './assets/boot.png';
import wingUrl from './assets/wing.png';

/* ------------------------------------------------------------------ */
/* 좌표계: 원본 이미지 픽셀 → 3D 월드 (1px = 0.01)                      */
/* ------------------------------------------------------------------ */
const U = 0.01;
const WIZ = { w: 250, h: 333, footX: 114, footY: 330 }; // 발바닥 중앙이 rig 원점
const wiz = (px, py) => [(px - WIZ.footX) * U, (WIZ.footY - py) * U];

// 날개 신발 이미지 (boot.png 는 날개를 떼어 낸 부츠, wing.png 는 날개만)
const BOOT = { w: 56, h: 73, soleX: 27, soleY: 73 };     // boot.png 안에서 발바닥 중앙
const WING = { w: 30, h: 44, rootX: 6, rootY: 34, k: 0.8 }; // wing.png 안에서 날개 뿌리

// 원래 갈색 부츠 자리에 딱 맞게 신기기 위한 값 (마법사 원본 픽셀 좌표)
//  - toeFlip : 발끝이 바깥쪽을 향하도록 좌우 반전
//  - wing    : 발목 바깥쪽 날개 뿌리 위치
const FEET = [
  { px: 94, py: 331, k: 0.76, toeFlip: false, z: 0.03, wing: [84, 312], wingFlip: true },  // 왼발
  { px: 138, py: 331, k: 0.8, toeFlip: true, z: 0.035, wing: [151, 310], wingFlip: false }, // 오른발
];
// 바지·코트 자락 레이어 (legs_overlay.png) — 부츠 목이 바지 안으로 들어간 것처럼 덮어 줌
const LEGS = { x0: 43, y0: 240, x1: 222, y1: 320 };
const DROP = 0.36; // 신발이 발 아래에서 올라와 신겨지는 거리

const MOUTH = { px: 148, py: 166, size: 26 };
const MIC = { grip: [62, 180], head: [104, 160] };

const TOR_H = 2.7; // 토네이도 높이

// 타임라인 (초)
const T = {
  micIn: 0.0,
  shout: 0.45,
  shoutEnd: 1.75,
  torIn: 0.9,
  torFull: 1.6,
  shoesIn: 1.7,
  arrive: 2.7,  // 발 바로 아래 도착
  snap: 3.05,   // 쏙! 다 신음
  micOut: 3.0,
  torOut: 3.25,
  torGone: 3.95,
  hop: 3.75,
  end: 6.3,
};
const HOPS = [
  { d: 0.74, h: 1.05 },
  { d: 0.62, h: 0.7 },
  { d: 0.52, h: 0.42 },
];

/* ------------------------------------------------------------------ */
/* 유틸                                                                */
/* ------------------------------------------------------------------ */
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
const easeInCubic = (x) => x * x * x;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOutBack = (x) => {
  const c1 = 1.9, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

const dotTex = () =>
  canvasTex(64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });

const sparkleTex = () =>
  canvasTex(64, (g, s) => {
    const c = s / 2;
    const r = g.createRadialGradient(c, c, 0, c, c, c * 0.55);
    r.addColorStop(0, 'rgba(255,255,255,0.9)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#fff';
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const rad = i % 2 === 0 ? c * 0.95 : c * 0.16;
      g.lineTo(c + Math.cos(a) * rad, c + Math.sin(a) * rad);
    }
    g.closePath();
    g.fill();
  });

const shadowTex = () =>
  canvasTex(128, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(10,6,40,0.75)');
    r.addColorStop(0.6, 'rgba(10,6,40,0.3)');
    r.addColorStop(1, 'rgba(10,6,40,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });

const magicCircleTex = () =>
  canvasTex(512, (g, s) => {
    const c = s / 2;
    g.strokeStyle = '#ffffff';
    g.fillStyle = '#ffffff';
    g.lineWidth = 6;
    g.beginPath(); g.arc(c, c, c * 0.94, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 3;
    g.beginPath(); g.arc(c, c, c * 0.82, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(c, c, c * 0.46, 0, Math.PI * 2); g.stroke();
    // 별 모양 (오각별)
    g.lineWidth = 4;
    g.beginPath();
    for (let i = 0; i <= 5; i++) {
      const a = ((i * 2) / 5) * Math.PI * 2 - Math.PI / 2;
      const x = c + Math.cos(a) * c * 0.8, y = c + Math.sin(a) * c * 0.8;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
    // 테두리 점
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const r = i % 3 === 0 ? 7 : 3.5;
      g.beginPath();
      g.arc(c + Math.cos(a) * c * 0.88, c + Math.sin(a) * c * 0.88, r, 0, Math.PI * 2);
      g.fill();
    }
  });

const grilleTex = () =>
  canvasTex(128, (g, s) => {
    g.fillStyle = '#c9cfdc';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#6d7488';
    for (let y = 4; y < s; y += 9)
      for (let x = (y / 9) % 2 ? 4 : 8.5; x < s; x += 9) {
        g.beginPath(); g.arc(x, y, 2.4, 0, Math.PI * 2); g.fill();
      }
  });

// 벌린 입 텍스처: 원래 그림의 '뚱한 입'을 피부색으로 덮고 그 위에 모양을 그림
function mouthTex(kind) {
  return canvasTex(128, (g, s) => {
    const c = s / 2;
    const skin = g.createRadialGradient(c, c - 6, 10, c, c - 6, 60);
    skin.addColorStop(0, 'rgba(252,205,182,1)');
    skin.addColorStop(0.7, 'rgba(252,205,182,1)');
    skin.addColorStop(1, 'rgba(252,205,182,0)');
    g.fillStyle = skin;
    g.beginPath(); g.ellipse(c, c - 8, 58, 30, 0, 0, Math.PI * 2); g.fill();

    const ink = '#3b1a14';
    g.lineWidth = 5;
    g.strokeStyle = ink;
    if (kind === 'smile') {
      g.fillStyle = '#6a1f28';
      g.beginPath();
      g.moveTo(c - 30, c - 16);
      g.quadraticCurveTo(c, c - 10, c + 30, c - 16);
      g.quadraticCurveTo(c + 22, c + 26, c, c + 26);
      g.quadraticCurveTo(c - 22, c + 26, c - 30, c - 16);
      g.closePath(); g.fill();
      g.save(); g.clip();
      g.fillStyle = '#f08a96';
      g.beginPath(); g.ellipse(c, c + 26, 20, 14, 0, 0, Math.PI * 2); g.fill();
      g.restore();
      g.stroke();
      return;
    }
    const dims = { u: [13, 15, 2], o: [20, 24, 6], a: [27, 36, 12] }[kind];
    const [rx, ry, dy] = dims;
    g.fillStyle = '#5c1a24';
    g.beginPath(); g.ellipse(c, c - 12 + dy, rx, ry, 0, 0, Math.PI * 2); g.fill();
    g.save(); g.clip();
    g.fillStyle = '#ef8390';
    g.beginPath(); g.ellipse(c, c - 12 + dy + ry, rx * 0.9, ry * 0.6, 0, 0, Math.PI * 2); g.fill();
    if (kind === 'a') {
      g.fillStyle = '#fffaf2';
      g.fillRect(c - rx, c - 12 + dy - ry, rx * 2, 7);
    }
    g.restore();
    g.beginPath(); g.ellipse(c, c - 12 + dy, rx, ry, 0, 0, Math.PI * 2); g.stroke();
  });
}

/* ------------------------------------------------------------------ */
/* 사운드 (Web Audio 합성 — 외부 파일 없이 동작)                         */
/* ------------------------------------------------------------------ */
class MagicSfx {
  constructor() { this.ctx = null; this.master = null; this.muted = false; this.noise = null; }
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
  }
  ok() { return this.ctx && !this.muted; }
  pop() {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(1100, t + 0.09);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.16);
  }
  buzz() {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.linearRampToValueAtTime(160, t + 0.2);
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.26);
  }
  // "우-와-아!" : 포먼트 합성 (한국어 음성 엔진이 없을 때의 대체)
  shoutSynth() {
    const c = this.ctx, t = c.currentTime;
    const src = c.createOscillator();
    src.type = 'sawtooth';
    const f = src.frequency;
    f.setValueAtTime(330, t);
    f.linearRampToValueAtTime(350, t + 0.26);
    f.linearRampToValueAtTime(470, t + 0.52);
    f.linearRampToValueAtTime(520, t + 0.85);
    f.linearRampToValueAtTime(390, t + 1.25);
    const vib = c.createOscillator(), vg = c.createGain();
    vib.frequency.value = 6.5; vg.gain.value = 12;
    vib.connect(vg); vg.connect(f);
    const out = c.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1.6, t + 0.05);
    out.gain.setValueAtTime(1.6, t + 1.02);
    out.gain.linearRampToValueAtTime(0, t + 1.28);
    // 우(350/800) → 오(500/900) → 아(820/1250)
    const formants = [
      { q: 7, gain: 1.0, pts: [[0, 340], [0.26, 340], [0.42, 520], [0.6, 820]] },
      { q: 9, gain: 0.55, pts: [[0, 780], [0.26, 800], [0.42, 920], [0.6, 1250]] },
      { q: 12, gain: 0.22, pts: [[0, 2300], [0.6, 2600]] },
    ];
    formants.forEach(({ q, gain, pts }) => {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = q;
      pts.forEach(([dt, hz], i) =>
        i === 0 ? bp.frequency.setValueAtTime(hz, t + dt) : bp.frequency.linearRampToValueAtTime(hz, t + dt));
      const g = c.createGain(); g.gain.value = gain;
      src.connect(bp); bp.connect(g); g.connect(out);
    });
    out.connect(this.master);
    src.start(t); vib.start(t);
    src.stop(t + 1.35); vib.stop(t + 1.35);
  }
  shout({ useSpeech = true, voiceSrc } = {}) {
    if (!this.ok()) return;
    if (voiceSrc) {
      const a = new Audio(voiceSrc);
      a.play().catch(() => this.shoutSynth());
      return;
    }
    if (useSpeech && 'speechSynthesis' in window) {
      const v = window.speechSynthesis.getVoices().find((x) => x.lang && x.lang.toLowerCase().startsWith('ko'));
      if (v) {
        const u = new SpeechSynthesisUtterance('우와아!');
        u.voice = v; u.lang = 'ko-KR'; u.pitch = 1.8; u.rate = 1.05; u.volume = 1;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
        return;
      }
    }
    this.shoutSynth();
  }
  wind(dur = 3) {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime;
    const n = c.createBufferSource();
    n.buffer = this.noise; n.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(260, t);
    bp.frequency.exponentialRampToValueAtTime(1300, t + dur * 0.35);
    bp.frequency.exponentialRampToValueAtTime(500, t + dur);
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = 3.2; lg.gain.value = 260;
    lfo.connect(lg); lg.connect(bp.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + 0.5);
    g.gain.setValueAtTime(0.55, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp); bp.connect(g); g.connect(this.master);
    n.start(t); lfo.start(t);
    n.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  }
  chime() {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime;
    [1318.5, 1568, 1975.5, 2637].forEach((hz, i) => {
      const st = t + i * 0.065;
      ['sine', 'triangle'].forEach((type, j) => {
        const o = c.createOscillator(), g = c.createGain();
        o.type = type; o.frequency.value = hz * (j ? 2 : 1);
        g.gain.setValueAtTime(0.0001, st);
        g.gain.exponentialRampToValueAtTime(j ? 0.05 : 0.22, st + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, st + 0.9);
        o.connect(g); g.connect(this.master);
        o.start(st); o.stop(st + 0.95);
      });
    });
  }
  boing(level = 1) {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    const base = 170 + (1 - level) * 90;
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * 3.1, t + 0.17);
    const w = c.createOscillator(), wg = c.createGain();
    w.frequency.value = 26; wg.gain.value = 24;
    w.connect(wg); wg.connect(o.frequency);
    g.gain.setValueAtTime(0.45 * level + 0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    o.connect(g); g.connect(this.master);
    o.start(t); w.start(t); o.stop(t + 0.34); w.stop(t + 0.34);
  }
}

/* ------------------------------------------------------------------ */
/* 셰이더                                                               */
/* ------------------------------------------------------------------ */
const TORNADO_VS = `
uniform float uTime, uGrow, uSpread, uRad;
varying vec2 vUv; varying float vEdge; varying float vH;
void main(){
  float h = position.y + 0.5;
  float ang = atan(position.z, position.x);
  float r = (0.22 + 1.05*pow(h,1.5)) * uRad * (1.0 + uSpread);
  r += sin(h*9.0 - uTime*5.0 + ang*2.0) * 0.035;
  vec3 p = vec3(cos(ang)*r, h*${TOR_H.toFixed(2)}*uGrow, sin(ang)*r);
  p.x += sin(uTime*2.3 + h*3.2) * 0.12 * h;
  p.z += cos(uTime*1.9 + h*2.7) * 0.06 * h;
  vec4 mv = modelViewMatrix * vec4(p,1.0);
  vec3 n = normalize(normalMatrix * vec3(cos(ang),0.0,sin(ang)));
  vEdge = 1.0 - abs(dot(n, normalize(-mv.xyz)));
  vUv = uv; vH = h;
  gl_Position = projectionMatrix * mv;
}`;

const TORNADO_FS = `
uniform float uTime, uOpacity, uSpeed, uBands, uTwist;
uniform vec3 uColA, uColB;
varying vec2 vUv; varying float vEdge; varying float vH;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
}
void main(){
  float s = vUv.x*uBands + vH*uTwist - uTime*uSpeed;
  float n = noise(vec2(s*3.0, vH*6.0 - uTime*2.0));
  float fs = fract(s) + (n-0.5)*0.35;
  float band = smoothstep(0.08,0.42,fs) * smoothstep(0.98,0.6,fs);
  float fade = smoothstep(0.0,0.12,vH) * smoothstep(1.0,0.72,vH);
  float a = band * fade * (0.22 + vEdge*1.0) * uOpacity;
  vec3 col = mix(uColA, uColB, vH) + vEdge*0.2;
  gl_FragColor = vec4(col, a);
}`;

const SWIRL_VS = `
uniform float uTime, uGrow, uSpread, uPx, uSize;
attribute vec4 aRand;
varying float vA;
void main(){
  float h = fract(aRand.y + uTime*(0.22 + aRand.z*0.32));
  float r = (0.22 + 1.05*pow(h,1.5)) * (0.72 + aRand.w*0.55) * (1.0 + uSpread);
  float ang = aRand.x*6.2831 + uTime*(3.0 + aRand.z*3.0)*(1.5 - h*0.6);
  vec3 p = vec3(cos(ang)*r, h*${TOR_H.toFixed(2)}*uGrow, sin(ang)*r);
  p.x += sin(uTime*2.3 + h*3.2) * 0.12 * h;
  vec4 mv = modelViewMatrix * vec4(p,1.0);
  gl_PointSize = uSize * (0.5 + aRand.w) * uPx / -mv.z;
  vA = smoothstep(0.0,0.08,h) * smoothstep(1.0,0.7,h) * (0.55 + 0.45*sin(uTime*11.0 + aRand.x*40.0));
  gl_Position = projectionMatrix * mv;
}`;

const SWIRL_FS = `
uniform sampler2D uMap; uniform vec3 uColor; uniform float uOpacity;
varying float vA;
void main(){
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(uColor, t.a * vA * uOpacity);
}`;

const BURST_VS = `
uniform float uPx;
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
varying float vA; varying vec3 vC;
void main(){
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_PointSize = aSize * uPx / -mv.z;
  vA = aAlpha; vC = aColor;
  gl_Position = projectionMatrix * mv;
}`;

const BURST_FS = `
uniform sampler2D uMap;
varying float vA; varying vec3 vC;
void main(){
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vC, t.a * vA);
}`;

/* ------------------------------------------------------------------ */
/* 엔진                                                                 */
/* ------------------------------------------------------------------ */
function createEngine(mount, bubble, cbRef) {
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  Object.assign(renderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
  mount.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const camBase = new THREE.Vector3();
  const camTarget = new THREE.Vector3(0, 2.05, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(2, 3, 5);
  scene.add(sun);

  const loader = new THREE.TextureLoader();
  const tex = (url) => {
    const t = loader.load(url);
    t.anisotropy = 4;
    return t;
  };
  const T_DOT = dotTex(), T_SPARK = sparkleTex();

  /* --- 마법사 rig (발바닥 중앙 = 원점, squash/stretch 기준점) --- */
  const rig = new THREE.Group();
  scene.add(rig);

  const wizMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(WIZ.w * U, WIZ.h * U),
    new THREE.MeshBasicMaterial({ map: tex(wizardUrl), transparent: true, alphaTest: 0.4 })
  );
  const wizTex = wizMesh.material.map;
  const wizNoBootsTex = tex(wizardNoBootsUrl);
  const setBarefootTex = (noBoots) => {
    const m = noBoots ? wizNoBootsTex : wizTex;
    if (wizMesh.material.map !== m) { wizMesh.material.map = m; wizMesh.material.needsUpdate = true; }
  };
  const [wcx, wcy] = wiz(WIZ.w / 2, WIZ.h / 2);
  wizMesh.position.set(wcx, wcy, 0);
  wizMesh.renderOrder = 1;
  rig.add(wizMesh);

  // 입
  const mouthTexs = { u: mouthTex('u'), o: mouthTex('o'), a: mouthTex('a'), smile: mouthTex('smile') };
  const mouthMat = new THREE.MeshBasicMaterial({ map: mouthTexs.u, transparent: true, alphaTest: 0.05, depthWrite: false });
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(MOUTH.size * U, MOUTH.size * U), mouthMat);
  const [mx, my] = wiz(MOUTH.px, MOUTH.py);
  mouth.position.set(mx, my, 0.012);
  mouth.renderOrder = 2;
  mouth.visible = false;
  rig.add(mouth);

  // 마이크
  const mic = new THREE.Group();
  const [gx, gy] = wiz(...MIC.grip);
  const [hx, hy] = wiz(...MIC.head);
  const micLen = Math.hypot(hx - gx, hy - gy);
  mic.position.set(gx, gy, 0.14);
  const micAngle = Math.atan2(hy - gy, hx - gx);
  mic.rotation.z = micAngle;
  {
    const body = new THREE.MeshStandardMaterial({ color: 0x2c2748, metalness: 0.3, roughness: 0.45 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xf4c35a, metalness: 0.6, roughness: 0.3 });
    const handleLen = micLen - 0.02;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.036, handleLen, 20), body);
    handle.geometry.rotateZ(-Math.PI / 2);
    handle.position.x = handleLen / 2 - 0.08;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.04, 24), gold);
    ring.geometry.rotateZ(-Math.PI / 2);
    ring.position.x = micLen - 0.09;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 28, 20),
      new THREE.MeshStandardMaterial({ map: grilleTex(), metalness: 0.55, roughness: 0.3 })
    );
    head.position.x = micLen;
    mic.add(handle, ring, head);
  }
  mic.scale.setScalar(0.0001);
  mic.visible = false;
  rig.add(mic);

  // 날개 신발
  const bootTex = tex(bootUrl), wingTex = tex(wingUrl);
  const bootMat = new THREE.MeshBasicMaterial({ map: bootTex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide });
  const wingMat = new THREE.MeshBasicMaterial({ map: wingTex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide });
  const boots = FEET.map((f) => {
    const g = new THREE.Group(); // 원점 = 발바닥 중앙
    const flip = new THREE.Group();
    flip.scale.x = f.toeFlip ? -1 : 1;
    g.add(flip);
    const bm = new THREE.Mesh(new THREE.PlaneGeometry(BOOT.w * f.k * U, BOOT.h * f.k * U), bootMat);
    bm.position.set((BOOT.w / 2 - BOOT.soleX) * f.k * U, (BOOT.soleY - BOOT.h / 2) * f.k * U, 0);
    bm.renderOrder = 3;
    flip.add(bm);

    // 날개: 발목 바깥쪽
    const pivot = new THREE.Group();
    pivot.position.set((f.wing[0] - f.px) * U, (f.py - f.wing[1]) * U, 0.04);
    pivot.scale.x = f.wingFlip ? -1 : 1;
    g.add(pivot);
    const wm = new THREE.Mesh(new THREE.PlaneGeometry(WING.w * WING.k * U, WING.h * WING.k * U), wingMat);
    wm.position.set((WING.w / 2 - WING.rootX) * WING.k * U, (WING.rootY - WING.h / 2) * WING.k * U, 0);
    wm.renderOrder = 5;
    pivot.add(wm);

    const [fx, fy] = wiz(f.px, f.py);
    g.userData = { fx, fy, fz: f.z, pivot };
    g.visible = false;
    rig.add(g);
    return g;
  });

  // 바지·코트 자락 레이어: 신발 목이 바지 속으로 들어간 것처럼 보이게 함
  const legs = new THREE.Mesh(
    new THREE.PlaneGeometry((LEGS.x1 - LEGS.x0) * U, (LEGS.y1 - LEGS.y0) * U),
    new THREE.MeshBasicMaterial({ map: tex(legsUrl), transparent: true, alphaTest: 0.4 })
  );
  {
    const [lx, ly] = wiz((LEGS.x0 + LEGS.x1) / 2, (LEGS.y0 + LEGS.y1) / 2);
    legs.position.set(lx, ly, 0.05);
  }
  legs.renderOrder = 4;
  legs.visible = false;
  rig.add(legs);

  /* --- 바닥 --- */
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.9, 1.9),
    new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0.02, 0.002, 0.05);
  shadow.scale.set(1, 0.55, 1);
  scene.add(shadow);

  const circleMat = new THREE.MeshBasicMaterial({
    map: magicCircleTex(), color: 0x8fe6d4, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const circle = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), circleMat);
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = 0.004;
  scene.add(circle);

  /* --- 토네이도 --- */
  const tornado = new THREE.Group();
  tornado.visible = false;
  scene.add(tornado);
  const torGeo = new THREE.CylinderGeometry(1, 1, 1, 64, 36, true);
  const layers = [
    { rad: 1.0, bands: 3, twist: 2.6, speed: 1.25, a: 0x7fe3d0, b: 0xeafcff, op: 0.8 },
    { rad: 0.76, bands: 4, twist: 3.6, speed: 1.8, a: 0x9ab8ff, b: 0xffffff, op: 0.55 },
    { rad: 1.2, bands: 2, twist: 1.8, speed: 0.95, a: 0xb69cff, b: 0x8fe6d4, op: 0.45 },
  ].map((L, i) => {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uGrow: { value: 0 }, uSpread: { value: 0 }, uRad: { value: L.rad },
        uOpacity: { value: 0 }, uSpeed: { value: L.speed }, uBands: { value: L.bands }, uTwist: { value: L.twist },
        uColA: { value: new THREE.Color(L.a) }, uColB: { value: new THREE.Color(L.b) },
      },
      vertexShader: TORNADO_VS, fragmentShader: TORNADO_FS,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(torGeo, mat);
    m.renderOrder = 5 + i;
    m.frustumCulled = false;
    tornado.add(m);
    return { mat, base: L.op };
  });

  const makeSwirl = (count, color, map, size) => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const rnd = new Float32Array(count * 4);
    for (let i = 0; i < count * 4; i++) rnd[i] = Math.random();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 4));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uGrow: { value: 0 }, uSpread: { value: 0 }, uPx: { value: 500 }, uSize: { value: size },
        uMap: { value: map }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 },
      },
      vertexShader: SWIRL_VS, fragmentShader: SWIRL_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const p = new THREE.Points(geo, mat);
    p.frustumCulled = false;
    p.renderOrder = 9;
    tornado.add(p);
    return mat;
  };
  const swirls = [
    makeSwirl(reduced ? 120 : 260, 0xd8fff6, T_DOT, 0.07),
    makeSwirl(reduced ? 14 : 30, 0xf4c35a, T_SPARK, 0.15),
  ];

  /* --- 파티클 버스트 (CPU) --- */
  const MAXP = 420;
  const bGeo = new THREE.BufferGeometry();
  const bPos = new Float32Array(MAXP * 3), bSize = new Float32Array(MAXP), bAlpha = new Float32Array(MAXP), bCol = new Float32Array(MAXP * 3);
  bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
  bGeo.setAttribute('aSize', new THREE.BufferAttribute(bSize, 1));
  bGeo.setAttribute('aAlpha', new THREE.BufferAttribute(bAlpha, 1));
  bGeo.setAttribute('aColor', new THREE.BufferAttribute(bCol, 3));
  const bMat = new THREE.ShaderMaterial({
    uniforms: { uPx: { value: 500 }, uMap: { value: T_SPARK } },
    vertexShader: BURST_VS, fragmentShader: BURST_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const bPts = new THREE.Points(bGeo, bMat);
  bPts.frustumCulled = false;
  bPts.renderOrder = 10;
  scene.add(bPts);
  const dustMat = bMat.clone();
  dustMat.uniforms = { uPx: bMat.uniforms.uPx, uMap: { value: T_DOT } };
  dustMat.blending = THREE.NormalBlending;
  // 먼지는 같은 풀을 쓰되 텍스처만 다르게 하려면 별도 풀 필요 → 간단히 두 번째 풀
  const dGeo = bGeo.clone();
  const dPts = new THREE.Points(dGeo, dustMat);
  dPts.frustumCulled = false;
  dPts.renderOrder = 10;
  scene.add(dPts);

  const pools = [
    { geo: bGeo, list: [] },
    { geo: dGeo, list: [] },
  ];
  const tmpColor = new THREE.Color();
  function emit(poolIdx, o) {
    const pool = pools[poolIdx];
    const n = reduced ? Math.ceil(o.count / 2) : o.count;
    for (let i = 0; i < n; i++) {
      if (pool.list.length >= MAXP) pool.list.shift();
      const a = Math.random() * Math.PI * 2;
      const up = o.up ?? 0.5;
      const sp = o.speed * (0.4 + Math.random() * 0.8);
      const col = o.colors[(Math.random() * o.colors.length) | 0];
      tmpColor.set(col);
      pool.list.push({
        x: o.x + (Math.random() - 0.5) * (o.jitter ?? 0.1),
        y: o.y + (Math.random() - 0.5) * (o.jitter ?? 0.1) * 0.5,
        z: o.z + (Math.random() - 0.5) * (o.jitter ?? 0.1),
        vx: Math.cos(a) * sp,
        vy: (Math.random() * 0.6 + up) * sp,
        vz: Math.sin(a) * sp * (o.flatZ ?? 1),
        life: 0, max: o.life * (0.6 + Math.random() * 0.6),
        size: o.size * (0.5 + Math.random() * 0.9),
        grav: o.grav ?? -2.5, drag: o.drag ?? 2.2,
        r: tmpColor.r, g: tmpColor.g, b: tmpColor.b,
      });
    }
  }
  function updatePools(dt) {
    pools.forEach(({ geo, list }) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.life += dt;
        if (p.life >= p.max) { list.splice(i, 1); continue; }
        const d = Math.exp(-p.drag * dt);
        p.vx *= d; p.vy *= d; p.vz *= d;
        p.vy += p.grav * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.y < 0.01) { p.y = 0.01; p.vy *= -0.3; }
      }
      const pos = geo.attributes.position.array, sz = geo.attributes.aSize.array;
      const al = geo.attributes.aAlpha.array, co = geo.attributes.aColor.array;
      for (let i = 0; i < MAXP; i++) {
        const p = list[i];
        if (p) {
          const k = p.life / p.max;
          pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
          sz[i] = p.size * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) * 0.6);
          al[i] = 1 - k * k;
          co[i * 3] = p.r; co[i * 3 + 1] = p.g; co[i * 3 + 2] = p.b;
        } else {
          al[i] = 0; sz[i] = 0;
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
      geo.attributes.aColor.needsUpdate = true;
    });
  }

  /* --- 충격파 링 + 섬광 --- */
  const rings = [];
  function spawnRing(color, max, dur, y = 0.01) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 1, 64),
      new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.renderOrder = 8;
    scene.add(m);
    rings.push({ m, max, dur, t: 0 });
  }
  function updateRings(dt) {
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose();
        rings.splice(i, 1); continue;
      }
      const s = 0.1 + easeOutCubic(k) * r.max;
      r.m.scale.set(s, s, s);
      r.m.material.opacity = 1 - k;
    }
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T_DOT, color: 0xfff0b8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.renderOrder = 11;
  scene.add(glow);

  /* --- 사운드 --- */
  const sfx = new MagicSfx();

  /* --- 상태 --- */
  const state = { flap: 0, flapAmp: 0.14, playing: false, start: 0, fired: new Set(), shake: 0, bootsOn: false, last: performance.now() / 1000 };
  const v3 = new THREE.Vector3();

  function setLetters(n) {
    if (state.letters !== n) { state.letters = n; cbRef.current.setLetters(n); }
  }
  function reset() {
    state.playing = false;
    state.bootsOn = false;
    state.fired.clear();
    boots.forEach((b) => { b.visible = false; b.scale.set(1, 1, 1); b.rotation.set(0, 0, 0); });
    legs.visible = false;
    setBarefootTex(false);
    mic.visible = false;
    mouth.visible = false;
    tornado.visible = false;
    circleMat.opacity = 0;
    rig.position.set(0, 0, 0);
    rig.scale.set(1, 1, 1);
    rig.rotation.set(0, 0, 0);
    bubble.style.opacity = '0';
    setLetters(0);
  }
  function play() {
    sfx.unlock();
    reset();
    state.playing = true;
    state.start = performance.now() / 1000;
    cbRef.current.onPhase && cbRef.current.onPhase('start');
  }
  const once = (t, at, name, fn) => {
    if (t >= at && !state.fired.has(name)) { state.fired.add(name); fn(); }
  };

  function footWorld(b) {
    v3.set(b.userData.fx, b.userData.fy + 0.05, b.userData.fz);
    return rig.localToWorld(v3.clone());
  }

  /* --- 프레임 --- */
  function frame(now, dt) {
    sfx.muted = !!cbRef.current.muted;
    const t = state.playing ? now - state.start : 999;

    // 공통 기본값
    let lift = 0, sx = 1, sy = 1, rotZ = 0, flapSpeed = 5, flapAmp = 0.14;
    sy += Math.sin(now * 2.2) * 0.008;

    if (state.playing) {
      /* 1) 마이크 등장 */
      once(t, T.micIn, 'mic', () => { mic.visible = true; sfx.pop(); });
      const micS = t < T.micOut ? easeOutBack(seg(t, T.micIn, T.micIn + 0.38)) : 1 - easeInCubic(seg(t, T.micOut, T.micOut + 0.3));
      mic.scale.setScalar(Math.max(0.0001, micS));
      mic.rotation.z = micAngle + (t > T.shout && t < T.shoutEnd ? Math.sin(t * 34) * 0.05 : 0);
      if (t > T.micOut + 0.3) mic.visible = false;

      /* 2) "우와아!" */
      if (t > 0.28 && t < T.shout) { const k = seg(t, 0.28, T.shout); sy -= Math.sin(k * Math.PI) * 0.07; sx += Math.sin(k * Math.PI) * 0.04; }
      if (t >= T.shout && t < T.shoutEnd) {
        const k = seg(t, T.shout, T.shoutEnd);
        sy += Math.sin(Math.min(1, k * 4) * Math.PI * 0.5) * 0.05 * (1 - k * 0.5);
        rotZ = Math.sin(t * 55) * 0.006;
        state.shake = Math.max(state.shake, 0.018);
      }
      once(t, T.shout, 'voice', () => {
        sfx.shout({ useSpeech: cbRef.current.useSpeech, voiceSrc: cbRef.current.voiceSrc });
        const [hx2, hy2] = wiz(MOUTH.px, MOUTH.py);
        v3.set(hx2 + 0.2, hy2, 0.2);
        const w = rig.localToWorld(v3.clone());
        emit(0, { x: w.x, y: w.y, z: w.z, count: 14, speed: 2.2, life: 0.6, size: 0.16, colors: ['#ffe7a0', '#ffffff'], grav: 0, up: 0.2 });
      });
      if (t >= T.shout && t < T.snap) {
        mouth.visible = true;
        const kind = t < 0.72 ? 'u' : t < 1.0 ? 'o' : t < T.shoutEnd ? 'a' : 'o';
        if (mouthMat.map !== mouthTexs[kind]) { mouthMat.map = mouthTexs[kind]; mouthMat.needsUpdate = true; }
        const wob = t < T.shoutEnd ? 1 + Math.sin(t * 40) * 0.05 : 0.8;
        mouth.scale.set(wob, wob, 1);
      }
      if (t >= T.snap) {
        mouth.visible = true;
        if (mouthMat.map !== mouthTexs.smile) { mouthMat.map = mouthTexs.smile; mouthMat.needsUpdate = true; }
        mouth.scale.set(0.9, 0.9, 1);
      }
      setLetters(t < T.shout ? 0 : t < 0.72 ? 1 : t < 1.0 ? 2 : t < 1.2 ? 3 : t < T.snap ? 4 : -1);
      bubble.style.opacity = (t >= T.shout && t < 2.5) || (t >= T.snap && t < T.snap + 0.9) ? '1' : '0';

      /* 3) 소용돌이 바람 */
      once(t, T.torIn, 'tornado', () => {
        tornado.visible = true;
        sfx.wind(T.torGone - T.torIn + 0.2);
        spawnRing(0x8fe6d4, 1.9, 0.9);
      });
      if (tornado.visible) {
        const grow = easeOutCubic(seg(t, T.torIn, T.torFull));
        const out = seg(t, T.torOut, T.torGone);
        const op = seg(t, T.torIn, T.torIn + 0.25) * (1 - out);
        layers.forEach((L) => {
          L.mat.uniforms.uTime.value = now;
          L.mat.uniforms.uGrow.value = grow;
          L.mat.uniforms.uSpread.value = easeOutCubic(out) * 0.9;
          L.mat.uniforms.uOpacity.value = op * L.base;
        });
        swirls.forEach((m) => {
          m.uniforms.uTime.value = now;
          m.uniforms.uGrow.value = grow;
          m.uniforms.uSpread.value = easeOutCubic(out) * 1.2;
          m.uniforms.uOpacity.value = op;
        });
        tornado.position.y = easeInCubic(out) * 0.7;
        if (t > T.torGone) tornado.visible = false;
      }
      circleMat.opacity = seg(t, T.torIn, T.torIn + 0.4) * (1 - seg(t, T.torOut, T.torGone)) * 0.85;
      circle.rotation.z = now * 0.8;

      // 바람에 살짝 떠오름
      const hover = easeInOut(seg(t, 1.15, 1.8)) * (1 - easeInCubic(seg(t, T.snap, T.snap + 0.25)));
      lift += hover * 0.22;
      rotZ += Math.sin(now * 8) * 0.018 * hover;

      /* 4) 날개 신발 강림 */
      once(t, T.shoesIn, 'shoes', () => boots.forEach((b) => { b.visible = true; }));
      // (a) 바람을 타고 빙글빙글 내려와 발 바로 아래에 도착
      if (t >= T.shoesIn && t < T.arrive) {
        const p = seg(t, T.shoesIn, T.arrive);
        boots.forEach((b, i) => {
          const { fx, fy, fz } = b.userData;
          const spin = (1 - easeOutCubic(p)) * Math.PI * 4;
          const a = spin + i * Math.PI;
          const r = 1.05 * (1 - easeInOut(p));
          b.position.set(fx + Math.cos(a) * r, lerp(3.3, fy - DROP, easeInOut(p)), fz + Math.sin(a) * r * 0.8);
          b.rotation.y = spin;
          const s = lerp(0.55, 1, easeOutCubic(p));
          b.scale.set(s, s, s);
          if (Math.random() < 0.6) {
            const w = b.localToWorld(v3.set(0, 0.2, 0).clone());
            emit(0, { x: w.x, y: w.y, z: w.z, count: 1, speed: 0.4, life: 0.7, size: 0.12, colors: ['#ffe7a0', '#bff6ea'], grav: -0.4, up: 0 });
          }
        });
        flapSpeed = 22; flapAmp = 0.42;
      }
      // (b) 발이 신발 속으로 쏙 — 신발이 아래에서 올라오며 부츠 목이 바지 속으로 들어감
      once(t, T.arrive, 'slip', () => { legs.visible = true; });
      if (t >= T.arrive && t < T.snap) {
        const q = seg(t, T.arrive, T.snap);
        const e = easeInOut(q);
        boots.forEach((b) => {
          const { fx, fy, fz } = b.userData;
          b.position.set(fx, fy - DROP * (1 - e), fz);
          b.rotation.set(0, 0, 0);
          const pull = Math.sin(q * Math.PI);
          b.scale.set(1 - pull * 0.06, 1 + pull * 0.1, 1);
        });
        sy -= Math.sin(q * Math.PI) * 0.03; // 발을 밀어 넣는 느낌
        flapSpeed = 14; flapAmp = 0.3;
      }
      // (c) 꽉 맞게 조여지는 반동
      if (t >= T.snap && t < T.snap + 0.5) {
        const w = seg(t, T.snap, T.snap + 0.5);
        const a = 0.15 * Math.exp(-5 * w) * Math.cos(w * 17);
        boots.forEach((b) => b.scale.set(1 + a, 1 - a * 0.8, 1));
      } else if (t >= T.snap + 0.5 && state.fired.has('snap')) {
        boots.forEach((b) => b.scale.set(1, 1, 1));
      }
      once(t, T.snap, 'snap', () => {
        state.bootsOn = true;
        setBarefootTex(true); // 원래 갈색 부츠를 지우고 날개 신발만 남김
        boots.forEach((b) => {
          b.position.set(b.userData.fx, b.userData.fy, b.userData.fz);
          b.rotation.set(0, 0, 0);
          b.scale.set(1, 1, 1);
          const w = footWorld(b);
          emit(0, { x: w.x, y: w.y + 0.1, z: w.z + 0.1, count: 26, speed: 3.2, life: 0.9, size: 0.2, colors: ['#f4c35a', '#fff3c4', '#8fe6d4', '#ffffff'], grav: -1.6, up: 0.6 });
        });
        spawnRing(0xf4c35a, 1.5, 0.7);
        spawnRing(0xffffff, 2.3, 1.0);
        sfx.chime();
        state.shake = Math.max(state.shake, 0.03);
        cbRef.current.onPhase && cbRef.current.onPhase('shoes-on');
      });
      const g = seg(t, T.snap, T.snap + 0.5);
      glow.material.opacity = g > 0 && g < 1 ? Math.sin(g * Math.PI) * 0.9 : 0;
      glow.position.set(0.1, 0.25 + lift, 0.3);
      glow.scale.setScalar(0.6 + g * 1.8);

      /* 5) 통통 점프 */
      let tt = t - T.hop;
      if (tt >= 0) {
        let landed = true;
        for (let i = 0; i < HOPS.length; i++) {
          const { d, h } = HOPS[i];
          if (tt < d) {
            landed = false;
            const u = tt / d;
            const crouch = 0.2;
            if (u < crouch) {
              const k = Math.sin((u / crouch) * Math.PI);
              sy -= k * 0.16 * (i === 0 ? 1 : 1.15);
              sx += k * 0.1;
            } else {
              once(t, T.hop + HOPS.slice(0, i).reduce((s, x) => s + x.d, 0) + d * crouch, 'hop' + i, () => sfx.boing(h / HOPS[0].h));
              const v = (u - crouch) / (1 - crouch);
              lift += h * 4 * v * (1 - v);
              const st = Math.pow(Math.abs(2 * v - 1), 3) * 0.12;
              sy += st; sx -= st * 0.5;
              flapSpeed = 30; flapAmp = 0.55;
              rotZ += Math.sin(v * Math.PI * 2) * 0.03;
            }
            break;
          }
          tt -= d;
          once(t, T.hop + HOPS.slice(0, i + 1).reduce((s, x) => s + x.d, 0), 'land' + i, () => {
            boots.forEach((b) => {
              const w = footWorld(b);
              emit(1, { x: w.x, y: 0.05, z: w.z, count: 10, speed: 1.3, life: 0.55, size: 0.22, colors: ['#e9e2ff', '#c9d6ff'], grav: 0.3, up: 0.15, flatZ: 0.5, drag: 4 });
            });
            spawnRing(0xc9d6ff, 0.9 - i * 0.15, 0.5);
          });
        }
        if (landed) {
          const k = seg(tt, 0, 0.3);
          const sq = Math.sin(k * Math.PI) * 0.1 * (1 - k);
          sy -= sq; sx += sq * 0.6;
        }
      }

      once(t, T.end, 'done', () => {
        state.playing = false;
        mouth.visible = true;
        cbRef.current.onDone && cbRef.current.onDone();
      });
    }

    // 신발 장착 후: 날개 파닥
    if (state.bootsOn && !state.playing) { flapSpeed = 6; flapAmp = 0.18; }
    state.flap += dt * flapSpeed;
    state.flapAmp = lerp(state.flapAmp, flapAmp, 1 - Math.exp(-dt * 10));
    boots.forEach((b, i) => {
      if (!b.visible) return;
      const f = Math.sin(state.flap + i * 0.6);
      b.userData.pivot.rotation.z = f * state.flapAmp + 0.05;
      b.userData.pivot.scale.y = 1 - Math.abs(f) * 0.08;
    });

    rig.position.y = lift;
    rig.scale.set(sx, sy, 1);
    rig.rotation.z = rotZ;

    // 그림자
    const s = 1 / (1 + lift * 0.55);
    shadow.scale.set(1.25 * s * sx, 0.55 * s, 1);
    shadow.material.opacity = 0.55 * s;

    updatePools(dt);
    updateRings(dt);

    // 카메라 흔들림
    camera.position.copy(camBase);
    if (!reduced && state.shake > 0.0005) {
      camera.position.x += (Math.random() - 0.5) * state.shake * 2;
      camera.position.y += (Math.random() - 0.5) * state.shake * 2;
    }
    state.shake *= Math.exp(-dt * 6);
    camera.lookAt(camTarget);

    // 말풍선 위치
    const [bx, by] = state.letters === -1 ? wiz(168, 262) : wiz(186, 96);
    const w = rig.localToWorld(v3.set(bx, by, 0).clone()).project(camera);
    const W = mount.clientWidth, H = mount.clientHeight;
    const px = Math.min((w.x + 1) / 2 * W, W - bubble.offsetWidth - 8);
    const py = (1 - w.y) / 2 * H;
    bubble.style.transform = `translate(${px.toFixed(1)}px, ${(py - bubble.offsetHeight).toFixed(1)}px)`;

    renderer.render(scene, camera);
  }

  /* --- 리사이즈: 화면 비율에 맞춰 카메라 거리 조절 --- */
  function resize() {
    const W = Math.max(1, mount.clientWidth), H = Math.max(1, mount.clientHeight);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const needH = 5.3, needW = 3.9;
    const dist = Math.max(needH / 2 / tanH, needW / 2 / (tanH * camera.aspect));
    camBase.set(0, camTarget.y + dist * 0.14, dist);
    camera.updateProjectionMatrix();
    const px = (H * renderer.getPixelRatio()) / (2 * tanH);
    swirls.forEach((m) => { m.uniforms.uPx.value = px; });
    bMat.uniforms.uPx.value = px;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(mount);
  resize();

  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - state.last);
    state.last = now;
    frame(now, dt);
  };
  loop();

  return {
    play, reset, sfx,
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
      if (sfx.ctx) sfx.ctx.close();
    },
  };
}

/* ------------------------------------------------------------------ */
/* React 컴포넌트                                                       */
/* ------------------------------------------------------------------ */
const SHOUT = ['우', '와', '아', '!'];

export const MagicShoesStage = forwardRef(function MagicShoesStage(
  { onDone, onPhase, muted = false, useSpeech = true, voiceSrc, className, style },
  ref
) {
  const mountRef = useRef(null);
  const bubbleRef = useRef(null);
  const engineRef = useRef(null);
  const [letters, setLetters] = useState(0);
  const cbRef = useRef({});
  cbRef.current = { onDone, onPhase, muted, useSpeech, voiceSrc, setLetters };

  useImperativeHandle(ref, () => ({
    play: () => engineRef.current && engineRef.current.play(),
    reset: () => engineRef.current && engineRef.current.reset(),
    unlockAudio: () => engineRef.current && engineRef.current.sfx.unlock(),
    sound: (name) => engineRef.current && engineRef.current.sfx[name] && engineRef.current.sfx[name](),
  }), []);

  useEffect(() => {
    const eng = createEngine(mountRef.current, bubbleRef.current, cbRef);
    engineRef.current = eng;
    return () => eng.dispose();
  }, []);

  return (
    <div
      ref={mountRef}
      className={className}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', ...style }}
    >
      <style>{`
        @keyframes mssPop { 0% { transform: scale(0) rotate(-25deg); } 70% { transform: scale(1.25) rotate(6deg); } 100% { transform: none; } }
        .mss-bubble { position:absolute; left:0; top:0; z-index:2; pointer-events:none; white-space:nowrap;
          padding: .28em .6em .34em; border-radius: 1.2em 1.2em 1.2em .25em; background:#fff; color:#2a1f4d;
          font-size: clamp(26px, 5.2vmin, 54px); line-height:1; letter-spacing:.02em;
          box-shadow: 0 .12em 0 #c9c0ff; transition: opacity .25s; will-change: transform; }
        .mss-bubble span { display:inline-block; animation: mssPop .32s cubic-bezier(.3,1.5,.5,1) both; }
        @media (prefers-reduced-motion: reduce) { .mss-bubble span { animation: none; } }
      `}</style>
      <div ref={bubbleRef} className="mss-bubble" aria-hidden="true" style={{ opacity: 0 }}>
        {letters === 0
          ? '\u00a0'
          : (letters < 0 ? ['쏙', '!'] : SHOUT.slice(0, letters)).map((ch, i) => (
              <span key={(letters < 0 ? 's' : 'w') + i}>{ch}</span>
            ))}
      </div>
    </div>
  );
});

export default MagicShoesStage;
