import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

/* =====================================================================
   마법사에게 마법 투구가 날아와 씌워지고, 투구에서 빛이 사방으로 퍼지는 애니메이션
   (React + three.js)

   - 캐릭터: 첨부 이미지(배경 제거)
   - 투구:   두 번째 첨부 이미지의 투구(투구만 잘라낸 것)를 그대로 사용
   - 타임라인(초)
     0.0  지팡이에 마력이 모임
     0.7  투구가 오른쪽 위에서 빙글빙글 날아옴 (지팡이에서 마법 줄기)
     2.0  머리 위에서 잠깐 멈칫
     2.4  쑥 내려와 2.75에 머리에 '쿵' 얹어짐
     2.9  투구의 룬 문자와 보석에 빛이 모여듦
     3.5  투구에서 빛이 사방으로 폭발 → 광선, 충격파, 별가루, 나선 광채
     9.2  종료 (광채는 은은하게 계속 유지)
   ===================================================================== */

// ---------- 좌표 (캐릭터 이미지 480×721 px, 100px = 1 world unit) ----------
const IMG_W = 480;
const IMG_H = 721;
const px = (x, y) => [(x - IMG_W / 2) / 100, (IMG_H / 2 - y) / 100];
const FEET_Y = px(0, 705)[1];
const WAND_TIP = px(437, 463);

// 투구: 원본 투구 이미지 414×414 px → 캐릭터 머리에 맞게 0.65배
const HELM_SCALE = 0.65;
const HELM_SIZE = (414 * HELM_SCALE) / 100;
const HELM_HOME = px(75 + (414 * HELM_SCALE) / 2, 136 + (414 * HELM_SCALE) / 2); // 머리에 씌워졌을 때 중심
const GEM_OFFSET = [(90 * HELM_SCALE) / 100, (60 * HELM_SCALE) / 100]; // 투구 중심 → 이마 보석

// ---------- 타이밍 ----------
const T = {
  fly: 0.7,
  arrive: 2.0,
  drop: 2.4,
  land: 2.75,
  charge: 2.9,
  burst: 3.5,
  done: 9.2,
};

// ---------- 유틸 ----------
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const smooth = (t) => t * t * (3 - 2 * t);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;
const rand = (a, b) => a + Math.random() * (b - a);

const PALETTE = [
  new THREE.Color('#fff3c4'),
  new THREE.Color('#ffd56b'),
  new THREE.Color('#ffb347'),
  new THREE.Color('#ffffff'),
  new THREE.Color('#8fe9ff'),
  new THREE.Color('#ff9ad5'),
  new THREE.Color('#c3a8ff'),
];
const pickColor = (warm = 0.6) =>
  Math.random() < warm ? PALETTE[Math.floor(Math.random() * 4)] : PALETTE[4 + Math.floor(Math.random() * 3)];

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
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 200);
  let baseDist = 32;
  const VIEW_CENTER_Y = 0.15;

  // ----- 배경 (밤하늘 + 폭발 시 따뜻한 빛) -----
  const bgMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uBurst: { value: 0 }, uCenter: { value: new THREE.Vector2(0, 2) } },
    vertexShader: PLANE_VS,
    fragmentShader: /* glsl */ `
      varying vec2 vP;
      uniform float uTime; uniform float uBurst; uniform vec2 uCenter;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      void main(){
        float h = clamp((vP.y + 7.0) / 14.0, 0.0, 1.0);
        vec3 col = mix(vec3(0.16, 0.10, 0.27), vec3(0.035, 0.045, 0.14), h);
        vec2 g = vP * 3.2;
        vec2 cell = floor(g);
        float r = hash(cell);
        vec2 f = fract(g) - vec2(hash(cell + 3.1), hash(cell + 7.7));
        float star = smoothstep(0.06, 0.0, length(f)) * step(0.86, r);
        star *= 0.45 + 0.55 * sin(uTime * (1.5 + r * 3.0) + r * 40.0);
        col += vec3(0.75, 0.8, 1.0) * star * 0.55;
        float d = length(vP - uCenter);
        col += vec3(1.0, 0.72, 0.35) * uBurst * 0.55 * exp(-d * 0.22);
        col += vec3(0.6, 0.45, 1.0) * uBurst * 0.18 * exp(-d * 0.08);
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthWrite: false,
  });
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(90, 60), bgMat);
  bg.position.z = -8;
  bg.renderOrder = -10;
  scene.add(bg);

  // ----- 광선 + 충격파 링 (캐릭터 뒤) -----
  const raysMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uReach: { value: 0 },
      uGlow: { value: 0 },
      uRings: { value: new THREE.Vector3(-99, -99, -99) },
    },
    vertexShader: PLANE_VS,
    fragmentShader: /* glsl */ `
      varying vec2 vP;
      uniform float uTime; uniform float uIntensity; uniform float uReach; uniform float uGlow;
      uniform vec3 uRings;
      float ring(float r, float t0){
        float age = uTime - t0;
        if (age < 0.0 || age > 2.4) return 0.0;
        float rr = age * 7.5;
        float w = 0.18 + age * 0.25;
        return exp(-pow((r - rr) / w, 2.0)) * (1.0 - age / 2.4);
      }
      void main(){
        float r = length(vP);
        float a = atan(vP.y, vP.x);
        float t = uTime;
        float n1 = pow(0.5 + 0.5 * sin(a * 12.0 + t * 0.55), 10.0);
        float n2 = pow(0.5 + 0.5 * sin(a * 19.0 - t * 0.8 + 1.3), 16.0);
        float n3 = pow(0.5 + 0.5 * sin(a * 7.0 + t * 0.3 + 2.1), 5.0);
        float n4 = pow(0.5 + 0.5 * sin(a * 31.0 + t * 1.3), 24.0);
        float flick = 0.75 + 0.25 * sin(t * 7.0 + a * 5.0);
        float rays = (n1 * 0.75 + n2 * 0.6 + n3 * 0.45 + n4 * 0.5) * flick;
        float reach = max(uReach, 0.001);
        float fall = smoothstep(reach, reach * 0.15, r) * smoothstep(0.0, 0.5, r);
        vec3 gold = vec3(1.0, 0.82, 0.42);
        vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (a / 6.2831 + vec3(0.0, 0.33, 0.67)) + t * 0.4);
        vec3 tint = mix(gold, rainbow, 0.28);
        vec3 col = tint * rays * fall * uIntensity * 1.3;
        col += vec3(1.0, 0.93, 0.75) * uGlow * (0.45 / (r * r * 2.2 + 0.45));
        float rings = ring(r, uRings.x) + ring(r, uRings.y) * 0.8 + ring(r, uRings.z) * 0.6;
        col += mix(vec3(1.0, 0.9, 0.6), rainbow, 0.35) * rings * 0.9;
        gl_FragColor = vec4(col, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const rays = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), raysMat);
  rays.renderOrder = 1;
  scene.add(rays);

  // ----- 캐릭터 (발 기준 피벗) -----
  const charPivot = new THREE.Group();
  charPivot.position.y = FEET_Y;
  scene.add(charPivot);
  const charGroup = new THREE.Group();
  charGroup.position.y = -FEET_Y;
  charPivot.add(charGroup);

  const shadowMat = new THREE.ShaderMaterial({
    uniforms: { uBurst: { value: 0 } },
    vertexShader: PLANE_VS,
    fragmentShader: `varying vec2 vUv; uniform float uBurst;
      void main(){ vec2 p = (vUv - 0.5) * 2.0; float d = length(p);
        float a = smoothstep(1.0, 0.0, d);
        vec3 c = mix(vec3(0.0), vec3(1.0,0.8,0.45), uBurst);
        gl_FragColor = vec4(c, a * mix(0.45, 0.35, uBurst)); }`,
    transparent: true,
    depthWrite: false,
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.55), shadowMat);
  shadow.position.set(-0.1, FEET_Y - 0.05, -0.2);
  scene.add(shadow);

  const bodyMat = new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, alphaTest: 0.02 });
  const body = new THREE.Mesh(new THREE.PlaneGeometry(IMG_W / 100, IMG_H / 100), bodyMat);
  body.renderOrder = 2;
  charGroup.add(body);

  // ----- 투구 (원본 이미지 그대로 + 발광 셰이더) -----
  const helmRoot = new THREE.Group(); // 비행 경로
  charGroup.add(helmRoot);
  const helmSquash = new THREE.Group(); // 착지 찌그러짐 (아래쪽 기준)
  helmSquash.position.y = -HELM_SIZE / 2;
  helmRoot.add(helmSquash);
  const helmSpin = new THREE.Group(); // 회전
  helmSpin.position.y = HELM_SIZE / 2;
  helmSquash.add(helmSpin);

  const helmUniforms = {
    uMap: { value: null },
    uTime: { value: 0 },
    uOpacity: { value: 1 },
    uGlow: { value: 0 },
    uRune: { value: 0 },
    uSweep: { value: -1 },
    uSweepAmt: { value: 0 },
    uHalo: { value: 0 },
  };
  const helmMat = new THREE.ShaderMaterial({
    uniforms: helmUniforms,
    vertexShader: PLANE_VS,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D uMap; uniform float uTime; uniform float uOpacity;
      uniform float uGlow; uniform float uRune; uniform float uSweep; uniform float uSweepAmt;
      void main(){
        vec4 c = texture2D(uMap, vUv);
        if (c.a < 0.01) discard;
        vec3 col = c.rgb;
        // 금색 띠/룬 문자가 빛남
        float gold = smoothstep(0.15, 0.42, c.r - c.b);
        float shimmer = 0.75 + 0.25 * sin(uTime * 6.0 + vUv.x * 24.0);
        col += vec3(1.0, 0.82, 0.4) * gold * uRune * shimmer;
        // 파란 강철 표면에 금빛이 번짐
        col = mix(col, col * vec3(1.25, 1.18, 1.05) + vec3(0.18, 0.14, 0.06), uGlow);
        // 반짝 지나가는 광택
        float band = exp(-pow((vUv.x * 0.8 + (1.0 - vUv.y) * 0.6 - uSweep) * 7.0, 2.0));
        col += vec3(1.0, 0.97, 0.88) * band * uSweepAmt;
        gl_FragColor = vec4(col, c.a * uOpacity);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const helm = new THREE.Mesh(new THREE.PlaneGeometry(HELM_SIZE, HELM_SIZE), helmMat);
  helm.renderOrder = 4;
  helmSpin.add(helm);

  // 투구 실루엣을 따라 번지는 후광
  const HALO_PAD = 1.4;
  const haloMat = new THREE.ShaderMaterial({
    uniforms: helmUniforms,
    vertexShader: PLANE_VS,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D uMap; uniform float uTime; uniform float uHalo;
      void main(){
        vec2 uv = (vUv - 0.5) * ${HALO_PAD.toFixed(2)} + 0.5;
        float acc = 0.0;
        for (int i = 0; i < 16; i++) {
          float a = float(i) * 0.3927;
          vec2 d = vec2(cos(a), sin(a));
          acc += texture2D(uMap, uv + d * 0.035).a;
          acc += texture2D(uMap, uv + d * 0.075).a * 0.7;
          acc += texture2D(uMap, uv + d * 0.13).a * 0.4;
        }
        acc /= 33.6;
        float pulse = 0.85 + 0.15 * sin(uTime * 4.0);
        vec3 col = vec3(1.0, 0.8, 0.42) * acc * uHalo * pulse;
        gl_FragColor = vec4(col, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(HELM_SIZE * HALO_PAD, HELM_SIZE * HALO_PAD), haloMat);
  halo.position.z = -0.02;
  halo.renderOrder = 3;
  helmSpin.add(halo);

  const gemAnchor = new THREE.Object3D();
  gemAnchor.position.set(GEM_OFFSET[0], GEM_OFFSET[1], 0.05);
  helmSpin.add(gemAnchor);

  // 보석 플레어 (앞)
  const flareMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 } },
    vertexShader: PLANE_VS,
    fragmentShader: /* glsl */ `
      varying vec2 vP; uniform float uTime; uniform float uIntensity;
      void main(){
        vec2 p = vP;
        float r = length(p);
        float core = exp(-r * r * 14.0);
        float ca = cos(uTime * 0.6), sa = sin(uTime * 0.6);
        vec2 q = mat2(ca, -sa, sa, ca) * p;
        float cross = exp(-abs(q.x) * 32.0) * exp(-abs(q.y) * 1.4) + exp(-abs(q.y) * 32.0) * exp(-abs(q.x) * 1.4);
        vec2 q2 = mat2(0.7071, -0.7071, 0.7071, 0.7071) * q;
        float cross2 = exp(-abs(q2.x) * 45.0) * exp(-abs(q2.y) * 2.6) + exp(-abs(q2.y) * 45.0) * exp(-abs(q2.x) * 2.6);
        vec3 col = vec3(0.85, 0.97, 1.0) * core * 1.3 + vec3(1.0, 0.88, 0.6) * cross * 0.85 + vec3(0.7, 0.9, 1.0) * cross2 * 0.5;
        gl_FragColor = vec4(col * uIntensity, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const flare = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), flareMat);
  flare.renderOrder = 6;
  scene.add(flare);

  // ----- 파티클 -----
  const particles = createParticles(2400);
  scene.add(particles.points);

  // ----- 화면 섬광 -----
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xfff4dd,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), flashMat);
  flash.position.z = 3;
  flash.renderOrder = 10;
  scene.add(flash);

  // ----- 크기 맞추기 -----
  const resize = () => {
    const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 800;
    const h = canvas.clientHeight || canvas.parentElement?.clientHeight || 600;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const tanH = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    baseDist = Math.max(9.6 / 2 / tanH, 6.4 / 2 / (tanH * camera.aspect));
    camera.updateProjectionMatrix();
    particles.material.uniforms.uScale.value = (h * renderer.getPixelRatio()) / (2 * tanH);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement || canvas);
  resize();

  // ----- 텍스처 -----
  const loader = new THREE.TextureLoader();
  const textures = [];
  const loadTex = (src, srgb) =>
    new Promise((resolve, reject) => {
      loader.load(
        src,
        (tx) => {
          if (srgb) tx.colorSpace = THREE.SRGBColorSpace;
          tx.anisotropy = 4;
          textures.push(tx);
          resolve(tx);
        },
        undefined,
        reject
      );
    });

  // ----- 상태 -----
  let startAt = -1;
  let doneFired = true;
  const emitAcc = { wand: 0, stream: 0, trail: 0, charge: 0, spiral: 0, twinkle: 0, ambient: 0 };
  const fired = { land: false, burst: false };
  const tmpV = new THREE.Vector3();
  const helmWorld = new THREE.Vector3();
  const gemWorld = new THREE.Vector3();

  function play() {
    if (disposed) return;
    particles.clear();
    for (const k in emitAcc) emitAcc[k] = 0;
    fired.land = fired.burst = false;
    doneFired = false;
    startAt = performance.now() / 1000;
  }

  // 투구 비행 경로 (charGroup 좌표)
  const START = new THREE.Vector3(5.2, 4.2, 0.4);
  const CTRL = new THREE.Vector3(3.6, 5.6, 0.4);
  const HOVER = new THREE.Vector3(HELM_HOME[0], HELM_HOME[1] + 1.8, 0.1);
  const HOME = new THREE.Vector3(HELM_HOME[0], HELM_HOME[1], 0.1);
  const bez = (u, out) => {
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c = u * u;
    return out.set(
      a * START.x + b * CTRL.x + c * HOVER.x,
      a * START.y + b * CTRL.y + c * HOVER.y,
      a * START.z + b * CTRL.z + c * HOVER.z
    );
  };

  let raf = 0;
  let prevNow = performance.now() / 1000;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, Math.max(0, now - prevNow));
    prevNow = now;
    const t = startAt < 0 ? 0 : now - startAt;
    update(t, now, dt);
    renderer.render(scene, camera);
  };

  function update(t, now, dt) {
    const started = startAt >= 0;
    const landAge = started ? t - T.land : -1;
    const bAge = started ? t - T.burst : -1;

    // --- 캐릭터 숨쉬기 + 착지 충격 ---
    let sq = 0;
    if (landAge > 0) sq = Math.exp(-landAge * 7) * Math.cos(landAge * 20) * 0.06;
    charPivot.scale.set(1 + sq * 0.6, 1 - sq + Math.sin(now * 2.2) * 0.008, 1);

    // --- 투구 비행 ---
    const show = started && t >= T.fly;
    let rotZ = 0;
    let rotY = 0;
    let scl = 1;
    let sx = 1;
    let sy = 1;
    if (show) {
      if (t < T.arrive) {
        const u = easeOutCubic(seg(t, T.fly, T.arrive));
        bez(u, helmRoot.position);
        rotZ = Math.PI * 4 * (1 - u);
        rotY = Math.sin(u * Math.PI * 3) * 0.45 * (1 - u);
        scl = lerp(0.55, 1, u);
      } else if (t < T.drop) {
        const u = seg(t, T.arrive, T.drop);
        helmRoot.position.copy(HOVER);
        helmRoot.position.y += Math.sin(u * Math.PI) * 0.12;
        rotZ = Math.sin(u * Math.PI * 2) * 0.05;
      } else if (t < T.land) {
        const u = easeInCubic(seg(t, T.drop, T.land));
        helmRoot.position.lerpVectors(HOVER, HOME, u);
      } else {
        helmRoot.position.copy(HOME);
        const a = t - T.land;
        const s = Math.exp(-a * 9) * Math.cos(a * 26) * 0.12;
        sy = 1 - s;
        sx = 1 + s * 0.6;
      }
    }
    helmRoot.visible = show;
    helmSpin.rotation.set(0, rotY, rotZ);
    helmRoot.scale.setScalar(scl);
    helmSquash.scale.set(sx, sy, 1);

    helmSpin.getWorldPosition(helmWorld);
    gemAnchor.getWorldPosition(gemWorld);

    // --- 투구 발광 ---
    const charge = started ? smooth(seg(t, T.charge, T.burst)) : 0;
    const post = bAge > 0 ? 1 : 0;
    const pulse = 0.5 + 0.5 * Math.sin(now * 4.5);
    helmUniforms.uTime.value = now;
    helmUniforms.uRune.value = show ? 0.12 + charge * 0.9 + post * (0.45 + pulse * 0.35) : 0;
    helmUniforms.uGlow.value = charge * 0.3 + post * lerp(0.6, 0.22, smooth(seg(bAge, 0, 2.5)));
    helmUniforms.uHalo.value = show ? 0.25 * (t < T.land ? 1 : 0.4) + charge * 1.2 + post * lerp(2.0, 0.55, smooth(seg(bAge, 0, 3))) : 0;
    // 광택: 충전 중 한 번, 이후 2.4초마다
    let sweep = -1;
    let sweepAmt = 0;
    if (started && t > T.charge) {
      const period = 2.4;
      const local = t < T.burst + 0.6 ? t - T.charge : ((t - T.burst - 0.6) % period);
      const dur = 0.55;
      if (local < dur) {
        sweep = lerp(-0.4, 1.8, local / dur);
        sweepAmt = 0.85;
      }
    }
    helmUniforms.uSweep.value = sweep;
    helmUniforms.uSweepAmt.value = sweepAmt;

    // --- 광선 / 링 / 섬광 ---
    let intensity = 0;
    let reach = 0;
    let glow = 0;
    if (started && show) {
      if (bAge < 0) {
        intensity = charge * 0.25;
        reach = 1 + charge * 2.5;
        glow = charge * 0.35 + 0.05;
      } else {
        const rise = smooth(seg(bAge, 0, 0.18));
        intensity = rise * lerp(1.6, 0.65, smooth(seg(bAge, 0.2, 3.5))) * lerp(1, 0.85, smooth(seg(t, T.done - 1, T.done + 1)));
        reach = 2 + 16 * easeOutCubic(seg(bAge, 0, 1.4));
        glow = rise * lerp(0.8, 0.3, smooth(seg(bAge, 0.1, 2.5)));
      }
    }
    raysMat.uniforms.uTime.value = now;
    raysMat.uniforms.uIntensity.value = intensity;
    raysMat.uniforms.uReach.value = reach;
    raysMat.uniforms.uGlow.value = glow;
    if (started) {
      const tb = startAt + T.burst;
      raysMat.uniforms.uRings.value.set(tb, tb + 0.28, tb + 0.7);
    } else raysMat.uniforms.uRings.value.set(-99, -99, -99);
    rays.position.set(gemWorld.x, gemWorld.y, -0.6);

    flare.position.set(gemWorld.x, gemWorld.y, 1.8);
    flareMat.uniforms.uTime.value = now;
    flareMat.uniforms.uIntensity.value = !show
      ? 0
      : bAge < 0
        ? 0.08 + charge * 0.7
        : lerp(1.4, 0.45, smooth(seg(bAge, 0, 1.6))) * (0.9 + 0.1 * pulse);

    let flashO = bAge >= 0 ? 0.85 * Math.exp(-bAge * 5.5) : 0;
    if (landAge >= 0 && landAge < 0.4) flashO = Math.max(flashO, 0.2 * Math.exp(-landAge * 12));
    flashMat.opacity = flashO;

    bgMat.uniforms.uTime.value = now;
    bgMat.uniforms.uBurst.value = Math.max(charge * 0.25, bAge > 0 ? lerp(1.0, 0.55, smooth(seg(bAge, 0.2, 3))) * smooth(seg(bAge, 0, 0.25)) : 0);
    bgMat.uniforms.uCenter.value.set(gemWorld.x * 1.25, gemWorld.y * 1.25);
    shadowMat.uniforms.uBurst.value = bAge > 0 ? 0.6 * smooth(seg(bAge, 0, 0.4)) : 0;

    // --- 카메라 (줌 + 흔들림) ---
    let zoom = 1;
    let shakeX = 0;
    let shakeY = 0;
    if (started) {
      zoom = 1 - 0.035 * charge - 0.03 * smooth(seg(bAge, 0, 0.4)) + 0.04 * smooth(seg(bAge, 0.4, 3.5));
      if (bAge > 0 && bAge < 1.2) {
        const amp = 0.09 * Math.exp(-bAge * 5);
        shakeX = Math.sin(now * 61) * amp;
        shakeY = Math.cos(now * 53) * amp;
      }
      if (landAge > 0 && landAge < 0.5) shakeY += Math.sin(landAge * 50) * 0.05 * Math.exp(-landAge * 10);
    }
    camera.position.set(shakeX, VIEW_CENTER_Y + shakeY, baseDist * zoom);
    camera.lookAt(shakeX * 0.5, VIEW_CENTER_Y + shakeY * 0.5, 0);

    emit(t, now, dt, started, show, bAge, landAge);
    particles.update(dt, now);

    if (started && !doneFired && t >= T.done) {
      doneFired = true;
      onDone && onDone();
    }
  }

  function emit(t, now, dt, started, show, bAge, landAge) {
    const P = particles;
    tmpV.set(WAND_TIP[0], WAND_TIP[1], 0.3);
    charGroup.localToWorld(tmpV);
    const wx = tmpV.x;
    const wy = tmpV.y;

    // 지팡이 끝 반짝임
    emitAcc.wand += dt * (started && t < T.land ? 40 : 6);
    while (emitAcc.wand >= 1) {
      emitAcc.wand -= 1;
      const a = rand(0, Math.PI * 2);
      const s = rand(0.2, 0.9);
      P.spawn(wx, wy, 0.4, Math.cos(a) * s, Math.sin(a) * s + 0.3, 0, rand(0.5, 1.2), rand(0.06, 0.16), pickColor(0.85), 1.5, -0.4);
    }
    if (!started) return;

    if (show && t < T.land) {
      // 지팡이 → 투구 마법 줄기
      emitAcc.stream += dt * 80;
      while (emitAcc.stream >= 1) {
        emitAcc.stream -= 1;
        const life = rand(0.45, 0.75);
        const tx = helmWorld.x + rand(-0.4, 0.4);
        const ty = helmWorld.y + rand(-0.4, 0.4);
        P.spawn(wx, wy, 0.5, (tx - wx) / life, (ty - wy) / life, 0, life, rand(0.07, 0.16), pickColor(0.7), 0, 0);
      }
      // 날아오는 투구 꼬리
      emitAcc.trail += dt * (t < T.arrive ? 120 : 40);
      while (emitAcc.trail >= 1) {
        emitAcc.trail -= 1;
        const a = rand(0, Math.PI * 2);
        const r = rand(0, 1.1);
        P.spawn(helmWorld.x + Math.cos(a) * r, helmWorld.y + Math.sin(a) * r, 0.6, rand(-0.3, 0.3), rand(-0.3, 0.3), 0, rand(0.5, 1.1), rand(0.06, 0.18), pickColor(0.75), 1.5, 0.2);
      }
    }

    // 착지: 반짝이 먼지 링
    if (landAge >= 0 && !fired.land) {
      fired.land = true;
      for (let i = 0; i < 80; i++) {
        const a = rand(0, Math.PI * 2);
        const s = rand(2, 4.5);
        P.spawn(helmWorld.x + Math.cos(a) * 1.3, helmWorld.y - 0.2 + Math.sin(a) * 0.45, 0.8, Math.cos(a) * s, Math.sin(a) * s * 0.4, 0, rand(0.3, 0.6), rand(0.06, 0.14), pickColor(0.9), 3, 0);
      }
    }

    // 충전: 빛이 보석으로 빨려 들어감
    if (t >= T.charge && bAge < 0) {
      emitAcc.charge += dt * 170;
      while (emitAcc.charge >= 1) {
        emitAcc.charge -= 1;
        const a = rand(0, Math.PI * 2);
        const r = rand(2.2, 3.8);
        const life = rand(0.3, 0.5);
        const sx = gemWorld.x + Math.cos(a) * r;
        const sy = gemWorld.y + Math.sin(a) * r;
        P.spawn(sx, sy, 0.8, (gemWorld.x - sx) / life, (gemWorld.y - sy) / life, 0, life, rand(0.06, 0.14), pickColor(0.6), 0, 0);
      }
    }

    // 대폭발
    if (bAge >= 0 && !fired.burst) {
      fired.burst = true;
      for (let i = 0; i < 650; i++) {
        const a = rand(0, Math.PI * 2);
        const s = Math.pow(Math.random(), 0.6) * 11 + 1;
        P.spawn(gemWorld.x, gemWorld.y, rand(-0.6, 1.2), Math.cos(a) * s, Math.sin(a) * s, rand(-0.4, 0.4), rand(1.0, 2.6), rand(0.06, 0.26), pickColor(0.6), 1.1, 0.6);
      }
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        const s = rand(5, 8);
        P.spawn(gemWorld.x, gemWorld.y, 1.0, Math.cos(a) * s, Math.sin(a) * s, 0, rand(1.4, 2.2), rand(0.35, 0.55), PALETTE[Math.floor(rand(0, 4))], 1.6, 0);
      }
    }

    if (bAge > 0) {
      const strong = lerp(1, 0.22, smooth(seg(bAge, 0.5, 5)));
      // 8갈래 나선 광채
      emitAcc.spiral += dt * 150 * strong;
      while (emitAcc.spiral >= 1) {
        emitAcc.spiral -= 1;
        const arm = Math.floor(rand(0, 8));
        const a = now * 2.4 + (arm / 8) * Math.PI * 2 + rand(-0.06, 0.06);
        const s = rand(3.2, 5.2);
        const vx = Math.cos(a) * s - Math.sin(a) * 1.4;
        const vy = Math.sin(a) * s + Math.cos(a) * 1.4;
        P.spawn(gemWorld.x, gemWorld.y, -0.4, vx, vy, 0, rand(0.9, 1.6), rand(0.06, 0.17), pickColor(0.65), 0.6, 0);
      }
      // 주변 반짝임
      emitAcc.twinkle += dt * 45 * (0.4 + 0.6 * strong);
      while (emitAcc.twinkle >= 1) {
        emitAcc.twinkle -= 1;
        const r = rand(1.5, 6.5);
        const a = rand(0, Math.PI * 2);
        P.spawn(gemWorld.x + Math.cos(a) * r, gemWorld.y + Math.sin(a) * r * 0.85, rand(-0.8, 0.6), 0, rand(0.05, 0.3), 0, rand(0.6, 1.4), rand(0.1, 0.26), pickColor(0.6), 0.5, -0.1);
      }
      // 투구에서 피어오르는 금가루
      emitAcc.ambient += dt * 30;
      while (emitAcc.ambient >= 1) {
        emitAcc.ambient -= 1;
        P.spawn(helmWorld.x + rand(-1.2, 1.2), helmWorld.y + rand(0.2, 1.2), 1.0, rand(-0.2, 0.2), rand(0.4, 1.0), 0, rand(0.8, 1.6), rand(0.05, 0.12), pickColor(0.9), 0.3, -0.2);
      }
    }
  }

  Promise.all([loadTex(ASSETS.wizard, true), loadTex(ASSETS.helmet, false)])
    .then(([wizTex, helmTex]) => {
      if (disposed) return;
      bodyMat.map = wizTex;
      bodyMat.needsUpdate = true;
      helmTex.generateMipmaps = true;
      helmUniforms.uMap.value = helmTex;
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
        vec3 col = mix(vColor, vec3(1.0), core * 0.7) * v * vAlpha;
        gl_FragColor = vec4(col, 1.0);
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
   웅장한 효과음 (Web Audio 합성: 오케스트라풍 금관·합창·팀파니·심벌·종)
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

  // 큰 홀 잔향 (스테레오, 약 5초)
  const hall = ctx.createConvolver();
  {
    const len = Math.floor(sr * 5);
    const buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const n = Math.random() * 2 - 1;
        lp = lp * 0.55 + n * 0.45; // 살짝 어둡게
        const early = i < sr * 0.08 ? 1.4 : 1;
        d[i] = lp * Math.pow(1 - i / len, 3.2) * early;
      }
    }
    hall.buffer = buf;
  }
  const hallGain = ctx.createGain();
  hallGain.gain.value = 0.55;
  hall.connect(hallGain).connect(master);

  const noiseBuf = (() => {
    const b = ctx.createBuffer(1, sr * 2, sr);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  })();

  const out = (node, wet = 0.5, pan = 0) => {
    let n = node;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
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

  // 금관 (트럼펫/호른 느낌): 디튠 톱니파 + 필터 스웰
  function brass(t, f, dur, vol, { attack = 0.08, pan = 0, bright = 6 } = {}) {
    const g = ctx.createGain();
    env(g, t, vol, attack, Math.max(0, dur - attack - 0.4), 0.9);
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = 1.2;
    flt.frequency.setValueAtTime(f * 1.2, t);
    flt.frequency.exponentialRampToValueAtTime(f * bright, t + attack + 0.12);
    flt.frequency.exponentialRampToValueAtTime(f * bright * 0.55, t + dur);
    flt.connect(g);
    out(g, 0.55, pan);
    [-7, 0, 7].forEach((det) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5 + Math.random();
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(f * 0.004, t + 0.5);
      lfo.connect(lg).connect(o.frequency);
      o.connect(flt);
      o.start(t);
      lfo.start(t);
      o.stop(t + dur + 1);
      lfo.stop(t + dur + 1);
    });
  }

  // 합창 '아—' : 톱니파를 포먼트 필터로
  function choir(t, f, dur, vol, pan = 0) {
    const g = ctx.createGain();
    env(g, t, vol, 0.6, Math.max(0, dur - 1.6), 1.0);
    out(g, 0.8, pan);
    const formants = [
      [730, 1, 8],
      [1090, 0.5, 9],
      [2440, 0.25, 10],
    ];
    const bus = ctx.createGain();
    formants.forEach(([ff, amp, q]) => {
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

  // 현악 패드 (낮게 깔리는 긴장감)
  function strings(t, f, dur, vol, pan = 0) {
    const g = ctx.createGain();
    env(g, t, vol, 0.8, Math.max(0, dur - 1.6), 0.8);
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
      o.stop(t + dur + 0.2);
    });
  }

  // 북 (팀파니/타이코)
  function drum(t, f0, f1, dur, vol, { noise = 0.4, wet = 0.4 } = {}) {
    const o = ctx.createOscillator();
    o.type = 'sine';
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

  function noise(t, dur, { vol = 0.2, f0 = 800, f1 = 800, q = 1, type = 'bandpass', attack = 0.02, wet = 0.4, pan = 0 } = {}) {
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
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    out(g, wet, pan);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // 심벌 (크래시)
  function crash(t, dur, vol) {
    noise(t, dur, { vol, f0: 9000, f1: 5000, q: 0.4, type: 'highpass', attack: 0.004, wet: 0.7 });
    noise(t, dur * 0.6, { vol: vol * 0.6, f0: 6000, f1: 3500, q: 1.5, type: 'bandpass', attack: 0.004, wet: 0.7 });
  }

  function bell(t, f, vol = 0.06, dur = 1.6, pan = 0) {
    [
      [1, 1],
      [2.01, 0.35],
      [3.98, 0.15],
      [5.4, 0.06],
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

  function schedule() {
    const t0 = ctx.currentTime + 0.06;
    const at = (s) => t0 + s;

    // 1) 서막: 낮은 현악 D 단조 + 지팡이 반짝임
    [midi(38), midi(45), midi(50), midi(53)].forEach((f, i) => strings(at(0), f, 2.9, 0.035 - i * 0.004, (i - 1.5) * 0.3));
    drum(at(0), 70, 45, 1.6, 0.35, { noise: 0.25 });
    for (let i = 0; i < 8; i++) bell(at(0.1 + i * 0.09), 1800 + Math.random() * 1800, 0.018, 0.4, rand(-0.6, 0.6));

    // 2) 투구가 날아옴: 휘이익 + 호른 모티프 (D–A–D)
    noise(at(T.fly), 1.3, { vol: 0.14, f0: 500, f1: 3200, q: 1.6, attack: 0.5, pan: 0.5 });
    noise(at(T.fly + 0.9), 0.6, { vol: 0.08, f0: 3000, f1: 900, q: 1.4, attack: 0.1, pan: 0.1 });
    brass(at(T.fly + 0.05), midi(62), 0.55, 0.05, { pan: -0.2, bright: 4 });
    brass(at(T.fly + 0.5), midi(69), 0.45, 0.055, { pan: -0.2, bright: 4.5 });
    brass(at(T.fly + 0.9), midi(74), 1.1, 0.06, { pan: -0.2, bright: 5 });
    choir(at(T.fly + 0.2), midi(62), 2.0, 0.04, -0.3);
    choir(at(T.fly + 0.2), midi(65), 2.0, 0.035, 0.3);
    // 머리 위에서 멈칫: Bb 화음
    [midi(46), midi(58), midi(62), midi(65)].forEach((f, i) => brass(at(T.arrive), f, 0.8, 0.035, { pan: (i - 1.5) * 0.35, bright: 3.5 }));

    // 3) 내려와서 '쿵!' 금속성 착지
    noise(at(T.drop), T.land - T.drop + 0.02, { vol: 0.18, f0: 2800, f1: 300, q: 1.3, attack: 0.25 });
    const tl = at(T.land);
    drum(tl, 90, 38, 1.8, 0.75, { noise: 0.6, wet: 0.35 });
    drum(tl, 160, 70, 0.5, 0.3, { noise: 0.3 });
    [1, 2.76, 5.4, 8.93, 13.3].forEach((m, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = 330 * m;
      const g = ctx.createGain();
      env(g, tl, 0.09 / (i + 1), 0.002, 0, 2.6 - i * 0.35);
      o.connect(g);
      out(g, 0.6);
      o.start(tl);
      o.stop(tl + 3);
    });
    crash(tl, 1.4, 0.06);

    // 4) 충전: 팀파니 롤 크레셴도 + 역방향 스웰 + C sus 금관
    const rollStart = at(T.charge - 0.05);
    const rollEnd = at(T.burst);
    let tt = rollStart;
    let k = 0;
    while (tt < rollEnd - 0.02) {
      const p = (tt - rollStart) / (rollEnd - rollStart);
      drum(tt, 75 + p * 10, 55, 0.35, 0.08 + p * 0.3, { noise: 0.2, wet: 0.5 });
      tt += lerp(0.11, 0.045, p);
      k++;
    }
    noise(at(T.charge), T.burst - T.charge, { vol: 0.3, f0: 300, f1: 9000, q: 0.8, type: 'lowpass', attack: T.burst - T.charge - 0.02, wet: 0.3 });
    [midi(48), midi(55), midi(60), midi(65), midi(67)].forEach((f, i) =>
      brass(at(T.charge), f, T.burst - T.charge + 0.1, 0.03 + i * 0.004, { attack: 0.5, pan: (i - 2) * 0.3, bright: 5 })
    );
    choir(at(T.charge), midi(72), 0.75, 0.05, 0);

    // 5) 대폭발: D 장조 총주 (금관 + 합창 + 북 + 심벌 + 종 글리산도)
    const tb = at(T.burst);
    drum(tb, 65, 30, 3.0, 0.95, { noise: 0.8, wet: 0.3 });
    drum(tb + 0.02, 110, 50, 1.2, 0.5, { noise: 0.4 });
    crash(tb, 4.5, 0.16);
    noise(tb, 2.4, { vol: 0.2, f0: 12000, f1: 800, q: 0.5, type: 'lowpass', attack: 0.005, wet: 0.8 });
    const D_MAJOR = [38, 50, 57, 62, 66, 69, 74, 78];
    D_MAJOR.forEach((n, i) => brass(tb, midi(n), 4.8, 0.05 - i * 0.003, { attack: 0.06, pan: ((i % 4) - 1.5) * 0.35, bright: i < 2 ? 4 : 7 }));
    [62, 66, 69, 74, 78].forEach((n, i) => choir(tb + 0.05, midi(n), 5.6, 0.05, ((i % 3) - 1) * 0.4));
    [50, 57, 62].forEach((n, i) => strings(tb, midi(n), 5.6, 0.03, (i - 1) * 0.5));
    // 상승하는 종 글리산도
    const arp = [74, 78, 81, 86, 90, 93, 98, 102];
    arp.forEach((n, i) => bell(tb + 0.05 + i * 0.07, midi(n), 0.05, 2.2, ((i % 2) * 2 - 1) * 0.5));
    // 팡파르 꼭대기 음
    brass(tb + 0.55, midi(81), 2.4, 0.045, { attack: 0.1, bright: 7 });
    brass(tb + 1.1, midi(86), 3.2, 0.045, { attack: 0.15, bright: 7 });
    // 메아리 북 + 여운 반짝임
    [0.6, 1.2].forEach((d, i) => drum(tb + d, 60, 32, 1.6, 0.4 - i * 0.12, { noise: 0.3, wet: 0.6 }));
    for (let i = 0; i < 30; i++) bell(tb + 0.8 + Math.random() * 4.5, midi(86 + Math.floor(Math.random() * 16)), 0.016, 1.0, rand(-0.8, 0.8));
    // 마지막 여운 화음
    [62, 69, 74, 78].forEach((n, i) => choir(tb + 4.6, midi(n), 3.0, 0.03, (i - 1.5) * 0.4));
    bell(tb + 5.4, midi(86), 0.05, 3.0);
  }

  // 반드시 클릭(탭) 이벤트 안에서 호출: 브라우저의 자동재생 차단을 풀고 오디오를 깨움
  let keepAlive = null;
  function unlock() {
    try {
      // 1샘플짜리 무음 버퍼를 재생하면 Safari/모바일에서 오디오가 열림
      const b = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) {
      /* 무시 */
    }
    try {
      // iOS 무음 모드 대비: 무음 <audio>를 함께 재생해 미디어 재생 세션으로 전환
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
    // resume이 응답하지 않는 브라우저도 있어 0.4초 이상은 기다리지 않음
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
  html, body, #root { margin: 0; height: 100%; background: #080b1f; }
  .app { position: fixed; inset: 0; overflow: hidden; background: #080b1f; font-family: 'Pretendard', 'Apple SD Gothic Neo', 'Noto Sans KR', system-ui, sans-serif; }
  .app canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .loading { position: absolute; inset: 0; display: grid; place-items: center; color: #e9e4ff; font-size: 18px; letter-spacing: 0.04em; }
  .bar { position: absolute; left: 50%; bottom: max(20px, env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex; gap: 10px; }
  .bar button { appearance: none; border: 1px solid rgba(255,225,150,0.45); border-radius: 999px; padding: 11px 22px; font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; color: #fff7e0; background: rgba(30,26,70,0.72); backdrop-filter: blur(6px); transition: transform .15s ease, background .2s ease, opacity .2s; }
  .bar button:hover:not(:disabled) { transform: translateY(-1px); background: rgba(60,50,120,0.85); }
  .bar button:disabled { opacity: 0.55; cursor: default; }
  .bar .play { background: linear-gradient(180deg, #ffd66e, #f0a92e); color: #3a2300; border-color: #ffe7a6; box-shadow: 0 6px 24px rgba(255,190,80,0.35); }
  .bar .play:hover:not(:disabled) { background: linear-gradient(180deg, #ffe08a, #f5b542); }
  .bar .sound[aria-pressed='false'] { color: #b9b5d6; }
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

  const play = useCallback(async () => {
    if (!stageRef.current) return;
    setPhase('playing');
    let a = null;
    if (sound) {
      if (!audioRef.current || audioRef.current.ctx.state === 'closed') audioRef.current = createAudio();
      a = audioRef.current;
      if (a) {
        a.setMuted(false);
        await a.unlock(); // 오디오가 완전히 깨어난 뒤에 소리를 예약해야 화면과 박자가 맞음
      }
    }
    if (a) a.schedule();
    stageRef.current.play();
  }, [sound]);

  // 재생 중에 '소리 꺼짐'을 누르면 바로 음소거
  useEffect(() => {
    if (audioRef.current) audioRef.current.setMuted(!sound);
  }, [sound]);

  const label = phase === 'idle' ? '재생' : phase === 'playing' ? '재생 중…' : '다시 보기';

  return (
    <div className="app">
      <style>{CSS}</style>
      <canvas ref={canvasRef} aria-label="마법 투구가 날아와 파란 마법사의 머리에 얹어지고, 투구에서 빛이 사방으로 휘황찬란하게 퍼져 나가는 애니메이션" />
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
   이미지 (첨부 이미지에서 배경 제거 / 투구만 잘라냄, WebP)
   ===================================================================== */
const SILENT_WAV = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

const ASSETS = {
  wizard: 'data:image/webp;base64,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',
  helmet: 'data:image/webp;base64,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',
};
