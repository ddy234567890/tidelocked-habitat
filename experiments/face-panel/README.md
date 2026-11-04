# 얼굴 반응 패널 (실험)

게임 좌측 하단에 대원 얼굴을 띄우고, 환경(산소·기압·온도 등)에 따라 표정·피부가 바뀌는 패널이에요.
**게임용 근사 모델이에요. 의학적으로 검증된 시뮬레이션이 아니에요.**

## 테스트 페이지 열기

저장소 맨 위 폴더에서 정적 서버를 켜고 이 폴더의 `index.html`을 열어요 (모델을 `../../public/models/face/`에서 읽어요).

```bash
python3 -m http.server 8000
# 브라우저: http://localhost:8000/experiments/face-panel/
```

테스트: `node tests/physiology.test.mjs`, `node tests/map.test.mjs`

## 이번 버전에서 바뀐 것

- 보기 방식은 **표면 얼굴만** 써요 (홀로그램 점 보기는 화면에서 뺐어요. 코드는 남아 있음).
- 스캔 얼굴의 입술 사이를 실제로 갈라서 입이 열리고, **입 안 구조**(윗니·아랫니 14개씩, 잇몸, 혀, 입천장·목 쪽 공간)를 넣었어요. 아래쪽은 턱과 같이 움직여요.
- 아랫입술은 턱을 벌려도 기울지 않고 서 있는 채로 내려가며, 안쪽은 아랫니를 감싸듯 말려요 (입술이 두꺼워 보이지 않게).
- 표정은 **FACS 동작 단위(AU, 근육 하나의 움직임)** 로 계산한 뒤 ARKit 블렌드셰이프로 바꿔요 (`faceController.js`의 `AU_NAMES` 참고).
- 더위: 심부 체온이 오르기 전에도, 피부로 느끼는 더위(30~42°C, 습도 높을수록 세게)에 바로 얼굴이 붉어지고 땀이 맺혀요.

## 참고 치수 (입 안)

| 항목 | 값 | 비고 |
|---|---|---|
| 윗니 가운데 앞니 | 길이 9.0 · 폭 8.2 mm | 실측 평균 |
| 쉴 때 보이는 윗니 | 약 2.6 mm | 한국인 실측 평균 |
| 송곳니 사이 너비 | 위 35.4 · 아래 26.9 mm | 실측 평균 |
| 최대 입 벌림 | 남 56.3 · 여 50.6 mm | 실측 평균 |
| 두 눈 중심 사이(E) | 약 63 mm | 추정 (mm ↔ 모델 크기 변환용) |
| 나머지 치아 크기·혀 크기 | — | 추정 |

---

## 흐름

```
환경 입력 (envInput.js)
  → 보호장비·실내 반영 (protection.js)
  → 신체 상태 계산 (physiology.js, bodyLoop.js가 0.1초마다)   ← 화면과 분리
  → 얼굴 제어 (faceController.js, 화면 프레임마다)
  → 블렌드셰이프 적용 + 땀·광택·피부색 효과 (facePanel.js)
```

## 게임에 붙이기

```js
import { createBodyLoop, createFacePanel, fromGameStats } from './engine/face/index.js';

const body = createBodyLoop({ getEnv: () => fromGameStats(game.stats, { pressureKPa: game.pressure }) });
const face = createFacePanel({ container: document.querySelector('#face'), getBody: () => body.state, modelUrl: '/models/face/face.glb' });
```

- 지금 선지 JSON의 `stats`에는 온도·산소 %만 있어요. 기압·습도·활동량·노출 시간이 생기면 `fromGameStats()`만 고치면 돼요.
- 단계가 바뀔 때 이벤트가 필요하면 `createBodyLoop({ onLevelChange(key, from, to) {…} })`를 써요.

## 입력값 (단위)

| 이름 | 단위 | 뜻 |
| --- | --- | --- |
| o2Pct | % | 산소 농도 (부피 %) |
| pressureKPa | kPa | 절대기압 |
| tempC | °C | 기온 |
| humidityPct | % | 상대습도 |
| activityMET | MET | 활동량 (1 = 쉬는 상태) |
| exposureMin | 분 | 현재 환경 노출 시간 |
| location | outdoor / habitat | 실외 / 실내(거주지) |
| suit.worn, o2Supply, cooling, pressureHold | 켜짐, 0~1 | 우주복 착용, 산소 공급·냉각·압력 유지 상태 |
| suit.setpointKPa | kPa | 우주복 안 목표 압력 (기본 29.6, EMU 4.3 psi 참고) |

## 과학 근거와 게임 조정값

| 구분 | 내용 |
| --- | --- |
| SCI | 흡입 산소 분압 = 산소 농도 × (기압 − 6.3 kPa) |
| SCI | 폐포 산소식 (호흡률 0.8) |
| SCI | Severinghaus 산소해리곡선 (분압 → 산소포화도) |
| SCI | Stull 습구온도 식 |
| SCI | 암스트롱 한계 6.3 kPa, 습구온도 35°C 한계, 산소포화도 90% 기준 |
| 근사 | 과호흡으로 CO₂가 떨어지는 정도 (에베레스트 정상 실측과 비슷하게 맞춤) |
| 근사 | 운동 시 산소 감소 |
| GAME | 변화 속도 (시간 압축) |
| GAME | 체온 목표식, 추위·피로·압력 불편 매핑 |
| GAME | 표정 배합 전부 |

- 호흡곤란은 산소 농도가 아니라 **산소 분압**으로 판단해요. 같은 21%라도 기압이 낮으면 숨이 차요.
- 기압은 눈·안압과 연결하지 않아요. 압력 **변화**만 귀·코 안팎 압력 차로 불편을 만들고, 얼굴은 턱을 움직여 귀를 뚫는 동작을 해요.
- 단계(정상/경미/심함)는 켜지는 문턱과 꺼지는 문턱이 다르고, 최소 1초 유지돼요. 그래서 경계값 근처에서 깜빡거리지 않아요.

## 얼굴 모델 사양 (실제 모델을 넣을 때)

- **형식:** `.glb` (glTF 2.0 바이너리). Draco 압축은 쓰지 않아요.
- **블렌드셰이프:** ARKit 52개 표준 이름을 권장해요. 최소한 아래 26개는 필요해요.
  - eyeBlink·eyeWide·eyeSquint (좌우)
  - browInnerUp, browDown·browOuterUp (좌우)
  - noseSneer·cheekSquint (좌우), cheekPuff
  - jawOpen, jawLeft, jawRight
  - mouthFunnel, mouthStretch·mouthFrown·mouthPress (좌우)
  - 이름이 달라도 자동 매핑하고, 못 찾은 것은 테스트 페이지 표에서 직접 고를 수 있어요.
- **방향:** Y가 위, 얼굴이 +Z를 봐요 (glTF 기본).
- **크기:** 단위는 미터를 권장해요. 크기는 자동으로 맞춰요.
- **폴리곤:** 머리 기준 약 3만 삼각형 이하.
- **질감:** 텍스처는 있어도 되고 없어도 돼요. 재질은 MeshStandard(PBR)여야 땀·광택·홍조 효과가 붙어요.
- **놓는 곳:** `public/models/face/face.glb`
  - 있으면 자동으로 쓰고, 없으면 임시 모델로 대신해요.
  - 출처·라이선스는 ASSETS.md에 적어요.

## 테스트

- `node tests/physiology.test.mjs`: 관계식, 상태, 경계값 흔들림, 회복을 확인해요.
- `node tests/map.test.mjs`: 이름 매핑을 확인해요.
- `face-test.html`: 슬라이더, 개발용 표시, .glb 끌어다 놓기로 확인해요.
