# Tidelocked Habitat

Teegarden's Star b 이주 게임의 중앙 시각화(포인트 클라우드)입니다.

## 처음 한 번

```bash
npm install
```

## 실행

```bash
npm run dev
```

터미널에 나오는 주소(보통 http://localhost:5173)를 브라우저로 열면 됩니다.

## 폴더

| 폴더 | 내용 |
|---|---|
| `src/engine` | 공통 셰이더, 모프 전환, 카메라, 라벨 등 엔진 |
| `src/scenes` | 위치 무대, 주거 모듈, 산소 오버레이 |
| `src/data/choices` | 주차별 선지 JSON (`week1.json` …) |
| `public/models` | 정리된 `.glb` 모델 (`raw/`에는 받은 원본) |
| `scripts` | 모델 정리 같은 보조 스크립트 |

## 같이 작업하는 법

1. 작업판에서 카드를 맡아요.
2. Claude Code에게 "최신 main 받아와서 ○○ 작업할 브랜치 만들어줘"라고 말해요.
3. 카드의 프롬프트를 붙여넣어 작업해요.
4. 끝나면 "커밋하고 PR 올려줘"라고 말하고, 작업판 메모에 PR 링크를 남겨요.

규칙은 `CLAUDE.md`에, 외부 모델 출처는 `ASSETS.md`에 있어요.
