// 프롤로그 접속 화면 (public/web/prologue-access.html, README_연결방법.md 를 따른다).
// 게임을 열면 맨 처음 이 화면을 게임 위에 iframe 으로 띄운다 (로그인 → 행성 선택).
// 접속 화면은 열리면 바로 로그인부터 시작하고(안에 video[data-prologue] 가 없으므로),
// 목적지 확정 때 prologue:done { name, planet } 을 보낸다 → 닫고 onDone (로켓 이동 화면 → 1주차 브리핑).
// 이름·행성은 window.prologue 에 남기고, 게임 쪽 window 에도 같은 prologue:done 을 다시 보낸다.
// 고른 행성이 지금 불러온 행성과 다르면 ?planet=…&prologue=0 으로 새로 불러온다. 이름은 이 탭에만 잠깐 남겨(sessionStorage) 이어 쓴다.
// 주소 뒤 ?prologue=0 이면 접속 화면 없이 바로 넘어간다.
import { planetSearch } from './planets/index.js';

const KEY = 'tidelocked.prologue';
export function openPrologue(onDone) {
  const search = window.startParams ?? location.search;
  if (new URLSearchParams(search).get('prologue') === '0') {
    try { window.prologue = JSON.parse(sessionStorage.getItem(KEY)) ?? undefined; sessionStorage.removeItem(KEY); } catch { /* 이름 없이 시작 */ }
    return onDone();
  }
  const frame = document.createElement('iframe');
  frame.src = 'web/prologue-access.html';
  frame.title = '탐사 접속';
  frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:1000;background:#02040C';
  frame.addEventListener('load', () => {
    const inner = frame.contentWindow;
    inner.addEventListener('prologue:login', e => { window.prologue = { ...e.detail }; });
    inner.addEventListener('prologue:done', e => {
      window.prologue = { ...e.detail };
      window.dispatchEvent(new CustomEvent('prologue:done', { detail: { ...e.detail } }));
      // 다른 행성: 접속 화면(목적지 확정)을 띄운 채 새로 불러온다. 파일로 연 시안(startParams)은 주소가 없어 그대로 시작한다
      const next = window.startParams == null ? planetSearch(e.detail.planet, location.search) : null;
      if (next) {
        try { sessionStorage.setItem(KEY, JSON.stringify(e.detail)); } catch { /* 저장이 막혀 있으면 이름 없이 */ }
        location.href = location.pathname + next;
        return;
      }
      frame.remove();
      onDone();
    }, { once: true });
    inner.focus();
  }, { once: true });
  document.body.append(frame);
}
