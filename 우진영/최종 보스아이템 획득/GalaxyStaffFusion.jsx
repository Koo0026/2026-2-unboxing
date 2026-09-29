import { useEffect, useRef, useState } from 'react';
import { createGalaxyFusion } from './galaxyFusionCore';
import './GalaxyStaffFusion.css';

import staffImg from './assets/staff.webp';
import wandImg from './assets/wand.webp';
import capeImg from './assets/cape.webp';
import bootsImg from './assets/boots.webp';
import helmImg from './assets/helm.webp';

// 빔·파티클 색상은 각 아이템 카드의 주조색 (0~1 RGB)
export const DEFAULT_IMAGES = {
  staff: staffImg,
  items: [
    { src: wandImg, color: [0.45, 0.88, 1.0] },  // 별빛 지팡이
    { src: capeImg, color: [0.5, 0.58, 1.0] },   // 은하 망토
    { src: bootsImg, color: [1.0, 0.62, 0.32] }, // 날개 장화
    { src: helmImg, color: [0.86, 0.52, 1.0] },  // 마법 투구
  ],
};

/**
 * 4개 아이템 → 은하 지팡이 합체 연출
 * props
 *  - images      : 기본값 DEFAULT_IMAGES
 *  - autoPlay    : 마운트 즉시 재생 (기본 true)
 *  - showControls: 다시 재생/느리게 보기 버튼 (개발용, 기본 true)
 *  - onPhase     : (phase) => void   'loading'|'ready'|'summon'|'fusion'|'complete'
 *  - onComplete  : () => void        ← 여기서 성우 음성 재생 + 왕관 오버레이 시작
 */
export default function GalaxyStaffFusion({
  images = DEFAULT_IMAGES,
  showControls = true,
  onPhase,
  onComplete,
}) {
  const mountRef = useRef(null);
  const apiRef = useRef(null);
  const cbRef = useRef({ onPhase, onComplete });
  cbRef.current = { onPhase, onComplete };
  const [phase, setPhase] = useState('loading');
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const api = createGalaxyFusion(mountRef.current, {
      images,
      onPhase: (p) => { setPhase(p); cbRef.current.onPhase?.(p); },
      onComplete: () => cbRef.current.onComplete?.(),
    });
    apiRef.current = api;
    return () => api.dispose();
  }, [images]);

  useEffect(() => { apiRef.current?.setSpeed(slow ? 0.35 : 1); }, [slow]);

  return (
    <div className="fusion-root">
      <div ref={mountRef} className="fusion-canvas" />

      {phase === 'loading' && <div className="fusion-status">보물을 불러오는 중</div>}
      {phase === 'error' && <div className="fusion-status">이미지를 불러오지 못했어요. 새로고침해 주세요.</div>}
      {phase === 'summon' && <div className="fusion-banner">최종 보물 소환!</div>}
      {phase === 'complete' && (
        <div className="fusion-title" role="status">
          <span className="l1">최종 보물 소환 완료!</span>
          <span className="l2">대마법사 탄생!</span>
        </div>
      )}

      {showControls && (
        <div className="fusion-controls">
          <button className="fusion-btn" aria-pressed={slow} onClick={() => setSlow((s) => !s)}>느리게 보기</button>
          <button className="fusion-btn" onClick={() => apiRef.current?.play()}>다시 재생</button>
        </div>
      )}
    </div>
  );
}
