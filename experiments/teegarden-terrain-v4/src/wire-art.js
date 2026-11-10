// 화면의 1비트 망점 그림: 이동 화면 풍경·로켓, 브리핑 풍경·ORI, 오른쪽 칸 행성. 별은 고정, 씨앗 고정(Math.random 없음).
// 글과 진행 표시는 intro.js 가 그대로 움직이고, 여기서는 그림만 바꾼다. 3D 점(공통 점 셰이더)과는 상관없다.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
const CREAM = [220, 230, 255]; // 망점 밝은 쪽 색: 본문색 #DCE6FF (이름은 예전 그대로)
const threshold = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];
function seeded(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function noiseField(seed) {
  const random = seeded(seed), table = Float32Array.from({ length: 4096 }, random);
  const at = (x, y) => table[(Math.imul(x, 57) + Math.imul(y, 131)) & 4095];
  const smooth = t => t * t * (3 - 2 * t);
  const layer = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
    return (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
  };
  return (x, y) => layer(x, y) * 0.5 + layer(x * 2.1, y * 2.1) * 0.3 + layer(x * 4.4, y * 4.4) * 0.2;
}
function plot(canvas, width, height, shade) {
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d'), image = context.createImageData(width, height);
  for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i += 4) {
    const value = shade(x, y);
    if (value == null) continue;
    const lit = value > threshold(x, y);
    image.data[i] = lit ? CREAM[0] : 0; image.data[i + 1] = lit ? CREAM[1] : 0; image.data[i + 2] = lit ? CREAM[2] : 0; image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

/** 조석 고정 행성: 빛이 옆에서 들어 어두운 쪽이 깊게 잠긴다 */
function planetShade(cx, cy, radius, noise, light = [0.74, -0.34, 0.58], night = 0) {
  return (x, y) => {
    const nx = (x - cx) / radius, ny = (y - cy) / radius, d = nx * nx + ny * ny;
    if (d > 1) return null;
    const nz = Math.sqrt(1 - d), lambert = Math.max(0, nx * light[0] + ny * light[1] + nz * light[2]);
    const surface = noise(nx * 2.4 / (nz + 0.5) + 5, ny * 5 / (nz + 0.5) + 2);
    const streak = surface > 0.53 ? 1.5 : 0.5 + surface * 0.5;
    return lambert ** 1.5 * 1.3 * streak + night * streak * nz; // night: 밤 쪽에도 윤곽이 보이게 남기는 희미한 빛
  };
}

const TRAVEL_FLARES = [[0.09, 0.32, 16], [0.42, 0.16, 12], [0.61, 0.5, 18], [0.33, 0.56, 10], [0.92, 0.6, 12]];
/** 사각형 [x0, y0, x1, y1] 안은 0, 밖으로 feather 만큼 가며 1 이 되는 값 (별을 부드럽게 치울 때) */
function clearMask(rects) {
  // floor: 가운데에도 남기는 별 비율 (0 이면 다 치운다). 가장자리는 smoothstep 으로 천천히 돌아온다
  return (x, y) => rects.reduce((keep, [x0, y0, x1, y1, feather, floor = 0]) => {
    const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1);
    const t = Math.min(1, Math.hypot(dx, dy) / feather), ease = t * t * (3 - 2 * t);
    return Math.min(keep, floor + (1 - floor) * ease);
  }, 1);
}
// frame: 행성 둘레 네모 칸(강의 표시 배경)의 여백, 반지름 배수 [왼, 위, 오른, 아래]. 칸 안과 clear 사각형(화면 비율) 안의 별을 치운다
function drawScene(canvas, cssWidth, cssHeight, { planetAt = [0.79, 0.27, 0.2], horizon = 0.8, flares = TRAVEL_FLARES, seed = 77, light, night = 0, clear = [], frame } = {}) {
  const width = Math.ceil(cssWidth / 2), height = Math.ceil(cssHeight / 2), random = seeded(seed), speck = noiseField(31), rock = noiseField(53), clouds = noiseField(7);
  const lit = new Uint8Array(width * height);
  const pr = Math.min(width, height) * planetAt[2], pcx = width * planetAt[0], pcy = height * planetAt[1];
  const box = frame && [Math.max(2, pcx - frame[0] * pr), Math.max(2, pcy - frame[1] * pr), Math.min(width - 2, pcx + frame[2] * pr), Math.min(height - 2, pcy + frame[3] * pr)].map(Math.round);
  const keep = clearMask([...clear.map(([x0, y0, x1, y1, f, floor]) => [x0 * width, y0 * height, x1 * width, y1 * height, f * width, floor]), ...(box ? [[...box, 3]] : [])]);
  // 잔별: 조밀한 모래 같은 점
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const density = (0.012 + 0.05 * Math.max(0, speck(x / 60, y / 60) - 0.42)) * keep(x, y);
    if (random() < density) lit[y * width + x] = 1;
  }
  // 큰 별: 십자 빛줄기
  const flare = (cx, cy, reach) => {
    for (let i = -reach; i <= reach; i++) {
      if (Math.abs(i) > 2 && (Math.abs(i) & 1)) continue;
      [[cx + i, cy], [cx, cy + i]].forEach(([x, y]) => { if (x >= 0 && y >= 0 && x < width && y < height) lit[y * width + x] = 1; });
    }
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) lit[(cy + dy) * width + cx + dx] = 1;
  };
  // 큰 별은 빛줄기 끝까지 치운 자리(글·행성 칸) 밖에 있을 때만 그린다
  flares.forEach(([u, v, reach]) => {
    const x = u * width, y = v * height;
    if ([[x, y], [x - reach, y], [x + reach, y], [x, y - reach], [x, y + reach]].every(([px, py]) => keep(px, py) > 0.9)) flare(Math.round(x), Math.round(y), reach);
  });

  const planet = planetShade(width * planetAt[0], height * planetAt[1], Math.min(width, height) * planetAt[2], clouds, light, night);
  canvas.dataset.planet = [pcx, pcy, pr].join(','); // 강의 그림 표시(planet-brief.js)가 읽는다
  if (box) canvas.dataset.frame = box.join(',');
  // 앞쪽 위성 표면: 화면 아래에 걸린 큰 호
  const R = width * 1.15, gx = width * 0.42, gy = height * horizon + R;
  const craters = [];
  for (let i = 0; i < 30; i++) {
    const cx = random() * width * 1.1 - width * 0.05, t = random() ** 0.7, base = gy - Math.sqrt(Math.max(0, R * R - (cx - gx) ** 2));
    const cy = base + 6 + t * (height - base), size = (5 + random() ** 2.6 * 42) * (0.55 + t * 0.8);
    craters.push({ cx, cy, rx: size, ry: size * (0.3 + t * 0.32) });
  }
  plot(canvas, width, height, (x, y) => {
    const fromCentre = Math.hypot(x - gx, y - gy);
    if (fromCentre < R) {
      const depth = Math.min(1, (R - fromCentre) / (height * 0.26));
      let value = 0.22 + rock(x / 26, y / 9) * 0.62 + (rock(x / 5, y / 2.4) - 0.5) * 0.3;
      for (const c of craters) {
        const nx = (x - c.cx) / c.rx, ny = (y - c.cy) / c.ry, d = Math.hypot(nx, ny);
        if (d > 1.16) continue;
        if (d < 0.92) value = 0.44 + nx * 0.34 + (d < 0.28 ? 0.1 : 0); // 안쪽: 왼쪽이 그늘
        else value = d < 1 ? (nx < 0 ? 0.98 : 0.1) : Math.min(value, nx < 0 ? 1 : 0.2) + (nx < 0 ? 0.2 : 0);
      }
      return value * (0.62 + depth * 0.5);
    }
    const body = planet(x, y);
    if (body != null) return body;
    return lit[y * width + x];
  });
}

/** 로켓: 또렷한 윤곽선 위주. 그늘만 망점으로 얹는다 */
function drawShip(canvas) {
  const width = 255, height = 126, source = document.createElement('canvas');
  source.width = width; source.height = height;
  const c = source.getContext('2d');
  c.translate(132, 66); c.scale(1.5, 1.5); c.rotate(-0.1);
  const shaded = (top, bottom) => {
    const g = c.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, '#060606'); g.addColorStop(0.24, '#5c5c5c'); g.addColorStop(0.38, '#a8a8a8'); g.addColorStop(0.6, '#2c2c2c'); g.addColorStop(1, '#000');
    return g;
  };
  const shape = (points, fill) => {
    c.fillStyle = fill; c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 0.8; c.stroke();
  };
  const seam = (x, top, bottom) => { c.strokeStyle = '#fff'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke(); };
  const body = (left, right, half) => shape([[left, -half], [right, -half], [right, half], [left, half]], shaded(-half, half));
  // 배기 불꽃
  const flame = c.createLinearGradient(-88, 0, -46, 0);
  flame.addColorStop(0, 'rgba(255,255,255,0)'); flame.addColorStop(0.5, '#808080'); flame.addColorStop(1, '#fff');
  c.fillStyle = flame; c.beginPath(); c.moveTo(-46, -9); c.quadraticCurveTo(-66, -12, -88, 0); c.quadraticCurveTo(-66, 12, -46, 9); c.closePath(); c.fill();
  // 꼬리날개
  [-1, 1].forEach(side => shape([[-36, 9 * side], [-20, 9 * side], [-40, 24 * side], [-50, 24 * side]], '#101010'));
  // 보조 추진기
  [-1, 1].forEach(side => {
    const top = side < 0 ? -16 : 7, bottom = top + 9, middle = top + 4.5;
    shape([[-42, top], [-2, top], [9, middle], [-2, bottom], [-42, bottom]], shaded(top, bottom));
    shape([[-42, top + 1], [-47, top - 1], [-47, bottom + 1], [-42, bottom - 1]], '#000');
    [-28, -14].forEach(x => seam(x, top, bottom));
  });
  // 1단 · 단 연결부 · 2단 · 덮개
  body(-42, 12, 10);
  shape([[12, -10], [18, -7], [18, 7], [12, 10]], '#000');
  body(18, 44, 7);
  shape([[44, -7], [50, -10], [60, -10], [72, -6], [82, 0], [72, 6], [60, 10], [50, 10], [44, 7]], shaded(-10, 10));
  seam(50, -10, 10); seam(60, -10, 10);
  [-28, -14, 0].forEach(x => seam(x, -10, 10));
  seam(31, -7, 7);
  // 몸통 눈금 띠
  c.fillStyle = '#fff';
  for (let x = -40; x < 10; x += 6) c.fillRect(x, 3, 3, 1.2);
  shape([[-42, -7], [-49, -10], [-49, 10], [-42, 7]], '#000');
  c.resetTransform();
  const { data } = c.getImageData(0, 0, width, height);
  plot(canvas, width, height, (x, y) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 70) return null;
    const value = (data[i] / 255) * (data[i + 3] / 255);
    return value > 0.72 ? 1 : value < 0.07 ? 0 : value * 0.8; // 선은 끊기지 않게, 그늘만 망점
  });
}

/** ORI: 모양은 원본 그대로. 한쪽 빛과 망점, 윤곽선으로 다시 찍는다 */
function ditherRobot(image) {
  const width = 124, height = Math.round(width * image.naturalHeight / image.naturalWidth), source = document.createElement('canvas');
  source.width = width; source.height = height;
  const context = source.getContext('2d');
  context.drawImage(image, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  const solid = (x, y) => x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3] >= 128;
  const canvas = document.createElement('canvas');
  canvas.className = image.className; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', image.alt);
  plot(canvas, width, height, (x, y) => {
    if (!solid(x, y)) return null;
    if (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1)) return 1;
    const i = (y * width + x) * 4, value = (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11) / 255;
    return Math.max(0, value - 0.22) ** 1.7 * (1.5 - 1.1 * x / width);
  });
  image.replaceWith(canvas);
}

const screen = document.querySelector('#intro-travel');
const scene = document.createElement('canvas');
scene.className = 'scene'; scene.setAttribute('aria-hidden', 'true');
screen.prepend(scene);
const briefScene = document.createElement('canvas');
briefScene.className = 'scene'; briefScene.setAttribute('aria-hidden', 'true');
document.querySelector('.brief-view').prepend(briefScene);
const paintAll = () => {
  if (innerWidth < 100 || innerHeight < 100) return; // 창 크기가 아직 0이면 다음 크기 변경 때 그린다
  drawScene(scene, innerWidth, innerHeight);
  drawScene(briefScene, innerWidth - 56, Math.max(320, innerHeight - 310), {
    planetAt: [0.78, 0.49, 0.24], horizon: 0.8, flares: [[0.47, 0.08, 12]], seed: 91, light: [-1, 0, 0], // 큰 별은 로봇·행성 칸과 겹쳐 앞에 나와 보이지 않게 위쪽 가운데 하나만
    // ORI 말풍선 글 뒤 별을 티 나지 않게 듬성하게 (가운데도 35%는 남기고 가장자리로 천천히 돌아온다) (넓은 화면은 로봇 오른쪽, 좁은 화면은 아래쪽)
    clear: innerWidth > 1100 ? [[0.31, 0.26, 0.5, 0.46, 0.14, 0.35]] : [[0.1, 0.62, 0.9, 0.74, 0.12, 0.35]],
    frame: [1.75, 1.32, 1.9, 1.55],
  });
  // 브리핑 행성은 조석 고정: 별이 왼쪽에 있어 왼쪽 절반이 낮, 오른쪽 절반이 밤이다
  briefScene.dispatchEvent(new Event('painted'));
};
paintAll();
addEventListener('resize', paintAll);

const robot = document.querySelector('.robot');
const convertRobot = () => { try { ditherRobot(robot); } catch { /* 파일로 직접 열면 흑백 이미지로 남는다 */ } };
if (robot.complete) convertRobot(); else robot.addEventListener('load', convertRobot, { once: true });

// 오른쪽 칸의 공 그림
const globe = document.createElement('canvas');
plot(globe, 56, 56, planetShade(28, 28, 27.5, noiseField(7)));
document.querySelector('.globe div').replaceChildren(globe);

const ship = document.createElement('canvas');
ship.setAttribute('role', 'img'); ship.setAttribute('aria-label', '로켓');
document.querySelector('#travel-rocket').replaceChildren(ship);
drawShip(ship);

// 양 끝 지구·행성도 같은 망점 구로 바꾼다
const spheres = [[11, [0.7, -0.5, 0.52]], [7, [0.74, -0.34, 0.58]]];
screen.querySelectorAll('.end svg').forEach((svg, i) => {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', svg.getAttribute('aria-label'));
  plot(canvas, 40, 40, planetShade(20, 20, 19.5, noiseField(spheres[i][0]), spheres[i][1]));
  svg.replaceWith(canvas);
});
