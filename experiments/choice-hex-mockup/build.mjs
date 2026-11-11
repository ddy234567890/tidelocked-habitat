// 시안 만들기: 게임의 주차 선지(weekN.json)에서 화면에 필요한 글만 뽑아 template.html 에 넣고 index.html 로 쓴다.
// 실행: node experiments/choice-hex-mockup/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const weeksDir = join(here, '../teegarden-terrain-v4/src/weeks');
const weeks = [1, 2, 3, 4, 5].map(n => {
  const w = JSON.parse(readFileSync(join(weeksDir, `week${n}.json`), 'utf8'));
  return {
    week: w.week, title: w.title, goal: w.goal, brief: w.brief,
    steps: w.steps.map(s => ({
      id: s.id, label: s.label,
      choices: s.choices.map(({ id, label, line, gain, cost, requires, hidden }) => ({ id, label, line, gain, cost, requires, hidden })),
    })),
  };
});
// 픽셀 폰트(Terrarum Sans Bitmap, SIL OFL 1.1 — 게임과 같은 파일)를 파일 안에 넣어, 이 html 하나만 열거나 보내도 폰트가 나오게 한다
const fontPath = join(here, '../teegarden-terrain-v4/src/assets/fonts/terrarum-sans-bitmap.woff');
const font = `data:font/woff;base64,${readFileSync(fontPath).toString('base64')}`;
const html = readFileSync(join(here, 'template.html'), 'utf8')
  .replace('/*DATA*/', JSON.stringify(weeks))
  .replace('../teegarden-terrain-v4/src/assets/fonts/terrarum-sans-bitmap.woff', font);
writeFileSync(join(here, 'index.html'), html);
console.log('index.html 완성:', weeks.map(w => `W${w.week} ${w.steps.length}단계`).join(', '));
