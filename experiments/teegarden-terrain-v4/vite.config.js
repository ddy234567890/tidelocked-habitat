import { defineConfig } from 'vite';

// 선지 에셋 모델(.glb)을 주소로 불러온다. 독립 HTML(scripts/deliver.mjs)에서는 데이터 주소로 넣는다.
export default defineConfig({ assetsInclude: ['**/*.glb'] });
