// 메모장 창 (주차별 노드맵). 선지판(hexBoard)이 받은 단계 상태를 주차별로 적어 두었다가,
// '메모장'을 열면 주차마다 고른 노드를 이은 경로만 보여 준다. 노드에 마우스를 올리거나 한 번 누르면 정보가 뜬다.
// 기록은 이 판 안에서만 한다 (main.js 는 그대로). 새로고침하면 처음부터 다시 적는다.
import { WEEKS } from './choices.js';
import { ICONS } from './hexIcons.js';
import './field-notes.css';

const SVG = 'http://www.w3.org/2000/svg';
const esc = text => String(text ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const hex = r => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 3 * i - Math.PI / 2; return `${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`; }).join(' ');
const R = 30, GAP = 150, X0 = 40, Y = 36, H = 96;   // 한 줄의 노드 크기·간격 (판 좌표)

export function createFieldNotes() {
  const log = new Map();   // 주차 번호 → [{ short, done, choice }]

  const modal = document.createElement('div');
  modal.className = 'fn-modal'; modal.hidden = true;
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'fn-title');
  modal.innerHTML = `
    <section class="window fn-win">
      <div class="titlebar"><span id="fn-title">MEMO://NODE_MAP</span><span class="wbtns"><button type="button" class="wbtn fn-x" aria-label="메모장 닫기">×</button></span></div>
      <div class="fn-rows"></div>
    </section>
    <svg width="0" height="0" aria-hidden="true" style="position:absolute"><defs>
      ${Object.entries(ICONS).map(([id, d]) => `<symbol id="fn-ic-${id}" viewBox="0 0 24 24">${d}</symbol>`).join('')}
    </defs></svg>
    <div class="fn-tip" role="tooltip"></div>`;
  document.body.append(modal);
  const rows = modal.querySelector('.fn-rows'), tip = modal.querySelector('.fn-tip');
  let opener = null, pinned = null;

  // ---- 기록: 선지판이 update 받을 때마다 부른다 ----
  function record(steps) {
    const ids = steps.map(s => s.id).join('/');
    const k = WEEKS.findIndex(w => w.steps.map(s => s.id).join('/') === ids);
    if (k < 0) return;
    const prev = log.get(k + 1);
    log.set(k + 1, steps.map((s, i) => {
      const done = s.status === 'done';
      if (!done && prev?.[i]?.done) return prev[i];   // 한 번 결정한 단계는 이동 중 잠깐 들어오는 빈 상태로 덮이지 않게
      const c = done ? s.choices.find(x => x.id === s.selected) : null;
      return { short: s.short, done, choice: c && { id: c.id, label: c.label, line: c.line, gain: c.gain, cost: c.cost } };
    }));
    if (!modal.hidden) render();
  }

  // ---- 그리기: 주차마다 한 줄, 고른 노드끼리 선으로 잇는다. 아직 안 고른 단계는 점선 "?" ----
  function chain(steps, wk) {
    const width = X0 * 2 + GAP * (steps.length - 1);
    let lines = '', nodes = '';
    steps.forEach((s, i) => {
      const x = X0 + i * GAP;
      if (i) lines += `<line class="fn-line${s.done && steps[i - 1].done ? '' : ' wait'}" x1="${x - GAP + R + 4}" y1="${Y}" x2="${x - R - 4}" y2="${Y}"/>`;
      const c = s.choice;
      nodes += `<g class="fn-node${s.done ? ' done' : ''}" transform="translate(${x} ${Y})" ${c ? `tabindex="0" role="button" data-w="${wk}" data-i="${i}" aria-label="${esc(s.short)}: ${esc(c.label)}"` : 'aria-hidden="true"'}>
        <polygon class="fn-hex" points="${hex(R)}"/>
        ${c ? `<use href="#fn-ic-${ICONS[c.id] ? c.id : '_'}" x="-11" y="-11" width="22" height="22" class="fn-icon"/><text class="fn-name" y="${R + 20}">${esc(c.label)}</text>` : '<text class="fn-q" y="6">?</text>'}
      </g>`;
    });
    return `<svg class="fn-map" viewBox="0 0 ${width} ${H}" width="${width}" height="${H}" xmlns="${SVG}">${lines}${nodes}</svg>`;
  }
  function render() {
    unpin();
    rows.innerHTML = [...log.keys()].sort((a, b) => a - b)
      .map(wk => `<div class="fn-row"><span class="fn-wk">W${wk}</span>${chain(log.get(wk), wk)}</div>`).join('');
  }

  // ---- 정보: 마우스를 올리면 뜨고, 한 번 누르면 고정(다시 누르거나 다른 곳을 누르면 풀림) ----
  function showTip(node) {
    const s = log.get(Number(node.dataset.w))?.[Number(node.dataset.i)];
    if (!s?.choice) return;
    const c = s.choice;
    tip.innerHTML = `<div class="t-step">W${node.dataset.w} · ${esc(s.short)}</div><div class="t-name">${esc(c.label)}</div>
      ${c.line ? `<p>${esc(c.line)}</p>` : ''}
      ${c.gain ? `<div class="t-row"><span>얻은 것</span><span>${esc(c.gain)}</span></div>` : ''}
      ${c.cost ? `<div class="t-row cost"><span>감수</span><span>${esc(c.cost)}</span></div>` : ''}`;
    tip.classList.add('on');
    const r = node.getBoundingClientRect();
    // 같은 줄의 다른 노드를 가리지 않게 노드 바로 아래에 (자리가 없으면 위에)
    const left = Math.min(innerWidth - tip.offsetWidth - 10, Math.max(10, r.left + r.width / 2 - tip.offsetWidth / 2));
    const top = r.bottom + 8 + tip.offsetHeight > innerHeight - 10 ? r.top - tip.offsetHeight - 8 : r.bottom + 8;
    tip.style.left = `${left}px`; tip.style.top = `${Math.max(10, top)}px`;
  }
  const hideTip = () => { if (!pinned) tip.classList.remove('on'); };
  function unpin() { pinned?.classList.remove('pinned'); pinned = null; tip.classList.remove('on'); }
  const nodeOf = e => e.target.closest('.fn-node[data-w]');
  rows.addEventListener('pointerover', e => { const n = nodeOf(e); if (n && !pinned) showTip(n); });
  rows.addEventListener('pointerout', e => { const n = nodeOf(e); if (n && !n.contains(e.relatedTarget)) hideTip(); });
  rows.addEventListener('focusin', e => { const n = nodeOf(e); if (n && !pinned) showTip(n); });
  rows.addEventListener('focusout', hideTip);
  rows.addEventListener('scroll', unpin);
  function toggle(n) {
    if (pinned === n) return unpin();
    unpin(); pinned = n; n.classList.add('pinned'); showTip(n);
  }
  modal.addEventListener('click', e => {
    const n = nodeOf(e);
    if (n) return toggle(n);
    if (e.target === modal) return close();
    unpin();
  });
  rows.addEventListener('keydown', e => { const n = nodeOf(e); if (n && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(n); } });

  // ---- 열고 닫기 ----
  function open() {
    opener = document.activeElement;
    render();
    modal.hidden = false;
    modal.querySelector('.fn-x').focus();
    rows.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }
  function close() {
    if (modal.hidden) return;
    unpin(); modal.hidden = true;
    opener?.focus?.();
  }
  modal.querySelector('.fn-x').addEventListener('click', close);
  addEventListener('keydown', e => {
    if (modal.hidden || e.key !== 'Escape') return;
    e.stopPropagation();
    if (pinned) unpin(); else close();
  }, true);

  return { record, open, close };
}
