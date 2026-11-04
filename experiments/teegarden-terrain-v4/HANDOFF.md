# Teegarden terrain v4 작업 인계

2026-10-31. 이 폴더는 기존 게임과 독립된 Vite + Three.js 시안입니다.

## 실행
Node.js 22.12 이상에서 이 폴더를 작업 디렉터리로 사용합니다.
```
npm ci
npm run dev
npm test
npm run build
node scripts/deliver.mjs
```
마지막 명령은 독립 HTML, 5개 PLY와 전체 코드 문서를 deliverables에 생성합니다.

## 다음 작업자 / Claude
이 파일과 README.md를 읽으세요. 저장소 루트의 CLAUDE.md도 확인하세요.
기존 게임 src/engine, src/scenes 파일에 자동으로 덮어쓰지 마세요.
이 시안은 PointsMaterial 하나를 공유하며, 기존 게임의 공통 셰이더에 아직 통합하지 않았습니다.
별도 브랜치에서 이 폴더만 수정하고 검증 후 PR로 검토하세요.

## 유지할 요구사항
- 위치 모델 30,000점, mulberry32 고정 씨앗, Math.random 금지.
- 표면 기복 2.00x, 파라미터 패널 없음. 파랑/크림/주황 팔레트 함수 사용.
- A 중앙 평탄면, C 정상 높이 0/띠 반폭 0.45/얼음 골짜기 위치 보존 (굽은 마루 좌표 ridgeFrame 기준).
- B z=0 단면 보존. 내부 양쪽 벽은 비대칭. 동굴 형태는 메인 게임 용암동굴을 따른다. 무너질 위험 주황 표시는 쓰지 않는다(2026-10-31 사용자 요청).
- 항성/배경 별은 세계 좌표 고정.
- 카메라 이동 → 정지 → 1.05초 점 구성. 휠 조작에 스캔선 없음.
- A/B/C 전환은 표면을 따른 연속 이동. 행성 궤도 우회 없음.

## 1주차 와이어프레임 선지 (2026-11-03)
- 선지 갈래는 플레이테스트 1주차(위치 3 → 짓는 방식 2씩 → 공기 3). 데이터 src/choices.json, 배치·와이어프레임 src/placement.js, 크기 비율 src/modelSizes.json.
- 건물·장치는 Kenney Space Kit(CC0) 모델의 모서리 선을 점으로 그린다. 새 머티리얼 없음.
- 자세한 내용은 README.md "1주차 와이어프레임 선지".

## 구조
src/main.js: UI/렌더/전환. navigation.js: 카메라 경로. effects.js: 구성 시간/점 밝기.
terrain.js: 공용 지형 함수. plain.js/lavaTube.js/ridge.js: 각 지형. planet.js: 행성.
sites.json: 지역 데이터. palette.js: 색. tests/: 지형/경로/효과 검증.

## 자료 및 호스팅
실제 관측 지형이 아닌 설계 시나리오입니다. 원본 DOCX는 패키지에 포함하지 않았습니다.
공개 시안: https://teegarden-b-exploration.chayubin0229.chatgpt.site
GitHub 수정만으로 위 Sites 배포가 자동 갱신되지는 않습니다.
다른 계정은 이 비공개 저장소 접근 권한과 수정 권한이 필요합니다.

## 화면 디자인과 선지 문구 (2026-11-04)
- 화면은 팀 디자인 캔버스 「1주차 화면 3종」(https://claude.ai/artifact/7auowppcVKb3j5rwsvK2PQ)을 따른다: ⓪ 이동 중 → ① 브리핑 → ② 결정. 틀은 index.html, 색·글꼴·반응형은 src/style.css, 시작 화면은 src/intro.js.
- 주소 뒤에 `?intro=0` 을 붙이면 시작 화면을 건너뛴다.
- 왼쪽 상태 칸·브리핑에 채우는 값은 src/hud.json 이다. 아직 자료가 없는 값(산소 농도, 현재 기온, 대원 이름)은 null 로 두면 '측정 중'으로 나온다. 값을 지어 넣지 않는다.
- 선지 글은 src/choices.json 의 label(이름) · line(한 줄 설명) · gain(얻는 것) · cost(감수할 것)이다. 근거는 플레이테스트 1주차의 얻는 것·감수할 것이다.
  - 말투: 해요체로 차분하게. 비유(텐트·이불·동네)를 빼고 무엇을·왜를 먼저 적는다. 단계 질문은 '~골라 주세요'로 끝낸다.
  - tests/choices.test.js 가 길이(이름 12자·한 줄 36자·얻는 것/감수 28자)와 해요체를 검사한다.
- 글꼴(Terrarum Sans Bitmap, SIL OFL 1.1)과 ORI 로봇 이미지는 src/assets 에 있고 ASSETS.md 에 적었다. 로봇 이미지의 작가·라이선스는 올린 팀원이 확인해 적어야 한다.
- `node scripts/deliver.mjs` 로 만드는 독립 HTML 은 글꼴·로봇 이미지를 담지 못해 시스템 글꼴로 나온다 (상대 경로 파일이라서).

## 주차 이어가기 (2026-11-04)
- 주차 파일은 따로 둔다: 1주차 src/choices.json, 2~5주차 src/weeks/weekN.json. src/choices.js 의 WEEKS 에 등록되어 있다.
- 색: 지형은 파랑, 가장 최근에 더한 선지 하나는 크림(겹쳐 흰색으로 보인다), 그 전 선지는 모두 주황 (main.js syncAssets, 모든 주차 공통).
- 선택 상태는 하나에 쌓인다: { location, module, oxygen, power, storage, heat, … }. 뒤 주차는 requires 로 앞 주차 선택을 읽는다 (선지 조건, situation 현재 상황 문구, extra 설명 뒤 문장).
- 장치(오버레이)는 주차가 지나도 남고, buildOverlay 의 placed 로 앞 장치 자리를 비워 둔다.
- 2주차만 바로 보기: 주소 뒤에 `?intro=0&week=2&site=lavaTube` (site 는 plain·lavaTube·ridge). 1주차는 단계마다 첫 선지를 고른 것으로 친다.
- 오버레이 outside: { B: [x, z] } 는 그 지대에서 집 근처 대신 땅 위 자리에 둔다. 부품 box: [가로, 높이, 두께] 는 모델 없는 상자다.
- 오버레이 partsAt: { A, B, C } 는 지대마다 장치 묶음이 다르다 (3주 W1).
- 게이지·숫자 효과는 아직 없다. 5주 U1 의 {low} 와 점수 문구는 게이지가 들어온 뒤에 넣는다.
- 더블클릭으로 여는 파일: `npm run open-file` 이 저장소 맨 위 이번-시안-열기.html 을 새로 만든다. 시작 메뉴에서 1주차 또는 2주차(지대별)를 고른다. 새 주차를 넣으면 이 파일도 다시 만든다.
