import { defineConfig } from 'vite';

// 3DGS Viewer の Vite 設定（最小構成）。
// - base: './' で相対パス配信に対応（サブディレクトリ配置でもアセット参照が壊れない）。
// - publicDir: 同梱シーンアセットと scenes.json を置く public/ をそのまま静的配信する。
export default defineConfig({
  base: './',
  publicDir: 'public',
  server: {
    port: 3100,
    open: false,
  },
});
