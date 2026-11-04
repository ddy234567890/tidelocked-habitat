import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// 서버 없이 더블클릭으로 여는 시안 파일을 저장소 맨 위 이번-시안-열기.html 로 만든다. 실행: npm run open-file
// 주소 뒤에 아무것도 없이 열면 시작 메뉴가 나오고, 고르면 ?week= 주소로 다시 연다.
const root = new URL('../', import.meta.url);
const result = await build({ entryPoints: [fileURLToPath(new URL('src/main.js', root))], absWorkingDir: fileURLToPath(root), bundle: true, format: 'iife', minify: true, write: false, loader: { '.glb': 'dataurl', '.woff': 'dataurl' } });
const font = (await readFile(new URL('src/assets/fonts/terrarum-sans-bitmap.woff', root))).toString('base64');
const css = (await readFile(new URL('src/style.css', root), 'utf8')).replace(/^@import[^\n]*\n/gm, '')
  .replace('./assets/fonts/terrarum-sans-bitmap.woff', `data:font/woff;base64,${font}`);
const links = [2, 3, 4, 5].flatMap(week => [['평원', 'plain'], ['동굴', 'lavaTube'], ['능선', 'ridge']]
  .map(([label, site]) => `<a href="?intro=0&week=${week}&site=${site}">${week}주차 · ${label}</a>`)).join('');
const menu = `<div id="start-menu" hidden style="position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:#02040C">
<nav style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;width:min(560px,90vw)"><style>#start-menu a:first-of-type{grid-column:1/-1}#start-menu a{padding:12px 16px;border:2px solid #2B47C4;background:#0A1434;color:#DCE6FF;text-decoration:none}#start-menu a:hover,#start-menu a:focus{background:#1B2A9C}</style>
<a href="?start=1">처음부터 (1주차)</a>${links}</nav></div>
<script>if(!location.search){var m=document.getElementById('start-menu');m.hidden=false;}</script>`;
let html = await readFile(new URL('index.html', root), 'utf8');
html = html.replace('<link rel="stylesheet" href="/src/style.css">', () => `<style>${css}</style>`);
html = html.replace('<script type="module" src="/src/main.js"></script>', () => `${menu}<script>${result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`);
await writeFile(new URL('../../이번-시안-열기.html', root), html);
