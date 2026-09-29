# 우와아 주문 · 날개 신발 (React + three.js)

## 1) 가장 빠른 확인
`바로-실행-데모.html` 을 더블클릭하면 브라우저에서 바로 실행됩니다.
(React·three.js 를 CDN에서 불러오므로 인터넷 연결이 필요합니다.)

## 2) 개발 프로젝트로 실행 (Node.js 18 이상)
```bash
npm install
npm run dev      # http://localhost:5173 자동으로 열림
npm run build    # dist/ 폴더에 배포용 파일 생성
```

## 파일 구성
- `src/MagicShoesStage.jsx` : 애니메이션 본체 (다른 프로젝트에 이 파일 + assets 만 복사해서 사용)
- `src/App.jsx`, `src/App.css` : 입 모양 칸 맞추기 데모 화면
- `src/assets/`
  - `wizard.png` : 배경 제거한 마법사
  - `wizard_noboots.png` : 원래 갈색 부츠를 지운 마법사 (신발을 다 신은 뒤 교체)
  - `legs_overlay.png` : 바지·코트 자락 레이어 (부츠 목을 덮어 '신은' 모습을 만듦)
  - `boot.png` : 날개를 떼어 낸 부츠, `wing.png` : 날개

※ three.js 는 데모와 같은 r128(0.128.0)로 고정했습니다. 최신 버전은 색 관리 기본값이 달라 이미지가 뿌옇게 보일 수 있습니다.

## 기존 게임에 붙이기
```jsx
const stage = useRef();
<MagicShoesStage ref={stage} onDone={() => { /* 다음 단계 */ }} />
stage.current.play();   // 입 모양 칸을 다 맞췄을 때 (클릭 핸들러 안에서 호출해야 소리가 남)
stage.current.reset();  // 처음 상태로
```
옵션: `muted`, `voiceSrc="/woowaa.mp3"`(녹음 목소리), `useSpeech={false}`(합성음만 사용)

타이밍 조정: `MagicShoesStage.jsx` 상단의 `T`, `HOPS`
위치 조정: `FEET`(발 위치·신발 크기 k·날개 위치), `MIC`(마이크), `MOUTH`(입), `DROP`(신발이 올라오는 거리)
