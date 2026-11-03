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
