// GLB 에서 고른 애니메이션만 남기고 버퍼를 다시 묶는다. 사용: node scripts/trim-glb.mjs 원본.glb 결과.glb 동작1,동작2,…
import fs from 'node:fs';
const [src, dst, keepCsv] = process.argv.slice(2), keep = keepCsv.split(',');
const b = fs.readFileSync(src);
const jl = b.readUInt32LE(12), j = JSON.parse(b.slice(20, 20 + jl).toString());
const binStart = 20 + jl + 8, bin = b.slice(binStart, binStart + b.readUInt32LE(20 + jl));
j.animations = j.animations.filter(a => keep.includes(a.name));
const missing = keep.filter(k => !j.animations.some(a => a.name === k)); if (missing.length) throw new Error('missing ' + missing);
// 쓰이는 accessor 모으기
const used = new Set();
const walk = v => { if (typeof v === 'number') used.add(v); };
for (const m of j.meshes) for (const p of m.primitives) { Object.values(p.attributes).forEach(walk); walk(p.indices); (p.targets ?? []).forEach(t => Object.values(t).forEach(walk)); }
for (const s of j.skins ?? []) walk(s.inverseBindMatrices);
for (const a of j.animations) for (const s of a.samplers) { walk(s.input); walk(s.output); }
const accMap = new Map(), accs = [], views = [], chunks = []; let off = 0;
[...used].sort((a, b) => a - b).forEach(i => {
  const acc = { ...j.accessors[i] }, bv = j.bufferViews[acc.bufferView];
  const comp = { 5126: 4, 5125: 4, 5123: 2, 5121: 1, 5122: 2, 5120: 1 }[acc.componentType];
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type];
  const stride = bv.byteStride ?? comp * n, start = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const len = stride === comp * n ? acc.count * comp * n : null;
  if (len === null) throw new Error('strided');
  const data = bin.slice(start, start + len);
  const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; }
  views.push({ buffer: 0, byteOffset: off, byteLength: len, ...(bv.target ? { target: bv.target } : {}) });
  chunks.push(data); off += len;
  acc.bufferView = views.length - 1; delete acc.byteOffset;
  accMap.set(i, accs.length); accs.push(acc);
});
const re = v => accMap.get(v);
for (const m of j.meshes) for (const p of m.primitives) { for (const k in p.attributes) p.attributes[k] = re(p.attributes[k]); if (p.indices != null) p.indices = re(p.indices); if (p.targets) p.targets = p.targets.map(t => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, re(v)]))); }
for (const s of j.skins ?? []) if (s.inverseBindMatrices != null) s.inverseBindMatrices = re(s.inverseBindMatrices);
for (const a of j.animations) for (const s of a.samplers) { s.input = re(s.input); s.output = re(s.output); }
j.accessors = accs; j.bufferViews = views; delete j.images; delete j.textures; delete j.samplers;
if (j.materials) j.materials = j.materials.map(m => ({ name: m.name, pbrMetallicRoughness: { baseColorFactor: m.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1] } }));
let newBin = Buffer.concat(chunks); const bp = (4 - newBin.length % 4) % 4; if (bp) newBin = Buffer.concat([newBin, Buffer.alloc(bp)]);
j.buffers = [{ byteLength: newBin.length }];
let js = Buffer.from(JSON.stringify(j)); const jp = (4 - js.length % 4) % 4; if (jp) js = Buffer.concat([js, Buffer.alloc(jp, 0x20)]);
const head = Buffer.alloc(12); head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + newBin.length, 8);
const ch = (len, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(len, 0); h.writeUInt32LE(type, 4); return h; };
fs.writeFileSync(dst, Buffer.concat([head, ch(js.length, 0x4E4F534A), js, ch(newBin.length, 0x004E4942), newBin]));
console.log('wrote', dst, fs.statSync(dst).size, 'anims', j.animations.map(a => a.name).join(','));
