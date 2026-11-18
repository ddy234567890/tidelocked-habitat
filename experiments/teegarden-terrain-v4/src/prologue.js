// 프롤로그 접속 화면 (public/web/prologue-access.html, README_연결방법.md 를 따른다).
// 게임을 열면 맨 처음 이 화면을 게임 위에 iframe 으로 띄운다 (로그인 → 행성 선택).
// 접속 화면은 열리면 바로 로그인부터 시작하고(안에 video[data-prologue] 가 없으므로),
// 목적지 확정 때 prologue:done { name, planet } 을 보낸다 → 닫고 onDone (로켓 이동 화면 → 1주차 브리핑).
// 이름·행성은 window.prologue 에 남기고, 게임 쪽 window 에도 같은 prologue:done 을 다시 보낸다.
// 주소 뒤 ?prologue=0 이면 접속 화면 없이 바로 넘어간다.
export function openPrologue(onDone) {
  if (new URLSearchParams(window.startParams ?? location.search).get('prologue') === '0') return onDone();
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
      frame.remove();
      onDone();
    }, { once: true });
    inner.focus();
  }, { once: true });
  document.body.append(frame);
}
