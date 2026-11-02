# 얼굴 — 대원 얼굴 반응 패널 (따로 만든 시안)

환경(산소·기압·온도 등)에 따라 대원의 몸 상태를 계산하고, 그 상태를 **얼굴 표정**으로 보여 주는 패널이에요.
게임 본체와 아직 연결하지 않은 독립 시안이라 이 폴더 안에서만 돌아가요.

- 미리보기 (아티팩트): https://claude.ai/artifact/7t8SLnr1DFk428FNWxZRpi
- 게임용 근사 모델이에요. 의학적으로 검증된 시뮬레이션이 아니에요.

## 열어 보기

`index.html`을 파일로 바로 열면 모델을 못 읽어요. 이 폴더에서 작은 서버를 띄워 주세요.

```bash
python -m http.server 5178
```

그다음 브라우저에서 http://localhost:5178 을 열면 돼요.

## 흐름

환경 입력 → 보호장비·실내 반영 → 신체 상태 → 얼굴 표정·시선

| 파일 | 하는 일 |
|---|---|
| `src/engine/face/envInput.js` | 환경 입력 형식과 범위. `fromGameStats()`가 게임 스탯과 잇는 자리예요 |
| `src/engine/face/protection.js` | 거주지 공기, 우주복(밀폐·산소·냉각) 반영 |
| `src/engine/face/physiology.js` | 산소포화도·체온·귀 압력 등 계산 → 호흡곤란·열·추위·압력·피로 심각도 |
| `src/engine/face/bodyLoop.js` | 위 계산을 0.1초 간격으로 돌리는 루프 (화면 프레임과 따로) |
| `src/engine/face/faceController.js` | 심각도 → ARKit 블렌드셰이프 가중치, 깜빡임, 호흡, 시선 움직임 |
| `src/engine/face/scanRig.js` | 블렌드셰이프가 없는 얼굴 스캔에 표정 34개를 자동으로 만들어 넣어요 |
| `src/engine/face/pointCloud.js` | 점 구름(홀로그램) 표현 |
| `src/engine/face/facePanel.js` | Three.js 화면, 모델 불러오기(KTX2·meshopt 압축 포함), 표면/홀로그램 전환 |
| `models/face/face.landmarks.json` | 스캔의 눈·입·턱 위치 (표정 자동 생성에 써요) |

게임에서 쓸 때는 `main.js` 맨 아래처럼 `FaceTest.setSource(() => fromGameStats(...))`로 입력을 바꿔 끼우면 돼요.

## 아직 본체 규칙과 다른 점

본체(`CLAUDE.md`)에 넣기 전에 맞춰야 해요.

- 점 구름이 이 폴더의 자체 셰이더(`pointCloud.js`)를 써요. 본체는 `src/engine`의 공통 포인트 셰이더 하나만 써야 해요.
- 색이 본체 팔레트(`palette.js`)를 거치지 않아요. 경고에 빨강, 청색증에 푸른 보라를 써서 "빨강·초록·보라 금지" 규칙과 맞지 않아요.
- 모델이 `public/models`가 아니라 이 폴더 안에 있어요.

## 에셋

| 파일 | 원래 이름 | 출처 | 작가 | 라이선스 |
|---|---|---|---|---|
| `models/face/face.glb` | Face | https://sketchfab.com/3d-models/face-ffde29cb64584cf1a939ac2b58d0a931 | 2on | CC-BY 4.0 (게임 크레딧에 작가 표기 필요) |

Three.js(r160)는 CDN(jsDelivr)에서 불러와요.
