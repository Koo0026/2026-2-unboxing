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
- `src/App.jsx`, `src/App.css` : 데모 화면 (들어오자마자 "우와아!" → 신발 장착, 끝나면 '한 번 더 보기')
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
stage.current.play();   // 이 장면에 들어오자마자 호출 (그 전에 사용자의 클릭/터치가 한 번이라도 있어야 소리가 남)
stage.current.reset();  // 처음 상태로
```
옵션: `muted`, `voice="speech" | "clip"`(기본 `speech`), `voiceSrc="/my-voice.mp3"`(직접 녹음한 목소리로 교체), `useSpeech`(내장 목소리를 못 틀 때 합성음 대신 브라우저 음성 사용)
목소리: 기본은 처음 버전처럼 기기 음성이 "우와아!"를 직접 읽습니다(첫 번째 한국어 음성, pitch 1.8 · rate 1.05 — 맥·아이폰은 Yuna). 한국어 음성이 없거나 0.6초 안에 시작하지 못하거나 오류가 나면 내장 목소리 파일 `shout_woah.mp3`로 바뀝니다. 데모 주소 끝에 `?voice=clip`을 붙이면 처음부터 내장 목소리 파일을 씁니다. 외치는 동안 다른 효과음은 6dB 낮아졌다가 목소리가 끝나면 돌아옵니다.
입 모양 맞추기: 목소리가 실제로 나기 시작한 순간(onstart)을 기준으로 '우 → 와 → 아!' 입 모양·말풍선 글자·몸 동작이 맞춰지고, 소리가 끝나면(onend) 입을 다뭅니다. 목소리별 타이밍은 `MagicShoesStage.jsx`의 `VOICE_PROFILES`(기기 음성 `speech` / 내장 파일 `clip`)에 있습니다.
내장 목소리 출처: "regular show style 'woah!'" by Reitanna (https://freesound.org/people/Reitanna/sounds/235158/) — CC0 1.0 퍼블릭 도메인(상업적 사용 가능, 출처 표기 의무 없음). 자르기·끝 톤 살짝 올리기·EQ·압축·짧은 울림으로 힘 있게 다듬음.

타이밍 조정: `MagicShoesStage.jsx` 상단의 `T`, `HOPS`
위치 조정: `FEET`(발 위치·신발 크기 k·날개 위치), `MIC`(마이크), `MOUTH`(입), `DROP`(신발이 올라오는 거리)
