import { defineConfig } from 'vite';

// 3DGS Viewer の Vite 設定（最小構成）。
// - base: './' で相対パス配信に対応（サブディレクトリ配置でもアセット参照が壊れない）。
// - publicDir: 同梱シーンアセットと scenes.json を置く public/ をそのまま静的配信する。
// MetaVarsee と同一 Web サーバー（同一オリジン）へ相乗りする前提。
// MetaVarsee は /xr/NeccosMetaverse_WebGPU_Dev/ に配信済み。本ビューアは同サーバーの
// 別サブディレクトリ（既定 /xr/Metavarse_3dgs_viewer/）へ置く。VITE_BASE_PATH で上書き可。
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/xr/Metavarse_3dgs_viewer/',
  publicDir: 'public',
  build: {
    target: 'es2020',
  },
});
