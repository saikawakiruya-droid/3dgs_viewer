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
  return {
    url: resolveAssetUrl(entry.url),
    label: entry.name || entry.id,
    viewpoint: entry.viewpoint, // 任意: 保存済み開始視点（scenes.json）。無ければ自動枠取り。
  };
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

// ─────────────────────────────────────────────
// 向き補正 & カメラ自動枠取り（参考: ../Metavarse_3dgs ViewerApp._orientSplat / _frameToScene）。
// ─────────────────────────────────────────────
const FRAME = {
  DISTANCE_FACTOR: 0.9, // カメラ距離 = 最大辺 × これ
  MAX_SAMPLES: 150_000, // bbox サンプリング上限（重い全反復を間引く）
  LO_PCT: 0.02, // 外れ値（floater）除外の下側パーセンタイル
  HI_PCT: 0.98, // 同上側
  DATA_WAIT_MS: 10_000, // splat データ充填（numSplats>0）の待機上限
  VIEW_DIR: { x: 0, y: 0.4, z: 1 }, // 斜め上前方から中心を見る方向
};

/** 3DGS の上下補正。PLY/SPZ は y-down 系が多く three.js（y-up）で上下反転するため X軸180°。 */
function orientSplat(splat) {
  if (splat.rotation && typeof splat.rotation.x === 'number') {
    splat.rotation.x = Math.PI;
  }
  if (typeof splat.updateMatrixWorld === 'function') {
    splat.updateMatrixWorld(true);
  }
}

/** forEachSplat で中心をサンプリングし、軸ごと [p2,p98] で外れ値に頑健なローカル境界を作る。 */
function robustLocalBox(splat, count) {
  const step = Math.max(1, Math.floor(count / FRAME.MAX_SAMPLES));
  const xs = [];
  const ys = [];
  const zs = [];
  let i = 0;
  splat.forEachSplat((index, center) => {
    if (i++ % step !== 0) return;
    xs.push(center.x);
    ys.push(center.y);
    zs.push(center.z);
  });
  if (xs.length === 0) return null;
  const pct = (arr, p) => {
    arr.sort((a, b) => a - b);
    const idx = Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))));
    return arr[idx];
  };
  const box = new THREE.Box3(
    new THREE.Vector3(pct(xs, FRAME.LO_PCT), pct(ys, FRAME.LO_PCT), pct(zs, FRAME.LO_PCT)),
    new THREE.Vector3(pct(xs, FRAME.HI_PCT), pct(ys, FRAME.HI_PCT), pct(zs, FRAME.HI_PCT))
  );
  return box.isEmpty() ? null : box;
}

/** SplatMesh のワールド境界（matrixWorld=180°補正込み）を算出。取得不能時は null。 */
async function computeSplatWorldBox(splat) {
  try {
    const splatCount = () => splat.numSplats || splat.packedSplats?.numSplats || 0;
    // データ充填を待つ（numSplats を提供する実 Spark でのみ意味を持つ）。
    if (typeof splat.numSplats === 'number' || splat.packedSplats) {
      const start = performance.now();
      while (splatCount() === 0 && performance.now() - start < FRAME.DATA_WAIT_MS) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    // 1) 外れ値に頑健なローカル境界を優先（floater が生境界を数倍に膨張させるため）。
    let localBox = null;
    if (typeof splat.forEachSplat === 'function' && splatCount() > 0) {
      localBox = robustLocalBox(splat, splatCount());
    }
    // 2) フォールバック: getBoundingBox（生境界）。
    if (!localBox && typeof splat.getBoundingBox === 'function') {
      const local = splat.getBoundingBox();
      if (local?.min && local?.max) {
        localBox = new THREE.Box3(
          new THREE.Vector3(local.min.x, local.min.y, local.min.z),
          new THREE.Vector3(local.max.x, local.max.y, local.max.z)
        );
      }
    }
    if (!localBox || localBox.isEmpty()) return null;
    if (typeof splat.updateMatrixWorld === 'function') splat.updateMatrixWorld(true);
    if (splat.matrixWorld) localBox.applyMatrix4(splat.matrixWorld);
    return localBox.isEmpty() ? null : localBox;
  } catch (e) {
    console.warn('[viewer] シーン境界の取得に失敗、初期視点配置をスキップ:', e);
    return null;
  }
}

/** x/y/z すべて有限数の Vec3 か。 */
function isVec3(v) {
  return (
    v != null &&
    typeof v === 'object' &&
    ['x', 'y', 'z'].every((k) => typeof v[k] === 'number' && Number.isFinite(v[k]))
  );
}

/**
 * 保存済み開始視点（scenes.json の viewpoint）を適用する。
 * position/target は必須、fov/near/far は任意。適用したら true、不正・未指定なら false。
 */
function applyViewpoint(vp, camera, controls) {
  if (!vp || !isVec3(vp.position) || !isVec3(vp.target)) return false;
  camera.position.set(vp.position.x, vp.position.y, vp.position.z);
  if (typeof vp.fov === 'number') camera.fov = vp.fov;
  if (typeof vp.near === 'number') camera.near = vp.near;
  if (typeof vp.far === 'number') camera.far = vp.far;
  camera.updateProjectionMatrix();
  controls.target.set(vp.target.x, vp.target.y, vp.target.z);
  controls.update();
  return true;
}

/** splat の bounding box からカメラ位置・注視点・クリップ面を自動調整する。 */
async function frameCameraToSplat(splat, camera, controls) {
  const box = await computeSplatWorldBox(splat);
  if (!box || box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxExtent = Math.max(size.x, size.y, size.z) || 1;

  const dir = new THREE.Vector3(FRAME.VIEW_DIR.x, FRAME.VIEW_DIR.y, FRAME.VIEW_DIR.z).normalize();
  const distance = maxExtent * FRAME.DISTANCE_FACTOR;
  camera.position.set(
    center.x + dir.x * distance,
    center.y + dir.y * distance,
    center.z + dir.z * distance
  );
  // クリップ面をシーン規模へ（巨大/微小シーンでも near/far に収める）。
  camera.near = Math.max(maxExtent / 1000, 0.01);
  camera.far = maxExtent * 100;
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
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

  // ── 視点キャプチャ（開発補助）──
  // V キーで現在のカメラ視点を scenes.json の "viewpoint" へ貼り付けられる形で console 出力。
  // Spark で決めた構図を手元で再現 → V → 出力値を該当シーンに貼るとその視点で起動する。
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'v' && e.key !== 'V') return;
    const r = (n) => Math.round(n * 1000) / 1000;
    const p = camera.position;
    const t = controls.target;
    const vp = {
      position: { x: r(p.x), y: r(p.y), z: r(p.z) },
      target: { x: r(t.x), y: r(t.y), z: r(t.z) },
      fov: camera.fov,
    };
    console.log('[viewer] 現在の視点（scenes.json の "viewpoint" に貼り付け）:\n' + JSON.stringify(vp, null, 2));
    setStatus('視点をコンソールに出力しました（V キー）');
  });

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
    orientSplat(splat); // 上下補正（X軸180°）
    // 保存済み開始視点があればそれを優先。無ければ bbox から自動枠取り。
    if (!applyViewpoint(target.viewpoint, camera, controls)) {
      await frameCameraToSplat(splat, camera, controls);
    }
    setStatus(`表示中: ${target.label}`);
  } catch (e) {
    console.error('[viewer] splat 読込失敗:', e);
    setStatus(`読込失敗: ${target.label}（${e.message}）`);
  }
}

main();
