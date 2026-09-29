// App.jsx — 입 모양 칸 맞추기 데모
// 주문 칸(우·와·아)에 알맞은 입 모양을 차례로 놓으면 MagicShoesStage.play() 실행
import React, { useCallback, useMemo, useRef, useState } from 'react';
import MagicShoesStage from './MagicShoesStage.jsx';
import './App.css';

const TARGET = ['u', 'wa', 'a'];
const SYL = { u: '우', wa: '와', a: '아', i: '이', e: '에' };
const ALL = ['u', 'wa', 'a', 'i', 'e'];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 입 모양 그림 (정면에서 본 입술)
export function MouthIcon({ shape, size = 64 }) {
  const lip = '#e0707a', line = '#6b2a33', inside = '#4a1a24', tongue = '#f29ba4', teeth = '#fffaf2';
  const cx = 32, cy = 34;
  const S = {
    u: { o: [12, 13], n: [5, 6] },
    wa: { o: [17, 19], n: [11, 13], tongue: true },
    a: { o: [21, 24], n: [16, 19], tongue: true, top: true },
    i: { o: [27, 11], n: [22, 5], grin: true },
    e: { o: [24, 15], n: [19, 10], top: true, tongue: true },
  }[shape];
  const id = `m-${shape}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <clipPath id={id}><ellipse cx={cx} cy={cy} rx={S.n[0]} ry={S.n[1]} /></clipPath>
      </defs>
      <ellipse cx={cx} cy={cy} rx={S.o[0]} ry={S.o[1]} fill={lip} stroke={line} strokeWidth="2" />
      <ellipse cx={cx} cy={cy} rx={S.n[0]} ry={S.n[1]} fill={inside} />
      <g clipPath={`url(#${id})`}>
        {S.tongue && <ellipse cx={cx} cy={cy + S.n[1] * 0.8} rx={S.n[0] * 0.8} ry={S.n[1] * 0.55} fill={tongue} />}
        {S.top && <rect x={cx - S.n[0]} y={cy - S.n[1]} width={S.n[0] * 2} height={S.n[1] * 0.35} fill={teeth} />}
        {S.grin && <rect x={cx - S.n[0]} y={cy - S.n[1]} width={S.n[0] * 2} height={S.n[1] * 2} fill={teeth} />}
        {S.grin && <line x1={cx - S.n[0]} y1={cy} x2={cx + S.n[0]} y2={cy} stroke="#d9cfc2" strokeWidth="1" />}
      </g>
      {shape === 'u' && (
        <g stroke={line} strokeWidth="1.4" strokeLinecap="round" opacity=".7">
          <line x1="32" y1="18" x2="32" y2="22" />
          <line x1="21" y1="24" x2="24" y2="26" />
          <line x1="43" y1="24" x2="40" y2="26" />
        </g>
      )}
    </svg>
  );
}

export default function App() {
  const stage = useRef(null);
  const [slots, setSlots] = useState([null, null, null]);
  const [tray, setTray] = useState(() => shuffle(ALL));
  const [wrong, setWrong] = useState(null);
  const [phase, setPhase] = useState('play'); // play | magic | done
  const [muted, setMuted] = useState(false);
  const [announce, setAnnounce] = useState('');

  const next = slots.indexOf(null);

  const pick = useCallback((shape) => {
    if (phase !== 'play') return;
    stage.current?.unlockAudio();
    if (shape === TARGET[next]) {
      const filled = slots.slice();
      filled[next] = shape;
      setSlots(filled);
      setTray((t) => t.filter((x) => x !== shape));
      stage.current?.sound('pop');
      if (filled.every(Boolean)) {
        setPhase('magic');
        setAnnounce('주문 완성! 우와아!');
        stage.current?.play();
      }
    } else {
      setWrong(shape);
      stage.current?.sound('buzz');
      setTimeout(() => setWrong(null), 450);
    }
  }, [phase, next, slots]);

  const restart = () => {
    stage.current?.reset();
    setSlots([null, null, null]);
    setTray(shuffle(ALL));
    setPhase('play');
    setAnnounce('');
  };

  const previewOnly = () => {
    stage.current?.unlockAudio();
    setSlots(TARGET.slice());
    setTray((t) => t.filter((x) => !TARGET.includes(x)));
    setPhase('magic');
    stage.current?.play();
  };

  return (
    <div className="app">
      <header className="top">
        <h1>우와아 주문</h1>
        <div className="tools">
          <button className="ghost" onClick={() => setMuted((m) => !m)} aria-pressed={muted}>
            {muted ? '소리 켜기' : '소리 끄기'}
          </button>
          <button className="ghost" onClick={previewOnly} disabled={phase === 'magic'}>
            애니메이션만 보기
          </button>
        </div>
      </header>

      <section className="spell" aria-label="입 모양 칸">
        {TARGET.map((t, i) => (
          <div
            key={t}
            className={`slot ${slots[i] ? 'filled' : ''} ${i === next && phase === 'play' ? 'current' : ''}`}
          >
            <span className="syl">{SYL[t]}</span>
            <span className="face">{slots[i] ? <MouthIcon shape={slots[i]} size={52} /> : <span className="empty" />}</span>
          </div>
        ))}
      </section>

      <main className="stage">
        <MagicShoesStage
          ref={stage}
          muted={muted}
          onDone={() => { setPhase('done'); setAnnounce('날개 신발을 신었어요!'); }}
        />
      </main>

      <footer className="tray">
        {phase === 'done' ? (
          <button className="again" onClick={restart}>한 번 더 하기</button>
        ) : (
          <>
            <p className="hint">
              {phase === 'play' ? `‘${SYL[TARGET[next]]}’ 소리를 내는 입 모양을 골라요` : '우와아!'}
            </p>
            <div className="tiles">
              {tray.map((s) => (
                <button
                  key={s}
                  className={`tile ${wrong === s ? 'wrong' : ''}`}
                  onClick={() => pick(s)}
                  disabled={phase !== 'play'}
                  aria-label={`${SYL[s]} 입 모양`}
                >
                  <MouthIcon shape={s} size={56} />
                </button>
              ))}
            </div>
          </>
        )}
      </footer>
      <p className="sr" aria-live="polite">{announce}</p>
    </div>
  );
}
