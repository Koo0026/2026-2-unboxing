// MagicShoesStage.jsx
// 이 장면에 들어오면 바로 ref.play() 를 호출하세요.
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
// 내장 "우와아!" 목소리 — 기기 음성을 못 쓸 때의 대체 / ?voice=clip (실제 사람 녹음, 0.82초, 힘 있게 외치며 끝으로 갈수록 올라감, 14KB)
//   타이밍(클립 시작 기준): 우 0~0.10초 → 와 0.10~0.14초 → 아! 0.14~0.74초(가장 크고 높음 0.70~0.74초) → 0.82초에 소리 끝
//   원본: "regular show style 'woah!'" by Reitanna — https://freesound.org/people/Reitanna/sounds/235158/
//   라이선스: CC0 1.0 (퍼블릭 도메인 — 상업적 사용·수정 자유, 출처 표기 의무 없음)
//   손본 것: 약한 시작·늘어진 모음 잘라 내기(끝 "아"를 짧게), 끝을 살짝 빠르게(+3반음) 해서 톤 올리기,
//            저음 줄이고 또렷한 고음 키우기, 압축·첫소리 강조·짧은 울림으로 '외치는' 소리 만들기, 피크 제한(-1.6dBTP)
import woowaUrl from './assets/shout_woah.mp3';

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
//  - wingTilt: 날개를 바깥쪽으로 눕히는 각도(rad) — 코트 자락 뒤에서 옆으로 뻗어 나오게
const FEET = [
  { px: 94, py: 331, k: 0.76, toeFlip: false, z: 0.03, wing: [86, 313], wingFlip: true, wingTilt: 0.42 },  // 왼발
  { px: 138, py: 331, k: 0.8, toeFlip: true, z: 0.035, wing: [146, 312], wingFlip: false, wingTilt: 0.42 }, // 오른발
];
// 바지·코트 자락 레이어 (legs_overlay.png) — 부츠 목이 바지 안으로 들어간 것처럼 덮어 줌
const LEGS = { x0: 43, y0: 240, x1: 222, y1: 320 };
const DROP = 0.36; // 신발이 발 아래에서 올라와 신겨지는 거리

const MOUTH = { px: 148, py: 166, size: 26 };
const MIC = { grip: [62, 180], head: [104, 160] };
const HEAD = { px: 148, py: 148, r: 135 }; // 머리 중심 · 효과선 크기 (원본 픽셀)
const WAND = [231, 220];                  // 지팡이 끝 반짝이

const TOR_H = 2.7; // 토네이도 높이

// "우와아!" 목소리별 타이밍 — 목소리가 '실제로' 나기 시작한 순간(onstart 등)부터의 초
//   wa: 입술이 열리기 시작(o) · a: 입을 활짝(아) · peak: 가장 높고 큰 순간(클라이맥스) · bang: 효과가 '팡' 터지는 시각
//   fade: 소리가 잦아들며 입을 오므리기 시작 · end: 소리 끝(입 다묾) · letters: 말풍선 '우·와·아·!' 가 뜨는 시각
//   ※ 목소리를 바꾸면 이 표만 고치면 됨 — 입 모양·글자·몸 동작·효과선·카메라가 모두 여기서 계산됨
const VOICE_PROFILES = {
  // 기기 음성 "우와아!" (Yuna, pitch 1.8, rate 1.05) — macOS AVSpeech 로 같은 설정 렌더 후 에너지·음높이·포먼트로 측정
  //   우 0~0.09 · 입술 둥글게(w) 0.09~0.12 · 와(입 활짝, 가장 높은 음 ≈380Hz) 0.13~0.19 · 아(음 내려감) 0.20~0.31 · 잦아듦 0.31~0.41
  //   (+0.02초: 이벤트→실제 소리 지연 보정) — onstart→onend 실측 0.50~0.56초 (onendAt)
  speech: { wa: 0.13, a: 0.155, peak: 0.17, bang: 0.155, fade: 0.33, end: 0.43, letters: [0, 0.12, 0.22, 0.3], onendAt: 0.53 },
  // 내장 목소리 shout_woah.mp3 (0.82초): 우 0~0.10 · 와 0.10~0.14 · 아! 0.14~0.82 (음이 계속 올라가 0.70 에서 정점)
  clip: { wa: 0.1, a: 0.14, peak: 0.7, bang: 0.67, fade: 0.74, end: 0.82, letters: [0, 0.11, 0.17, 0.67], dur: 0.82 },
  // 합성음(대체용, 1.24초)
  synth: { wa: 0.22, a: 0.36, peak: 1.1, bang: 1.07, fade: 1.12, end: 1.2, letters: [0, 0.23, 0.39, 1.07], dur: 1.24 },
};

// 타임라인 (초)
const T = {
  micIn: 0.0,
  shout: 0.45, // 외치기 시작 (실제 목소리 시작은 기기 음성 지연만큼 늦을 수 있음 → 그동안 웅크린 채 버팀)
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

// 만화 효과선: 머리 둘레로 뻗는 뾰족한 선 (캐릭터 뒤에 깔려 실루엣 밖으로만 보임)
const emphasisTex = () =>
  canvasTex(256, (g, s) => {
    const c = s / 2;
    const rays = [-28, -8, 12, 32, 52, 74, 112, 134, 156, 178, 200];
    rays.forEach((deg, i) => {
      const a = (deg * Math.PI) / 180;
      // 머리 쪽은 가늘고 바깥쪽 끝은 둥글고 도톰한 획
      const r0 = c * (i % 2 ? 0.6 : 0.55), r1 = c * (i % 2 ? 0.85 : 0.93), w = c * (i % 2 ? 0.028 : 0.036);
      const ux = Math.cos(a), uy = -Math.sin(a), nx = -uy, ny = ux;
      const ex = c + ux * r1, ey = c + uy * r1;
      const path = () => {
        g.beginPath();
        g.moveTo(c + ux * r0, c + uy * r0);
        g.lineTo(ex + nx * w, ey + ny * w);
        g.arc(ex, ey, w, Math.atan2(ny, nx), Math.atan2(-ny, -nx), true); // 바깥쪽으로 둥글게
        g.closePath();
      };
      g.lineJoin = 'round';
      g.lineWidth = 6; g.strokeStyle = 'rgba(255,214,110,0.55)'; path(); g.stroke();
      g.fillStyle = '#ffffff'; path(); g.fill();
    });
  });

// "우와아!" 신나는 포즈 — 꾹 웅크렸다가(예비동작) 박자마다 통! 튀어 오르고, '아!'에서 크게 젖히며 부르르
const keyLerp = (keys, t) => {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
      return lerp(v0, v1, easeInOut((t - t0) / (t1 - t0)));
    }
  }
  return keys[keys.length - 1][1];
};
// 몸 동작 — V(실제 목소리 기준 시각표)에서 계산. V 가 없으면(목소리가 아직 안 나옴) 웅크린 채 버팀
//  웅크림 → 우: 팡 → (w) 짧게 웅크림 → 아!: 크게 점프·머리 젖힘 → 클라이맥스 → 소리가 끝나면 내려와 바람 호버로
//  shear: +면 머리가 앞(오른쪽)으로, -면 뒤로 젖힘 / rot: 좌우 들썩
function shoutPose(t, V) {
  const p = { lift: 0, sx: 0, sy: 0, rot: 0, shear: 0, jx: 0, buzz: 0 };
  const S0 = T.shout;
  if (t < S0 - 0.3) return p;
  const crouchIn = easeInOut(seg(t, S0 - 0.27, S0 - 0.03));
  if (!V) { // 목소리 대기 중: 꾹 웅크리고 살짝 떨며 버팀
    p.sy -= 0.13 * crouchIn; p.sx += 0.07 * crouchIn + (t > S0 ? Math.sin(t * 60) * 0.006 : 0);
    p.shear = 0.03 * crouchIn;
    return p;
  }
  const { S, a: A, peak: P, bang: B, E } = V;
  if (t > E + 0.6) return p;
  const span = A - S, r = clamp(span / 0.14, 0.4, 1);
  const sep = B - A > 0.15; // 긴 목소리: 클라이맥스가 '아!' 시작과 따로 옴 / 짧은 목소리: '아!'가 곧 클라이맥스
  // '우!'에서 웅크림을 팡 풀어 줌
  const crouch = 1 - easeOutCubic(seg(t, S, S + 0.07));
  p.sy -= 0.13 * crouch; p.sx += 0.07 * crouch;
  // 입술을 오므리는(w) 동안 짧게 다시 웅크림 → '아!'에서 크게 점프
  const preLen = Math.min(0.06, span * 0.45), preAmt = 0.11 * clamp((span - 0.05) / 0.09);
  const sq = t > A - preLen && t < A ? easeInCubic(seg(t, A - preLen, A)) * preAmt : t >= A && t < A + 0.05 ? (1 - seg(t, A, A + 0.05)) * preAmt : 0;
  p.sy -= sq; p.sx += sq * 0.55;
  // 스프링처럼 쭉 늘어났다 돌아옴
  (sep ? [[S, 0.14], [A, 0.22], [B, 0.12]] : [[S, 0.14], [A, 0.26]]).forEach(([b, amp]) => {
    if (t >= b) { const d = t - b, s = amp * Math.exp(-7 * d) * Math.sin(2 * Math.PI * 3.2 * d); p.sy += s; p.sx -= s * 0.5; }
  });
  // '우': 까치발로 살짝
  if (t < V.wa + 0.02) p.lift += 0.045 * Math.sin(Math.PI * seg(t, S, V.wa + 0.02));
  // '아!': 크게 뛰어올랐다가 까치발로 버팀 (긴 목소리는 정점까지 한 번 더 쭉) → 소리가 끝나면 내려옴
  if (t >= A) {
    const top = A + 0.11;
    let L = t < top ? 0.17 * easeOutCubic(seg(t, A, top)) : lerp(0.17, 0.08, easeInOut(seg(t, top, top + 0.21)));
    if (sep && t > top + 0.21) L += 0.03 * easeInOut(seg(t, top + 0.21, P));
    const rel = Math.max(sep ? P : E - 0.05, top);
    p.lift += L * (1 - easeInOut(seg(t, rel, rel + 0.27)));
  }
  // 긴 목소리: 소리가 올라갈수록 몸도 점점 쭉 늘어남 (정점에서 최대)
  if (sep) {
    const swell = t >= A ? easeInCubic(seg(t, A + 0.12, P)) * (1 - easeInOut(seg(t, P, P + 0.2))) : 0;
    p.sy += 0.06 * swell; p.sx -= 0.03 * swell;
  }
  // 몸 젖히기·좌우 들썩 키
  const sk = [[S0 - 0.27, 0], [S0 - 0.03, 0.03], [S, 0.03], [S + 0.05 * r, -0.03], [A - 0.03 * r, 0.015]];
  if (sep) sk.push([A + 0.07, -0.06], [(A + 0.07 + P) / 2, -0.045], [P, -0.075]); else sk.push([A + 0.08, -0.075]);
  sk.push([Math.max(E, sk[sk.length - 1][0] + 0.05) + 0.13, 0]);
  const tk = [[S0 - 0.05, 0], [S, 0], [S + 0.05 * r, -0.03], [A - 0.02 * r, 0.02], [A + 0.09, -0.02]];
  if (sep) tk.push([(A + 0.09 + P) / 2, 0.035], [P, -0.025]);
  tk.push([Math.max(E, tk[tk.length - 1][0] + 0.05) + 0.13, 0]);
  p.shear = keyLerp(sk, t);
  p.rot = keyLerp(tk, t);
  // '아~!' 동안 부르르 — 긴 목소리는 소리가 올라갈수록 세지고, 소리가 잦아들면 멈춤
  const buzz = t >= A ? Math.min(1, (t - A) / 0.04) * (sep ? lerp(0.45, 1, seg(t, A, P)) : 1) * (1 - seg(t, sep ? P + 0.04 : A + 0.1, E + 0.08)) : 0;
  p.rot += Math.sin(t * 71) * 0.012 * buzz;
  p.jx = Math.sin(t * 93) * 0.012 * buzz;
  p.buzz = buzz;
  return p;
}

// 벌린 입 텍스처: 원래 그림의 '뚱한 입'을 피부색으로 덮고 그 위에 모양을 그림
//  - 피부색은 wizard.png 입 주변 색(#f8c0a3)과 똑같이, 가장자리는 부드럽게 번지게 해서 덧댄 티가 안 나게 함
//  - premultiplyAlpha 로 올려서 가장자리에 검은 테두리가 생기지 않게 함 (mouthMat 블렌딩과 짝)
function mouthTex(kind) {
  const t = canvasTex(128, (g, s) => {
    const c = s / 2;
    g.save();
    g.translate(c + 3, c - 9);
    g.scale(1, 26 / 46);
    const skin = g.createRadialGradient(0, 0, 0, 0, 0, 60);
    skin.addColorStop(0, 'rgba(248,192,163,1)');
    skin.addColorStop(0.74, 'rgba(248,192,163,1)');
    skin.addColorStop(1, 'rgba(248,192,163,0)');
    g.fillStyle = skin;
    g.beginPath(); g.arc(0, 0, 60, 0, Math.PI * 2); g.fill();
    g.restore();

    const ink = '#3b1a14';
    g.lineWidth = 5;
    g.lineJoin = 'round';
    g.strokeStyle = ink;
    if (kind === 'close') { // 다문 입 (소리가 끝난 뒤 — 신이 나서 입꼬리만 올라감)
      g.lineCap = 'round';
      g.lineWidth = 5.5;
      g.beginPath();
      g.moveTo(c - 20, c - 15);
      g.quadraticCurveTo(c, c + 1, c + 20, c - 15);
      g.stroke();
      return;
    }
    if (kind === 'smile') {
      const lip = () => {
        g.beginPath();
        g.moveTo(c - 30, c - 16);
        g.quadraticCurveTo(c, c - 10, c + 30, c - 16);
        g.quadraticCurveTo(c + 22, c + 26, c, c + 26);
        g.quadraticCurveTo(c - 22, c + 26, c - 30, c - 16);
        g.closePath();
      };
      g.fillStyle = '#6a1f28';
      lip(); g.fill();
      g.save(); g.clip();
      g.fillStyle = '#f08a96';
      g.beginPath(); g.ellipse(c, c + 26, 20, 14, 0, 0, Math.PI * 2); g.fill();
      g.restore();
      lip(); g.stroke(); // 입 윤곽선 (혀 타원 테두리가 입 밖으로 그려지던 문제 수정)
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
  t.premultiplyAlpha = true;
  return t;
}

/* ------------------------------------------------------------------ */
/* 사운드 (Web Audio 합성 + 내장 "우와아!" 목소리 shout_woah.mp3)       */
/* ------------------------------------------------------------------ */
class MagicSfx {
  constructor() { this.ctx = null; this.master = null; this.muted = false; this.noise = null; this.voices = {}; }
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
      this.comp = comp; // 목소리는 효과음 버스(master)를 거치지 않고 여기로 바로 들어감
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.loadVoice(woowaUrl); // 외치기(0.45초) 전에 미리 디코딩
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
  }
  // 목소리 파일(data URL 또는 경로) → AudioBuffer (한 번만 디코딩해 캐시)
  loadVoice(src) {
    if (!this.ctx || !src) return Promise.resolve(null);
    if (this.voices[src]) return this.voices[src].p;
    const c = this.ctx, slot = { buf: null, p: null };
    const bytes = /^data:[^,]*;base64,/.test(src)
      ? Promise.resolve().then(() => Uint8Array.from(atob(src.slice(src.indexOf(',') + 1)), (ch) => ch.charCodeAt(0)).buffer)
      : fetch(src).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); });
    slot.p = bytes
      .then((ab) => new Promise((res, rej) => { const q = c.decodeAudioData(ab, res, rej); if (q && q.catch) q.catch(rej); }))
      .then((buf) => (slot.buf = buf))
      .catch(() => null);
    this.voices[src] = slot;
    return slot.p;
  }
  // 목소리 재생: 목소리를 맨 앞에 두고, 외치는 동안 나머지 효과음(바람·반짝이 등)을 살짝 낮췄다가 부드럽게 되돌림
  playBuffer(buf, gain = 1.1) {
    const c = this.ctx, t = c.currentTime, s = c.createBufferSource(), g = c.createGain();
    s.buffer = buf; g.gain.value = gain;
    s.connect(g); g.connect(this.comp || this.master);
    s.start(t);
    if (this.comp) this.duck(t, buf.duration);
  }
  duck(t, dur, db = -6) {
    const m = this.master.gain, base = 0.85, low = base * Math.pow(10, db / 20);
    m.cancelScheduledValues(t);
    m.setValueAtTime(m.value, t);
    m.linearRampToValueAtTime(low, t + 0.06);
    m.setValueAtTime(low, t + Math.max(0.06, dur - 0.1));
    m.linearRampToValueAtTime(base, t + dur + 0.35);
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
  // "우-와-아!" 포먼트 합성 (내장 목소리를 못 틀 때의 대체) — 기본 목소리와 같은 박자·같은 상승 억양
  shoutSynth() {
    const c = this.ctx, t = c.currentTime, D = 1.24;
    // 성대 펄스에 가까운 음원: 배음이 1/n^1.6 로 줄어듦 (톱니파보다 덜 날카로움)
    const N = 40, re = new Float32Array(N), im = new Float32Array(N);
    for (let n = 1; n < N; n++) im[n] = Math.pow(n, -1.6);
    const src = c.createOscillator();
    src.setPeriodicWave(c.createPeriodicWave(re, im));
    // 음높이: 우↗ 와↗ 아↗! (끝으로 갈수록 올라감, Hz)
    const knots = [[0, 285], [0.1, 300], [0.22, 330], [0.27, 322], [0.36, 345], [0.5, 405],
      [0.555, 400], [0.7, 445], [0.85, 495], [1.0, 535], [1.12, 555], [D, 575]];
    const curve = new Float32Array(125);
    for (let i = 0, k = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * D;
      while (k < knots.length - 2 && x > knots[k + 1][0]) k++;
      const [x0, y0] = knots[k], [x1, y1] = knots[k + 1];
      const u = clamp((x - x0) / (x1 - x0));
      curve[i] = y0 + (y1 - y0) * (0.5 - 0.5 * Math.cos(Math.PI * u));
    }
    src.frequency.setValueCurveAtTime(curve, t, D);
    // 끝의 '아!'에서 커지는 떨림(비브라토)
    const vib = c.createOscillator(), vg = c.createGain();
    vib.frequency.value = 6; vg.gain.setValueAtTime(2, t);
    vg.gain.setValueAtTime(3, t + 0.8); vg.gain.linearRampToValueAtTime(11, t + 1.1);
    vib.connect(vg); vg.connect(src.frequency);
    // 숨소리(기식음) 약간
    const br = c.createBufferSource(); br.buffer = this.noise;
    const bg = c.createGain(); bg.gain.value = 0.05;
    br.connect(bg);
    // 세기: 우(조금 작게) → 와 → (살짝 끊고) 아!(가장 크게) → 숨 섞인 마무리
    const out = c.createGain(), A = 1.5, gp = out.gain;
    gp.setValueAtTime(0, t);
    gp.linearRampToValueAtTime(A * 0.5, t + 0.03);
    gp.linearRampToValueAtTime(A * 0.6, t + 0.27);
    gp.linearRampToValueAtTime(A * 0.85, t + 0.5);
    gp.linearRampToValueAtTime(A * 0.6, t + 0.535);
    gp.linearRampToValueAtTime(A * 0.9, t + 0.6);
    gp.linearRampToValueAtTime(A, t + 0.95);
    gp.setValueAtTime(A, t + 1.1);
    gp.linearRampToValueAtTime(A * 0.12, t + 1.2);
    gp.linearRampToValueAtTime(0, t + D);
    // 입 모양: 우(330/800/2400) → ㅘ 미끄러짐 → 아(900/1500/2750)
    const formants = [
      { q: 5, gain: 1.0, pts: [[0, 330], [0.22, 350], [0.36, 860], [D, 930]] },
      { q: 7, gain: 0.6, pts: [[0, 780], [0.22, 820], [0.36, 1450], [D, 1550]] },
      { q: 10, gain: 0.28, pts: [[0, 2400], [0.36, 2700], [D, 2800]] },
    ];
    formants.forEach(({ q, gain, pts }) => {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = q;
      pts.forEach(([dt, hz], i) =>
        i === 0 ? bp.frequency.setValueAtTime(hz, t + dt) : bp.frequency.linearRampToValueAtTime(hz, t + dt));
      const g = c.createGain(); g.gain.value = gain;
      src.connect(bp); bg.connect(bp); bp.connect(g); g.connect(out);
    });
    out.connect(this.master);
    src.start(t); vib.start(t); br.start(t);
    src.stop(t + D + 0.05); vib.stop(t + D + 0.05); br.stop(t + D + 0.05);
  }
  // 외치기 — 기본(voice='speech')은 처음 버전처럼 기기 음성이 "우와아!"를 직접 읽음
  //   (첫 번째 한국어 음성, pitch 1.8, rate 1.05 — 맥·아이폰은 Yuna). voice='clip' 이면 내장 목소리 파일(shout_woah.mp3, CC0).
  //   voiceSrc 를 주면 그 파일. 실패하면 내장 목소리 파일 → 합성음 순서로 대체.
  //   on.start(kind, info): 목소리가 '실제로' 나기 시작한 순간 → 입 모양·말풍선 글자·몸 동작의 기준점
  //   on.end(): 목소리가 끝난 순간 (기기 음성의 onend 등)
  shout({ useSpeech = false, voiceSrc, voice = 'speech', on = {} } = {}) {
    const start = (kind, info = {}) => on.start && on.start(kind, info);
    if (!this.ok()) { start('silent'); return; }
    if (voiceSrc) {
      const a = new Audio(voiceSrc);
      a.addEventListener('playing', () => start('file', { dur: a.duration }), { once: true });
      a.addEventListener('ended', () => on.end && on.end(), { once: true });
      a.play().catch(() => this.shoutBuiltIn(useSpeech, on));
      return;
    }
    if (voice === 'speech') { this.shoutSpeech(useSpeech, on); return; }
    this.shoutBuiltIn(useSpeech, on);
  }
  // 기기의 한국어 음성으로 "우와아!" (처음 버전 설정 그대로)
  //   ※ 기기마다 목소리·시작 지연이 다름(맥/아이폰 Yuna, 윈도우 Heami, 안드로이드 Google).
  //   한국어 음성이 없거나, 0.6초 안에 시작하지 못하거나, 오류가 나면 내장 목소리 파일로 대체
  shoutSpeech(useSpeech, on = {}, deadline = performance.now() + 600) {
    const ss = 'speechSynthesis' in window ? window.speechSynthesis : null;
    const fallback = () => (this.ok() ? this.shoutBuiltIn(useSpeech, on) : on.start && on.start('silent', {}));
    if (!ss) { fallback(); return; }
    const all = ss.getVoices();
    const v = all.find((x) => x.lang && x.lang.toLowerCase().replace('_', '-').startsWith('ko'));
    if (!v) {
      if (all.length === 0 && performance.now() < deadline) { // 음성 목록이 아직 안 불러와짐 → 마감 전까지 기다림
        let done = false;
        const retry = () => { if (done) return; done = true; ss.removeEventListener('voiceschanged', retry); clearTimeout(to); this.shoutSpeech(useSpeech, on, deadline); };
        const to = setTimeout(() => { if (done) return; done = true; ss.removeEventListener('voiceschanged', retry); fallback(); }, Math.max(0, deadline - performance.now()));
        ss.addEventListener('voiceschanged', retry);
        return;
      }
      fallback();
      return;
    }
    const u = new SpeechSynthesisUtterance('우와아!');
    u.voice = v; u.lang = 'ko-KR'; u.pitch = 1.8; u.rate = 1.05; u.volume = 1;
    let started = false, gaveUp = false, ended = false;
    const giveUp = () => {
      if (started || gaveUp) return;
      gaveUp = true; ss.cancel();
      fallback();
    };
    const finish = () => {
      if (!started || gaveUp || ended) return;
      ended = true;
      this.unduck();
      on.end && on.end();
    };
    u.onstart = () => {
      if (started || gaveUp) return;
      started = true;
      if (this.comp) this.duck(this.ctx.currentTime, 2); // 목소리가 끝나면(onend) unduck 으로 되돌림
      on.start && on.start('speech', { voiceName: v.name });
    };
    u.onend = finish;
    u.onerror = () => (started ? finish() : giveUp());
    ss.cancel();
    ss.speak(u);
    setTimeout(giveUp, Math.max(0, deadline - performance.now()));
    setTimeout(finish, 3000); // onend 가 오지 않는 기기 대비
  }
  unduck() {
    if (!this.ctx || !this.master) return;
    const m = this.master.gain, t = this.ctx.currentTime;
    m.cancelScheduledValues(t);
    m.setValueAtTime(m.value, t);
    m.linearRampToValueAtTime(0.85, t + 0.35);
  }
  shoutBuiltIn(useSpeech, on = {}) {
    const start = (kind, info = {}) => on.start && on.start(kind, info);
    const slot = this.voices[woowaUrl];
    if (slot && slot.buf) { this.playBuffer(slot.buf); start('clip', { dur: slot.buf.duration }); return; }
    const t0 = this.ctx.currentTime;
    this.loadVoice(woowaUrl).then((buf) => {
      if (!this.ok()) { start('silent'); return; }
      if (buf) {
        if (this.ctx.currentTime - t0 < 0.3) { this.playBuffer(buf); start('clip', { dur: buf.duration }); } else start('silent');
      } else this.shoutFallback(useSpeech, on);
    });
  }
  shoutFallback(useSpeech, on = {}) {
    if (useSpeech && 'speechSynthesis' in window) {
      const v = window.speechSynthesis.getVoices().find((x) => x.lang && x.lang.toLowerCase().startsWith('ko'));
      if (v) {
        const u = new SpeechSynthesisUtterance('우와아!');
        u.voice = v; u.lang = 'ko-KR'; u.pitch = 1.8; u.rate = 1.05; u.volume = 1;
        u.onstart = () => on.start && on.start('speech', { voiceName: v.name });
        u.onend = () => on.end && on.end();
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
        return;
      }
    }
    this.shoutSynth();
    on.start && on.start('synth', { dur: 1.24 });
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
  rig.matrixAutoUpdate = false; // 몸 젖히기(shear)를 넣기 위해 행렬을 직접 갱신 (frame 끝부분)
  const shearM = new THREE.Matrix4();
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
  const mouthTexs = { u: mouthTex('u'), o: mouthTex('o'), a: mouthTex('a'), close: mouthTex('close'), smile: mouthTex('smile') };
  const mouthMat = new THREE.MeshBasicMaterial({
    map: mouthTexs.u, transparent: true, alphaTest: 0.004, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, // premultiplied
  });
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(MOUTH.size * U, MOUTH.size * U), mouthMat);
  const [mx, my] = wiz(MOUTH.px, MOUTH.py);
  mouth.position.set(mx, my, 0.012);
  mouth.renderOrder = 2;
  mouth.visible = false;
  rig.add(mouth);

  // 만화 효과선 (마법사 뒤 — 실루엣 밖으로 뻗은 부분만 보임)
  const fxLines = new THREE.Mesh(
    new THREE.PlaneGeometry(HEAD.r * 2 * U, HEAD.r * 2 * U),
    new THREE.MeshBasicMaterial({ map: emphasisTex(), transparent: true, depthWrite: false, opacity: 0 })
  );
  {
    const [ex, ey] = wiz(HEAD.px, HEAD.py);
    fxLines.position.set(ex, ey, -0.03);
  }
  fxLines.renderOrder = 0.5;
  fxLines.visible = false;
  rig.add(fxLines);

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

    // 날개: 발목 바깥쪽 (부츠 앞, 코트 자락(legs, z 0.05) 뒤 — 자락이 날개 윗부분을 자연스럽게 덮음)
    const pivot = new THREE.Group();
    pivot.position.set((f.wing[0] - f.px) * U, (f.py - f.wing[1]) * U, 0.012);
    pivot.scale.x = f.wingFlip ? -1 : 1;
    g.add(pivot);
    const wm = new THREE.Mesh(new THREE.PlaneGeometry(WING.w * WING.k * U, WING.h * WING.k * U), wingMat);
    wm.position.set((WING.w / 2 - WING.rootX) * WING.k * U, (WING.rootY - WING.h / 2) * WING.k * U, 0);
    wm.renderOrder = 3.5; // 부츠(3) 다음, 바지·코트 자락(4) 전에 그림
    pivot.add(wm);

    const [fx, fy] = wiz(f.px, f.py);
    // 위로 파닥일 때 양쪽 날개가 거울처럼 같이 움직이도록 회전 방향을 맞춤 (뒤집힌 날개는 부호 반대)
    const wingDir = f.wingFlip ? -1 : 1;
    g.userData = { fx, fy, fz: f.z, pivot, wingDir, wingBase: -wingDir * f.wingTilt };
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
    state.vo = null;
    state.run = (state.run || 0) + 1;
    boots.forEach((b) => { b.visible = false; b.scale.set(1, 1, 1); b.rotation.set(0, 0, 0); });
    legs.visible = false;
    setBarefootTex(false);
    mic.visible = false;
    mouth.visible = false;
    fxLines.visible = false;
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

  /* --- "우와아!" 목소리 동기화: 실제로 소리가 난 순간(onstart)을 기준점으로, 끝(onend)에서 입을 다묾 --- */
  const animNow = () => performance.now() / 1000 - state.start;
  function startVoice(kind, info = {}) {
    if (!state.playing || state.vo) return;
    const prof = VOICE_PROFILES[kind] || VOICE_PROFILES.clip;
    let k = 1, trusted = true;
    if (kind === 'speech') {
      // Yuna(맥·아이폰): 측정한 시각표 그대로 — 소리가 끝나는 시각에 입을 다묾 (onend 는 같은 문장도 0.50~0.76초로 들쭉날쭉해서 기준으로 안 씀)
      // 다른 음성: 끝은 onend 를 기다리고, 이 기기에서 잰 가장 짧은 길이로 다음 재생부터 박자를 늘이거나 줄임
      trusted = /yuna|유나/i.test(info.voiceName || '');
      if (!trusted && state.speechDurMin) k = clamp(state.speechDurMin / prof.onendAt, 0.6, 2.5);
    } else if (info.dur && prof.dur && isFinite(info.dur)) k = clamp(info.dur / prof.dur, 0.5, 3);
    state.vo = { kind, p: prof, k, trusted, S: Math.max(T.shout, animNow()), endAt: null, voiceName: info.voiceName };
    // 입가에 작은 반짝임
    const [hx2, hy2] = wiz(MOUTH.px, MOUTH.py);
    const w = rig.localToWorld(v3.set(hx2 + 0.2, hy2, 0.2).clone());
    emit(0, { x: w.x, y: w.y, z: w.z, count: 14, speed: 2.2, life: 0.6, size: 0.16, colors: ['#ffe7a0', '#ffffff'], grav: 0, up: 0.2 });
  }
  function endVoice() {
    const vo = state.vo;
    if (!vo || vo.endAt != null) return;
    vo.endAt = animNow();
    if (vo.kind === 'speech' && !vo.trusted) state.speechDurMin = Math.min(state.speechDurMin || 9, vo.endAt - vo.S); // 다음 재생부터 이 기기 길이에 맞춤
  }
  // 지금 재생 중인 목소리 기준의 시각표 (애니메이션 시각). 목소리가 아직 안 나왔으면 null
  function shoutTimes(t) {
    const vo = state.vo;
    if (!vo) return null;
    const { p, k, S } = vo, at = (x) => S + x * k;
    let E = at(p.end);
    if (vo.endAt != null) E = vo.trusted ? Math.min(vo.endAt, E) : vo.endAt;  // 소리가 일찍 끝나면 그때 입을 다묾
    else if (!vo.trusted) E = Math.min(Math.max(E, t + 0.05), S + 2.5);       // 처음 듣는 음성: onend 까지 기다림
    E = Math.max(E, at(p.a) + 0.05);
    return { S, wa: at(p.wa), a: at(p.a), peak: at(p.peak), bang: at(p.bang), fade: Math.min(at(p.fade), E - 0.06), E, letters: p.letters.map(at) };
  }

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
    let shear = 0, jx = 0, camPunch = 0, camShX = 0, camShY = 0, beatPop = 0, bubbleRot = 0;
    sy += Math.sin(now * 2.2) * 0.008;

    if (state.playing) {
      // 가장 최근 박자에서 얼마나 지났는지 → 입·마이크·말풍선이 박자마다 '팡' 커짐
      // 목소리 기준 시각표 (실제로 소리가 난 순간부터) — 아직 소리가 안 났으면 V = null (웅크린 채 대기)
      if (!state.vo && t > T.shout + 0.8) startVoice('silent'); // 어떤 이유로든 목소리 시작 신호가 없으면 기본 박자로 진행
      const V = shoutTimes(t);
      if (V) V.letters.forEach((b) => { if (t >= b && t < V.E) beatPop = Math.max(beatPop, Math.exp(-9 * (t - b))); });
      const pose = shoutPose(t, V); // "우와아!" 몸 동작

      /* 1) 마이크 등장 */
      once(t, T.micIn, 'mic', () => { mic.visible = true; sfx.pop(); });
      const micS = t < T.micOut ? easeOutBack(seg(t, T.micIn, T.micIn + 0.38)) : 1 - easeInCubic(seg(t, T.micOut, T.micOut + 0.3));
      mic.scale.setScalar(Math.max(0.0001, micS * (1 + beatPop * 0.18)));
      mic.rotation.z = micAngle + (V && t > V.S && t < V.E ? Math.sin(t * 34) * (0.05 + 0.06 * pose.buzz) : 0);
      if (t > T.micOut + 0.3) mic.visible = false;

      /* 2) "우와아!" — 웅크림(소리 날 때까지) → 우: 팡 → 아!: 크게 점프·머리 젖힘 → 클라이맥스 → 바람 호버로 */
      lift += pose.lift; sx += pose.sx; sy += pose.sy; rotZ += pose.rot; shear = pose.shear; jx = pose.jx;
      bubbleRot = Math.sin(t * 52) * 4 * pose.buzz;
      once(t, T.shout, 'voice', () => {
        const run = state.run;
        sfx.shout({
          useSpeech: cbRef.current.useSpeech, voiceSrc: cbRef.current.voiceSrc, voice: cbRef.current.voice,
          on: { start: (kind, info) => run === state.run && startVoice(kind, info), end: () => run === state.run && endVoice() },
        });
      });
      if (V) {
        const { S: VS, a: VA, peak: VP, bang: VB, E: VE } = V;
        const sep = VB - VA > 0.15; // 긴 목소리(클라이맥스가 따로) / 짧은 목소리('아!'가 곧 클라이맥스)
        // 카메라: '우'에서 살짝 → '아!'에서 다가감(긴 목소리는 정점까지 점점 더) → 정점에서 한 번 더 '쿵' → 원위치
        const punchAt = (b, amt, rel) => (t >= b ? amt * easeOutCubic(seg(t, b, b + 0.07)) * (1 - easeInOut(seg(t, b + 0.07, b + 0.07 + rel))) : 0);
        let up = 0;
        if (t >= VA) {
          up = sep ? 0.05 * easeOutCubic(seg(t, VA, VA + 0.06)) + 0.04 * easeInOut(seg(t, VA + 0.06, VP)) : 0.09 * easeOutCubic(seg(t, VA, VA + 0.06));
          const R = sep ? VP : Math.max(VA + 0.06, VE - 0.15);
          up *= 1 - easeInOut(seg(t, R, R + 0.35));
        }
        camPunch = Math.max(punchAt(VS, 0.025, 0.12), up) + 0.025 * easeOutCubic(seg(t, VB, Math.max(VP, VB + 0.02))) * (1 - easeInOut(seg(t, VP, VP + 0.2)));
        // 깔끔한 만화식 흔들림 (감쇠 진동)
        const shakeAt = (b, amp) => {
          if (t < b || t > b + 0.8) return;
          const d = t - b, e = Math.exp(-6 * d);
          camShX += amp * e * Math.sin(d * Math.PI * 2 * 12);
          camShY += amp * 0.5 * e * Math.sin(d * Math.PI * 2 * 16 + 1.3);
        };
        if (sep) { shakeAt(VA, 0.018); shakeAt(VB, 0.05); } else shakeAt(VA, 0.05);
        // 만화 효과선: '우'에서 작게 → '아!'(긴 목소리는 정점)에서 가장 크게 '팡'
        let fxb = null;
        const fxl = sep ? [[VS, 0.8, 0.08], [VA, 1.0, VB - VA - 0.06], [VB, 1.22, 0.16]] : [[VS, 0.8, 0.08], [VB, 1.22, Math.max(0.16, VE - VB - 0.12)]];
        fxl.forEach((fe) => { if (t >= fe[0] && t < fe[0] + fe[2] + 0.3) fxb = fe; });
        if (fxb) {
          const [b, sc, hold] = fxb, d = t - b;
          const k = sc * lerp(0.62, 1, easeOutBack(seg(d, 0, 0.16)));
          fxLines.scale.set(k, k, 1);
          fxLines.rotation.z = b === VA && sep ? 0.09 : -0.05;
          fxLines.material.opacity = d < hold ? (b >= VA ? 0.9 + 0.1 * Math.sin(d * 55) : 1) : 1 - seg(d, hold, hold + 0.3);
          fxLines.visible = true;
        } else fxLines.visible = false;
        // 반짝이·별 터짐 — 머리 뒤에서 터뜨려 얼굴(표정)을 가리지 않고 실루엣 둘레로 퍼지게
        const headBurst = (count, speed, size) => {
          const [hx3, hy3] = wiz(HEAD.px, HEAD.py);
          const w = rig.localToWorld(v3.set(hx3, hy3, -0.45).clone());
          emit(0, { x: w.x, y: w.y, z: w.z, count, speed, life: 0.75, size, colors: ['#ffe7a0', '#ffffff', '#ffb3c7', '#bff6ea'], grav: -0.8, up: 0.35, jitter: 0.55, flatZ: 0.03 });
        };
        if (sep) once(t, VA, 'fx-a', () => headBurst(16, 2.6, 0.18));
        once(t, VB, 'fx-peak', () => {
          headBurst(34, 3.4, 0.24);
          const [wx, wy] = wiz(...WAND);
          const w = rig.localToWorld(v3.set(wx, wy, 0.2).clone());
          emit(0, { x: w.x, y: w.y, z: w.z, count: 16, speed: 2.2, life: 0.7, size: 0.18, colors: ['#fff3c4', '#f4c35a', '#ffffff'], grav: -1, up: 0.6 });
        });
      } else fxLines.visible = false;
      if (V && t < T.snap) {
        mouth.visible = true;
        // 우 → (입술이 열리며) o → 아! → 소리가 끝나면 입을 다묾 (소리 없이 벌린 입이 남지 않게)
        const kind = t < V.wa ? 'u' : t < V.a ? 'o' : t < V.E ? 'a' : 'close';
        if (mouthMat.map !== mouthTexs[kind]) { mouthMat.map = mouthTexs[kind]; mouthMat.needsUpdate = true; }
        let wob = 1;
        if (t < V.E) {
          const sepV = V.bang - V.a > 0.15;
          const open = t >= V.a ? (sepV ? seg(t, V.a, V.peak) : 1 - 0.5 * seg(t, V.peak, V.fade)) : 0; // 소리 높이·세기에 맞춰 입 크기
          const fade = seg(t, V.fade, V.E);                                                          // 잦아들며 오므림
          wob = (1 + open * 0.1 + Math.sin(t * 40) * 0.04 + beatPop * 0.15) * (1 - fade * 0.4);
        }
        mouth.scale.set(wob, wob, 1);
      } else if (t < T.snap) mouth.visible = false;
      if (t >= T.snap) {
        mouth.visible = true;
        if (mouthMat.map !== mouthTexs.smile) { mouthMat.map = mouthTexs.smile; mouthMat.needsUpdate = true; }
        mouth.scale.set(0.9, 0.9, 1);
      }
      setLetters(t >= T.snap ? -1 : !V ? 0 : V.letters.filter((b) => t >= b).length);
      bubble.style.opacity = (V && t >= V.S && t < V.E + 1.2) || (t >= T.snap && t < T.snap + 0.9) ? '1' : '0';

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
      // 바지 자락이 나타나는 순간 원래 갈색 부츠도 지움 (올라오는 새 신발과 두 켤레가 겹쳐 보이지 않게)
      once(t, T.arrive, 'slip', () => { legs.visible = true; setBarefootTex(true); });
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
      b.userData.pivot.rotation.z = b.userData.wingBase + b.userData.wingDir * (f * state.flapAmp + 0.05);
      b.userData.pivot.scale.y = 1 - Math.abs(f) * 0.08;
    });

    rig.position.set(jx, lift, 0);
    rig.scale.set(sx, sy, 1);
    rig.rotation.z = rotZ;
    rig.updateMatrix();
    // 몸 젖히기: 발은 붙인 채 위쪽만 기울임 (x += shear * y)
    if (shear) rig.matrix.multiply(shearM.set(1, shear, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1));
    rig.updateMatrixWorld(true);

    // 그림자
    const s = 1 / (1 + lift * 0.55);
    shadow.scale.set(1.25 * s * sx, 0.55 * s, 1);
    shadow.material.opacity = 0.55 * s;

    updatePools(dt);
    updateRings(dt);

    // 카메라 흔들림
    camera.position.copy(camBase);
    if (!reduced) {
      if (camPunch > 0) camera.position.lerp(camTarget, camPunch); // '우와아!' 펀치 인
      camera.position.x += camShX;
      camera.position.y += camShY;
    }
    if (!reduced && state.shake > 0.0005) {
      camera.position.x += (Math.random() - 0.5) * state.shake * 2;
      camera.position.y += (Math.random() - 0.5) * state.shake * 2;
    }
    state.shake *= Math.exp(-dt * 6);
    camera.lookAt(camTarget);
    camera.updateMatrixWorld();

    // 말풍선 위치
    const [bx, by] = state.letters === -1 ? wiz(168, 262) : wiz(186, 96);
    const w = rig.localToWorld(v3.set(bx, by, 0).clone()).project(camera);
    const W = mount.clientWidth, H = mount.clientHeight;
    const px = Math.min((w.x + 1) / 2 * W, W - bubble.offsetWidth - 8);
    const py = (1 - w.y) / 2 * H;
    bubble.style.transform = `translate(${px.toFixed(1)}px, ${(py - bubble.offsetHeight).toFixed(1)}px) scale(${(1 + beatPop * 0.2).toFixed(3)}) rotate(${bubbleRot.toFixed(2)}deg)`;

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
  { onDone, onPhase, muted = false, useSpeech = false, voiceSrc, voice = 'speech', className, style },
  ref
) {
  const mountRef = useRef(null);
  const bubbleRef = useRef(null);
  const engineRef = useRef(null);
  const [letters, setLetters] = useState(0);
  const cbRef = useRef({});
  cbRef.current = { onDone, onPhase, muted, useSpeech, voiceSrc, voice, setLetters };

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
        @keyframes mssPop {
          0% { transform: translateY(.35em) scale(0) rotate(-30deg); }
          40% { transform: translateY(-.14em) scale(1.6) rotate(10deg); }
          62% { transform: translateY(0) scale(.84) rotate(-5deg); }
          80% { transform: scale(1.12) rotate(2deg); }
          100% { transform: none; } }
        .mss-bubble { position:absolute; left:0; top:0; z-index:2; pointer-events:none; white-space:nowrap;
          padding: .28em .6em .34em; border-radius: 1.2em 1.2em 1.2em .25em; background:#fff; color:#2a1f4d;
          font-size: clamp(26px, 5.2vmin, 54px); line-height:1; letter-spacing:.02em;
          box-shadow: 0 .12em 0 #c9c0ff; transition: opacity .25s; will-change: transform; transform-origin: 0 100%; }
        .mss-bubble span { display:inline-block; animation: mssPop .48s cubic-bezier(.25,.8,.35,1) both; }
        .mss-bubble span.mss-big { font-size: 1.18em; }
        .mss-bubble span.mss-bang { font-size: 1.34em; color: #ff5d73; }
        @media (prefers-reduced-motion: reduce) { .mss-bubble span { animation: none; } }
      `}</style>
      <div ref={bubbleRef} className="mss-bubble" aria-hidden="true" style={{ opacity: 0 }}>
        {letters === 0
          ? '\u00a0'
          : (letters < 0 ? ['쏙', '!'] : SHOUT.slice(0, letters)).map((ch, i) => (
              <span key={(letters < 0 ? 's' : 'w') + i} className={letters > 0 && i >= 2 ? (i === 3 ? 'mss-bang' : 'mss-big') : undefined}>{ch}</span>
            ))}
      </div>
    </div>
  );
});

export default MagicShoesStage;
