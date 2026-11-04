import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildPlain } from '../src/plain.js';
import { buildLavaTube } from '../src/lavaTube.js';
import { buildRidge } from '../src/ridge.js';
import { buildPlanet } from '../src/planet.js';

// 서버 없이 여는 미리보기와, 다른 모델링 도구로 옮길 포인트 파일을 만든다.
const root = new URL('../', import.meta.url), target = new URL('deliverables/', root);
await mkdir(target, { recursive: true });
const result = await build({ entryPoints: [fileURLToPath(new URL('src/main.js', root))], absWorkingDir: process.cwd(), bundle: true, format: 'iife', minify: true, write: false, loader: { '.glb': 'dataurl' } });
let html = await readFile(new URL('index.html', root), 'utf8');
let css = await readFile(new URL('src/style.css', root), 'utf8');
css = css.replace(/^@import[^\n]*\n/, '');
// 파일 하나로 열리도록 글꼴과 로봇 이미지도 HTML 안에 담는다
const dataUrl = async (file, type) => `data:${type};base64,${(await readFile(new URL(file, root))).toString('base64')}`;
const font = await dataUrl('src/assets/fonts/terrarum-sans-bitmap.woff', 'font/woff'), robot = await dataUrl('src/assets/ori-robot.png', 'image/png');
css = css.replace('./assets/fonts/terrarum-sans-bitmap.woff', () => font);
html = html.replace('/src/assets/ori-robot.png', () => robot);
html = html.replace('<link rel="stylesheet" href="/src/style.css">', () => `<style>${css}</style>`);
html = html.replace('<script type="module" src="/src/main.js"></script>', () => `<script>${result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`);
await writeFile(new URL('Teegarden-terrain.html', target), html);

const definitions = JSON.parse(await readFile(new URL('src/sites.json', root), 'utf8'));
for (const [name, builder] of Object.entries({ planet: buildPlanet, plain: buildPlain, lavaTube: buildLavaTube, lavaTubeInterior: buildLavaTube, ridge: buildRidge })) {
  const def = name === 'lavaTubeInterior' ? { ...definitions.lavaTube, view: 'interior' } : definitions[name];
  const data = builder(30000, def);
  const lines = ['ply', 'format ascii 1.0', 'comment Teegarden b scenario prototype; model units; Y up', 'element vertex 30000', 'property float x', 'property float y', 'property float z', 'property uchar red', 'property uchar green', 'property uchar blue', 'end_header'];
  for (let i = 0; i < 30000; i++) {
    const p = Array.from(data.positions.subarray(i * 3, i * 3 + 3), v => v.toFixed(5));
    const c = Array.from(data.colors.subarray(i * 3, i * 3 + 3), v => Math.round(v * 255));
    lines.push([...p, ...c].join(' '));
  }
  await writeFile(new URL(`${name}.ply`, target), lines.join('\n'));
}
const files = ['package.json', 'index.html', 'src/sites.json', 'src/palette.js', 'src/terrain.js', 'src/plain.js', 'src/lavaTube.js', 'src/ridge.js', 'src/planet.js', 'src/surroundings.js', 'src/choices.json', 'src/choices.js', 'src/placement.js', 'src/navigation.js', 'src/effects.js', 'src/main.js', 'src/style.css', 'tests/terrain.test.js', 'tests/navigation.test.js', 'tests/effects.test.js', 'scripts/deliver.mjs'];
let source = '# Teegarden b 독립 프로토타입 전체 코드\n\n2026-10-30 · v4.0 · 카메라 이동 후 홀로그램 구성. 각 파일의 전체 내용입니다.\n';
for (const file of files) {
  const language = file.endsWith('.css') ? 'css' : file.endsWith('.html') ? 'html' : file.endsWith('.json') ? 'json' : 'js';
  source += `\n## ${file}\n\n\x60\x60\x60${language}\n${await readFile(new URL(file, root), 'utf8')}\n\x60\x60\x60\n`;
}
await writeFile(new URL('전체코드.md', target), source);
const changed = ['package.json', 'index.html', 'src/navigation.js', 'src/effects.js', 'src/main.js', 'src/style.css', 'tests/navigation.test.js', 'tests/effects.test.js', 'scripts/deliver.mjs'];
let changes = '# v4 변경 파일 전체 코드\n\n2026-10-30 · v3 대비 변경·추가한 파일의 전체 내용입니다.\n';
for (const file of changed) changes += `\n## ${file}\n\n\x60\x60\x60\n${await readFile(new URL(file, root), 'utf8')}\n\x60\x60\x60\n`;
await writeFile(new URL('변경파일전체코드.md', target), changes);
console.log('Created standalone HTML, five 30,000-point PLY files, and full source documents.');
