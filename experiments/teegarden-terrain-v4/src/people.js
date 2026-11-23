// 사람 배치 실험: 지역 화면에서 사람을 한 명씩 놓거나, 원 하나에 3~4명씩 무리로 놓는다.
// 사람은 뼈대(스켈레톤)와 동작이 있는 사람 모델(src/models/human.glb, Quaternius Universal Animation Library, CC0)을
// 촘촘한 점으로 그린다: 모델 겉면에서 고르게 뽑은 점을 매 화면 뼈대 움직임에 맞춰 옮긴다 (src/pointRig.js, 장면과 같은 머티리얼 하나).
// 사람은 걷고, 집에 드나들 때 문을 열고, 바깥에서 일하고, 이야기한다.
// 서 있는 자리의 환경과 지금 하는 행동(뛰면 숨이 더 차고 더 더워짐)에 따라 몸 상태가 바뀌고 (src/peopleSim.js),
// 사람마다 버티는 힘·알아채는 때가 달라 같은 곳에 여럿을 놓아도 저마다 다르게 반응한다:
//   숨이 막히거나 더우면 움찔 → 집으로 후다닥 뛰어감(문은 서둘러 염) → 거의 쓰러질 지경이면 기어감 → 쓰러짐.
//   쓰러진 사람이 있으면 근처의 괜찮은 사람이 달려가 옆에 무릎 꿇고 돌본다. 환경이 나아지면 숨을 고르고 다시 일어난다.
// 색은 palette.js 함수로만, 무작위는 mulberry32 (Math.random 금지).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mulberry32 } from './terrain.js';
import { floorAt, WEEKS } from './choices.js';
import { blueStep, cream, orange } from './palette.js';
import { Person, placeOf, envFor, STATUS_NAMES, ACT_MET, INDOOR } from './peopleSim.js';
import { prepareRig, createSkinner } from './pointRig.js';
import { GAME } from './face/physiology.js';
import humanUrl from './models/human.glb';
import './people.css';

const HEIGHT = 0.5;         // 사람 키 (지역 단위). 통로 한 칸 1.2 ≈ 3 m 로 치면 약 1.6~1.8 m (2026-11-14 사용자: 0.9 는 너무 커서 줄임)
const SAMPLES = 4000;        // 사람 한 명의 점 수 (모델 겉면에서 넓이에 고르게)
const WEIGHT = 0.2;          // 선 점 비율 (0 = 지형 점 크기, 1 = 건물 선 점처럼 가늘게)
const GLOW = 0.3;           // 점 하나의 밝기. 점이 촘촘해 겹쳐 더해지므로 낮게 둬야 파랑·주황이 하얗게 타지 않는다
const RING = 0.19;           // 발밑 고리 반지름: 멀리서도 사람 자리를 찾게 한다
const GROUP_R = 0.8;         // 무리로 놓을 때 원 반지름
const MAX_PEOPLE = 30;
const CREW = 10;            // 지역에 들어가면 처음부터 대원 10명이 있다 (2026-11-18 사용자: 10명 고정, 더하기·치우기 단추 없음)
const CREW_R = [1.6, 3.6];
// 우주복 (2026-11-23 사용자: 바깥 산소 14% 에 맨몸으로 다니는 건 이상하다 → 바깥에선 모두 우주복, 위치마다 버티는 시간이 다르다).
// 바깥에 나간 사람은 우주복 덕에 처음엔 집 안과 같은 환경(INDOOR)을 겪고, 바깥에 있는 시간만큼 우주복이 한계에 가까워져
// 바깥 환경이 서서히 몸에 닿는다: 바깥에 있은 시간 ÷ (SUIT_TIME[지대] × 버티는 힘) 만큼 실내 값 → 바깥 값으로 바뀐다.
//   평원 20초: 60°C 라 냉각이 금방 한계 → 10초쯤 힘들어하고 15초쯤부터 쓰러진다
//   능선 40초: 덜 더워서 천천히, 힘들어하기만 한다 / 동굴: 바위가 열을 막아 한계 없음 (null)
// 집 안에 들어가면 우주복이 다시 채워진다 (바깥에 있던 시간이 SUIT_RECHARGE 배 빠르게 줄어든다)
const SUIT_TIME = { plain: 20, ridge: 40, lavaTube: null };
const SUIT_RECHARGE = 2;
// 대원마다 기본 표정 (얼굴 모델은 하나라서 눈썹·눈·입꼬리 기본값으로 사람을 구별한다)
const FACES = [
  { weights: { browDownLeft: 0.25, browDownRight: 0.25, mouthPressLeft: 0.3, mouthPressRight: 0.3 } },
  { weights: { browOuterUpLeft: 0.35, eyeSquintRight: 0.2, mouthSmileLeft: 0.15 } },
  { weights: { mouthSmileLeft: 0.35, mouthSmileRight: 0.35, cheekSquintLeft: 0.2, cheekSquintRight: 0.2 } },
  { weights: { browInnerUp: 0.3, eyeWideLeft: 0.15, eyeWideRight: 0.15 } },
  { weights: { eyeSquintLeft: 0.35, eyeSquintRight: 0.35, mouthStretchLeft: 0.15 } },
  { weights: { mouthFrownLeft: 0.3, mouthFrownRight: 0.3, browInnerUp: 0.15 } },
  { weights: { mouthDimpleLeft: 0.3, mouthDimpleRight: 0.3, browOuterUpRight: 0.25 } },
  { weights: { noseSneerLeft: 0.2, browDownLeft: 0.3, mouthPressRight: 0.25 } },
  { weights: { mouthSmileRight: 0.3, eyeWideLeft: 0.2, browOuterUpLeft: 0.2 } },
  { weights: { eyeSquintLeft: 0.2, mouthFrownRight: 0.2, browDownRight: 0.25 } },
];   // 대원들이 처음 서는 거리 (기지 가운데에서)
const LIMIT = 14;            // 이 범위(|x|, |z|) 안에서만 놓고 걷는다
const SPEED = { walk: 0.7, run: 1.9, sprint: 2.6, crawl: 0.32, carry: 0.5 };   // 지역 단위/초 (걷기 약 1.4 m/s)
const TIRED_PACE = 0.6;      // 힘들 때 걸음 배율
const WANDER = 1.3;          // 처음 놓인 자리에서 이만큼 안에서 돌아다닌다
const HELP_RANGE = 4;        // 쓰러진 사람을 보고 도우러 가는 거리
const FIT = [0.6, 1.9];      // 버티는 힘 범위 (사람마다 다르게)
const FADE = 0.25;           // 동작 사이 섞는 시간 (초)
const ACT_NAMES = { idle: '서 있음', talk: '이야기하는 중', walk: '걷는 중', home: '집으로 가는 중', out: '밖으로 나가는 중', door: '문 여는 중', work: '일하는 중', rest: '숨 고르는 중', flinch: '숨이 막혀 움찔', run: '집으로 뛰어가는 중', sprint: '집으로 전력 질주', crawl: '기어서 피하는 중', help: '쓰러진 사람을 돌보는 중', carry: '쓰러진 사람을 부축해 데려가는 중', carried: '부축받는 중', shove: '밀치고 먼저 가는 중', shoved: '밀려서 휘청', down: '쓰러짐', getup: '일어나는 중', tend: '장치 손보러 가는 중', fix: '장치 고치는 중', operate: '장치 다루는 중', inspect: '새로 세운 장치를 보러 가는 중', look: '새 장치 살펴보는 중', movein: '새 집에 들어가 보는 중' };
const DEVICE_ACTS = new Set(['tend', 'fix', 'operate', 'inspect', 'look']);
const INSPECT_RANGE = 8;     // 새 장치가 세워지면 이 거리 안의 사람이 보러 간다
const INSPECT_MAX = 3;       // 새 장치 하나를 보러 가는 사람 수
// 선지 id → 장치 이름 (그 장치를 세운 선지 이름)
const DEVICE_NAMES = new Map(WEEKS.flatMap(w => w.steps.flatMap(st => st.choices.flatMap(c => (c.overlays ?? []).map(id => [id, c.label])))));
const MOVE_CLIP = { walk: 'Walk_Loop', home: 'Walk_Loop', out: 'Walk_Loop', run: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop', crawl: 'Crouch_Fwd_Loop', help: 'Jog_Fwd_Loop', carry: 'Walk_Loop', tend: 'Walk_Loop', inspect: 'Walk_Loop', movein: 'Walk_Loop' };
const SCARED = 30;           // 바깥에서 힘들었던 사람이 다시 밖에 나가지 않는 시간 (초)
const SELFISH = 0.35;        // 급한 성격(길을 막으면 밀치고 먼저 감)인 사람의 비율
const moveSpeed = act => SPEED[act] ?? SPEED.walk;

function ringData(r, c, n = 32) {
  const pts = [], cols = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push(Math.cos(a) * r, 0.02, Math.sin(a) * r); cols.push(...c); }
  return { positions: new Float32Array(pts), colors: new Float32Array(cols) };
}

export function createPeople({ host, camera, parent, material, geometryFrom, getState }) {
  const group = new THREE.Group(); parent.add(group);
  const people = [];
  let mode = null, site = null, seed = 91821, acc = 0, last = null, model = null;
  const rand = () => mulberry32(seed++)();

  // ---- 화면 단추 · 정보창 ----
  const box = host.parentElement;
  const tools = document.createElement('div');
  tools.className = 'pp-tools pp-loading'; tools.hidden = true;
  tools.innerHTML = `<div class="pp-row"><button type="button" data-mode="one" aria-pressed="false" disabled>＋ 한 명</button><button type="button" data-mode="group" aria-pressed="false" disabled>◎ 무리 3–4명</button><button type="button" class="pp-clear" disabled>치우기</button></div>
    <p class="pp-count" aria-live="polite">사람 모델을 불러오는 중…</p>`;
  const tip = document.createElement('div');
  tip.className = 'past-tip pp-tip'; tip.hidden = true; tip.setAttribute('role', 'status');
  box.append(tools, tip);
  tools.querySelector('.pp-row').hidden = true;   // 10명 고정: 더하기·치우기 단추는 숨긴다
  let focused = null;   // 마우스를 올린(또는 가장 최근에 올렸던) 대원 = 왼쪽 아래 얼굴의 주인
  // 이름표: 얼굴로 보고 있는 대원의 머리 위에 늘 떠 있다
  const tag = document.createElement('div'); tag.className = 'pp-tag'; tag.hidden = true; tag.setAttribute('aria-hidden', 'true'); box.append(tag);
  // hover = 마우스를 올려서 바뀐 것 (이때만 얼굴 창까지 선을 잇고 신호 전환 효과를 낸다)
  // 지금 마우스가 대원 위에 있는지: 바뀔 때만 알린다 (얼굴 창은 위에 있을 때 밝게, 떼면 흐리게)
  let hovering = false, pinned = null;   // pinned = 눌러서 고른 대원: 마우스를 떼도 얼굴이 이 사람에게 돌아온다
  function setHover(on) {
    if (on === hovering) return; hovering = on;
    box.classList.toggle('pp-on-person', on);   // 사람 위에서는 건물·장치(에셋) 정보창을 숨긴다 (people.css)
    if (!on && pinned && focused !== pinned) focus(pinned);   // 다른 사람을 잠깐 보고 떼면 고른 사람에게 돌아온다
    dispatchEvent(new CustomEvent('crew-hover', { detail: { on } }));
  }
  function pin(p) {
    pinned = p; focus(p, true);
    tag.classList.toggle('pp-pinned', Boolean(p));
    dispatchEvent(new CustomEvent('crew-pin', { detail: { person: p } }));
  }
  function focus(p, hover = false) {
    if (p === focused) return; focused = p;
    if (p) tag.innerHTML = `<b>${p.name}</b>`;
    tag.classList.toggle('pp-pinned', Boolean(p) && p === pinned);
    dispatchEvent(new CustomEvent('crew-focus', { detail: { person: p, at: hover && p ? screenOf(p) : null } }));
  }
  const modeButtons = [...tools.querySelectorAll('[data-mode]')];
  function setMode(next) {
    mode = next;
    for (const b of modeButtons) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    host.classList.toggle('pp-placing', Boolean(mode));
    if (mode !== 'group') preview.visible = false;
  }
  for (const b of modeButtons) b.addEventListener('click', () => setMode(mode === b.dataset.mode ? null : b.dataset.mode));
  tools.querySelector('.pp-clear').addEventListener('click', clear);
  addEventListener('keydown', e => { if (e.key === 'Escape' && mode) setMode(null); });

  // ---- 모델 불러오기: 겉면 점 자리를 고르고, 상태마다 점 색을 미리 만든다 ----
  const RINGS = { pick: geometryFrom(ringData(RING * 1.6, cream(1), 48), WEIGHT), focus: geometryFrom(ringData(RING * 1.25, cream(1)), WEIGHT), ok: geometryFrom(ringData(RING, blueStep(0.6)), WEIGHT), tired: geometryFrom(ringData(RING, orange(0.7)), WEIGHT), down: geometryFrom(ringData(RING, orange(1)), WEIGHT) };
  const preview = new THREE.Points(geometryFrom(ringData(GROUP_R, cream(0.9), 64), WEIGHT), material);
  preview.visible = false; group.add(preview);
  new GLTFLoader().load(humanUrl, gltf => {
    const prep = prepareRig(gltf.scene, { samples: SAMPLES });
    // 색: 몸은 밝은 파랑 단계(위를 향한 면일수록 밝게), 머리·손 끝처럼 높은 곳은 크림.
    // 힘들 때는 머리가 주황이고 몸이 주황으로 깜빡, 쓰러지면 모두 주황. 점이 촘촘해 겹쳐 밝아지므로 점 하나는 조금 어둡게 둔다
    const colorsFor = state => {
      const out = new Float32Array(SAMPLES * 3);
      for (let k = 0; k < SAMPLES; k++) {
        const h = (prep.restY[k] - prep.bottom) / prep.height, lit = 0.5 + 0.5 * Math.max(0, prep.normalY[k]);
        const head = h > 0.86;
        const col = state === 'pick' ? (head ? cream(1) : cream(0.45 + 0.5 * lit))
          : state === 'down' ? orange(0.6 + 0.4 * lit)
          : state === 'blink' ? orange(0.5 + 0.5 * lit)
          : head ? (state === 'tired' ? orange(1) : cream(0.9)) : blueStep(0.5 + 0.45 * lit);
        out.set(col.map(c => c * GLOW), k * 3);
      }
      return out;
    };
    const blank = new Float32Array(SAMPLES * 3);
    const tones = Object.fromEntries(['ok', 'tired', 'blink', 'down', 'pick'].map(s => [s, geometryFrom({ positions: blank, colors: colorsFor(s) }).getAttribute('color').array]));
    model = { scene: gltf.scene, prep, clips: gltf.animations, scale: HEIGHT / prep.height, tones };
    tools.classList.remove('pp-loading');
    for (const b of tools.querySelectorAll('button')) b.disabled = false;
    count();
  }, undefined, error => { tools.querySelector('.pp-count').textContent = '사람 모델을 불러오지 못했어요'; console.error(error); });

  // ---- 사람 더하기 · 빼기 ----
  function add(x, z) {
    if (!model || people.length >= MAX_PEOPLE || Math.abs(x) > LIMIT || Math.abs(z) > LIMIT) return null;
    const p = new Person(x, z, { fit: FIT[0] + rand() * (FIT[1] - FIT[0]) });
    const rig = cloneSkinned(model.scene);
    const mixer = new THREE.AnimationMixer(rig);
    const geometry = geometryFrom({ positions: new Float32Array(SAMPLES * 3), colors: new Float32Array(SAMPLES * 3) }, WEIGHT);
    geometry.getAttribute('position').setUsage(THREE.DynamicDrawUsage);
    const points = new THREE.Points(geometry, material); points.frustumCulled = false;
    points.scale.setScalar(model.scale); points.position.y = -model.prep.bottom * model.scale;
    const mark = new THREE.Points(RINGS.ok, material);
    const holder = new THREE.Group(); holder.add(points, mark); group.add(holder);
    p.anchor = { x, z };   // 처음 놓인 자리: 이 둘레를 돌아다닌다
    p.pace = 0.9 + rand() * 0.2;   // 걸음 빠르기도 조금씩 다르게
    p.view = { holder, points, mark, rig, mixer, skin: createSkinner(rig, model.prep), action: null, tone: null, heading: rand() * Math.PI * 2, phase: rand() * 10 };
    p.act = 'idle'; p.timer = 0.5 + rand() * 2; p.target = null; p.notice = null; p.helping = null;
    p.selfish = rand() < SELFISH; p.carrying = null; p.carriedBy = null; p.pause = null; p.knock = null;
    p.name = `대원 ${String(people.length + 1).padStart(2, '0')}`;
    p.face = FACES[people.length % FACES.length];
    play(p, 'Idle_Loop');
    people.push(p); count();
    return p;
  }
  function remove(p) {
    if (p.carrying) dropCarry(p);
    if (p.carriedBy) { p.carriedBy.carrying = null; p.carriedBy.target = null; p.carriedBy.timer = 0; }
    for (const o of people) if (o.helping === p) { o.helping = null; o.target = null; o.timer = 0; }
    group.remove(p.view.holder); p.view.points.geometry.dispose(); p.view.mixer.stopAllAction();
    people.splice(people.indexOf(p), 1); count();
    if (pinned === p) pinned = null;
    if (focused === p) focus(people[0] ?? null);
  }
  function clear() { while (people.length) remove(people[0]); hideTip(); }
  // 무리: 원 안에 3~4명을 서로 조금 떨어뜨려 놓는다
  function addGroup(cx, cz) {
    const n = 3 + (rand() < 0.5 ? 1 : 0), spots = [];
    for (let tries = 0; spots.length < n && tries < 60; tries++) {
      const a = rand() * Math.PI * 2, d = GROUP_R * 0.85 * Math.sqrt(rand());
      const s = { x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d };
      if (spots.every(o => Math.hypot(o.x - s.x, o.z - s.z) > 0.3)) spots.push(s);
    }
    return spots.map(s => add(s.x, s.z)).filter(Boolean);
  }
  // 지역에 들어가면 대원 10명을 기지 둘레에 고르게 세운다 (자리는 고정 씨앗으로 매번 같다)
  function spawnCrew(homes) {
    const r = mulberry32(4242);
    for (let i = 0; i < CREW; i++) {
      // 기지가 있으면 집 안에 나눠 세운다. 기지가 없으면 가운데 둘레에 (바깥에선 우주복이 SUIT_TIME 만큼 버틴다)
      const h = homes[i % homes.length];
      if (h) { const a = r() * Math.PI * 2, d = h.r * 0.7 * Math.sqrt(r()); add(h.at[0] + Math.cos(a) * d, h.at[2] + Math.sin(a) * d); continue; }
      const a = i / CREW * Math.PI * 2 + (r() - 0.5) * 0.5, d = CREW_R[0] + r() * (CREW_R[1] - CREW_R[0]);
      add(Math.cos(a) * d, Math.sin(a) * d);   // 기지가 아직 없으면 우주복을 입고 착륙 자리 둘레에 선다 (아래 stepBodies 의 우주복)
    }
    focus(people[0] ?? null);
  }
  function count() {
    const n = { ok: 0, tired: 0, down: 0 };
    for (const p of people) n[p.status]++;
    tools.querySelector('.pp-count').innerHTML = !model ? '사람 모델을 불러오는 중…' : people.length
      ? `${people.length}명 · ${STATUS_NAMES.ok} ${n.ok} · ${STATUS_NAMES.tired} ${n.tired} · <b>${STATUS_NAMES.down} ${n.down}</b>`
      : '기지를 지으면 대원 10명이 들어와요';
  }

  // ---- 동작 재생: 앞 동작에서 부드럽게 넘어간다. once 는 한 번만 하고 마지막 자세로 멈춘다 ----
  function play(p, name, { once = false, speed = 1 } = {}) {
    const v = p.view, clip = model.clips.find(c => c.name === name);
    if (!clip) return 0;
    const action = v.mixer.clipAction(clip);
    action.timeScale = speed * p.pace;
    if (v.action === action) return clip.duration;
    action.reset();
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = once;
    if (v.action) action.crossFadeFrom(v.action, FADE, false);
    action.play();
    v.action = action;
    return clip.duration / speed;
  }
  const clipLength = name => model.clips.find(c => c.name === name)?.duration ?? 1;

  // ---- 화면을 누른 자리 → 땅 위 지역 좌표 (시선을 따라 내려가다 땅 높이 아래로 들어가는 첫 자리) ----
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), inverse = new THREE.Matrix4();
  function groundUnder(clientX, clientY) {
    const rect = host.getBoundingClientRect();
    ndc.set((clientX - rect.left) / rect.width * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    parent.updateMatrixWorld(); inverse.copy(parent.matrixWorld).invert();
    const o = ray.ray.origin.clone().applyMatrix4(inverse), end = ray.ray.origin.clone().add(ray.ray.direction).applyMatrix4(inverse);
    const d = end.sub(o).normalize();
    const below = t => o.y + d.y * t <= floorAt(site, o.x + d.x * t, o.z + d.z * t);
    let prev = 0;
    for (let t = 0.05; t < 120; t *= 1.04) {
      const x = o.x + d.x * t, z = o.z + d.z * t;
      if (Math.abs(x) <= LIMIT * 2 && Math.abs(z) <= LIMIT * 2 && below(t)) {
        let a = prev, b = t;   // 땅 표면을 반으로 나눠 가며 찾는다
        for (let i = 0; i < 20; i++) { const m = (a + b) / 2; if (below(m)) b = m; else a = m; }
        return { x: o.x + d.x * b, z: o.z + d.z * b };
      }
      prev = t;
    }
    return null;
  }
  // 누른 채 끌면 화면 돌리기라서, 거의 움직이지 않고 뗐을 때만 놓는다. 사람 위를 누르면 그 사람을 뺀다
  let down = null;
  host.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  host.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    if (!mode) { const p = nearest(e.clientX, e.clientY); if (p) pin(p); return; }   // 대원을 누르면 고른다 (빈 땅을 누르면 그대로)
    const hit = nearest(e.clientX, e.clientY);
    if (hit) { remove(hit); hideTip(); return; }
    const g = groundUnder(e.clientX, e.clientY);
    if (!g) return;
    if (mode === 'group') addGroup(g.x, g.z); else add(g.x, g.z);
  });

  // ---- 마우스를 올리면 그 사람이 어디서 무엇을 겪는지. 무리 모드에서는 놓일 원을 미리 보여 준다 ----
  const screen = new THREE.Vector3();
  function screenOf(p) {
    p.view.holder.getWorldPosition(screen);
    screen.y += HEIGHT * 0.5 * parent.scale.y;
    screen.project(camera);
    const rect = host.getBoundingClientRect();
    return { x: rect.left + (screen.x + 1) / 2 * rect.width, y: rect.top + (1 - screen.y) / 2 * rect.height, behind: screen.z > 1 };
  }
  function nearest(cx, cy) {
    let best = null, bestD = 22;
    for (const p of people) { const s = screenOf(p), d = Math.hypot(s.x - cx, s.y - cy); if (!s.behind && d < bestD) { best = p; bestD = d; } }
    return best;
  }
  let hoverAt = null, shown = null;
  host.addEventListener('pointermove', e => {
    hoverAt = e.buttons ? null : { x: e.clientX, y: e.clientY };
    const p = hoverAt && nearest(hoverAt.x, hoverAt.y);
    if (p) { showTip(p); focus(p, true); } else hideTip();
    setHover(Boolean(p));
    if (mode === 'group' && hoverAt) {
      const g = groundUnder(hoverAt.x, hoverAt.y);
      preview.visible = Boolean(g);
      if (g) preview.position.set(g.x, floorAt(site, g.x, g.z), g.z);
    }
  });
  host.addEventListener('pointerleave', () => { hoverAt = null; hideTip(); setHover(false); preview.visible = false; });
  function hideTip() { tip.hidden = true; shown = null; }
  function showTip(p) {
    const e = p.env, s = p.state;
    if (!e || !s) return hideTip();
    const where = p.place === 'home' ? '집 안' : `바깥 · 우주복 ${SUIT_TIME[site] ? Math.round((p.suit ?? 1) * 100) + '%' : '여유'}`;
    const status = STATUS_NAMES[p.status] + (p.cause && p.status !== 'ok' ? ` · ${p.cause}` : '');
    tip.innerHTML = `<small>${p.name} · ${where} · ${e.tempC.toFixed(1)}°C · 산소 ${e.oxygenPct.toFixed(1)}%</small><b>${status}</b><span>${ACT_NAMES[p.act] ?? ''}${DEVICE_ACTS.has(p.act) && p.device ? ` · ${p.device.name}` : ''}</span><span>산소포화도 ${s.spo2Pct.toFixed(0)}% · 체온 ${s.coreC.toFixed(1)}° · 버티는 힘 ${p.fit.toFixed(1)}${p.selfish ? ' · 급한 성격' : ''}</span>`;
    tip.hidden = false; shown = p;
    const r = box.getBoundingClientRect(), at = screenOf(p);
    // 정보창이 마우스 자리를 가리지 않게: 마우스(없으면 그 사람) 오른쪽 아래에 두고, 칸이 모자라면 왼쪽·위로 뒤집는다
    const GAP = 18, w = tip.offsetWidth, h = tip.offsetHeight;
    const cx = (hoverAt ? hoverAt.x : at.x) - r.left, cy = (hoverAt ? hoverAt.y : at.y) - r.top;
    let x = cx + GAP, y = cy + GAP;
    if (x + w > r.width - 8) x = cx - GAP - w;
    if (y + h > r.height - 8) y = cy - GAP - h;
    tip.style.left = `${Math.max(8, Math.min(r.width - w - 8, x))}px`;
    tip.style.top = `${Math.max(8, Math.min(r.height - h - 8, y))}px`;
  }

  // ---- 몸 상태: 화면과 따로 고정 간격(0.1초)으로 계산한다 (대원 얼굴 bodyLoop 와 같은 방식). 화면이 가려져 그리기가 멈춰도 계산은 이어진다 ----
  let homes = [];
  function simulate() {
    const s = getState();
    if (s.site !== site) { clear(); site = s.site; setMode(null); }
    homes = s.homes ?? [];
    syncBuildings(s);
    const now = performance.now() / 1000;
    if (!s.active || !site) { last = null; return; }
    acc = Math.min(acc + (last === null ? 0 : now - last), 2); last = now;
    if (paused) return;
    let changed = false;
    while (acc >= GAME.dt) { acc -= GAME.dt; changed = stepBodies(s) || changed; }
    if (changed) count();
  }
  function stepBodies(s) {
    let changed = false;
    for (const p of people) {
      p.place = placeOf(p.x, p.z, homes);
      const before = p.status;
      const met = ACT_MET[p.act] ?? 2;
      let env = envFor({ site, place: p.place, stats: s.stats, decided: s.decided, met });
      // 우주복: 바깥에 있은 시간(p.outside)이 쌓일수록 바깥 환경이 서서히 몸에 닿는다. 집 안에선 다시 채워진다
      const limit = SUIT_TIME[site];
      if (p.place === 'home') p.outside = Math.max(0, (p.outside ?? 0) - GAME.dt * SUIT_RECHARGE);
      else {
        p.outside = (p.outside ?? 0) + GAME.dt;
        const k = limit ? Math.min(1, p.outside / (limit * p.fit)) : 0;
        p.suit = 1 - k;   // 우주복 남은 정도 (정보창에 보인다)
        env = { tempC: INDOOR.tempC + (env.tempC - INDOOR.tempC) * k, oxygenPct: INDOOR.oxygenPct + (env.oxygenPct - INDOOR.oxygenPct) * k, activityMET: INDOOR.activityMET + (env.activityMET - INDOOR.activityMET) * k };
      }
      p.step(env);
      if (p.status !== before) changed = true;
    }
    return changed;
  }
  // ---- 주차마다 세워지는 장치: 자리를 모아 두고, 새로 생기면 근처 사람이 보러 간다. 새 집이 생기면 바깥 사람이 들어가 본다 ----
  let devices = [], known = new Set(), homeCount = 0;
  function syncBuildings(s) {
    devices = (s.devices ?? []).flatMap(d => d.spots.map((at, i) => ({ key: `${d.id}:${i}`, id: d.id, week: d.week, x: at[0], z: at[2], r: d.radii[i] ?? 0.5, name: DEVICE_NAMES.get(d.id) ?? d.id })));
    const fresh = devices.filter(d => !known.has(d.key));
    known = new Set(devices.map(d => d.key));
    if (homes.length > homeCount && homeCount === 0 && people.length) moveIn();
    homeCount = homes.length;
    if (!people.length) return;
    for (const d of fresh) {
      const free = people.filter(p => p.status === 'ok' && !p.scared && !busy(p) && Math.hypot(p.x - d.x, p.z - d.z) < INSPECT_RANGE)
        .sort((a, b) => Math.hypot(a.x - d.x, a.z - d.z) - Math.hypot(b.x - d.x, b.z - d.z)).slice(0, INSPECT_MAX);
      free.forEach((p, i) => { p.device = d; setTimeout(() => { if (p.status === 'ok' && !busy(p)) go(p, besideDevice(p, d), 'inspect'); }, 300 + i * 450 + rand() * 400); });
    }
  }
  // 하던 일을 끊으면 안 되는 상태 (돕기·부축·피하기·밀치기·문 열기 등)
  const busy = p => p.carrying || p.carriedBy || p.pause || p.status !== 'ok' || ['help', 'carry', 'run', 'sprint', 'crawl', 'door', 'flinch', 'getup', 'inspect', 'look'].includes(p.act);
  // 장치 둘레에서 그 사람 쪽 자리 (장치 바닥 반지름 바로 바깥)
  function besideDevice(p, d) {
    const a = Math.atan2(p.z - d.z, p.x - d.x) + (rand() - 0.5) * 1.2, r = d.r + 0.22;
    return { x: d.x + Math.cos(a) * r, z: d.z + Math.sin(a) * r };
  }
  // 새 집이 처음 생기면 바깥의 괜찮은 사람들이 차례로 들어가 본다
  function moveIn() {
    people.filter(p => p.status === 'ok' && p.place === 'outside' && !busy(p)).forEach((p, i) => {
      setTimeout(() => { const near = nearestHome(p); if (near && p.status === 'ok' && !busy(p)) go(p, inside(near.h), 'movein'); }, 400 + i * 350 + rand() * 300);
    });
  }
  let paused = false;   // 개발용 advance 가 시간을 직접 돌리는 동안 실제 시간 계산을 멈춘다
  setInterval(simulate, GAME.dt * 1000);

  // ---- 행동: 상태와 자리에 따라 무엇을 할지 고른다 ----
  const nearestHome = p => homes.reduce((best, h) => { const d = Math.hypot(p.x - h.at[0], p.z - h.at[2]); return !best || d < best.d ? { h, d } : best; }, null);
  const inside = h => { const a = rand() * Math.PI * 2, d = h.r * 0.55 * Math.sqrt(rand()); return { x: h.at[0] + Math.cos(a) * d, z: h.at[2] + Math.sin(a) * d }; };
  function wanderSpot(p) {
    const a = rand() * Math.PI * 2, d = WANDER * (0.3 + 0.7 * rand());
    return { x: Math.max(-LIMIT, Math.min(LIMIT, p.anchor.x + Math.cos(a) * d)), z: Math.max(-LIMIT, Math.min(LIMIT, p.anchor.z + Math.sin(a) * d)) };
  }
  function go(p, target, act) {
    p.act = act; p.target = target; p.timer = 15; p.doorAt = null;
    play(p, MOVE_CLIP[act] ?? 'Walk_Loop', { speed: act === 'carry' ? 0.55 : act === 'walk' && p.status === 'tired' ? TIRED_PACE : 1 });
  }
  function settle(p, act, clip, seconds) { p.act = act; p.target = null; p.timer = seconds; play(p, clip); }
  // 힘들 때: 집이 있으면 뛰어서 피하고(위험이 클수록 전력 질주), 쓰러지기 직전이면 기어간다. 피할 곳이 없으면 웅크려 숨을 고른다
  function flee(p) {
    const near = nearestHome(p);
    if (p.place !== 'outside' || !near) return settle(p, 'rest', 'Crouch_Idle_Loop', 2 + rand() * 2);
    const act = p.danger > 0.7 ? 'crawl' : p.danger > 0.35 || p.cause === '더위' ? 'sprint' : 'run';
    go(p, inside(near.h), act);
  }
  function decide(p) {
    if (p.status === 'tired') return flee(p);
    const near = nearestHome(p), roll = rand();
    // 근처에 쓰러진 사람이 있고 돌보는 사람이 없으면 달려가 돌본다
    const fallen = people.find(o => o !== p && o.status === 'down' && !o.carriedBy && !people.some(h => h.helping === o) && Math.hypot(o.x - p.x, o.z - p.z) < HELP_RANGE);
    if (fallen) { p.helping = fallen; const a = rand() * Math.PI * 2; return go(p, { x: fallen.x + Math.cos(a) * 0.28, z: fallen.z + Math.sin(a) * 0.28 }, 'help'); }
    if (near && p.place === 'outside' && roll < 0.25) return go(p, inside(near.h), 'home');
    if (near && p.place === 'home' && roll < 0.3 && !p.scared) { const a = rand() * Math.PI * 2, d = near.h.r + 0.6 + rand() * 1.2; return go(p, { x: near.h.at[0] + Math.cos(a) * d, z: near.h.at[2] + Math.sin(a) * d }, 'out'); }
    // 세워진 장치 손보기: 가까운 장치일수록 자주 간다 (바깥 장치면 바깥 환경을 겪는다)
    if (devices.length && roll < 0.45 && !p.scared && rand() < 0.6) {
      const d = devices.map(d => [d, Math.hypot(d.x - p.x, d.z - p.z) + rand() * 2]).sort((a, b) => a[1] - b[1])[0][0];
      p.device = d; return go(p, besideDevice(p, d), 'tend');
    }
    if (p.place === 'outside' && roll < 0.45 && !p.scared) return settle(p, 'work', 'Fixing_Kneeling', 4 + rand() * 3);
    if (roll < 0.58 && people.some(o => o !== p && o.status === 'ok' && Math.hypot(o.x - p.x, o.z - p.z) < 1.5)) return settle(p, 'talk', 'Idle_Talking_Loop', 3 + rand() * 3);
    if (roll < 0.85) return go(p, p.place === 'home' && near ? inside(near.h) : wanderSpot(p), 'walk');
    settle(p, 'idle', 'Idle_Loop', 2 + rand() * 3);
  }

  // ---- 부축: 돌보던 사람을 일으켜 옆에 붙이고 가까운 집 안으로 데려간다. 집 안에 닿으면 눕히고 곁을 지킨다 ----
  function startCarry(p) {
    const fallen = p.helping, near = nearestHome(fallen);
    if (!near || fallen.place === 'home' || fallen.carriedBy) return false;
    p.carrying = fallen; fallen.carriedBy = p;
    go(p, inside(near.h), 'carry');
    fallen.act = 'carried'; play(fallen, 'Walk_Loop', { speed: 0.45 });
    return true;
  }
  function dropCarry(p, laidInside = false) {
    const o = p.carrying;
    if (!o) return;
    p.carrying = null; o.carriedBy = null;
    if (o.status === 'down') { o.act = 'down'; play(o, 'Death01', { once: true }); }   // 내려놓으면 다시 눕는다 (집 안이면 곧 숨을 돌린다)
    if (laidInside) { p.helping = o; settle(p, 'help', 'Fixing_Kneeling', 2.5 + rand() * 2); }
  }
  // ---- 밀치기: 급한 사람이 피하는 길에 앞사람이 있으면 밀치고 먼저 간다. 밀린 사람은 휘청이며 뒤로 밀려난다 ----
  const AHEAD = 0.42;
  function blocker(p, dx, dz, dist) {
    for (const o of people) {
      if (o === p || o.status === 'down' || o.carriedBy || o.carrying || o.act === 'shoved') continue;
      if (o.place === 'home' && p.place !== 'home') continue;   // 이미 집 안에 들어간 사람은 문을 막지 않는다
      if (o.target && MOVE_CLIP[o.act] && moveSpeed(o.act) >= moveSpeed(p.act)) continue;   // 같은 쪽으로 더 빨리 가는 사람은 막는 게 아니다
      const ox = o.x - p.x, oz = o.z - p.z, d = Math.hypot(ox, oz);
      if (d < AHEAD && d < dist + 0.1 && (ox * dx + oz * dz) / (d * dist || 1) > 0.45) return o;
    }
    return null;
  }
  function shove(p, o) {
    p.pause = { act: p.act, t: 0.45 }; p.act = 'shove'; p.shoveCd = 2.5 + rand() * 2;
    play(p, 'Push_Loop', { once: true, speed: 1.8 });
    const d = Math.hypot(o.x - p.x, o.z - p.z) || 1;
    o.knock = { x: (o.x - p.x) / d * 0.45, z: (o.z - p.z) / d * 0.45, t: 0.3 };
    o.pause = { act: o.act, t: 0.8, target: o.target }; o.act = 'shoved'; o.doorAt = null;
    play(o, 'Hit_Chest', { once: true, speed: 0.55 });
  }
  // 멈춰 있는 동작(밀치기·밀림)이 끝나면 하던 일로 돌아간다
  function resume(p) {
    const { act, target } = p.pause; p.pause = null;
    if (target !== undefined) p.target = target;
    if (p.target && MOVE_CLIP[act]) { p.act = act; play(p, MOVE_CLIP[act]); }
    else if (p.status === 'tired') flee(p);
    else settle(p, 'idle', 'Idle_Loop', 0.5 + rand());
  }

  function think(p, dt) {
    const v = p.view;
    p.shoveCd = Math.max(0, (p.shoveCd ?? 0) - dt);
    p.scared = Math.max(0, (p.scared ?? 0) - dt);
    if (p.status !== 'ok' && p.place === 'outside') p.scared = SCARED;   // 바깥에서 혼난 사람은 한동안 밖에 나가지 않는다
    // 쓰러짐: 쓰러지는 동작을 한 번 하고 그 자세로 누워 있다. 부축받는 중이면 데려가는 사람이 움직인다
    if (p.status === 'down') {
      p.pause = null; p.knock = null;
      if (p.carrying) dropCarry(p);
      if (p.carriedBy) return;
      if (p.act !== 'down') { p.act = 'down'; p.target = null; p.notice = null; play(p, 'Death01', { once: true }); }
      return;
    }
    // 부축받다가 정신이 들면 스스로 선다
    if (p.carriedBy) { if (p.carriedBy.carrying === p) dropCarry(p.carriedBy); else p.carriedBy = null; }
    if (p.act === 'down' || p.act === 'carried') return settle(p, 'getup', 'Crouch_Idle_Loop', 1.6 / p.fit + 0.6);   // 다시 일어나기 전 숨 고르기
    // 밀림: 뒤로 밀려났다가 하던 일로
    if (p.knock) { const k = Math.min(1, dt / p.knock.t); p.x += p.knock.x * k; p.z += p.knock.z * k; p.knock.t -= dt; if (p.knock.t <= 0) p.knock = null; }
    if (p.pause) { p.pause.t -= dt; if (p.pause.t <= 0) resume(p); return; }
    // 힘들어진 것을 알아채기까지 사람마다 다르다 (0.2 ~ 1.6초). 알아채면 움찔한 뒤 피한다 (부축하던 사람은 내려놓는다)
    if (p.status === 'tired' && !p.wasTired) p.notice = 0.2 + rand() * 1.4;
    p.wasTired = p.status === 'tired';
    if (p.notice != null) {
      p.notice -= dt;
      // 돕거나 부축하는 사람은 자기도 쓰러지기 직전(위험 0.6)까지는 참고 데려간다
      if (p.notice <= 0 && !((p.carrying || (p.act === 'help' && p.helping)) && p.danger < 0.6)) { p.notice = null; dropCarry(p); p.helping = null; p.act = 'flinch'; p.target = null; p.timer = 0.6; play(p, 'Hit_Chest', { once: true, speed: 0.6 }); }
    }
    // 피하는 중 위험이 커지면 더 급하게 (뛰기 → 전력 질주 → 기기)
    if (p.target && ['run', 'sprint'].includes(p.act) && p.danger > 0.7) { p.act = 'crawl'; play(p, MOVE_CLIP.crawl); }
    else if (p.target && p.act === 'run' && p.danger > 0.35) { p.act = 'sprint'; play(p, MOVE_CLIP.sprint); }
    // 돌보는 중: 돌보던 사람이 일어나거나 사라지면 그만둔다
    if (p.act === 'help' && !p.target && (!p.helping || p.helping.status !== 'down')) { p.helping = null; p.timer = 0; }
    if (p.target) {
      const dx = p.target.x - p.x, dz = p.target.z - p.z, dist = Math.hypot(dx, dz);
      const hurry = ['run', 'sprint', 'crawl'].includes(p.act);
      // 길을 막은 사람: 급한 성격이면 밀치고, 아니면 걸음을 늦춰 비켜 가길 기다린다
      const ahead = hurry || p.act === 'carry' ? blocker(p, dx, dz, dist) : null;
      if (ahead && p.selfish && hurry && p.act !== 'crawl' && !p.shoveCd) { shove(p, ahead); return; }
      const yieldTo = ahead ? 0.35 : 1;
      const step = moveSpeed(p.act) * p.pace * yieldTo * (p.act === 'walk' && p.status === 'tired' ? TIRED_PACE : 1) * dt;
      const nx = p.x + dx / (dist || 1) * Math.min(step, dist), nz = p.z + dz / (dist || 1) * Math.min(step, dist);
      v.heading = turn(v.heading, Math.atan2(dx, dz), dt * (p.act === 'sprint' ? 2 : 1));
      // 집 경계를 넘으려는 순간 문 앞에서 멈춰 문을 연다. 급할 때는 짧게 서둘러 연다 (한 번 열면 그 경계는 그냥 지나간다)
      if (!p.doorAt && homes.length && placeOf(nx, nz, homes) !== placeOf(p.x, p.z, homes)) {
        p.doorAt = { act: p.act, t: hurry ? 0.55 : Math.min(1.4, clipLength('Interact')) }; p.act = 'door';
        play(p, 'Interact', { once: true, speed: hurry ? 2 : 1 });
      }
      if (p.act === 'door') {
        p.doorAt.t -= dt;
        if (p.doorAt.t <= 0) { p.act = p.doorAt.act; play(p, MOVE_CLIP[p.act] ?? 'Walk_Loop', { speed: p.act === 'carry' ? 0.55 : 1 }); }
        return;
      }
      p.x = nx; p.z = nz;
      p.timer -= dt;
      if (dist < 0.05 || p.timer <= 0) {
        if (p.act === 'carry') return dropCarry(p, true);
        if ((p.act === 'tend' || p.act === 'inspect') && p.device) {
          v.heading = Math.atan2(p.device.x - p.x, p.device.z - p.z);
          if (p.act === 'inspect') { p.act = 'look'; p.target = null; p.timer = 2.5 + rand() * 1.5; play(p, 'Interact', { once: true, speed: 0.8 }); return; }
          return rand() < 0.5 ? settle(p, 'fix', 'Fixing_Kneeling', 3 + rand() * 3) : settle(p, 'operate', 'Interact', 2 + rand() * 1.5);
        }
        if (p.act === 'help' && p.helping?.status === 'down') { v.heading = Math.atan2(p.helping.x - p.x, p.helping.z - p.z); return settle(p, 'help', 'Fixing_Kneeling', p.helping.place === 'home' ? 1.4 + rand() : 0.5 + rand() * 0.3); }   // 바깥이면 잠깐만 살피고 바로 일으킨다
        if (p.status === 'tired') return settle(p, 'rest', 'Crouch_Idle_Loop', 2 + rand() * 2);
        return settle(p, 'idle', 'Idle_Loop', 1 + rand() * 2);
      }
      return;
    }
    p.timer -= dt;
    if (p.timer <= 0) {
      // 곁에서 살핀 뒤: 바깥이면 일으켜 집으로 데려가고, 집 안이면 깨어날 때까지 곁에 남는다
      if (p.act === 'help' && p.helping?.status === 'down') { if (!startCarry(p)) p.timer = 2; return; }
      p.helping = null;
      decide(p);
    }
  }
  const turn = (from, to, dt) => { const d = ((to - from + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return from + d * Math.min(1, dt * 7); };
  // 서로 겹치지 않게 살짝 밀어낸다 (누워 있는 사람·부축 중인 둘은 빼고)
  const SPACE = 0.2;
  function separate() {
    for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
      const a = people[i], b = people[j];
      if (a.carrying === b || b.carrying === a) continue;
      if (a.place === 'home' && b.place === 'home') continue;   // 집 안에서는 붐벼도 괜찮다 (작은 집에 여럿이 피해 들어온다)
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d >= SPACE || d === 0) continue;
      const fixedA = a.status === 'down' || a.carriedBy, fixedB = b.status === 'down' || b.carriedBy;
      if (fixedA && fixedB) continue;
      const push = (SPACE - d) / (fixedA || fixedB ? 1 : 2), ux = dx / d, uz = dz / d;
      if (!fixedA) { a.x -= ux * push; a.z -= uz * push; }
      if (!fixedB) { b.x += ux * push; b.z += uz * push; }
    }
  }

  // ---- 매 화면: 행동을 고르고, 동작을 재생해 점을 뼈대 움직임에 맞춰 옮긴다 ----
  let lastFrame = null;
  function frame(time) {
    const s = getState();
    tools.hidden = !s.active || !site || s.site !== site;
    group.visible = !tools.hidden;
    if (tools.hidden) { hideTip(); setHover(false); tag.hidden = true; if (mode) setMode(null); lastFrame = null; return; }
    const now = time / 1000, dt = Math.min(0.1, now - (lastFrame ?? now)); lastFrame = now;
    if (!model) return;
    // 지역에 들어가면 바로 대원 10명을 세운다 (2026-11-23 사용자: 얼굴 연결이 1-1 위치 고르기부터 떠야 함).
    // 기지(집)가 있으면 집 안에, 아직 없으면 착륙 자리 둘레 바깥에 우주복을 입고 서 있다가(SUIT_TIME 만큼 버티다 서서히 지침),
    // 집이 생기면 moveIn 으로 걸어 들어간다. (예전에는 바로 바깥 환경을 겪어 몇 초 만에 모두 쓰러져서, 2026-11-18 에는 집이 생긴 뒤에만 세웠다)
    if (!people.length) spawnCrew(s.homes ?? []);
    for (const p of people) think(p, dt);
    // 부축받는 사람은 데려가는 사람 오른쪽에 붙어 같은 쪽을 본다
    for (const p of people) if (p.carrying) {
      const o = p.carrying, h = p.view.heading;
      o.x = p.x + Math.cos(h) * 0.17; o.z = p.z - Math.sin(h) * 0.17; o.view.heading = h;
    }
    separate();
    for (const p of people) {
      const v = p.view;
      v.mixer.update(dt);
      const pos = v.points.geometry.getAttribute('position');
      v.skin(pos.array); pos.needsUpdate = true;
      // 색: 힘들어함은 주황 머리 + 몸이 주황으로 깜빡, 쓰러짐은 주황
      const tone = p.status === 'down' ? 'down' : p.status === 'ok' && p === pinned ? 'pick' : p.status === 'tired' ? ((time + v.phase * 100) % 700 < 350 ? 'blink' : 'tired') : 'ok';
      if (tone !== v.tone) {
        v.tone = tone;
        const color = v.points.geometry.getAttribute('color');
        color.array.set(model.tones[tone]); v.points.geometry.userData.baseColor.set(model.tones[tone]); color.needsUpdate = true;
      }
      v.mark.geometry = p === pinned && p.status === 'ok' ? RINGS.pick : p === focused && p.status === 'ok' ? RINGS.focus : RINGS[p.status];   // 얼굴로 보고 있는 대원은 발밑 고리가 크림색
      v.mark.scale.setScalar(p.status === 'ok' ? 1 : 1 + 0.25 * (0.5 + 0.5 * Math.sin(now * (p.status === 'down' ? 5 : 3) + v.phase)));   // 힘들거나 쓰러지면 발밑 고리가 맥박처럼
      v.points.rotation.set(p.act === 'carried' ? 0.35 : 0, v.heading, 0, 'YXZ');   // 부축받는 사람은 앞으로 기울어 끌려가듯
      v.holder.position.set(p.x, floorAt(site, p.x, p.z), p.z);
    }
    if (focused) {   // 이름표를 머리 위에
      const at = screenOf(focused), r = box.getBoundingClientRect();
      tag.hidden = at.behind;
      tag.style.left = `${at.x - r.left}px`; tag.style.top = `${at.y - r.top - 34}px`;
    }
    if (hoverAt) { const p = nearest(hoverAt.x, hoverAt.y); if (p) { showTip(p); focus(p, true); } else hideTip(); setHover(Boolean(p)); }
    else if (shown) showTip(shown);
  }
  count();
  // 개발용 (콘솔에서 확인). advance(초): 화면이 멈춰 있어도 그만큼 동작을 앞으로 돌린다
  const advance = seconds => {
    paused = true;
    for (let t = 0; t < seconds; t += 0.05) {
      frame(((lastFrame ?? performance.now() / 1000) + 0.05) * 1000);
      if (Math.round(t / 0.05) % 2) stepBodies(getState());
    }
    count();
  };
  const resumeClock = () => { paused = false; last = null; };
  window.people = { focused: () => focused, pinned: () => pinned, pin, add, addGroup, clear, list: people, screenOf, advance, resumeClock, devices: () => devices };
  return { frame, add, addGroup, clear };
}
