/**
 * 3DGS Viewer エントリ（Phase 1: 3DGS のみ表示）。
 *
 * 描画の切替は「入る際のリンク（URL）」で行う:
 *   - ?scene=<id>   … scenes.json の id を選択
 *   - ?url=<path>   … splat（.ply/.spz）を直接指定（scene より優先）
 *   - 指定なし       … scenes.json の "default"（無ければ先頭）
 *
 * 構成は既存 Metavarse_3dgs（ViewerApp / SplatSceneLoader）の実績配線を最小化したもの:
 *   WebGLRenderer + SparkRenderer + SplatMesh + OrbitControls。
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { MANIFEST_URL, ASSET_BASE, RENDER_CONFIG, LOAD_TIMEOUT_MS } from './config.js';

/** 相対 url は ASSET_BASE を前置し、絶対 URL（http/https）はそのまま返す。 */
function resolveAssetUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${ASSET_BASE}${url}`;
}

const statusEl = document.getElementById('status');
const setStatus = (msg) => {
  if (statusEl) statusEl.textContent = msg;
};

/** URL クエリから描画対象の splat URL を決定する（リンク駆動）。 */
async function resolveSplatUrl() {
  const params = new URLSearchParams(location.search);

  // 1) ?url= 直接指定が最優先（リモート絶対 URL をそのまま渡せる）。
  const direct = params.get('url');
  if (direct) return { url: resolveAssetUrl(direct), label: direct };

  // 2) scenes.json を取得して ?scene=<id> / default を解決。
  let manifest = { scenes: [], default: null };
  try {
    const res = await fetch(MANIFEST_URL);
    if (res.ok) manifest = await res.json();
  } catch (e) {
    console.warn('[viewer] scenes.json 取得失敗:', e);
  }

  const scenes = Array.isArray(manifest.scenes) ? manifest.scenes : [];
  const wantId = params.get('scene') || manifest.default;
  const entry =
    scenes.find((s) => s.id === wantId) || scenes[0] || null;

  if (!entry) return null;
  return { url: resolveAssetUrl(entry.url), label: entry.name || entry.id };
}

/** SplatMesh の読込完了を待つ（spark v2.x は onFinishedLoading）。60s タイムアウト付き。 */
function waitForLoad(splat) {
  const load = new Promise((resolve) => {
    if ('onFinishedLoading' in splat) {
      splat.onFinishedLoading = () => resolve();
    } else if (splat.ready instanceof Promise) {
      splat.ready.then(resolve);
    } else {
      setTimeout(resolve, 300);
    }
  });
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`splat load timeout (${LOAD_TIMEOUT_MS / 1000}s)`)), LOAD_TIMEOUT_MS)
  );
  return Promise.race([load, timeout]);
}

async function main() {
  const container = document.getElementById('canvas-container');

  // ── renderer ──
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER_CONFIG.PIXEL_RATIO_MAX));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  // ── scene / camera ──
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(RENDER_CONFIG.BACKGROUND_COLOR);

  const camera = new THREE.PerspectiveCamera(
    RENDER_CONFIG.CAMERA_FOV,
    window.innerWidth / window.innerHeight,
    RENDER_CONFIG.CAMERA_NEAR,
    RENDER_CONFIG.CAMERA_FAR
  );
  const p = RENDER_CONFIG.INITIAL_CAMERA_POSITION;
  camera.position.set(p.x, p.y, p.z);

  // ── Spark: SparkRenderer を scene に add すると splat 描画が有効化される ──
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);

  // ── camera controls ──
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  // ── resize ──
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ── render loop ──
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  // ── splat load（リンク駆動）──
  const target = await resolveSplatUrl();
  if (!target) {
    setStatus('表示できるシーンがありません（scenes.json / ?url= を確認）');
    return;
  }

  setStatus(`読込中: ${target.label} …`);
  try {
    const splat = new SplatMesh({ url: target.url });
    await waitForLoad(splat);
    scene.add(splat);
    setStatus(`表示中: ${target.label}`);
  } catch (e) {
    console.error('[viewer] splat 読込失敗:', e);
    setStatus(`読込失敗: ${target.label}（${e.message}）`);
  }
}

main();
