import hud from './hud.json' with { type: 'json' };
import { WEEKS } from './choices.js';
import { lecture, showPlanetMarks, resetPlanetMarks } from './planet-brief.js';

// 시작 화면: ⓪ 이동 중 → ① 브리핑(탐사 로봇 보고) → 결정 화면. 팀 디자인 캔버스 「1주차 화면 3종」을 따른다.
// 브리핑은 주차마다 다시 뜨고, 주차 탭으로 지난 주 브리핑을 다시 본다 (openBriefing).
// 1주차 브리핑은 ORI 의 행성 강의다 (planet-brief.json pages). 한 장은 두 박자다:
//   ① ORI 설명: 로봇 옆에 첫마디(say)가 한 글자씩 찍히고 설명(lines)이 한 줄씩 떠오른다. 행성 위 표시는 planet-brief.js.
//   ② ▶▶·Enter → 아래 칸에 그 장의 메모(notes)가 대원이 받아 적듯 천천히 타자로 찍힌다. 다시 ▶▶ → 다음 장.
//   움직이는 중에 누르면 그 움직임을 바로 끝낸다. ◀ 키는 앞 장(메모까지 다 적힌 상태). 마지막 메모 뒤 버튼으로 선지로 간다.
// 주소 뒤에 ?intro=0 을 붙이면 건너뛴다. 움직임 줄이기 설정이면 이동 화면을 거의 바로 넘기고 글도 바로 보인다.
const $ = selector => document.querySelector(selector);
const intro = $('#intro'), travel = $('#intro-travel'), brief = $('#intro-brief');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TRAVEL_MS = reduced ? 400 : 3400;
const SAY_MS = 34;   // ORI 가 한 글자 찍는 시간
const LINE_MS = 280; // 설명 줄 사이
const MEMO_MS = 62;  // 메모 한 글자 (사람이 치듯 들쭉날쭉: MEMO_RHYTHM 를 곱한다)
const MEMO_RHYTHM = [1, 0.7, 1.3, 0.9, 1.6, 0.8, 1.1, 0.6];
const nextButton = $('#intro-next');

let pages = null, page = 0, phase = 'talk'; // 강의 중이면 pages 가 있다
let timers = [], settle = null; // 진행 중인 움직임과, 바로 끝낼 때 부르는 함수

function finish() {
  intro.hidden = true;
  document.removeEventListener('keydown', onKey);
  $('#hud').querySelector('.site')?.focus({ preventScroll: true });
}
function later(ms, run) { timers.push(setTimeout(run, ms)); }
function stopMotion() { timers.forEach(clearTimeout); timers = []; const done = settle; settle = null; done?.(); }
function forward() {
  if (!pages) return finish();
  if (settle) return stopMotion();             // 움직이는 중: 바로 끝까지
  if (phase === 'talk') return writeMemo();    // 설명 다 들음: 메모하기
  if (page < pages.length - 1) return showPage(page + 1);
  finish();
}
function showBrief() {
  if (travel.hidden) return; // 이미 브리핑이다
  travel.hidden = true; brief.hidden = false;
  if (pages) showPage(page); // 보이고 나서야 행성 위치를 잴 수 있다
  else showPlanetMarks($('#brief-art'), undefined);
  nextButton.focus();
}
function onKey(event) {
  if (brief.hidden) return;
  if (event.key === 'Enter') { event.preventDefault(); forward(); }
  else if (event.key === 'ArrowLeft' && pages && page > 0) { event.preventDefault(); showPage(page - 1, { instant: true }); }
}

function paragraphs(texts, cls) {
  return texts.map(text => {
    const line = document.createElement('p');
    if (cls) line.className = cls;
    line.textContent = text;
    return line;
  });
}
function setButton(start) {
  nextButton.textContent = start ? lecture.button : '▶▶';
  nextButton.classList.toggle('start', start);
  nextButton.setAttribute('aria-label', start ? lecture.button : '다음');
}
function memoLine(text, cls = '') {
  const line = document.createElement('p');
  line.className = 'note ' + cls;
  line.append(Object.assign(document.createElement('span'), { textContent: text }));
  return line;
}

/** 강의 한 장의 ① ORI 설명. instant 면(앞 장으로 갈 때) 움직임 없이 메모까지 다 적힌 상태 */
function showPage(index, { instant = false } = {}) {
  stopMotion();
  page = index; phase = 'talk';
  const current = pages[index], animate = !instant && !reduced;
  const say = $('#brief-bubble'), lines = paragraphs(current.lines, 'say-line');
  $('#brief-lines').replaceChildren(...lines);
  // 아래 칸: 앞 장까지 적은 메모
  $('#brief-report').replaceChildren(...pages.slice(0, index).flatMap(item => item.notes).map(text => memoLine(text)));
  showPlanetMarks($('#brief-art'), current.art, { animate });
  $('#brief-page').hidden = false;
  $('#brief-page').textContent = `${index + 1} / ${pages.length}`;
  setButton(false);
  if (!animate) {
    say.textContent = current.say;
    if (instant) { phase = 'note'; $('#brief-report').append(...current.notes.map(text => memoLine(text))); setButton(index === pages.length - 1); }
    return;
  }
  // 첫마디를 한 글자씩, 그다음 설명을 한 줄씩
  const chars = [...current.say];
  say.textContent = '';
  lines.forEach(line => line.classList.add('wait'));
  chars.forEach((_, i) => later(i * SAY_MS, () => { say.textContent = chars.slice(0, i + 1).join(''); }));
  lines.forEach((line, i) => later(chars.length * SAY_MS + 150 + i * LINE_MS, () => line.classList.replace('wait', 'rise')));
  later(chars.length * SAY_MS + 150 + lines.length * LINE_MS + 300, () => { settle = null; });
  settle = () => { say.textContent = current.say; lines.forEach(line => line.classList.remove('wait', 'rise')); };
}

/** 강의 한 장의 ② 메모: 아래 칸에 그 장의 요약이 타자 치듯 천천히 적힌다 */
function writeMemo() {
  stopMotion();
  phase = 'note';
  const current = pages[page], last = page === pages.length - 1;
  const memos = current.notes.map(text => memoLine('', 'now'));
  $('#brief-report').append(...memos);
  const done = () => { memos.forEach((line, i) => { line.firstChild.textContent = current.notes[i]; line.classList.remove('typing'); }); setButton(last); };
  if (reduced) return done();
  let at = 0;
  current.notes.forEach((text, n) => {
    const chars = [...text], target = memos[n];
    later(at, () => target.classList.add('typing'));
    chars.forEach((char, i) => {
      at += MEMO_MS * MEMO_RHYTHM[i % MEMO_RHYTHM.length] * (char === ' ' || char === '·' ? 1.8 : 1);
      later(at, () => { target.firstChild.textContent = chars.slice(0, i + 1).join(''); });
    });
    at += 380;
    later(at, () => target.classList.remove('typing'));
  });
  later(at, () => { settle = null; setButton(last); });
  settle = done;
}

$('#brief-year').textContent = 'YEAR ' + hud.year;
// 창 크기가 바뀌어 풍경을 다시 그리면 행성 칸·표시도 제자리로 (움직임 없이)
document.querySelector('.brief-view canvas.scene')?.addEventListener('painted', () => {
  if (!brief.hidden) showPlanetMarks($('#brief-art'), pages?.[page].art, { animate: false });
});

/** 브리핑 글과 주차 탭을 채운다. 탭은 지금까지 온 주차(reached)까지만 만든다 */
function fillBrief(week, texts, reached, onTab) {
  if (week.week === 1) {
    pages = lecture.pages; page = 0;
    resetPlanetMarks();
    if (!brief.hidden) showPage(0);
  } else {
    pages = null; stopMotion();
    $('#brief-bubble').textContent = week.brief;
    $('#brief-lines').replaceChildren();
    $('#brief-report').replaceChildren(...paragraphs([week.goal, ...texts]));
    showPlanetMarks($('#brief-art'), undefined); $('#brief-page').hidden = true;
    nextButton.textContent = '▶▶'; nextButton.classList.remove('start'); nextButton.setAttribute('aria-label', '다음');
  }
  $('#brief-tabs').replaceChildren(...WEEKS.slice(0, reached).map(({ week: number }) => {
    const tab = document.createElement('button');
    tab.type = 'button'; tab.className = 'tab'; tab.textContent = 'WEEK ' + number;
    tab.setAttribute('role', 'tab');
    tab.classList.toggle('on', number === week.week); tab.setAttribute('aria-selected', String(number === week.week));
    tab.addEventListener('click', () => onTab(number));
    return tab;
  }));
}

/** 그 주 브리핑을 띄운다. texts 는 앞 선택에 맞는 상황 문장이다 */
export function openBriefing(week, texts, reached, onTab) {
  intro.hidden = false; travel.hidden = true; brief.hidden = false;
  fillBrief(week, texts, reached, onTab);
  document.addEventListener('keydown', onKey);
  nextButton.focus();
}

fillBrief(WEEKS[0], [], 1, () => {});
nextButton.addEventListener('click', forward);

if (new URLSearchParams(window.startParams ?? location.search).get('intro') === '0') {
  intro.hidden = true;
} else {
  const fill = $('#travel-fill'), rocket = $('#travel-rocket'), pct = $('#travel-pct'), bar = $('#travel-bar');
  const start = performance.now();
  const step = time => {
    if (travel.hidden) return;
    const t = Math.min((time - start) / TRAVEL_MS, 1), percent = Math.round(t * 100);
    fill.style.width = percent + '%';
    rocket.style.left = `calc(${percent}% - ${percent / 100 * 132}px)`; // 로켓이 끝에서 트랙 밖으로 나가지 않게
    pct.textContent = percent + '%'; bar.setAttribute('aria-valuenow', String(percent));
    $('#travel-eta').textContent = percent < 100 ? '행성 궤도 진입 준비 중' : '궤도 진입 완료';
    if (t < 1) requestAnimationFrame(step); else setTimeout(showBrief, 350);
  };
  requestAnimationFrame(step);
  $('#intro-skip').addEventListener('click', showBrief);
  document.addEventListener('keydown', onKey);
}
