import * as THREE from 'three';

/* ==========================================================================
 * 은하 지팡이 합체 애니메이션 코어 (three.js, 프레임워크 독립)
 * createGalaxyFusion(container, { images, onPhase, onComplete })
 *   images = { staff: url, items: [{ src, color:[r,g,b] }, x4] }
 *   phase  : 'loading' → 'ready' → 'summon' → 'fusion' → 'complete'
 *   options: sound(기본 true), onSoundState(state)  — 'running' | 'suspended' | 'unsupported'
 *   return : { play(), setSpeed(n), enableSound(), setMuted(bool), soundState(), dispose() }
 *   브라우저 정책상 사용자 클릭/터치 이전에는 소리가 막힐 수 있음 → enableSound()를 클릭 핸들러에서 호출
 * 모든 머티리얼을 ShaderMaterial로 작성해 three 버전별 색공간 차이에 영향받지 않음.
 * ========================================================================== */

// 최종 아이템은 처음에 숨겨 두고, 아이템 4개가 하나씩 등장 → 가운데로 모임 → 섬광과 함께 최종 아이템 등장
const TL = {
  appearStart: 0.4, appearGap: 0.5, appearDur: 0.55, // 아이템이 하나씩 등장
  gatherStart: 2.6, gatherEnd: 3.6,           // 아이템 → 합체 위치 (가운데 주변)
  chargeStart: 3.6,                           // 아이템 충전
  beamStart: 4.2, beamGap: 0.16, beamGrow: 0.38,
  absorbStart: 5.5, absorbGap: 0.09, absorbDur: 0.85,
  flash: 6.55,                                // 최종 아이템 등장
  reveal: 0.6,                                // 섬광 뒤 최종 아이템이 커지는 시간
  complete: 6.7,                              // 완료 문구
  done: 7.6,                                  // onComplete (성우 음성·왕관 연결 지점)
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeIn = (x) => x * x * x;
const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

function makeCanvasTexture(THREE, canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return t;
}

function glowCanvas() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.16)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  return c;
}

function circleCanvas() {
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); const C = S / 2;
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round';
  const ring = (r, w) => { g.lineWidth = w; g.beginPath(); g.arc(C, C, r, 0, Math.PI * 2); g.stroke(); };
  ring(490, 6); ring(462, 2); ring(360, 4); ring(340, 1.5); ring(150, 3);
  // 눈금
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2, l = i % 6 === 0 ? 26 : 10;
    g.lineWidth = i % 6 === 0 ? 3 : 1.5; g.beginPath();
    g.moveTo(C + Math.cos(a) * 462, C + Math.sin(a) * 462);
    g.lineTo(C + Math.cos(a) * (462 - l), C + Math.sin(a) * (462 - l)); g.stroke();
  }
  // 룬 모양 기호 (선으로만 구성)
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.26, r = 402;
    g.save(); g.translate(C + Math.cos(a) * r, C + Math.sin(a) * r); g.rotate(a + Math.PI / 2);
    g.lineWidth = 4; g.beginPath();
    const k = i % 4;
    if (k === 0) { g.moveTo(0, -20); g.lineTo(0, 20); g.moveTo(0, -8); g.lineTo(14, -20); g.moveTo(0, 4); g.lineTo(14, -8); }
    if (k === 1) { g.moveTo(-12, 20); g.lineTo(0, -20); g.lineTo(12, 20); g.moveTo(-6, 4); g.lineTo(6, 4); }
    if (k === 2) { g.arc(0, 0, 14, 0.3, Math.PI * 2 - 0.3); g.moveTo(-18, 0); g.lineTo(18, 0); }
    if (k === 3) { g.moveTo(0, -20); g.lineTo(14, 0); g.lineTo(0, 20); g.lineTo(-14, 0); g.closePath(); g.moveTo(0, -8); g.lineTo(0, 8); }
    g.stroke(); g.restore();
  }
  // 육망성 + 4개 아이템 자리
  g.lineWidth = 3;
  for (let s = 0; s < 2; s++) {
    g.beginPath();
    for (let i = 0; i <= 3; i++) {
      const a = (i / 3) * Math.PI * 2 - Math.PI / 2 + s * Math.PI;
      const x = C + Math.cos(a) * 340, y = C + Math.sin(a) * 340;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.lineWidth = 3; g.beginPath(); g.arc(C + Math.cos(a) * 250, C + Math.sin(a) * 250, 34, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(C + Math.cos(a) * 250, C + Math.sin(a) * 250, 10, 0, Math.PI * 2); g.fill();
  }
  return c;
}

function raysCanvas() {
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); const C = S / 2;
  const n = 28;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (i % 3) * 0.04, w = 0.02 + ((i * 37) % 7) * 0.006;
    const len = 330 + ((i * 53) % 5) * 36;
    const grd = g.createRadialGradient(C, C, 0, C, C, len);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.beginPath(); g.moveTo(C, C);
    g.arc(C, C, len, a - w, a + w); g.closePath(); g.fill();
  }
  return c;
}

/* ==========================================================================
 * 효과음 엔진 (Web Audio API로 실시간 합성 — 음원 파일 불필요)
 * 광선 4개는 A장조 화음(A3·C#4·E4·A4)으로 쌓여 합체 순간 하나의 코드로 완성됨
 * ========================================================================== */
function createFusionAudio(onState) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  ctx.onstatechange = () => onState && onState(ctx.state);

  const master = ctx.createGain(); master.gain.value = 0.85;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
  master.connect(comp); comp.connect(ctx.destination);

  const reverb = ctx.createConvolver();
  {
    const len = Math.floor(ctx.sampleRate * 2.8), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4); }
    reverb.buffer = buf;
  }
  const wet = ctx.createGain(); wet.gain.value = 0.7; reverb.connect(wet); wet.connect(master);

  const noiseBuf = (() => {
    const len = ctx.sampleRate * 2, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  })();

  // 재생 한 번 단위의 버스 — 다시 재생 시 통째로 페이드아웃해서 끊음
  let bus = null, sources = [];
  function newBus() {
    const dry = ctx.createGain(), send = ctx.createGain();
    dry.connect(master); send.connect(reverb);
    bus = { dry, send };
  }
  newBus();

  const now = () => ctx.currentTime;
  const E = 0.0001;
  const track = (n) => { sources.push(n); n.onended = () => { const i = sources.indexOf(n); if (i >= 0) sources.splice(i, 1); }; return n; };
  const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return track(o); };
  const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return track(s); };
  const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const filter = (type, f, q = 1) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  function out(node, pan = 0, send = 0.3) {
    let last = node;
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; node.connect(p); last = p; }
    last.connect(bus.dry);
    if (send) { const s = gain(send); last.connect(s); s.connect(bus.send); }
    return last;
  }

  const NOTES = [220, 277.18, 329.63, 440];      // 아이템별 광선 음 (A장조)
  const PANS = [-0.55, -0.55, 0.55, 0.55];         // 좌상·좌하·우하·우상 (합체 자리 순서)

  const api = {
    get state() { return ctx.state; },
    running: () => ctx.state === 'running',
    resume: () => ctx.resume(),
    setMuted(m) { master.gain.cancelScheduledValues(now()); master.gain.setTargetAtTime(m ? 0 : 0.85, now(), 0.05); },

    stopAll() {
      const t = now(), old = bus, olds = sources.slice();
      old.dry.gain.setTargetAtTime(0, t, 0.03); old.send.gain.setTargetAtTime(0, t, 0.03);
      setTimeout(() => { olds.forEach((s) => { try { s.stop(); } catch (e) {} }); old.dry.disconnect(); old.send.disconnect(); }, 200);
      sources = []; newBus();
    },

    /** 벨 소리 (아이템 등장, 명중, 반짝임) */
    ping(freq, vol = 0.2, pan = 0, t0 = now(), send = 0.5, dur = 1.1) {
      const g = gain(); g.gain.setValueAtTime(E, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006); g.gain.exponentialRampToValueAtTime(E, t0 + dur);
      [[1, 'triangle', 1], [2.76, 'sine', 0.35], [5.4, 'sine', 0.12]].forEach(([m, type, a]) => {
        const o = osc(type, freq * m), og = gain(a); o.connect(og); og.connect(g); o.start(t0); o.stop(t0 + dur + 0.05);
      });
      out(g, pan, send);
    },

    /** 바람 가르는 소리 (아이템이 가운데로 모일 때) — panFrom 쪽에서 중앙으로 팬 이동 */
    whoosh(dur, vol = 0.45, fLo = 250, fHi = 2600, panFrom = 0.8) {
      const t0 = now(), n = noise(), bp = filter('bandpass', fLo, 1.1), g = gain();
      bp.frequency.setValueAtTime(fLo, t0); bp.frequency.exponentialRampToValueAtTime(fHi, t0 + dur * 0.6); bp.frequency.exponentialRampToValueAtTime(fLo * 1.6, t0 + dur);
      g.gain.setValueAtTime(E, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.55); g.gain.exponentialRampToValueAtTime(E, t0 + dur);
      n.connect(bp); bp.connect(g);
      let last = g;
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.setValueAtTime(panFrom, t0); p.pan.linearRampToValueAtTime(0, t0 + dur * 0.8); g.connect(p); last = p; }
      last.connect(bus.dry); const s = gain(0.35); last.connect(s); s.connect(bus.send);
      // 저음 스웰
      const o = osc('sine', 70), og = gain(); o.frequency.exponentialRampToValueAtTime(140, t0 + dur * 0.6);
      og.gain.setValueAtTime(E, t0); og.gain.exponentialRampToValueAtTime(vol * 0.5, t0 + dur * 0.5); og.gain.exponentialRampToValueAtTime(E, t0 + dur);
      o.connect(og); og.connect(bus.dry);
      n.start(t0); n.stop(t0 + dur + 0.05); o.start(t0); o.stop(t0 + dur + 0.05);
    },

    /** 에너지 충전 웅웅거림 — 트레몰로가 점점 빨라짐 */
    charge(dur) {
      const t0 = now(), end = t0 + dur;
      const lp = filter('lowpass', 250, 7), trem = gain(0.6), g = gain();
      lp.frequency.setValueAtTime(250, t0); lp.frequency.exponentialRampToValueAtTime(2400, end);
      [-9, 0, 9].forEach((cents) => {
        const o = osc('sawtooth', 110); o.detune.value = cents; o.frequency.setValueAtTime(110, t0); o.frequency.linearRampToValueAtTime(175, end);
        o.connect(lp); o.start(t0); o.stop(end + 0.3);
      });
      const lfo = osc('sine', 4), lg = gain(0.4); lfo.frequency.setValueAtTime(4, t0); lfo.frequency.exponentialRampToValueAtTime(22, end);
      lfo.connect(lg); lg.connect(trem.gain); lfo.start(t0); lfo.stop(end + 0.3);
      g.gain.setValueAtTime(E, t0); g.gain.exponentialRampToValueAtTime(0.13, end - 0.05); g.gain.setTargetAtTime(0, end, 0.06);
      lp.connect(trem); trem.connect(g); out(g, 0, 0.25);
    },

    /** 광선 발사: 지잉 하고 떨어진 뒤 화음 음으로 지속 */
    beam(i, sustain) {
      const t0 = now(), end = t0 + sustain, f = NOTES[i];
      const lp = filter('lowpass', 3200, 3), g = gain();
      const o1 = osc('sawtooth', 2600), o2 = osc('square', f * 2);
      o1.frequency.setValueAtTime(2600, t0); o1.frequency.exponentialRampToValueAtTime(f, t0 + 0.28); o2.detune.value = 7;
      const vib = osc('sine', 6 + i * 0.7), vg = gain(f * 0.012); vib.connect(vg); vg.connect(o1.frequency);
      const wob = osc('sine', 2.5 + i * 0.4), wg = gain(900); wob.connect(wg); wg.connect(lp.frequency);
      const o2g = gain(0.18); o1.connect(lp); o2.connect(o2g); o2g.connect(lp);
      g.gain.setValueAtTime(E, t0); g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.055, t0 + 0.35);
      g.gain.linearRampToValueAtTime(0.1, end - 0.05); g.gain.setTargetAtTime(0, end, 0.05);
      lp.connect(g); out(g, PANS[i], 0.3);
      [o1, o2, vib, wob].forEach((o) => { o.start(t0); o.stop(end + 0.3); });
      // 발사 순간 치직
      const n = noise(), hp = filter('highpass', 2500, 0.8), ng = gain();
      ng.gain.setValueAtTime(0.28, t0); ng.gain.exponentialRampToValueAtTime(E, t0 + 0.16);
      n.connect(hp); hp.connect(ng); out(ng, PANS[i], 0.2); n.start(t0); n.stop(t0 + 0.2);
    },

    /** 광선이 수정에 명중 */
    hit(i) { api.ping(NOTES[i] * 4, 0.1, PANS[i] * 0.4, now(), 0.6, 0.7); },

    /** 흡수: 치솟는 상승음 + 역재생 심벌 느낌의 노이즈 */
    rise(dur) {
      const t0 = now(), end = t0 + dur;
      const g = gain(); g.gain.setValueAtTime(E, t0); g.gain.exponentialRampToValueAtTime(0.14, end - 0.02); g.gain.linearRampToValueAtTime(0, end + 0.02);
      [['sine', 1], ['triangle', 1.5]].forEach(([type, m]) => {
        const o = osc(type, 180 * m); o.frequency.setValueAtTime(180 * m, t0); o.frequency.exponentialRampToValueAtTime(1500 * m, end);
        o.connect(g); o.start(t0); o.stop(end + 0.05);
      });
      out(g, 0, 0.2);
      const n = noise(), hp = filter('highpass', 800, 0.7), ng = gain();
      hp.frequency.setValueAtTime(800, t0); hp.frequency.exponentialRampToValueAtTime(7000, end);
      ng.gain.setValueAtTime(E, t0); ng.gain.exponentialRampToValueAtTime(0.25, end - 0.02); ng.gain.linearRampToValueAtTime(0, end + 0.02);
      n.connect(hp); hp.connect(ng); out(ng, 0, 0.1); n.start(t0); n.stop(end + 0.05);
    },

    /** 합체 폭발: 서브 킥 + 노이즈 폭발 + A장조 반짝이 코드 + 아르페지오 */
    boom() {
      const t0 = now();
      const sub = osc('sine', 150), sg = gain();
      sub.frequency.setValueAtTime(150, t0); sub.frequency.exponentialRampToValueAtTime(36, t0 + 0.7);
      sg.gain.setValueAtTime(E, t0); sg.gain.exponentialRampToValueAtTime(0.95, t0 + 0.01); sg.gain.exponentialRampToValueAtTime(E, t0 + 1.8);
      sub.connect(sg); out(sg, 0, 0); sub.start(t0); sub.stop(t0 + 1.9);

      const n = noise(), lp = filter('lowpass', 5000, 0.7), ng = gain();
      lp.frequency.setValueAtTime(5000, t0); lp.frequency.exponentialRampToValueAtTime(160, t0 + 1.4);
      ng.gain.setValueAtTime(0.55, t0); ng.gain.exponentialRampToValueAtTime(E, t0 + 2.0);
      n.connect(lp); lp.connect(ng); out(ng, 0, 0.6); n.start(t0); n.stop(t0 + 2.1);

      [440, 554.37, 659.25, 880, 1108.73, 1318.51].forEach((f, k) => {
        [-5, 5].forEach((c) => {
          const o = osc(k < 3 ? 'triangle' : 'sine', f), g = gain(); o.detune.value = c;
          g.gain.setValueAtTime(E, t0); g.gain.exponentialRampToValueAtTime(0.045, t0 + 0.04 + k * 0.02); g.gain.exponentialRampToValueAtTime(E, t0 + 4.8);
          o.connect(g); out(g, (k % 2 ? 0.3 : -0.3), 0.9); o.start(t0); o.stop(t0 + 5);
        });
      });
      const scale = [1760, 1975.53, 2217.46, 2637.02, 2959.96, 3520];
      for (let k = 0; k < 14; k++) api.ping(scale[(Math.random() * scale.length) | 0], 0.07 * (1 - k / 16), Math.random() * 1.4 - 0.7, t0 + 0.15 + k * 0.09, 0.8, 0.8);
    },

    /** 완료 후 잔잔한 배경 패드 */
    pad(len = 12) {
      const t0 = now() + 0.8, lp = filter('lowpass', 1100, 0.5), g = gain();
      const lfo = osc('sine', 0.15), lg = gain(500); lfo.connect(lg); lg.connect(lp.frequency); lfo.start(t0); lfo.stop(t0 + len + 0.1);
      [110, 164.81, 220, 277.18].forEach((f) => { [-6, 6].forEach((c) => { const o = osc('sawtooth', f); o.detune.value = c; o.connect(lp); o.start(t0); o.stop(t0 + len + 0.1); }); });
      g.gain.setValueAtTime(E, t0); g.gain.exponentialRampToValueAtTime(0.018, t0 + 2.2); g.gain.setValueAtTime(0.018, t0 + len - 3); g.gain.exponentialRampToValueAtTime(E, t0 + len);
      lp.connect(g); out(g, 0, 0.8);
    },

    /** 완료 문구 등장 반짝임 */
    arpeggio() { const t0 = now(); [880, 1108.73, 1318.51, 1760].forEach((f, k) => api.ping(f, 0.12, (k - 1.5) * 0.3, t0 + k * 0.085, 0.6, 1.2)); },

    close() { try { ctx.close(); } catch (e) {} },
  };
  return api;
}

export function createGalaxyFusion(container, opts) {
  // THREE는 상단 import 사용
  const { images } = opts;
  const onPhase = opts.onPhase || (() => {});
  const onComplete = opts.onComplete || (() => {});
  const onSoundState = opts.onSoundState || (() => {});
  const audio = opts.sound === false ? null : createFusionAudio(onSoundState);
  if (audio) audio.resume().catch(() => {}).finally(() => onSoundState(audio.state));
  else onSoundState('unsupported');

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  const PR = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(PR);
  renderer.setClearColor(0x05030d, 1);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  const CAM_Z = 10;
  camera.position.set(0, 0, CAM_Z);

  const disposables = [];
  const track = (x) => { disposables.push(x); return x; };
  const quad = track(new THREE.PlaneGeometry(1, 1));

  /* ---------- 공용 머티리얼 ---------- */
  const spriteMat = (tex, color, opacity = 1) => track(new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex }, uColor: { value: new THREE.Vector3(...color) }, uOpacity: { value: opacity } },
    vertexShader: VERT,
    fragmentShader: `uniform sampler2D uMap; uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
      void main(){ vec4 t = texture2D(uMap, vUv); gl_FragColor = vec4(uColor * t.rgb * t.a * uOpacity, 1.0); }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  }));

  const cardMat = (tex, aspect, glowColor) => track(new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: tex }, uOpacity: { value: 1 }, uGlow: { value: 0 }, uWhite: { value: 0 },
      uGlowColor: { value: new THREE.Vector3(...glowColor) }, uAspect: { value: aspect }, uTime: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: `uniform sampler2D uMap; uniform float uOpacity, uGlow, uWhite, uAspect, uTime; uniform vec3 uGlowColor; varying vec2 vUv;
      void main(){
        vec4 t = texture2D(uMap, vUv);
        float edge = min(min(vUv.x, 1.0 - vUv.x) * uAspect, min(vUv.y, 1.0 - vUv.y));
        float rim = exp(-edge * 28.0) * uGlow;
        float sheen = pow(max(0.0, sin((vUv.x * uAspect + vUv.y) * 2.2 - uTime * 3.0)), 24.0) * uGlow * 0.6;
        vec3 col = t.rgb + uGlowColor * uGlow * (0.25 + 0.75 * t.rgb) + uGlowColor * rim + vec3(sheen);
        col = mix(col, vec3(1.0), uWhite);
        gl_FragColor = vec4(col, t.a * uOpacity);
      }`,
    transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
  }));

  const mesh = (mat, order) => { const m = new THREE.Mesh(quad, mat); m.renderOrder = order; m.frustumCulled = false; scene.add(m); return m; };

  /* ---------- 배경 성운 ---------- */
  const bgMat = track(new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFlare: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: `uniform float uTime, uFlare; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float v = 0.0, a = 0.5; for(int i=0;i<5;i++){ v += a*noise(p); p *= 2.03; a *= 0.5; } return v; }
      void main(){
        vec2 p = vUv * vec2(7.0, 4.0);
        float n = fbm(p + vec2(uTime*0.025, 0.0));
        float n2 = fbm(p*1.6 - vec2(0.0, uTime*0.02) + n*1.4);
        vec3 col = vec3(0.022, 0.014, 0.06);
        col += vec3(0.34, 0.11, 0.52) * pow(n2, 3.0) * 1.3;
        col += vec3(0.06, 0.17, 0.46) * pow(n, 2.6) * 0.9;
        float d = distance(vUv, vec2(0.5));
        col *= 1.0 - d * 0.95;
        col += uFlare * vec3(0.42, 0.3, 0.75) * exp(-d * d * 18.0);
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthWrite: false, depthTest: false,
  }));
  const bg = mesh(bgMat, 0);
  bg.position.z = -8; bg.scale.set(60, 34, 1);

  /* ---------- 별 ---------- */
  const STAR_N = 700;
  const starGeo = track(new THREE.BufferGeometry());
  {
    const pos = new Float32Array(STAR_N * 3), size = new Float32Array(STAR_N), phase = new Float32Array(STAR_N);
    for (let i = 0; i < STAR_N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 34; pos[i * 3 + 1] = (Math.random() - 0.5) * 20; pos[i * 3 + 2] = -6 + Math.random() * 4;
      size[i] = Math.random() < 0.08 ? 5 + Math.random() * 4 : 1.5 + Math.random() * 2.5; phase[i] = Math.random() * 6.28;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    starGeo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  }
  const starMat = track(new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPR: { value: PR } },
    vertexShader: `attribute float aSize; attribute float aPhase; uniform float uTime, uPR; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vA = 0.45 + 0.55 * sin(uTime * (1.2 + fract(aPhase) * 2.0) + aPhase);
        gl_PointSize = aSize * uPR * (10.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c);
      float a = smoothstep(0.5, 0.0, d); a *= a; gl_FragColor = vec4(vec3(0.85, 0.85, 1.0) * a * vA, 1.0); }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  }));
  const stars = new THREE.Points(starGeo, starMat); stars.renderOrder = 1; stars.frustumCulled = false; scene.add(stars);

  /* ---------- 텍스처 ---------- */
  const glowTex = track(makeCanvasTexture(THREE, glowCanvas()));
  const circleTex = track(makeCanvasTexture(THREE, circleCanvas()));
  const raysTex = track(makeCanvasTexture(THREE, raysCanvas()));

  /* ---------- 빔 ---------- */
  const beamMat = (color) => track(new THREE.ShaderMaterial({
    uniforms: { uProgress: { value: 0 }, uTime: { value: 0 }, uIntensity: { value: 0 }, uLen: { value: 1 }, uColor: { value: new THREE.Vector3(...color) } },
    vertexShader: VERT,
    fragmentShader: `uniform float uProgress, uTime, uIntensity, uLen; uniform vec3 uColor; varying vec2 vUv;
      void main(){
        float x = vUv.x; float y = vUv.y - 0.5;
        if (x > uProgress + 0.02) discard;
        float taper = sin(3.14159 * clamp(x / max(uProgress, 0.001), 0.0, 1.0));
        float w = sin(x * uLen * 2.4 - uTime * 13.0) * 0.17 * taper;
        float core = exp(-pow(y * 16.0, 2.0));
        float glow = exp(-pow(y * 4.2, 2.0)) * 0.5;
        float s1 = exp(-pow((y - w) * 34.0, 2.0)) * 0.9;
        float s2 = exp(-pow((y + w) * 34.0, 2.0)) * 0.9;
        float flow = 0.72 + 0.28 * sin(x * uLen * 7.0 - uTime * 26.0);
        float head = exp(-pow((x - uProgress) * uLen * 2.6, 2.0)) * exp(-pow(y * 5.0, 2.0)) * 1.8;
        float fade = smoothstep(0.0, 0.03, x) * (1.0 - smoothstep(uProgress, uProgress + 0.02, x));
        vec3 col = uColor * (glow + s1 + s2) * flow + vec3(1.0) * core * flow + (uColor * 0.6 + 0.6) * head;
        gl_FragColor = vec4(col * uIntensity * fade, 1.0);
      }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  }));

  /* ---------- 충격파 링 ---------- */
  const ringMat = (color) => track(new THREE.ShaderMaterial({
    uniforms: { uP: { value: 0 }, uColor: { value: new THREE.Vector3(...color) } },
    vertexShader: VERT,
    fragmentShader: `uniform float uP; uniform vec3 uColor; varying vec2 vUv;
      void main(){ float d = length(vUv - 0.5) * 2.0; float r = (1.0 - pow(1.0 - uP, 3.0)) * 0.96;
        float ring = exp(-pow((d - r) * (26.0 + 30.0 * uP), 2.0)); float inner = exp(-pow((d - r * 0.8) * 60.0, 2.0)) * 0.4;
        float a = (ring + inner) * (1.0 - uP) * step(0.001, uP);
        gl_FragColor = vec4((uColor + vec3(0.4)) * a, 1.0); }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  }));

  /* ---------- 파티클 풀 ---------- */
  const MAXP = 2400;
  const pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3), pSize = new Float32Array(MAXP), pAlpha = new Float32Array(MAXP);
  const pVel = new Float32Array(MAXP * 3), pLife = new Float32Array(MAXP), pMax = new Float32Array(MAXP), pBase = new Float32Array(MAXP), pDrag = new Float32Array(MAXP), pGrav = new Float32Array(MAXP);
  let pHead = 0;
  const pGeo = track(new THREE.BufferGeometry());
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
  pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1));
  const pMat = track(new THREE.ShaderMaterial({
    uniforms: { uPR: { value: PR } },
    vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; uniform float uPR; varying vec3 vC; varying float vA;
      void main(){ vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPR * (10.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard;
      float a = smoothstep(0.5, 0.0, d); a *= a; float core = smoothstep(0.14, 0.0, d);
      gl_FragColor = vec4((vC * a + vec3(core) * 0.85) * vA, 1.0); }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  }));
  const points = new THREE.Points(pGeo, pMat); points.renderOrder = 11; points.frustumCulled = false; scene.add(points);

  function spawn(x, y, z, vx, vy, vz, life, size, c, drag = 0, grav = 0) {
    const i = pHead; pHead = (pHead + 1) % MAXP;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
    pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
    pCol[i * 3] = c[0]; pCol[i * 3 + 1] = c[1]; pCol[i * 3 + 2] = c[2];
    pLife[i] = life; pMax[i] = life; pBase[i] = size; pDrag[i] = drag; pGrav[i] = grav;
  }
  function burst(x, y, n, speedMin, speedMax, colors, life = 1.2, size = 10, drag = 2.2) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = lerp(speedMin, speedMax, Math.pow(Math.random(), 0.7));
      const c = colors[(Math.random() * colors.length) | 0];
      spawn(x, y, 0.2, Math.cos(a) * s, Math.sin(a) * s, (Math.random() - 0.5) * s * 0.3, life * (0.5 + Math.random() * 0.8), size * (0.4 + Math.random()), c, drag, 0);
    }
  }
  function updateParticles(dt) {
    for (let i = 0; i < MAXP; i++) {
      if (pLife[i] <= 0) { pAlpha[i] = 0; continue; }
      pLife[i] -= dt;
      if (pLife[i] <= 0) { pAlpha[i] = 0; continue; }
      const damp = Math.exp(-pDrag[i] * dt);
      pVel[i * 3] *= damp; pVel[i * 3 + 1] = pVel[i * 3 + 1] * damp + pGrav[i] * dt; pVel[i * 3 + 2] *= damp;
      pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      const k = pLife[i] / pMax[i];
      pAlpha[i] = Math.min(1, k * 2.2) * Math.min(1, (1 - k) * 12 + 0.2);
      pSize[i] = pBase[i] * (0.35 + 0.65 * k);
    }
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.aColor.needsUpdate = true;
    pGeo.attributes.aSize.needsUpdate = true; pGeo.attributes.aAlpha.needsUpdate = true;
  }
  function clearParticles() { pLife.fill(0); pAlpha.fill(0); }

  /* ---------- 오브젝트 (텍스처 로드 후 생성) ---------- */
  let ready = false;
  let staff, staffGlow, circleA, circleB, rays, flash, items = [], rings = [], orbs = [];
  const STAFF_TINT = [0.82, 0.7, 1.0];
  // 지팡이 카드 안 수정(은하) 위치 — 카드 로컬 좌표 비율
  const CRYSTAL = { u: 0.36, v: 0.28 };

  const loader = new THREE.TextureLoader();
  const load = (src) => new Promise((res, rej) => loader.load(src, (t) => {
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy(); track(t); res(t);
  }, undefined, rej));

  let L = null; // layout
  let W = 1, H = 1;

  // 합체 자리: 좌상 → 좌하 → 우하 → 우상 (등장 순서대로 돌아가며 놓여 이동 경로가 겹치지 않음)
  const RING = [[-1, 1], [-1, -1], [1, -1], [1, 1]];

  function computeLayout() {
    const land = W / H >= 1.05;
    const staffAsp = staff.aspect;
    const lay = { land, inv: [], fus: [] };
    if (land) {
      // 등장: 화면 가운데 한 줄
      const iw = Math.min(W * 0.15, H * 0.3);
      for (let i = 0; i < 4; i++) lay.inv.push({ x: (i - 1.5) * iw * 1.4, y: H * 0.02, w: iw });
      const sw = Math.min(W * 0.5, H * 0.46 * staffAsp);
      lay.staff = { x: 0, y: -H * 0.01, w: sw };
      // 합체: 최종 아이템이 나타날 자리를 둘러쌈
      const fw = Math.min(W * 0.11, H * 0.22);
      const dx = Math.min(W * 0.2, sw * 0.42), dy = H * 0.2;
      RING.forEach(([sx, sy]) => lay.fus.push({ x: sx * dx, y: lay.staff.y + sy * dy, w: fw }));
    } else {
      // 등장: 화면 가운데 2×2 (RING 순서로 돌아가며)
      const iw = W * 0.34;
      RING.forEach(([sx, sy]) => lay.inv.push({ x: sx * W * 0.25, y: sy * H * 0.17, w: iw }));
      const sw = W * 0.9;
      lay.staff = { x: 0, y: 0, w: sw };
      const fw = W * 0.2;
      RING.forEach(([sx, sy]) => lay.fus.push({ x: sx * W * 0.22, y: sy * H * 0.12, w: fw }));
    }
    return lay;
  }

  function resize() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    H = 2 * CAM_Z * Math.tan((camera.fov * Math.PI) / 360); W = H * camera.aspect;
    if (ready) L = computeLayout();
  }
  const ro = new ResizeObserver(resize); ro.observe(container);

  /* ---------- 타임라인 상태 ---------- */
  let t = 0, speed = 1, last = performance.now(), raf = 0, disposed = false;
  let fired = {}, emittedPhase = '';
  const phaseAt = (tt) => (tt >= TL.complete ? 'complete' : tt >= TL.beamStart ? 'fusion' : tt >= TL.gatherStart ? 'summon' : 'ready');

  function play() {
    t = 0; fired = {}; emittedPhase = ''; clearParticles();
    if (audio) audio.stopAll();
    items.forEach((it) => { it.shown = false; });
  }

  function staffWorld(s) { // 카드 로컬(u,v) → 월드
    return { x: s.mesh.position.x + (CRYSTAL.u - 0.5) * s.mesh.scale.x, y: s.mesh.position.y + (0.5 - CRYSTAL.v) * s.mesh.scale.y };
  }

  function placeCard(obj, x, y, w, z = 0) {
    obj.mesh.position.set(x, y, z); obj.mesh.scale.set(w, w / obj.aspect, 1);
  }

  function frame(now) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    let dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!ready) { renderer.render(scene, camera); return; }
    dt *= speed; t += dt;
    const time = now / 1000;
    bgMat.uniforms.uTime.value = time; starMat.uniforms.uTime.value = time;

    const ph = phaseAt(t);
    if (ph !== emittedPhase) { emittedPhase = ph; onPhase(ph); }
    if (t >= TL.done && !fired.done) { fired.done = true; onComplete(); }

    /* 효과음 큐 — 타임라인 통과 시 1회 재생 (0.4초 이상 지난 큐는 건너뜀) */
    const cue = (key, at, fn) => {
      if (fired[key] || t < at) return;
      fired[key] = true;
      if (audio && audio.running() && t - at < 0.4) fn();
    };
    {
      const S = 1 / speed;
      [659.25, 830.61, 987.77, 1318.51].forEach((f, i) => cue('a_show' + i, TL.appearStart + i * TL.appearGap, () => audio.ping(f, 0.2, L.land ? (i - 1.5) * 0.35 : 0)));
      cue('a_gather', TL.gatherStart, () => audio.whoosh((TL.gatherEnd - TL.gatherStart) * S, 0.35, 300, 3200, 0));
      cue('a_charge', TL.chargeStart, () => audio.charge((TL.absorbStart - TL.chargeStart) * S));
      for (let i = 0; i < 4; i++) {
        const bs = TL.beamStart + i * TL.beamGap;
        cue('a_beam' + i, bs, () => audio.beam(i, (TL.flash - bs) * S));
        cue('a_hit' + i, bs + TL.beamGrow, () => audio.hit(i));
      }
      cue('a_rise', TL.absorbStart, () => audio.rise((TL.flash - TL.absorbStart) * S));
      cue('a_boom', TL.flash, () => { audio.boom(); audio.pad(12); });
      cue('a_arp', TL.complete + 0.15, () => audio.arpeggio());
    }

    /* 최종 아이템 — 섬광 전까지 숨김, 섬광과 함께 튀어나오듯 등장 */
    const s1 = L.staff;
    const tFlash = t - TL.flash;
    const revealed = tFlash >= 0;
    const rv = seg(t, TL.flash, TL.flash + TL.reveal);
    const bob = revealed ? Math.sin(time * 1.6) * H * 0.008 : 0;
    placeCard(staff, s1.x, s1.y + bob, s1.w * Math.max(0.001, easeOutBack(rv)), 1.4 * (1 - easeOut(rv)));
    staff.mesh.rotation.set(0, (1 - easeOut(rv)) * 0.6, 0);
    staff.mesh.visible = revealed;

    // 합체 중심(최종 아이템이 나타날 자리)의 에너지 → 등장 후에는 지팡이 수정의 발광
    let hits = 0;
    items.forEach((_, i) => { if (t >= TL.beamStart + i * TL.beamGap + TL.beamGrow) hits++; });
    let sg = 0.05 + hits * 0.12;
    sg += 0.9 * easeIn(seg(t, TL.absorbStart, TL.flash));
    if (revealed) sg = 0.3 + 1.3 * Math.exp(-3 * tFlash) + 0.08 * Math.sin(time * 3);
    staff.mat.uniforms.uGlow.value = sg; staff.mat.uniforms.uTime.value = time;
    staff.mat.uniforms.uWhite.value = revealed ? Math.exp(-5 * tFlash) : 0;

    const core = { x: s1.x, y: s1.y };
    const target = revealed ? staffWorld(staff) : core;
    const sH = s1.w / staff.aspect;
    staffGlow.position.set(target.x, target.y, -0.1);
    const sgScale = sH * (revealed ? 1.6 + sg * 1.2 : 0.6 + sg * 1.4);
    staffGlow.scale.set(sgScale, sgScale, 1);
    staffGlow.material.uniforms.uOpacity.value = Math.min(1.4, 0.15 + sg * 0.7) * (revealed ? 1 : easeInOut(seg(t, TL.gatherStart, TL.gatherEnd)));

    /* 아이템 */
    items.forEach((it, i) => {
      const inv = L.inv[i], fu = L.fus[i];
      const st = TL.appearStart + i * TL.appearGap;
      if (t >= st && !it.shown) {
        it.shown = true;
        burst(inv.x, inv.y, 48, 0.8, 3.6, [it.color, [1, 1, 1]], 0.9, 10, 3);
      }
      const pop = easeOutBack(seg(t, st, st + TL.appearDur));
      const gp = easeInOut(seg(t, TL.gatherStart + i * 0.07, TL.gatherEnd));
      let x = lerp(inv.x, fu.x, gp), y = lerp(inv.y, fu.y, gp), w = lerp(inv.w, fu.w, gp) * Math.max(0.001, pop);
      let z = Math.sin(gp * Math.PI) * 1.0;
      let rotY = gp * Math.PI * 2, rotZ = (1 - Math.min(1, pop)) * 0.5 * (i % 2 ? 1 : -1);
      let op = t >= st ? 1 : 0;
      let glow = t >= st ? 0.9 * Math.exp(-4 * (t - st)) : 0;
      if (t >= st) y += Math.sin(time * 2 + i) * H * 0.006 * (1 - gp); // 모이기 전까지 둥실

      // 충전
      const cp = seg(t, TL.chargeStart, TL.beamStart + i * TL.beamGap);
      if (t >= TL.chargeStart) {
        y += Math.sin(time * 3 + i) * H * 0.006;
        glow = Math.max(glow, 0.15 + 0.45 * cp + 0.1 * Math.sin(time * 18 + i) * cp);
        if (t < TL.absorbStart && Math.random() < 0.6 * cp + 0.1) {
          const a = Math.random() * Math.PI * 2, r = w * (0.9 + Math.random() * 0.5);
          spawn(x + Math.cos(a) * r, y + Math.sin(a) * r, 0.2, -Math.cos(a) * r * 2.2, -Math.sin(a) * r * 2.2, 0, 0.42, 6 + Math.random() * 5, it.color, 0, 0);
        }
      }

      // 흡수: 나선형으로 수정에 빨려들어감
      const as = TL.absorbStart + i * TL.absorbGap;
      const ap = seg(t, as, as + TL.absorbDur);
      if (ap > 0) {
        const e = easeIn(ap);
        const vx = x - target.x, vy = y - target.y, ang = e * 1.6 * (i % 2 ? 1 : -1);
        const rr = 1 - e;
        x = target.x + (vx * Math.cos(ang) - vy * Math.sin(ang)) * rr;
        y = target.y + (vx * Math.sin(ang) + vy * Math.cos(ang)) * rr;
        w *= 1 - 0.85 * e; rotZ = ang * 2;
        glow = lerp(glow, 1.6, easeOut(ap));
        op = 1 - seg(ap, 0.75, 1);
        if (Math.random() < 0.9) spawn(x, y, 0.2, (Math.random() - 0.5), (Math.random() - 0.5), 0, 0.5, 10, it.color, 2, 0);
      }
      placeCard(it, x, y, w, z + 0.5);
      it.mesh.rotation.set(0, rotY, rotZ);
      it.mesh.visible = op > 0.001;
      it.mat.uniforms.uGlow.value = glow; it.mat.uniforms.uOpacity.value = op; it.mat.uniforms.uTime.value = time;
      it.mat.uniforms.uWhite.value = ap > 0 ? 0.6 * easeIn(ap) : 0;
      const gs = w * (1.7 + glow * 0.8);
      it.glow.position.set(x, y, z + 0.4); it.glow.scale.set(gs, gs, 1);
      it.glow.material.uniforms.uOpacity.value = (0.2 + glow * 0.7) * op;
      it.glow.visible = op > 0.001;

      /* 빔 */
      const bs = TL.beamStart + i * TL.beamGap;
      const bp = easeOut(seg(t, bs, bs + TL.beamGrow));
      const beam = it.beam;
      if (t >= bs && t < TL.flash + 0.25) {
        beam.visible = true;
        const dx = target.x - x, dy = target.y - y, len = Math.max(0.001, Math.hypot(dx, dy));
        beam.position.set((x + target.x) / 2, (y + target.y) / 2, 0.8);
        beam.rotation.set(0, 0, Math.atan2(dy, dx));
        const bw = Math.min(W, H) * 0.075 * (1 + 0.5 * seg(t, TL.absorbStart, TL.flash));
        beam.scale.set(len, bw, 1);
        const u = beam.material.uniforms;
        u.uProgress.value = bp; u.uTime.value = time; u.uLen.value = len / bw;
        const fadeOut = 1 - seg(t, TL.flash, TL.flash + 0.2);
        u.uIntensity.value = (0.6 + 0.6 * seg(t, bs, bs + 0.1) + 0.6 * seg(t, TL.absorbStart, TL.flash)) * fadeOut * (0.9 + 0.1 * Math.sin(time * 40 + i));
        // 빔 타고 흐르는 에너지 입자
        if (bp > 0.2 && t < TL.flash) {
          for (let k = 0; k < 2; k++) {
            const life = 0.42, jitter = (Math.random() - 0.5) * bw * 0.5;
            const nx = -dy / len, ny = dx / len;
            spawn(x + nx * jitter, y + ny * jitter, 0.9, (dx / life) * bp, (dy / life) * bp, 0, life * 0.95, 6 + Math.random() * 7, Math.random() < 0.3 ? [1, 1, 1] : it.color, 0, 0);
          }
        }
        // 명중 스파크
        if (!it.hit && bp >= 0.999) {
          it.hit = true; burst(target.x, target.y, 60, 1, 4.5, [it.color, [1, 1, 1]], 0.8, 10, 3.5);
        }
      } else { beam.visible = false; }
      if (t < bs) it.hit = false;
    });

    /* 섬광 & 충격파 */
    if (tFlash >= 0 && !fired.flash) {
      fired.flash = true;
      const cols = items.map((it) => it.color).concat([[1, 1, 1], [1, 0.9, 0.6]]);
      burst(target.x, target.y, 520, 2, 11, cols, 1.6, 13, 1.8);
      burst(target.x, target.y, 160, 0.5, 3, [[1, 1, 1]], 2.2, 8, 0.8);
    }
    const fl = tFlash >= 0 ? Math.exp(-5.5 * tFlash) : Math.pow(seg(t, TL.flash - 0.12, TL.flash), 2) * 0.6;
    flash.material.uniforms.uOpacity.value = fl * 0.95; flash.visible = fl > 0.003;
    rings.forEach((r, k) => {
      const rp = seg(t, TL.flash + k * 0.14, TL.flash + k * 0.14 + 1.1 + k * 0.3);
      r.visible = rp > 0 && rp < 1;
      const S = Math.max(W, H) * (0.75 + k * 0.35);
      r.position.set(target.x, target.y, 1); r.scale.set(S, S, 1);
      r.material.uniforms.uP.value = rp;
    });

    /* 완료 후: 마법진, 광선, 공전 오브 */
    const fin = easeOut(seg(t, TL.flash, TL.flash + 1.2));
    const sC = { x: staff.mesh.position.x, y: staff.mesh.position.y };
    const circR = Math.min(W * 0.62, H * 0.9) * (0.75 + 0.25 * easeOutBack(seg(t, TL.flash, TL.flash + 1.0)));
    circleA.position.set(sC.x, sC.y, -0.3); circleA.scale.set(circR, circR, 1); circleA.rotation.z = time * 0.18;
    circleA.material.uniforms.uOpacity.value = fin * (0.55 + 0.1 * Math.sin(time * 2)); circleA.visible = fin > 0.001;
    circleB.position.set(sC.x, sC.y, -0.29); circleB.scale.set(circR * 0.62, circR * 0.62, 1); circleB.rotation.z = -time * 0.32;
    circleB.material.uniforms.uOpacity.value = fin * 0.4; circleB.visible = fin > 0.001;
    const rr = Math.min(W, H) * (1.1 + 0.4 * fin);
    rays.position.set(target.x, target.y, -0.2); rays.scale.set(rr, rr, 1); rays.rotation.z = time * 0.08;
    rays.material.uniforms.uOpacity.value = fin * 0.45 + (tFlash > 0 ? 0.6 * Math.exp(-2.5 * tFlash) : 0); rays.visible = fin > 0.001;
    bgMat.uniforms.uFlare.value = fin * 0.35 + (tFlash > 0 ? 0.6 * Math.exp(-3 * tFlash) : 0);

    orbs.forEach((o, k) => {
      const a = time * 0.9 + (k / 4) * Math.PI * 2;
      const rx = staff.mesh.scale.x * 0.6, ry = staff.mesh.scale.y * 0.78;
      const ox = sC.x + Math.cos(a) * rx, oy = sC.y + Math.sin(a) * ry, oz = Math.sin(a) * 0.8;
      const s = Math.min(W, H) * 0.09 * (0.9 + 0.1 * Math.sin(time * 5 + k));
      o.position.set(ox, oy, oz + 1); o.scale.set(s, s, 1);
      o.material.uniforms.uOpacity.value = fin * 1.2; o.visible = fin > 0.001;
      if (fin > 0.5 && Math.random() < 0.35) spawn(ox, oy, oz + 1, 0, 0.15, 0, 0.7, 6, items[k].color, 0.5, 0);
    });
    if (fin > 0.3 && Math.random() < 0.5) {
      const a = Math.random() * Math.PI * 2, r = circR * 0.45 * Math.sqrt(Math.random());
      spawn(sC.x + Math.cos(a) * r, sC.y + Math.sin(a) * r * 0.6, 0.2, 0, 0.3 + Math.random() * 0.5, 0, 1.8, 5 + Math.random() * 6, [[1, 0.9, 0.6], [0.8, 0.7, 1], [0.6, 0.85, 1]][(Math.random() * 3) | 0], 0.3, 0);
    }

    /* 카메라 */
    const shake = tFlash > 0 ? 0.22 * Math.exp(-5 * tFlash) : 0.03 * seg(t, TL.absorbStart, TL.flash);
    camera.position.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, CAM_Z - 0.7 * easeInOut(seg(t, TL.flash, TL.flash + 2.5)));

    updateParticles(dt);
    renderer.render(scene, camera);
  }

  /* ---------- 초기화 ---------- */
  (async () => {
    const [staffTex, ...itemTexs] = await Promise.all([load(images.staff), ...images.items.map((it) => load(it.src))]);
    if (disposed) return;
    const asp = (tx) => tx.image.width / tx.image.height;

    staff = { aspect: asp(staffTex) }; staff.mat = cardMat(staffTex, staff.aspect, STAFF_TINT); staff.mesh = mesh(staff.mat, 6);
    staffGlow = mesh(spriteMat(glowTex, [0.75, 0.62, 1.0]), 5);
    circleA = mesh(spriteMat(circleTex, [1.0, 0.82, 0.5]), 3);
    circleB = mesh(spriteMat(circleTex, [0.6, 0.75, 1.0]), 3);
    rays = mesh(spriteMat(raysTex, [0.85, 0.75, 1.0]), 3);

    items = images.items.map((src, i) => {
      const it = { aspect: asp(itemTexs[i]), color: src.color, shown: false, hit: false };
      it.mat = cardMat(itemTexs[i], it.aspect, src.color);
      it.glow = mesh(spriteMat(glowTex, src.color), 7);
      it.mesh = mesh(it.mat, 8);
      it.beam = mesh(beamMat(src.color), 9); it.beam.visible = false;
      return it;
    });
    rings = [mesh(ringMat([0.85, 0.75, 1]), 10), mesh(ringMat([0.6, 0.85, 1]), 10), mesh(ringMat([1, 0.8, 0.5]), 10)];
    orbs = items.map((it) => mesh(spriteMat(glowTex, it.color), 10));

    const flashMat = track(new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } }, vertexShader: VERT,
      fragmentShader: `uniform float uOpacity; varying vec2 vUv; void main(){ float d = distance(vUv, vec2(0.5));
        gl_FragColor = vec4(mix(vec3(1.0), vec3(0.85, 0.78, 1.0), d), uOpacity * (1.0 - d * 0.6)); }`,
      transparent: true, depthWrite: false, depthTest: false,
    }));
    flash = mesh(flashMat, 12); flash.position.z = 5; flash.scale.set(40, 30, 1); flash.visible = false;

    ready = true; resize(); play(); last = performance.now();
  })().catch((e) => { console.error(e); onPhase('error'); });

  onPhase('loading');
  resize();
  raf = requestAnimationFrame(frame);

  return {
    play,
    setSpeed(s) { speed = s; },
    /** 클릭/터치 핸들러 안에서 호출해야 소리가 풀림 */
    enableSound() { return audio ? audio.resume().then(() => onSoundState(audio.state)) : Promise.resolve(); },
    setMuted(m) { audio && audio.setMuted(m); },
    soundState() { return audio ? audio.state : 'unsupported'; },
    dispose() {
      disposed = true; cancelAnimationFrame(raf); ro.disconnect();
      if (audio) { audio.stopAll(); setTimeout(() => audio.close(), 250); }
      disposables.forEach((d) => d.dispose && d.dispose());
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    },
  };
}
