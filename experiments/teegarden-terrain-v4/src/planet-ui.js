// 행성마다 다른 화면 글: 지역 버튼·핀 이름, 제목, 행성 수치. index.html 은 b 기준이고, planet.json 의 ui 가 있으면 바꿔 넣는다.
// main.js 가 버튼에 동작을 달기 전에 실행돼야 해서 main.js 맨 앞에서 불러온다.
import { PLANET } from './planets/index.js';

const { ui, siteCopy } = PLANET;
if (ui) {
  const names = Object.keys(siteCopy);
  for (const kind of ['.pin', 'button.site']) document.querySelectorAll(kind).forEach((button, i) => {
    const copy = siteCopy[names[i]];
    button.dataset.site = names[i];
    button.querySelector('b').textContent = copy.letter;
    if (kind === '.pin') {
      const small = document.createElement('small'); small.textContent = copy.en;
      button.querySelector('span').replaceChildren(copy.title, small);
      button.setAttribute('aria-label', copy.letter + ' ' + copy.title + ' 탐사');
    } else button.querySelector('.name').textContent = copy.title;
  });
  document.title = ui.title + ' / 행성 탐사';
  const set = (selector, text) => { const el = document.querySelector(selector); if (el) el.textContent = text; };
  set('.cam-l span:last-child', 'SURFACE SCAN · ' + ui.target);
  set('.p-right .meta span:nth-child(2)', 'TARGET : ' + ui.target);
  set('.news', ui.news);
  document.querySelector('#planet-facts').replaceChildren(...ui.facts.map(([label, value]) => {
    const li = document.createElement('li'), name = document.createElement('span'), val = document.createElement('b');
    name.textContent = label; val.textContent = value; li.append(name, document.createElement('i'), val);
    return li;
  }));
}
