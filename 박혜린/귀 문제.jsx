import { useCallback, useEffect, useRef, useState } from 'react';
import { createStage, createAudio } from './stage.js';

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

  const play = useCallback(() => {
    if (!stageRef.current) return;
    if (sound) {
      if (!audioRef.current) audioRef.current = createAudio();
      const a = audioRef.current;
      if (a) {
        if (a.ctx.state === 'suspended') a.ctx.resume();
        a.schedule();
      }
    }
    stageRef.current.play();
    setPhase('playing');
  }, [sound]);

  const label = phase === 'idle' ? '재생' : phase === 'playing' ? '재생 중…' : '다시 보기';

  return (
    <div className="app">
      <canvas ref={canvasRef} aria-label="파란 마법사에게 마법 투구가 씌워지는 애니메이션" />
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
