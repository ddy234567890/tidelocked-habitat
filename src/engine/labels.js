import * as THREE from 'three';

/**
 * 3D 위치에 붙는 HUD 라벨 (카드 e07)
 *
 * 'SITE B · 지하' 같은 HTML 라벨을 3D 좌표에 붙인다. 매 프레임 화면 좌표로 옮기고,
 * 지점에서 라벨까지 가는 지시선을 그린다. 지점이 카메라 뒤나 화면 밖으로 가면 숨긴다.
 * 스타일은 게임 UI와 같은 남색 패널 + 얇은 테두리 (색은 CLAUDE.md 화면 색 토큰).
 *
 * 사용법:
 *   import { createLabels } from './engine/labels.js';
 *
 *   const labels = createLabels(camera, renderer.domElement);
 *   const tag = labels.add({ position: [0, 0.5, 0], text: 'SITE B · 지하' });
 *   labels.add({ position: [1.6, 0.3, 0.9], text: '산소 장치', variant: 'amber', offset: [-60, -30] });
 *
 *   tag.setText('SITE A · 평지');
 *   tag.setPosition([0, 0.8, 0]);
 *   tag.remove();
 *
 *   // 매 프레임 (카메라를 움직인 뒤, 렌더 직전)
 *   labels.update();
 *
 * add() 옵션
 *   position  [x, y, z] 월드 좌표 (필수)
 *   text      라벨 글자
 *   variant   'cream' (기본: 크림 테두리 + 흰 글자) | 'amber' (두 번째 표시: 주황 테두리 + 주황 글자)
 *   offset    [x, y] 지점에서 라벨까지 화면 픽셀 거리 (기본 [40, -36], 오른쪽 위)
 */

const STYLE = `
.hud-labels { position: fixed; pointer-events: none; overflow: hidden; }
.hud-labels svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.hud-labels line { stroke-width: 1; }
.hud-labels circle { stroke: none; }
.hud-label {
  position: absolute; left: 0; top: 0; white-space: nowrap;
  font: 13px/1 system-ui, sans-serif; letter-spacing: 0.04em;
  padding: 6px 9px; border: 1px solid; border-radius: 2px;
  background: rgb(10 20 52 / 0.85);
}
.hud-label.cream { color: #fff; border-color: #E8DFC8; }
.hud-label.amber { color: #F2B84B; border-color: #F2B84B; }
`;
const LINE_COLOR = { cream: '#E8DFC8', amber: '#F2B84B' };

/**
 * @param {THREE.Camera} camera
 * @param {HTMLElement} canvas  라벨을 겹쳐 놓을 캔버스 (보통 renderer.domElement)
 */
export function createLabels(camera, canvas) {
  if (!document.getElementById('hud-label-style')) {
    const style = document.createElement('style');
    style.id = 'hud-label-style';
    style.textContent = STYLE;
    document.head.append(style);
  }

  const layer = document.createElement('div');
  layer.className = 'hud-labels';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  layer.append(svg);
  canvas.after(layer);

  const items = new Set();
  const v = new THREE.Vector3();

  function add({ position, text = '', variant = 'cream', offset = [40, -36] }) {
    const world = new THREE.Vector3().fromArray(position);
    const el = document.createElement('div');
    el.className = `hud-label ${variant}`;
    el.textContent = text;
    layer.append(el);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    line.setAttribute('stroke', LINE_COLOR[variant]);
    dot.setAttribute('fill', LINE_COLOR[variant]);
    dot.setAttribute('r', '2.5');
    svg.append(line, dot);

    const item = { world, offset, el, line, dot };
    items.add(item);

    return {
      setText(t) {
        el.textContent = t;
      },
      setPosition(p) {
        world.fromArray(p);
      },
      remove() {
        items.delete(item);
        el.remove();
        line.remove();
        dot.remove();
      },
    };
  }

  /** 매 프레임 부른다 */
  function update() {
    const rect = canvas.getBoundingClientRect();
    Object.assign(layer.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });

    for (const { world, offset, el, line, dot } of items) {
      v.copy(world).project(camera);
      // 카메라 뒤(z > 1)거나 화면 밖이면 숨긴다
      const visible = v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
      for (const node of [el, line, dot]) node.style.display = visible ? '' : 'none';
      if (!visible) continue;

      const x = (v.x * 0.5 + 0.5) * rect.width;
      const y = (-v.y * 0.5 + 0.5) * rect.height;
      const lx = x + offset[0];
      const ly = y + offset[1];
      // 라벨은 지시선 끝에 붙인다: 오른쪽으로 뻗으면 라벨 왼쪽 끝이, 왼쪽으로 뻗으면 오른쪽 끝이 닿는다
      const shiftX = offset[0] >= 0 ? 0 : -el.offsetWidth;
      el.style.transform = `translate(${lx + shiftX}px, ${ly - el.offsetHeight / 2}px)`;
      line.setAttribute('x1', x);
      line.setAttribute('y1', y);
      line.setAttribute('x2', lx);
      line.setAttribute('y2', ly);
      dot.setAttribute('cx', x);
      dot.setAttribute('cy', y);
    }
  }

  function dispose() {
    for (const item of [...items]) item.el.remove();
    items.clear();
    layer.remove();
  }

  return { add, update, dispose };
}
