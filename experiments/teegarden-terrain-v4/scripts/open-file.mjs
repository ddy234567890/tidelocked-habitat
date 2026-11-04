import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// 서버 없이 더블클릭으로 여는 시안 파일을 저장소 맨 위 이번-시안-열기.html 로 만든다. 실행: npm run open-file
// 시작 메뉴에서 고른 뒤에 게임을 시작한다. 주소를 바꾸지 않아서 파일로 열어도, 공유 링크로 열어도 같게 돈다.
const root = new URL('../', import.meta.url);
const result = await build({ entryPoints: [fileURLToPath(new URL('src/main.js', root))], absWorkingDir: fileURLToPath(root), bundle: true, format: 'iife', minify: true, write: false, loader: { '.glb': 'dataurl', '.woff': 'dataurl' } });
const font = (await readFile(new URL('src/assets/fonts/terrarum-sans-bitmap.woff', root))).toString('base64');
const css = (await readFile(new URL('src/style.css', root), 'utf8')).replace(/^@import[^\n]*\n/gm, '')
  .replace('./assets/fonts/terrarum-sans-bitmap.woff', `data:font/woff;base64,${font}`);
const links = [2, 3, 4, 5].flatMap(week => [['평원', 'plain'], ['동굴', 'lavaTube'], ['능선', 'ridge']]
  .map(([label, site]) => `<button data-start="intro=0&week=${week}&site=${site}">${week}주차 · ${label}</button>`)).join('');
const menu = `<div id="start-menu" style="position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:#02040C">
<nav style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;width:min(560px,90vw)"><style>#start-menu button:first-of-type{grid-column:1/-1}#start-menu button{padding:12px 16px;border:2px solid #2B47C4;background:#0A1434;color:#DCE6FF;font:inherit;cursor:pointer}#start-menu button:hover,#start-menu button:focus{background:#1B2A9C}</style>
<button data-start="">처음부터 (1주차)</button>${links}</nav></div>`;
let html = await readFile(new URL('index.html', root), 'utf8');
html = html.replace('<link rel="stylesheet" href="/src/style.css">', () => `<style>${css}</style>`);
html = html.replace('<script type="module" src="/src/main.js"></script>', () => `${menu}<script>function boot(){${result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}}
var startMenu=document.getElementById('start-menu');
if(/[?&]week=/.test(location.search)){startMenu.remove();boot();}
else startMenu.querySelectorAll('button').forEach(function(b){b.addEventListener('click',function(){window.startParams=b.dataset.start;startMenu.remove();boot();});});</script>`);
await writeFile(new URL('../../이번-시안-열기.html', root), html);
