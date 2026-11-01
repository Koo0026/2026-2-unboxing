import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

/* =====================================================================
   마법진과 빛의 실타래 속에서 마법사에게 초록 망토가 둘러지고,
   망토를 두른 마법사가 '슈웅~' 날아올라 하늘을 누비는 애니메이션
   (React + three.js)

   - 캐릭터: 첨부 이미지 2장 (망토 전 / 망토 후, 배경 제거)
   - 타임라인(초)
     0.0  발밑에 마법진이 그려짐
     0.9  빛의 실타래가 몸을 휘감으며 올라감
     2.4  실타래가 점점 조여 듦
     3.0  섬광! 위에서 아래로 빛의 띠가 지나가며 초록 망토가 둘러짐
     4.0  기뻐서 통통 튐
     4.55 웅크렸다가 4.85에 '슈웅~' 하고 하늘로 솟구침
     5.6  화면을 빙글빙글 누비며 비행 (망토 펄럭, 별가루 꼬리)
    10.2  돌아와서 11.0에 사뿐히 착지
    12.2  종료
   ===================================================================== */

// ---------- 타이밍 ----------
const T = {
  circle: 0.0,
  threads: 0.9,
  tighten: 2.4,
  transform: 3.0,
  transformEnd: 3.9,
  joy: 4.0,
  crouch: 4.55,
  takeoff: 4.85,
  up: 5.35,
  loopStart: 5.6,
  loopEnd: 10.2,
  land: 11.0,
  done: 12.2,
};

// ---------- 좌표 ----------
// 망토 전 이미지(481×786): 100px = 1 unit, 이미지 중심 = 원점
// 망토 후 이미지(978×1024): 얼굴이 정확히 겹치도록 123px = 1 unit, 약간 이동
const PLAIN = { w: 481 / 100, h: 786 / 100, x: 0, y: 0 };
const CAPED = { w: 978 / 123, h: 1024 / 123, x: 0.032, y: 0.159 };
const FEET_Y = (393 - 778) / 100; // -3.85
const HEAD_Y = 0.9;

// ---------- 유틸 ----------
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const smooth = (t) => t * t * (3 - 2 * t);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rand = (a, b) => a + Math.random() * (b - a);

const PALETTE = [
  new THREE.Color('#fff3c4'),
  new THREE.Color('#ffe27a'),
  new THREE.Color('#ffffff'),
  new THREE.Color('#b8ff9a'),
  new THREE.Color('#7dffb0'),
  new THREE.Color('#9fe8ff'),
  new THREE.Color('#ffd0f0'),
];
const pickColor = (warm = 0.5) =>
  Math.random() < warm ? PALETTE[Math.floor(Math.random() * 3)] : PALETTE[3 + Math.floor(Math.random() * 4)];

/* ---------- 비행 경로 (화면 기준 정규화 좌표: -1 ~ 1) ----------
   그림과 소리가 같은 경로를 공유합니다. [x, y, 크기] */
const PATH = [
  [-1.6, 0.55, 0.4],
  [-0.55, 0.25, 0.48],
  [0.3, 0.6, 0.38],
  [0.85, 0.05, 0.55],
  [0.4, -0.45, 0.62],
  [-0.4, -0.25, 0.5],
  [-0.78, 0.35, 0.4],
  [0.0, 0.72, 0.34],
  [0.72, 0.35, 0.45],
  [0.95, -0.3, 0.58],
  [0.3, -0.55, 0.64],
  [-0.35, -0.1, 0.52],
  [0.0, 0.55, 0.45],
];
function catmull(p0, p1, p2, p3, u) {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}
function flightNorm(t) {
  const n = PATH.length - 1;
  const f = seg(t, T.loopStart, T.loopEnd) * n;
  const i = Math.min(n - 1, Math.floor(f));
  const u = f - i;
  const P = (k) => PATH[Math.max(0, Math.min(n, k))];
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) out[c] = catmull(P(i - 1)[c], P(i)[c], P(i + 1)[c], P(i + 2)[c], u);
  return out;
}

const PLANE_VS = /* glsl */ `
  varying vec2 vUv; varying vec2 vP;
  void main(){ vUv = uv; vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

/* =====================================================================
   STAGE
   ===================================================================== */
export function createStage(canvas, { onReady, onDone } = {}) {
  let disposed = false;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const FOV = 18;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 300);
  const VIEW_C = -0.3;
  let baseDist = 34;
  let halfW = 6;
  let halfH = 5.3;

  // ----- 배경: 초록빛 감도는 밤하늘 -----
  const bgMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uGlow: { value: 0 }, uCenter: { value: new THREE.Vector2(0, 0) }, uScroll: { value: 0 } },
    vertexShader: PLANE_VS,
    fragmentShader: /* glsl */ `
      varying vec2 vP;
      uniform float uTime; uniform float uGlow; uniform vec2 uCenter; uniform float uScroll;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float stars(vec2 p, float dens){
        vec2 cell = floor(p); float r = hash(cell);
        vec2 f = fract(p) - vec2(hash(cell + 3.1), hash(cell + 7.7));
        float s = smoothstep(0.07, 0.0, length(f)) * step(dens, r);
        return s * (0.45 + 0.55 * sin(uTime * (1.5 + r * 3.0) + r * 40.0));
      }
      void main(){
        float h = clamp((vP.y + 8.0) / 16.0, 0.0, 1.0);
        vec3 col = mix(vec3(0.06, 0.13, 0.17), vec3(0.03, 0.04, 0.12), h);
        col += vec3(0.75, 0.85, 1.0) * stars(vP * 3.0 + vec2(uScroll * 0.6, 0.0), 0.86) * 0.55;
        col += vec3(0.75, 0.85, 1.0) * stars(vP * 1.6 + vec2(uScroll * 0.25, 7.0), 0.93) * 0.35;
        float d = length(vP - uCenter);
        col += vec3(0.45, 1.0, 0.55) * uGlow * 0.35 * exp(-d * 0.25);
        col += vec3(1.0, 0.85, 0.4) * uGlow * 0.25 * exp(-d * 0.5);
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthWrite: false,
  });
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(110, 70), bgMat);
  bg.position.z = -10;
  bg.renderOrder = -10;
  scene.add(bg);

  // ----- 변신 순간의 광선 -----
  const raysMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 }, uReach: { value: 0 }, uRing: { value: -99 } },
    vertexShader: PLANE_VS,
    fragmentShader: /* glsl */ `
      varying vec2 vP;
      uniform float uTime; uniform float uIntensity; uniform float uReach; uniform float uRing;
      void main(){
        float r = length(vP);
        float a = atan(vP.y, vP.x);
        float t = uTime;
        float rays = pow(0.5 + 0.5 * sin(a * 12.0 + t * 0.6), 10.0) * 0.8
                   + pow(0.5 + 0.5 * sin(a * 19.0 - t * 0.9 + 1.3), 16.0) * 0.6
                   + pow(0.5 + 0.5 * sin(a * 7.0 + t * 0.3 + 2.1), 5.0) * 0.4;
        float fall = smoothstep(uReach, uReach * 0.15, r) * smoothstep(0.0, 0.6, r);
        vec3 tint = mix(vec3(0.55, 1.0, 0.6), vec3(1.0, 0.88, 0.45), 0.5 + 0.5 * sin(a * 3.0 + t));
        vec3 col = tint * rays * fall * uIntensity;
        float age = uTime - uRing;
        if (age > 0.0 && age < 2.0) {
          float rr = age * 8.0;
          col += vec3(0.7, 1.0, 0.75) * exp(-pow((r - rr) / (0.2 + age * 0.3), 2.0)) * (1.0 - age / 2.0) * 0.9;
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const rays = new THREE.Mesh(new THREE.PlaneGeometry(44, 44), raysMat);
  rays.position.set(0, HEAD_Y - 0.6, -1);
  rays.renderOrder = 1;
  scene.add(rays);

  // ----- 마법진 (바닥에 비스듬히) -----
  const circleMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uReveal: { value: 0 }, uIntensity: { value: 0 } },
    vertexShader: PLANE_VS,
    fragmentShader: /* glsl */ `
      varying vec2 vP;
      uniform float uTime; uniform float uReveal; uniform float uIntensity;
      float line(float d, float w){ return exp(-pow(d / w, 2.0)); }
      float segDist(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
      void main(){
        vec2 p = vP / 3.0;
        float r = length(p);
        float a = atan(p.y, p.x);
        float an = (a + 3.14159) / 6.28318;
        float reveal = step(an, uReveal);
        float rot = uTime * 0.35;
        float ar = a + rot;
        float v = 0.0;
        v += line(r - 0.96, 0.012) + line(r - 0.9, 0.007) + line(r - 0.64, 0.01) + line(r - 0.58, 0.006) + line(r - 0.22, 0.008);
        // 룬 눈금
        float tick = step(0.55, fract(ar * 48.0 / 6.28318)) * step(0.905, r) * step(r, 0.955);
        float glyph = step(0.7, fract(ar * 12.0 / 6.28318 + 0.1)) * step(0.66, r) * step(r, 0.86) * (0.5 + 0.5 * sin(ar * 36.0));
        v += tick * 0.7 + glyph * 0.45;
        // 육각별 (역회전)
        float rb = -uTime * 0.5;
        vec2 q = mat2(cos(rb), -sin(rb), sin(rb), cos(rb)) * p;
        float hx = 1e3;
        for (int k = 0; k < 6; k++) {
          float a0 = float(k) * 1.0472;
          vec2 A = 0.58 * vec2(cos(a0), sin(a0));
          vec2 B = 0.58 * vec2(cos(a0 + 2.0944), sin(a0 + 2.0944));
          hx = min(hx, segDist(q, A, B));
        }
        v += line(hx, 0.008);
        // 작은 원 6개
        for (int k = 0; k < 6; k++) {
          float a0 = float(k) * 1.0472 + rot;
          vec2 c = 0.77 * vec2(cos(a0), sin(a0));
          v += line(length(p - c) - 0.07, 0.006);
        }
        float glow = exp(-r * r * 3.0) * 0.18 + smoothstep(1.05, 0.9, r) * 0.06;
        vec3 col = mix(vec3(0.35, 1.0, 0.55), vec3(1.0, 0.9, 0.5), 0.35 + 0.35 * sin(a * 2.0 + uTime));
        float pulse = 0.85 + 0.15 * sin(uTime * 5.0);
        float outA = (v * reveal + glow) * uIntensity * pulse * step(r, 1.02);
        gl_FragColor = vec4(col * outA, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const magicCircle = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 6.4), circleMat);
  magicCircle.rotation.x = -1.22;
  magicCircle.position.set(-0.1, FEET_Y + 0.08, 0);
  magicCircle.renderOrder = 1;
  scene.add(magicCircle);

  // ----- 캐릭터 -----
  const flyGroup = new THREE.Group(); // 비행 위치/크기/기울기 (몸 중심 기준)
  scene.add(flyGroup);
  const squashGroup = new THREE.Group(); // 찌그러짐 (발 기준)
  squashGroup.position.y = FEET_Y;
  flyGroup.add(squashGroup);
  const charGroup = new THREE.Group();
  charGroup.position.y = -FEET_Y;
  squashGroup.add(charGroup);

  const shadowMat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0.45 } },
    vertexShader: PLANE_VS,
    fragmentShader: `varying vec2 vUv; uniform float uOpacity;
      void main(){ vec2 p = (vUv - 0.5) * 2.0; gl_FragColor = vec4(0.0, 0.0, 0.0, smoothstep(1.0, 0.0, length(p)) * uOpacity); }`,
    transparent: true,
    depthWrite: false,
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.55), shadowMat);
  shadow.position.set(-0.1, FEET_Y - 0.05, -0.3);
  scene.add(shadow);

  // 망토 전/후 두 장을 같은 자리에 겹쳐 두고, 빛의 띠가 지나가며 바뀜
  const sharedU = {
    uTime: { value: 0 },
    uSweep: { value: 100 },
    uFlutter: { value: 0 },
    uTrail: { value: new THREE.Vector2(0, 0) },
    uFeetY: { value: FEET_Y },
  };
  const charVS = /* glsl */ `
    uniform float uTime; uniform float uFlutter; uniform vec2 uTrail; uniform float uFeetY;
    uniform float uWave;
    varying vec2 vUv; varying vec3 vWorld;
    void main(){
      vUv = uv;
      vec3 p = position;
      vec3 lp = p + vec3(0.0); // 이미지 평면 위 위치
      float yLocal = lp.y + uOffsetY;
      // 어깨 아래로 갈수록 크게 펄럭 (망토)
      float w = 1.0 - smoothstep(uFeetY + 0.4, 0.2, yLocal);
      w *= w;
      p.x += sin(uTime * 9.0 + yLocal * 2.3) * uFlutter * w * uWave;
      p.y += cos(uTime * 7.0 + yLocal * 1.7) * uFlutter * 0.35 * w * uWave;
      p.xy += uTrail * w * uWave;
      vec4 wp = modelMatrix * vec4(p, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const charFS = (isCaped) => /* glsl */ `
    uniform sampler2D uMap; uniform float uSweep; uniform float uTime;
    varying vec2 vUv; varying vec3 vWorld;
    void main(){
      vec4 c = texture2D(uMap, vUv);
      float n = sin(vWorld.x * 6.0 + uTime * 4.0) * 0.08 + sin(vWorld.x * 13.0 - uTime * 6.0) * 0.04;
      float d = vWorld.y - (uSweep + n);
      ${isCaped ? 'float vis = smoothstep(-0.04, 0.04, d);' : 'float vis = 1.0 - smoothstep(-0.04, 0.04, d);'}
      float a = c.a * vis;
      if (a < 0.03) discard;
      vec3 col = c.rgb;
      ${isCaped ? 'float edge = exp(-pow(d / 0.16, 2.0)); col += vec3(0.6, 1.0, 0.6) * edge * 1.2 + vec3(1.0, 0.95, 0.7) * exp(-pow(d / 0.05, 2.0));' : ''}
      gl_FragColor = vec4(col, a);
    }`;
  const mkCharMat = (isCaped, offsetY) =>
    new THREE.ShaderMaterial({
      uniforms: { ...sharedU, uMap: { value: null }, uWave: { value: isCaped ? 1 : 0 }, uOffsetY: { value: offsetY } },
      vertexShader: 'uniform float uOffsetY;\n' + charVS,
      fragmentShader: charFS(isCaped),
      transparent: true,
      depthWrite: true,
    });
  const plainMat = mkCharMat(false, PLAIN.y);
  const capedMat = mkCharMat(true, CAPED.y);
  const plain = new THREE.Mesh(new THREE.PlaneGeometry(PLAIN.w, PLAIN.h, 1, 1), plainMat);
  plain.position.set(PLAIN.x, PLAIN.y, 0);
  plain.renderOrder = 2;
  const caped = new THREE.Mesh(new THREE.PlaneGeometry(CAPED.w, CAPED.h, 32, 64), capedMat);
  caped.position.set(CAPED.x, CAPED.y, 0.001);
  caped.renderOrder = 2;
  charGroup.add(plain, caped);

  // ----- 빛의 실타래 (몸을 휘감는 나선 리본) -----
  const threads = [];
  const THREAD_N = 6;
  const SEGS = 160;
  for (let k = 0; k < THREAD_N; k++) {
    const geo = new THREE.BufferGeometry();
    const posArr = new Float32Array((SEGS + 1) * 2 * 3);
    const uArr = new Float32Array((SEGS + 1) * 2);
    const sideArr = new Float32Array((SEGS + 1) * 2);
    const idx = [];
    for (let i = 0; i <= SEGS; i++) {
      uArr[i * 2] = uArr[i * 2 + 1] = i / SEGS;
      sideArr[i * 2] = -1;
      sideArr[i * 2 + 1] = 1;
      if (i < SEGS) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aU', new THREE.BufferAttribute(uArr, 1));
    geo.setAttribute('aSide', new THREE.BufferAttribute(sideArr, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uHead: { value: 0 }, uTail: { value: 0 }, uIntensity: { value: 0 }, uColor: { value: new THREE.Color(k % 2 ? '#b8ff9a' : '#ffe27a') }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aU; attribute float aSide;
        varying float vU; varying float vSide;
        void main(){ vU = aU; vSide = aSide; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying float vU; varying float vSide;
        uniform float uHead; uniform float uTail; uniform float uIntensity; uniform vec3 uColor; uniform float uTime;
        void main(){
          float body = smoothstep(uTail, uTail + 0.12, vU) * (1.0 - smoothstep(uHead - 0.02, uHead + 0.005, vU));
          float head = exp(-pow((vU - uHead) / 0.025, 2.0));
          float across = exp(-vSide * vSide * 2.2);
          float sparkle = 0.75 + 0.25 * sin(vU * 160.0 - uTime * 20.0);
          vec3 col = mix(uColor, vec3(1.0), across * 0.6) * (body * sparkle + head * 2.2) * across * uIntensity;
          if (max(col.r, max(col.g, col.b)) < 0.003) discard;
          gl_FragColor = vec4(col, 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    scene.add(mesh);
    threads.push({ mesh, geo, mat, phase: (k / THREAD_N) * Math.PI * 2, delay: k * 0.12, dir: k % 2 ? 1 : -1 });
  }
  const threadPoint = (th, u, radius, t, out) => {
    const turns = 2.1;
    const ang = th.phase + th.dir * (u * turns * Math.PI * 2 + t * 2.2);
    const yy = lerp(FEET_Y - 0.1, 3.6, u);
    const rShape = radius * (1 - 0.35 * smooth(seg(yy, 0.5, 3.6))); // 머리 쪽은 조금 좁게
    out.set(-0.15 + Math.cos(ang) * rShape * 1.15, yy, Math.sin(ang) * rShape * 0.8);
    return out;
  };
  const tA = new THREE.Vector3();
  const tB = new THREE.Vector3();
  function updateThreads(t, now) {
    const active = t > T.threads && t < T.transform + 0.6;
    const radius = lerp(2.3, 1.05, smooth(seg(t, T.tighten, T.transform + 0.1)));
    for (const th of threads) {
      th.mesh.visible = active;
      if (!active) continue;
      const local = t - T.threads - th.delay;
      const head = clamp01(local / 1.5);
      const tail = clamp01((local - 1.0) / 1.8);
      th.mat.uniforms.uHead.value = head;
      th.mat.uniforms.uTail.value = t > T.transform ? Math.max(tail, smooth(seg(t, T.transform, T.transform + 0.5))) : tail * 0.6;
      th.mat.uniforms.uIntensity.value = local > 0 ? 0.9 + smooth(seg(t, T.tighten, T.transform)) * 0.3 : 0;
      th.mat.uniforms.uTime.value = now;
      const pos = th.geo.attributes.position.array;
      const width = 0.08;
      for (let i = 0; i <= SEGS; i++) {
        const u = i / SEGS;
        threadPoint(th, u, radius, t, tA);
        threadPoint(th, Math.min(1, u + 1 / SEGS), radius, t, tB);
        let tx = tB.x - tA.x;
        let ty = tB.y - tA.y;
        const l = Math.hypot(tx, ty) || 1;
        tx /= l;
        ty /= l;
        const nx = -ty * width;
        const ny = tx * width;
        pos[i * 6] = tA.x - nx;
        pos[i * 6 + 1] = tA.y - ny;
        pos[i * 6 + 2] = tA.z;
        pos[i * 6 + 3] = tA.x + nx;
        pos[i * 6 + 4] = tA.y + ny;
        pos[i * 6 + 5] = tA.z;
      }
      th.geo.attributes.position.needsUpdate = true;
    }
  }

  // ----- 파티클 -----
  const particles = createParticles(2600);
  scene.add(particles.points);

  // ----- 화면 섬광 -----
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xf2ffe8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), flashMat);
  flash.position.z = 4;
  flash.renderOrder = 10;
  scene.add(flash);

  // ----- 크기 맞추기 -----
  const resize = () => {
    const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 800;
    const h = canvas.clientHeight || canvas.parentElement?.clientHeight || 600;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const tanH = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    baseDist = Math.max(10.6 / 2 / tanH, 6.6 / 2 / (tanH * camera.aspect));
    halfH = tanH * baseDist;
    halfW = halfH * camera.aspect;
    camera.updateProjectionMatrix();
    particles.material.uniforms.uScale.value = (h * renderer.getPixelRatio()) / (2 * tanH);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement || canvas);
  resize();

  // 정규화 경로 → 월드 좌표
  const pathToWorld = (n) => {
    const ax = Math.max(1.6, halfW - 1.3);
    const ay = Math.max(1.6, halfH - 1.6);
    return [n[0] * ax, VIEW_C + n[1] * ay, n[2]];
  };

  // ----- 상태 -----
  let startAt = -1;
  let doneFired = true;
  const acc = { rise: 0, thread: 0, trail: 0, joy: 0, idle: 0 };
  const fired = { transform: false, joy: false, takeoff: false, land: false };
  let prevPos = new THREE.Vector2(0, 0);
  let vel = new THREE.Vector2(0, 0);
  let bank = 0;

  function play() {
    if (disposed) return;
    particles.clear();
    for (const k in acc) acc[k] = 0;
    for (const k in fired) fired[k] = false;
    doneFired = false;
    startAt = performance.now() / 1000;
  }

  let raf = 0;
  let prevNow = performance.now() / 1000;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, Math.max(0.0001, now - prevNow));
    prevNow = now;
    const t = startAt < 0 ? 0 : now - startAt;
    update(t, now, dt);
    renderer.render(scene, camera);
  };

  function update(t, now, dt) {
    const started = startAt >= 0;
    sharedU.uTime.value = now;

    // --- 망토 변신 띠 ---
    let sweep = 100; // 모두 '망토 전'
    if (started && t >= T.transform) sweep = lerp(4.6, -4.6, easeInOutCubic(seg(t, T.transform, T.transformEnd)));
    if (started && t >= T.transformEnd) sweep = -100; // 모두 '망토 후'
    sharedU.uSweep.value = sweep;

    // --- 위치 / 크기 / 기울기 ---
    let px = 0;
    let py = 0;
    let s = 1;
    let sqx = 1;
    let sqy = 1;
    let airborne = false;
    if (started) {
      if (t >= T.joy && t < T.crouch) {
        // 기뻐서 통통 두 번
        const u = (t - T.joy) / (T.crouch - T.joy);
        const hop = Math.abs(Math.sin(u * Math.PI * 2));
        py = hop * 0.35;
        sqy = 1 + (hop - 0.5) * 0.06;
        sqx = 1 / sqy;
      } else if (t >= T.crouch && t < T.takeoff) {
        const u = smooth(seg(t, T.crouch, T.takeoff));
        sqy = 1 - 0.14 * u;
        sqx = 1 + 0.08 * u;
      } else if (t >= T.takeoff && t < T.loopStart) {
        airborne = true;
        const u = seg(t, T.takeoff, T.up);
        py = easeInCubic(u) * (halfH + 6);
        s = lerp(1, 0.8, u);
        sqy = 1 + 0.22 * Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.5);
        sqx = 1 / Math.sqrt(sqy);
        if (t > T.up) py = halfH + 10; // 화면 밖
      } else if (t >= T.loopStart && t < T.loopEnd) {
        airborne = true;
        const w = pathToWorld(flightNorm(t));
        px = w[0];
        py = w[1];
        s = w[2];
      } else if (t >= T.loopEnd && t < T.land) {
        airborne = true;
        const a = pathToWorld(PATH[PATH.length - 1]);
        const u = seg(t, T.loopEnd, T.land);
        const e = easeInOutCubic(u);
        px = lerp(a[0], 0, e);
        py = lerp(a[1], 0, e) + Math.sin(u * Math.PI) * 0.4;
        s = lerp(a[2], 1, easeOutCubic(u));
      } else if (t >= T.land) {
        const a = t - T.land;
        const b = Math.exp(-a * 7) * Math.cos(a * 18) * 0.1;
        sqy = 1 - b;
        sqx = 1 + b * 0.6;
      }
    }
    // 둥실 떠다님
    const hover = airborne ? Math.sin(now * 5) * 0.08 * s : 0;
    flyGroup.position.set(px, py + hover, 0);
    flyGroup.scale.setScalar(s);
    squashGroup.scale.set(sqx, sqy, 1);

    // 속도 → 기울기 + 망토 꼬리
    const cur = new THREE.Vector2(px, py);
    const v = cur.clone().sub(prevPos).divideScalar(dt);
    prevPos = cur;
    if (v.length() > 60) v.set(0, 0); // 순간이동(화면 밖 → 안)은 무시
    vel.lerp(v, 1 - Math.exp(-dt * 8));
    const targetBank = airborne ? clamp(-vel.x * 0.045, -0.5, 0.5) : 0;
    bank = lerp(bank, targetBank, 1 - Math.exp(-dt * 6));
    flyGroup.rotation.z = bank;
    const speed = vel.length();
    const capeOn = started && t > T.transform + 0.3;
    sharedU.uFlutter.value = capeOn ? (airborne ? 0.07 + Math.min(0.14, speed * 0.012) : 0.035) : 0;
    sharedU.uTrail.value.set(capeOn ? clamp(-vel.x * 0.025, -0.45, 0.45) : 0, capeOn ? clamp(-vel.y * 0.02, -0.35, 0.35) : 0);

    let shOp = 0.45 * clamp01(1 - py / 3);
    if (started && t >= T.takeoff && t < T.land) shOp = t > T.loopEnd ? 0.45 * seg(t, T.loopEnd + 0.4, T.land) : 0.45 * (1 - seg(t, T.takeoff, T.takeoff + 0.3));
    shadowMat.uniforms.uOpacity.value = shOp;

    // --- 마법진 ---
    const circleIn = started ? smooth(seg(t, T.circle, T.circle + 1.0)) : 0;
    const circleOut = started ? 1 - smooth(seg(t, T.transformEnd, T.crouch)) : 0;
    circleMat.uniforms.uTime.value = now;
    circleMat.uniforms.uReveal.value = circleIn;
    circleMat.uniforms.uIntensity.value = circleIn * circleOut * (1 + 0.6 * smooth(seg(t, T.tighten, T.transform)));
    magicCircle.visible = circleMat.uniforms.uIntensity.value > 0.001;

    updateThreads(t, now);

    // --- 변신 섬광/광선 ---
    const tfA = started ? t - T.transform : -1;
    raysMat.uniforms.uTime.value = now;
    raysMat.uniforms.uIntensity.value = tfA > 0 ? smooth(seg(tfA, 0, 0.15)) * (1 - smooth(seg(tfA, 0.4, 2.2))) * 1.3 : 0;
    raysMat.uniforms.uReach.value = tfA > 0 ? 2 + 14 * easeOutCubic(seg(tfA, 0, 1.2)) : 0;
    raysMat.uniforms.uRing.value = started ? startAt + T.transform : -99;
    let fl = tfA >= 0 ? 0.75 * Math.exp(-tfA * 5) : 0;
    const takeA = started ? t - T.takeoff : -1;
    if (takeA >= 0) fl = Math.max(fl, 0.25 * Math.exp(-takeA * 8));
    flashMat.opacity = fl;

    // 배경
    bgMat.uniforms.uTime.value = now;
    bgMat.uniforms.uGlow.value = started ? Math.max(circleIn * circleOut * 0.5, tfA > 0 ? (1 - smooth(seg(tfA, 0.2, 2.5))) : 0) : 0;
    bgMat.uniforms.uCenter.value.set(0, HEAD_Y - 1);
    bgMat.uniforms.uScroll.value += airborne ? vel.x * dt * 0.05 : 0;

    // --- 카메라 ---
    let shakeX = 0;
    let shakeY = 0;
    if (tfA > 0 && tfA < 0.8) {
      const amp = 0.07 * Math.exp(-tfA * 5);
      shakeX = Math.sin(now * 61) * amp;
      shakeY = Math.cos(now * 53) * amp;
    }
    if (takeA > 0 && takeA < 0.5) shakeY += Math.sin(takeA * 60) * 0.05 * Math.exp(-takeA * 8);
    const landA = started ? t - T.land : -1;
    if (landA > 0 && landA < 0.5) shakeY += Math.sin(landA * 50) * 0.04 * Math.exp(-landA * 10);
    const zoom = started ? 1 - 0.04 * smooth(seg(t, T.tighten, T.transform)) * (1 - smooth(seg(t, T.transform, T.crouch))) : 1;
    camera.position.set(shakeX, VIEW_C + shakeY, baseDist * zoom);
    camera.lookAt(shakeX * 0.5, VIEW_C + shakeY * 0.5, 0);

    emit(t, now, dt, started, airborne, px, py, s);
    particles.update(dt, now);

    if (started && !doneFired && t >= T.done) {
      doneFired = true;
      onDone && onDone();
    }
  }

  function emit(t, now, dt, started, airborne, px, py, s) {
    const P = particles;
    if (!started) {
      // 대기 중: 몸 주변 은은한 반짝임
      acc.idle += dt * 5;
      while (acc.idle >= 1) {
        acc.idle -= 1;
        P.spawn(rand(-2, 1.8), rand(-3, 3), rand(-0.5, 0.5), 0, rand(0.1, 0.3), 0, rand(0.8, 1.6), rand(0.06, 0.14), pickColor(0.5), 0.5, -0.05);
      }
      return;
    }

    // 마법진에서 피어오르는 빛
    if (t < T.transformEnd + 0.4) {
      acc.rise += dt * (40 + 120 * smooth(seg(t, T.tighten, T.transform)));
      while (acc.rise >= 1) {
        acc.rise -= 1;
        const a = rand(0, Math.PI * 2);
        const r = rand(0.4, 2.8);
        P.spawn(-0.1 + Math.cos(a) * r, FEET_Y + Math.sin(a) * r * 0.35, Math.sin(a) * r * 0.5, rand(-0.1, 0.1), rand(0.8, 2.4), 0, rand(0.8, 1.8), rand(0.05, 0.14), pickColor(0.45), 0.6, -0.4);
      }
    }

    // 실타래 끝에서 튀는 불꽃
    if (t > T.threads && t < T.transform) {
      acc.thread += dt * 90;
      while (acc.thread >= 1) {
        acc.thread -= 1;
        const th = threads[Math.floor(rand(0, threads.length))];
        const head = th.mat.uniforms.uHead.value;
        if (head <= 0) continue;
        const radius = lerp(2.3, 1.05, smooth(seg(t, T.tighten, T.transform + 0.1)));
        threadPoint(th, head, radius, t, tA);
        P.spawn(tA.x, tA.y, tA.z, rand(-0.4, 0.4), rand(-0.4, 0.4), 0, rand(0.3, 0.7), rand(0.06, 0.15), pickColor(0.5), 2, 0.3);
      }
    }

    // 변신 순간 폭발
    if (t >= T.transform && !fired.transform) {
      fired.transform = true;
      for (let i = 0; i < 520; i++) {
        const a = rand(0, Math.PI * 2);
        const sp = Math.pow(Math.random(), 0.6) * 10 + 1;
        P.spawn(rand(-1.4, 1.2), rand(-2.5, 2.5), rand(-0.5, 1), Math.cos(a) * sp, Math.sin(a) * sp, 0, rand(0.8, 2.2), rand(0.06, 0.24), pickColor(0.45), 1.3, 0.5);
      }
    }
    // 변신 띠를 따라 반짝이
    if (t > T.transform && t < T.transformEnd) {
      const y = sharedU.uSweep.value;
      for (let i = 0; i < 6; i++) P.spawn(rand(-2.4, 2.2), y + rand(-0.1, 0.1), 0.8, rand(-0.8, 0.8), rand(-0.3, 0.3), 0, rand(0.4, 0.8), rand(0.06, 0.16), pickColor(0.5), 2, 0.6);
    }

    // 기뻐서 머리 위 반짝 별
    if (t >= T.joy && !fired.joy) {
      fired.joy = true;
      for (let i = 0; i < 24; i++) {
        const a = rand(0.2, Math.PI - 0.2);
        P.spawn(-0.3 + Math.cos(a) * 2.2, 2.4 + Math.sin(a) * 1.4, 1, Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0, rand(0.6, 1.1), rand(0.18, 0.32), pickColor(0.7), 2, 0);
      }
    }

    // 이륙: 먼지 링 + 상승 기류
    if (t >= T.takeoff && !fired.takeoff) {
      fired.takeoff = true;
      for (let i = 0; i < 120; i++) {
        const a = rand(0, Math.PI * 2);
        const sp = rand(2.5, 6);
        P.spawn(-0.1 + Math.cos(a) * 1.2, FEET_Y + Math.sin(a) * 0.3, Math.sin(a) * 0.5, Math.cos(a) * sp, Math.abs(Math.sin(a)) * sp * 0.25, 0, rand(0.4, 0.9), rand(0.08, 0.2), pickColor(0.55), 3, 0);
      }
    }

    // 날아다니는 동안 별가루 꼬리
    if (airborne && py < halfH + 3) {
      acc.trail += dt * 150;
      while (acc.trail >= 1) {
        acc.trail -= 1;
        const yy = py + rand(-2.4, 0.6) * s; // 망토 아래쪽에서 주로
        P.spawn(px + rand(-1.1, 1.1) * s, yy, rand(-0.3, 0.3), -vel.x * 0.08 + rand(-0.3, 0.3), -vel.y * 0.08 + rand(-0.3, 0.3), 0, rand(0.5, 1.2), rand(0.05, 0.17), pickColor(0.5), 1.2, 0.2);
      }
    }

    // 착지
    if (t >= T.land && !fired.land) {
      fired.land = true;
      for (let i = 0; i < 110; i++) {
        const a = rand(0, Math.PI * 2);
        const sp = rand(2, 5);
        P.spawn(-0.1 + Math.cos(a) * 1.3, FEET_Y + Math.sin(a) * 0.3, Math.sin(a) * 0.5, Math.cos(a) * sp, Math.abs(Math.sin(a)) * sp * 0.3, 0, rand(0.4, 0.9), rand(0.08, 0.2), pickColor(0.55), 3, 0);
      }
      for (let i = 0; i < 40; i++) {
        const a = rand(0.2, Math.PI - 0.2);
        P.spawn(-0.3 + Math.cos(a) * 2.4, 2.2 + Math.sin(a) * 1.6, 1, Math.cos(a) * 1.4, Math.sin(a) * 1.4, 0, rand(0.7, 1.3), rand(0.16, 0.3), pickColor(0.6), 2, 0);
      }
    }
    if (t > T.land && t < T.done + 2) {
      acc.idle += dt * 12;
      while (acc.idle >= 1) {
        acc.idle -= 1;
        P.spawn(rand(-2.4, 2.2), rand(-3.5, 3), rand(-0.5, 0.8), 0, rand(0.1, 0.4), 0, rand(0.8, 1.6), rand(0.06, 0.16), pickColor(0.5), 0.5, -0.05);
      }
    }
  }

  // ----- 텍스처 로드 -----
  const loader = new THREE.TextureLoader();
  const textures = [];
  const loadTex = (src) =>
    new Promise((resolve, reject) => {
      loader.load(
        src,
        (tx) => {
          tx.anisotropy = 4;
          textures.push(tx);
          resolve(tx);
        },
        undefined,
        reject
      );
    });
  Promise.all([loadTex(ASSETS.plain), loadTex(ASSETS.caped)])
    .then(([pt, ct]) => {
      if (disposed) return;
      plainMat.uniforms.uMap.value = pt;
      capedMat.uniforms.uMap.value = ct;
      onReady && onReady();
    })
    .catch((e) => console.error('텍스처 로드 실패', e));

  frame();

  function dispose() {
    disposed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    textures.forEach((tx) => tx.dispose());
    renderer.dispose();
  }

  return { play, dispose };
}

/* =====================================================================
   파티클 (CPU 시뮬레이션 + 반짝이 셰이더)
   ===================================================================== */
function createParticles(N) {
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const size = new Float32Array(N);
  const alpha = new Float32Array(N);
  const seed = new Float32Array(N);
  const vel = new Float32Array(N * 3);
  const life = new Float32Array(N);
  const maxLife = new Float32Array(N);
  const drag = new Float32Array(N);
  const grav = new Float32Array(N);
  let cursor = 0;

  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aCol = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
  const aSize = new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage);
  const aAlpha = new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aPos);
  geo.setAttribute('aColor', aCol);
  geo.setAttribute('aSize', aSize);
  geo.setAttribute('aAlpha', aAlpha);
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  for (let i = 0; i < N; i++) {
    seed[i] = Math.random();
    pos[i * 3 + 2] = -999;
  }

  const material = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 500 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aSize; attribute float aAlpha; attribute float aSeed;
      uniform float uScale; uniform float uTime;
      varying vec3 vColor; varying float vAlpha; varying float vRot;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 0.65 + 0.35 * sin(uTime * (8.0 + aSeed * 14.0) + aSeed * 60.0);
        gl_PointSize = max(0.0, aSize * 3.2 * uScale / -mv.z);
        vColor = aColor; vAlpha = aAlpha * tw; vRot = aSeed * 6.2831 + uTime * (aSeed - 0.5) * 2.0;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vAlpha; varying float vRot;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float cs = cos(vRot), sn = sin(vRot);
        c = mat2(cs, -sn, sn, cs) * c;
        float d = length(c);
        float core = exp(-d * d * 90.0);
        float halo = exp(-d * d * 14.0) * 0.35;
        float cross = exp(-abs(c.x) * 55.0) * exp(-abs(c.y) * 7.0) + exp(-abs(c.y) * 55.0) * exp(-abs(c.x) * 7.0);
        float v = core * 1.0 + halo * 0.7 + cross * 0.75;
        if (v * vAlpha < 0.003) discard;
        gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.7) * v * vAlpha, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.renderOrder = 5;

  function spawn(x, y, z, vx, vy, vz, l, s, c, dr, g) {
    const i = cursor;
    cursor = (cursor + 1) % N;
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    vel[i * 3] = vx;
    vel[i * 3 + 1] = vy;
    vel[i * 3 + 2] = vz;
    life[i] = l;
    maxLife[i] = l;
    size[i] = s;
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    drag[i] = dr;
    grav[i] = g;
  }

  function update(dt, now) {
    material.uniforms.uTime.value = now;
    for (let i = 0; i < N; i++) {
      if (life[i] <= 0) {
        alpha[i] = 0;
        continue;
      }
      life[i] -= dt;
      const k = Math.exp(-drag[i] * dt);
      vel[i * 3] *= k;
      vel[i * 3 + 1] = vel[i * 3 + 1] * k - grav[i] * dt;
      vel[i * 3 + 2] *= k;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      const u = Math.max(0, life[i] / maxLife[i]);
      alpha[i] = life[i] > 0 ? Math.min(1, (1 - u) * 10) * Math.min(1, u * 3) : 0;
    }
    aPos.needsUpdate = true;
    aCol.needsUpdate = true;
    aSize.needsUpdate = true;
    aAlpha.needsUpdate = true;
  }

  function clear() {
    life.fill(0);
    alpha.fill(0);
    aAlpha.needsUpdate = true;
  }

  return { points, material, spawn, update, clear };
}

/* =====================================================================
   웅장한 효과음 (Web Audio 합성)
   마법진 드론 · 하프 · 합창 → 변신 총주 → '슈웅~' 이륙 → 비행 행진곡 + 바람/스쳐가는 소리 → 착지 화음
   ===================================================================== */
export function createAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  // iPhone/iPad: 무음 스위치가 켜져 있어도 소리가 나도록 '재생' 세션으로 지정
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch (e) {
    /* 지원하지 않는 브라우저 */
  }
  const ctx = new AC();
  const sr = ctx.sampleRate;

  const master = ctx.createGain();
  master.gain.value = 0.8;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 5;
  comp.attack.value = 0.004;
  comp.release.value = 0.25;
  master.connect(comp).connect(ctx.destination);

  const hall = ctx.createConvolver();
  {
    const len = Math.floor(sr * 4.5);
    const buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp = lp * 0.55 + (Math.random() * 2 - 1) * 0.45;
        d[i] = lp * Math.pow(1 - i / len, 3.2) * (i < sr * 0.08 ? 1.4 : 1);
      }
    }
    hall.buffer = buf;
  }
  const hallGain = ctx.createGain();
  hallGain.gain.value = 0.5;
  hall.connect(hallGain).connect(master);

  const noiseBuf = (() => {
    const b = ctx.createBuffer(1, sr * 2, sr);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  })();

  const panner = (pan) => {
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      return p;
    }
    return ctx.createGain();
  };
  const out = (node, wet = 0.5, pan = 0) => {
    let n = node;
    if (pan) {
      const p = panner(pan);
      node.connect(p);
      n = p;
    }
    n.connect(master);
    const s = ctx.createGain();
    s.gain.value = wet;
    n.connect(s).connect(hall);
  };
  const env = (g, t, peak, a, hold, rel) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
  };
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

  function brass(t, f, dur, vol, { attack = 0.08, pan = 0, bright = 6 } = {}) {
    const g = ctx.createGain();
    env(g, t, vol, attack, Math.max(0, dur - attack - 0.3), 0.7);
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = 1.2;
    flt.frequency.setValueAtTime(f * 1.2, t);
    flt.frequency.exponentialRampToValueAtTime(f * bright, t + attack + 0.12);
    flt.frequency.exponentialRampToValueAtTime(f * bright * 0.55, t + dur + 0.3);
    flt.connect(g);
    out(g, 0.5, pan);
    [-7, 0, 7].forEach((det) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(flt);
      o.start(t);
      o.stop(t + dur + 1);
    });
  }

  function choir(t, f, dur, vol, pan = 0) {
    const g = ctx.createGain();
    env(g, t, vol, 0.5, Math.max(0, dur - 1.4), 0.9);
    out(g, 0.8, pan);
    const bus = ctx.createGain();
    [
      [730, 1, 8],
      [1090, 0.5, 9],
      [2440, 0.25, 10],
    ].forEach(([ff, amp, q]) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = ff;
      bp.Q.value = q;
      const ag = ctx.createGain();
      ag.gain.value = amp * 3;
      bus.connect(bp).connect(ag).connect(g);
    });
    [-9, -3, 4, 10].forEach((det) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 4.5 + Math.random() * 1.2;
      const lg = ctx.createGain();
      lg.gain.value = f * 0.005;
      lfo.connect(lg).connect(o.frequency);
      o.connect(bus);
      o.start(t);
      lfo.start(t);
      o.stop(t + dur + 0.5);
      lfo.stop(t + dur + 0.5);
    });
  }

  function strings(t, f, dur, vol, pan = 0) {
    const g = ctx.createGain();
    env(g, t, vol, Math.min(0.6, dur * 0.3), Math.max(0, dur - 1.0), 0.6);
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = f * 4;
    flt.connect(g);
    out(g, 0.6, pan);
    [-12, -4, 5, 12].forEach((det) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(flt);
      o.start(t);
      o.stop(t + dur + 0.8);
    });
  }

  // 하프 (튕기는 소리)
  function harp(t, f, vol = 0.06, pan = 0) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.frequency.value = f * 2;
    const g = ctx.createGain();
    env(g, t, vol, 0.004, 0, 1.4);
    const g2 = ctx.createGain();
    env(g2, t, vol * 0.3, 0.004, 0, 0.5);
    o.connect(g);
    o2.connect(g2);
    out(g, 0.6, pan);
    out(g2, 0.6, pan);
    o.start(t);
    o2.start(t);
    o.stop(t + 1.6);
    o2.stop(t + 0.7);
  }

  function drum(t, f0, f1, dur, vol, { noise = 0.4, wet = 0.4 } = {}) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
    const g = ctx.createGain();
    env(g, t, vol, 0.004, 0.02, dur);
    o.connect(g);
    out(g, wet);
    o.start(t);
    o.stop(t + dur + 0.1);
    if (noise > 0) {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuf;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const ng = ctx.createGain();
      env(ng, t, vol * noise, 0.002, 0.01, 0.18);
      n.connect(lp).connect(ng);
      out(ng, wet);
      n.start(t);
      n.stop(t + 0.3);
    }
  }

  function noise(t, dur, { vol = 0.2, f0 = 800, f1 = 800, q = 1, type = 'bandpass', attack = 0.02, wet = 0.4, pan = 0, pan1 = null } = {}) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(attack, dur * 0.9));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    if (pan1 !== null && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(pan, t);
      p.pan.linearRampToValueAtTime(pan1, t + dur);
      g.connect(p);
      out(p, wet);
    } else out(g, wet, pan);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  function crash(t, dur, vol) {
    noise(t, dur, { vol, f0: 9000, f1: 5000, q: 0.4, type: 'highpass', attack: 0.004, wet: 0.7 });
    noise(t, dur * 0.6, { vol: vol * 0.6, f0: 6000, f1: 3500, q: 1.5, attack: 0.004, wet: 0.7 });
  }

  function bell(t, f, vol = 0.06, dur = 1.6, pan = 0) {
    [
      [1, 1],
      [2.01, 0.35],
      [3.98, 0.15],
    ].forEach(([m, a], i) => {
      const o = ctx.createOscillator();
      o.frequency.value = f * m;
      const g = ctx.createGain();
      env(g, t, vol * a, 0.003, 0, dur / (1 + i * 0.6));
      o.connect(g);
      out(g, 0.7, pan);
      o.start(t);
      o.stop(t + dur + 0.1);
    });
  }

  // '슈웅~' : 스쳐 지나가는 바람 + 휘파람처럼 올라가는 음
  function swoosh(t, dur, vol, { up = true, pan0 = 0, pan1 = 0, whistle = true } = {}) {
    noise(t, dur, { vol, f0: up ? 350 : 3200, f1: up ? 3800 : 500, q: 1.6, attack: dur * 0.55, wet: 0.35, pan: pan0, pan1 });
    noise(t, dur * 0.9, { vol: vol * 0.5, f0: up ? 900 : 6000, f1: up ? 7000 : 1200, q: 3, attack: dur * 0.5, wet: 0.35, pan: pan0, pan1 });
    if (whistle) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(up ? 380 : 1400, t);
      o.frequency.exponentialRampToValueAtTime(up ? 1500 : 420, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * 0.18, t + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      out(g, 0.4, (pan0 + pan1) / 2);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  function schedule() {
    const t0 = ctx.currentTime + 0.06;
    const at = (s) => t0 + s;

    // 1) 마법진: 낮은 드론 + 합창이 서서히
    [38, 45, 50, 53].forEach((n, i) => strings(at(0), midi(n), 3.2, 0.032 - i * 0.004, (i - 1.5) * 0.3));
    drum(at(0.05), 70, 42, 1.8, 0.4, { noise: 0.2, wet: 0.5 });
    noise(at(0), 1.2, { vol: 0.08, f0: 1500, f1: 6000, q: 2, attack: 0.8, wet: 0.7 });
    for (let i = 0; i < 6; i++) bell(at(0.15 + i * 0.12), midi(86 + [0, 3, 7, 10, 12, 15][i]), 0.025, 0.8, (i % 2 ? 0.4 : -0.4));

    // 2) 빛의 실타래: 하프 아르페지오 + 휘감는 바람
    const arpNotes = [62, 65, 69, 72, 74, 77, 81, 84];
    for (let i = 0; i < 22; i++) harp(at(T.threads + i * 0.07), midi(arpNotes[i % arpNotes.length] + (i >= 8 ? 12 * Math.floor(i / 16) : 0)), 0.05, Math.sin(i * 0.9) * 0.6);
    for (let k = 0; k < 4; k++) noise(at(T.threads + 0.2 + k * 0.4), 0.7, { vol: 0.07, f0: 600, f1: 2400, q: 2, attack: 0.35, pan: k % 2 ? -0.7 : 0.7, pan1: k % 2 ? 0.7 : -0.7 });
    choir(at(T.threads + 0.3), midi(62), 2.4, 0.04, -0.3);
    choir(at(T.threads + 0.3), midi(65), 2.4, 0.035, 0.3);
    // 조여 드는 긴장: 팀파니 롤 + 역방향 스웰
    let tt = at(T.tighten);
    const rollEnd = at(T.transform);
    while (tt < rollEnd - 0.02) {
      const p = (tt - at(T.tighten)) / (rollEnd - at(T.tighten));
      drum(tt, 75 + p * 10, 55, 0.35, 0.08 + p * 0.3, { noise: 0.2, wet: 0.5 });
      tt += lerp(0.11, 0.045, p);
    }
    noise(at(T.tighten), T.transform - T.tighten, { vol: 0.28, f0: 300, f1: 9000, q: 0.8, type: 'lowpass', attack: T.transform - T.tighten - 0.02, wet: 0.3 });
    [48, 55, 60, 65, 67].forEach((n, i) => brass(at(T.tighten), midi(n), T.transform - T.tighten + 0.1, 0.028 + i * 0.004, { attack: 0.5, pan: (i - 2) * 0.3, bright: 5 }));

    // 3) 변신! D 장조 총주
    const tb = at(T.transform);
    drum(tb, 65, 30, 2.6, 0.9, { noise: 0.8, wet: 0.3 });
    crash(tb, 3.5, 0.14);
    noise(tb, 1.0, { vol: 0.18, f0: 300, f1: 6000, q: 1, attack: 0.9, wet: 0.5 }); // 위→아래 쓸어내리는 띠
    [38, 50, 57, 62, 66, 69, 74].forEach((n, i) => brass(tb, midi(n), 1.6, 0.045 - i * 0.003, { attack: 0.06, pan: ((i % 4) - 1.5) * 0.35, bright: 7 }));
    [62, 66, 69, 74].forEach((n, i) => choir(tb + 0.05, midi(n), 1.8, 0.045, ((i % 3) - 1) * 0.4));
    [74, 78, 81, 86, 90, 93].forEach((n, i) => bell(tb + 0.05 + i * 0.07, midi(n), 0.045, 1.8, ((i % 2) * 2 - 1) * 0.5));

    // 4) 기쁨: 통통 튀는 종소리
    [0, 0.275].forEach((d, i) => {
      bell(at(T.joy + d), midi(86 + i * 5), 0.05, 0.8);
      drum(at(T.joy + d + 0.2), 140, 90, 0.2, 0.15, { noise: 0.1 });
    });

    // 5) 웅크렸다가 '슈우우웅~' 이륙
    noise(at(T.crouch), T.takeoff - T.crouch, { vol: 0.1, f0: 200, f1: 900, q: 1, attack: 0.28, wet: 0.2 });
    swoosh(at(T.takeoff - 0.08), 0.85, 0.42, { up: true, pan0: 0, pan1: 0 });
    drum(at(T.takeoff), 80, 40, 0.8, 0.5, { noise: 0.5 });
    brass(at(T.takeoff), midi(62), 0.4, 0.04, { bright: 6 });
    brass(at(T.takeoff + 0.15), midi(69), 0.4, 0.045, { bright: 6 });

    // 6) 비행: 행진곡풍 팡파르 + 현악 + 팀파니
    const beat = 0.3;
    const mStart = at(T.up);
    const melody = [
      [69, 1], [74, 1], [78, 1], [81, 2], [79, 0.5], [78, 0.5], [76, 1], [74, 1],
      [76, 0.5], [78, 0.5], [79, 1], [81, 1], [83, 1], [81, 1], [86, 3],
    ];
    let mt = mStart;
    melody.forEach(([n, b]) => {
      brass(mt, midi(n), b * beat * 0.95, 0.035, { attack: 0.03, bright: 6, pan: 0.15 });
      mt += b * beat;
    });
    const chords = [
      [50, 57, 62, 66],
      [43, 55, 59, 62],
      [45, 57, 61, 64],
      [50, 57, 62, 66],
    ];
    chords.forEach((ch, i) => ch.forEach((n, j) => strings(mStart + i * 4 * beat, midi(n), 4 * beat, 0.022, (j - 1.5) * 0.35)));
    for (let i = 0; i < 16; i += 2) drum(mStart + i * beat, i % 4 === 0 ? 82 : 110, 55, 0.4, 0.22, { noise: 0.25, wet: 0.35 });

    // 바람 소리: 비행 경로의 속도를 따라 커지고 높아짐, 위치를 따라 좌우로
    const wStart = T.loopStart - 0.2;
    const wEnd = T.land + 0.2;
    const step = 0.04;
    const N = Math.floor((wEnd - wStart) / step);
    const gainC = new Float32Array(N);
    const freqC = new Float32Array(N);
    const panC = new Float32Array(N);
    const speeds = [];
    for (let i = 0; i < N; i++) {
      const tt2 = wStart + i * step;
      let nx = 0;
      let spd = 0;
      if (tt2 >= T.loopStart && tt2 < T.loopEnd) {
        const a = flightNorm(tt2);
        const b = flightNorm(tt2 + 0.02);
        nx = a[0];
        spd = Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.02;
      } else if (tt2 >= T.loopEnd) {
        nx = 0;
        spd = 1.2 * (1 - seg(tt2, T.loopEnd, T.land));
      }
      speeds.push([tt2, spd, nx]);
      gainC[i] = Math.max(0.0001, Math.min(0.2, spd * 0.06));
      freqC[i] = 300 + spd * 700;
      panC[i] = clamp(nx, -1, 1) * 0.85;
    }
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuf;
    wind.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.Q.value = 0.9;
    const wg = ctx.createGain();
    wg.gain.value = 0.0001;
    const wp = panner(0);
    wind.connect(wf).connect(wg).connect(wp);
    out(wp, 0.25);
    const ws = at(wStart);
    const wd = N * step;
    wg.gain.setValueCurveAtTime(gainC, ws, wd);
    wf.frequency.setValueCurveAtTime(freqC, ws, wd);
    if (wp.pan) wp.pan.setValueCurveAtTime(panC, ws, wd);
    wind.start(ws);
    wind.stop(ws + wd + 0.1);

    // 가까이 스쳐 갈 때마다 '슈웅!' (속도가 가장 빠른 순간들)
    for (let i = 2; i < speeds.length - 2; i++) {
      const [tt3, sp, nx] = speeds[i];
      if (tt3 < T.loopStart || tt3 > T.loopEnd) continue;
      if (sp > speeds[i - 1][1] && sp >= speeds[i + 1][1] && sp > speeds[i - 2][1] && sp >= speeds[i + 2][1] && sp > 1.6) {
        const before = clamp(flightNorm(tt3 - 0.15)[0], -1, 1);
        const after = clamp(flightNorm(tt3 + 0.15)[0], -1, 1);
        const v = Math.min(0.3, 0.1 + sp * 0.05);
        swoosh(at(tt3 - 0.18), 0.42, v, { up: false, pan0: before * 0.9, pan1: after * 0.9, whistle: i % 2 === 0 });
      }
    }

    // 7) 사뿐히 착지 + 마무리 화음
    swoosh(at(T.loopEnd + 0.2), 0.7, 0.18, { up: false, pan0: 0.2, pan1: 0 });
    const tl = at(T.land);
    drum(tl, 90, 45, 1.2, 0.5, { noise: 0.5, wet: 0.4 });
    crash(tl + 0.02, 2.5, 0.08);
    [50, 57, 62, 66, 69, 74].forEach((n, i) => brass(tl + 0.05, midi(n), 2.2, 0.035, { attack: 0.12, pan: (i - 2.5) * 0.25, bright: 5 }));
    [62, 66, 69, 74].forEach((n, i) => choir(tl + 0.05, midi(n), 2.6, 0.04, (i - 1.5) * 0.4));
    [86, 90, 93, 98].forEach((n, i) => bell(tl + 0.3 + i * 0.12, midi(n), 0.04, 2.0, (i - 1.5) * 0.4));
  }

  // 반드시 클릭(탭) 이벤트 안에서 호출: 자동재생 차단을 풀고 오디오를 깨움
  let keepAlive = null;
  function unlock() {
    try {
      const b = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) {
      /* 무시 */
    }
    try {
      if (!keepAlive) {
        keepAlive = new Audio(SILENT_WAV);
        keepAlive.loop = true;
        keepAlive.setAttribute('playsinline', '');
      }
      keepAlive.currentTime = 0;
      const pr = keepAlive.play();
      if (pr && pr.catch) pr.catch(() => {});
      clearTimeout(keepAlive._stop);
      keepAlive._stop = setTimeout(() => keepAlive.pause(), (T.done + 4) * 1000);
    } catch (e) {
      /* 무시 */
    }
    const resumed = ctx.state === 'running' ? Promise.resolve() : ctx.resume();
    return Promise.race([resumed, new Promise((r) => setTimeout(r, 400))]).catch(() => {});
  }

  function setMuted(m) {
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.04);
  }

  function close() {
    if (keepAlive) keepAlive.pause();
    ctx.close();
  }

  return { ctx, schedule, unlock, setMuted, close };
}

/* =====================================================================
   React 컴포넌트
   ===================================================================== */
const CSS = `
  html, body, #root { margin: 0; height: 100%; background: #071016; }
  .app { position: fixed; inset: 0; overflow: hidden; background: #071016; font-family: 'Pretendard', 'Apple SD Gothic Neo', 'Noto Sans KR', system-ui, sans-serif; }
  .app canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .loading { position: absolute; inset: 0; display: grid; place-items: center; color: #e4ffe9; font-size: 18px; letter-spacing: 0.04em; }
  .bar { position: absolute; left: 50%; bottom: max(20px, env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex; gap: 10px; }
  .bar button { appearance: none; border: 1px solid rgba(190,255,190,0.4); border-radius: 999px; padding: 11px 22px; font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; color: #effff0; background: rgba(16,40,36,0.72); backdrop-filter: blur(6px); transition: transform .15s ease, background .2s ease, opacity .2s; }
  .bar button:hover:not(:disabled) { transform: translateY(-1px); background: rgba(30,70,60,0.85); }
  .bar button:disabled { opacity: 0.55; cursor: default; }
  .bar .play { background: linear-gradient(180deg, #ffe27a, #f0b43a); color: #3a2600; border-color: #fff0b0; box-shadow: 0 6px 24px rgba(255,210,90,0.3); }
  .bar .play:hover:not(:disabled) { background: linear-gradient(180deg, #ffe993, #f5bf4f); }
  .bar .sound[aria-pressed='false'] { color: #a9c4b3; }
`;

export default function App() {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const audioRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | playing | done
  const [sound, setSound] = useState(true);

  useEffect(() => {
    const stage = createStage(canvasRef.current, {
      onReady: () => setReady(true),
      onDone: () => setPhase('done'),
    });
    stageRef.current = stage;
    return () => stage.dispose();
  }, []);

  useEffect(
    () => () => {
      if (audioRef.current) audioRef.current.close();
      audioRef.current = null;
    },
    []
  );

  // 재생 중에 '소리 꺼짐'을 누르면 바로 음소거
  useEffect(() => {
    if (audioRef.current) audioRef.current.setMuted(!sound);
  }, [sound]);

  const play = useCallback(async () => {
    if (!stageRef.current) return;
    setPhase('playing');
    let a = null;
    if (sound) {
      if (!audioRef.current || audioRef.current.ctx.state === 'closed') audioRef.current = createAudio();
      a = audioRef.current;
      if (a) {
        a.setMuted(false);
        await a.unlock();
      }
    }
    if (a) a.schedule();
    stageRef.current.play();
  }, [sound]);

  const label = phase === 'idle' ? '재생' : phase === 'playing' ? '재생 중…' : '다시 보기';

  return (
    <div className="app">
      <style>{CSS}</style>
      <canvas ref={canvasRef} aria-label="마법진과 빛의 실타래 속에서 마법사에게 초록 망토가 둘러지고, 마법사가 슈웅 하고 날아올라 하늘을 누비다 내려앉는 애니메이션" />
      {!ready && <div className="loading">불러오는 중…</div>}
      <div className="bar">
        <button className="play" onClick={play} disabled={!ready || phase === 'playing'}>
          {label}
        </button>
        <button className="sound" aria-pressed={String(sound)} onClick={() => setSound((s) => !s)}>
          {sound ? '소리 켜짐' : '소리 꺼짐'}
        </button>
      </div>
    </div>
  );
}

/* =====================================================================
   이미지 (첨부 이미지 2장, 배경 제거, WebP)
   ===================================================================== */
const SILENT_WAV = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';
const ASSETS = {
  plain: 'data:image/webp;base64,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',
  caped: 'data:image/webp;base64,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',
};
