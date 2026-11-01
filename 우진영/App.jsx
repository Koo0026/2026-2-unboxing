// App.jsx — 우와아 주문 데모
// 입 모양을 고르는 단계 없이, 화면에 들어오자마자 마법사가 "우와아!"를 외치며 날개 신발을 신음
import React, { useEffect, useRef, useState } from 'react';
import MagicShoesStage from './MagicShoesStage.jsx';
import './App.css';

// 목소리: 기본은 기기 음성이 "우와아!"를 직접 읽음(처음 버전 기계음 — 맥·아이폰은 Yuna)
//   주소 끝에 ?voice=clip 을 붙이면 내장 목소리 파일(shout_woah.mp3, CC0)로 고정
const VOICE_MODE = typeof location !== 'undefined' && new URLSearchParams(location.search).get('voice') === 'clip' ? 'clip' : 'speech';

export default function App() {
  const stage = useRef(null);
  const [phase, setPhase] = useState('magic'); // magic | done
  const [muted, setMuted] = useState(false);
  const [announce, setAnnounce] = useState('우와아!');

  // 바로 시작 (브라우저가 소리를 막아 둔 상태면 첫 재생은 소리 없이 진행될 수 있음)
  useEffect(() => { stage.current?.play(); }, []);

  const again = () => {
    stage.current?.unlockAudio();
    setPhase('magic');
    setAnnounce('우와아!');
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
        </div>
      </header>

      <main className="stage">
        <MagicShoesStage
          ref={stage}
          muted={muted}
          voice={VOICE_MODE}
          onDone={() => { setPhase('done'); setAnnounce('날개 신발을 신었어요!'); }}
        />
      </main>

      <footer className={`tray ${phase === 'done' ? '' : 'playing'}`}>
        <button className="again" onClick={again} disabled={phase !== 'done'}>한 번 더 보기</button>
      </footer>
      <p className="sr" aria-live="polite">{announce}</p>
    </div>
  );
}
