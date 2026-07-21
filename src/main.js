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
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { TaisoAvatar } from './TaisoAvatar.js';
import { AvaturnController } from './avaturn-controller.js';
import {
  MANIFEST_URL,
  ASSET_BASE,
  RENDER_CONFIG,
  LOAD_TIMEOUT_MS,
  SPARK_CONFIG,
  QUALITY_PRESETS,
  QUALITY_LABELS,
  DEFAULT_QUALITY,
  AVATAR_CONFIG,
  AUDIO_CONFIG,
} from './config.js';

/** 画質プリセットを SparkRenderer / renderer に適用する（RAD/SPZ の LOD に効く）。 */
function applyQuality(spark, renderer, name) {
  const q = QUALITY_PRESETS[name] || QUALITY_PRESETS[DEFAULT_QUALITY];
  spark.lodSplatCount = q.lodSplatCount;
  spark.lodRenderScale = q.lodRenderScale;
  spark.maxStdDev = q.maxStdDev;
  spark.blurAmount = q.blurAmount;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  if ('lodDirty' in spark) spark.lodDirty = true;
  if (typeof spark.setDirty === 'function') spark.setDirty();
}

/** FPS / メモリ / LOD 常駐 splat 数 を表示する軽量パネル。tick() を毎フレーム呼ぶ。 */
function createStatsUI(spark) {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;top:12px;left:12px;z-index:10;font:12px/1.5 ui-monospace,SFMono-Regular,monospace;' +
    'color:#9effa0;background:rgba(0,0,0,0.5);padding:4px 8px;border-radius:6px;pointer-events:none;white-space:pre;';
  document.body.appendChild(el);
  let frames = 0;
  let last = performance.now();
  return {
    tick() {
      frames++;
      const now = performance.now();
      if (now - last >= 500) {
        const fps = Math.round((frames * 1000) / (now - last));
        frames = 0;
        last = now;
        const parts = [`FPS ${fps}`];
        // JS ヒープ使用量（Chrome 系のみ）。
        if (performance.memory && performance.memory.usedJSHeapSize) {
          parts.push(`Mem ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)}MB`);
        }
        // LOD 常駐 splat 数（画質設定に連動＝読み込み規模の目安）。
        if (spark && typeof spark.lodSplatCount === 'number') {
          parts.push(`Splats ${(spark.lodSplatCount / 1e6).toFixed(1)}M`);
        }
        // 実DL量は Spark が Worker 内 fetch で取得するためメインスレッドから計測不可。
        // 正確な値は DevTools → Network（.rad の Transferred）で確認する。
        el.textContent = parts.join('  |  ');
      }
    },
  };
}

/** 画質切替のドロップダウン UI を作成し、変更時に applyQuality を呼ぶ。 */
function createQualityUI(initial, onChange) {
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'position:fixed;top:12px;right:12px;z-index:10;font:13px/1.4 system-ui,sans-serif;' +
    'color:#cfd2ff;background:rgba(0,0,0,0.5);padding:6px 8px;border-radius:6px;';
  const label = document.createElement('label');
  label.textContent = '背景の画質 ';
  const sel = document.createElement('select');
  sel.style.cssText = 'font:inherit;color:#fff;background:#222;border:1px solid #555;border-radius:4px;padding:2px 4px;';
  for (const key of Object.keys(QUALITY_PRESETS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = QUALITY_LABELS[key] || key;
    if (key === initial) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  label.appendChild(sel);
  wrap.appendChild(label);
  document.body.appendChild(wrap);
}

/**
 * BGM コントローラを生成する。再生は T キー（体操開始）から制御する。
 * @returns {{ isPlaying: () => boolean, time: () => number, playFromStart: () => Promise<void> } | null}
 */
function setupAudio() {
  if (!AUDIO_CONFIG.ENABLED) return null;
  const audio = new Audio(AUDIO_CONFIG.URL);
  audio.loop = AUDIO_CONFIG.LOOP;
  audio.volume = AUDIO_CONFIG.VOLUME;
  return {
    isPlaying: () => !audio.paused,
    time: () => audio.currentTime,
    playFromStart() {
      try { audio.currentTime = 0; } catch (_) { /* noop */ }
      return audio.play().catch(() => {});
    },
  };
}

const DEG = Math.PI / 180;

/** url 末尾の拡張子（クエリ除去, 小文字）。 */
function extOf(url) {
  return (url.split('?')[0].split('.').pop() || '').toLowerCase();
}

/** RAD/SPZ は LOD ツリーを持つ。生 PLY は LOD 無。 */
function isLodFormat(ext) {
  return ext === 'rad' || ext === 'spz';
}

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
    camera: entry.camera, // 任意: 手調整カメラ { pos:[x,y,z], look:[x,y,z] }（検証システム方式）
    orient: entry.orient, // 任意: 向き { rx, ry, rz }（度）。無指定は既定 rx=180。
    viewpoint: entry.viewpoint, // 後方互換: { position, target, fov? }。camera が無い場合に使用。
  };
}

/**
 * SplatMesh を LOD 対応で生成する（検証システム ~/Desktop/splats/viewer と同方式）。
 * RAD/SPZ は lod ツリーで段階ロード、生 PLY は全 splat 常駐。
 * onLoad / onError / mesh.initialized のいずれかで解決し、LOAD_TIMEOUT_MS で打ち切る。
 * @returns {{ mesh: SplatMesh, loaded: Promise<void> }}
 */
function loadSplatMesh(url) {
  const isLod = isLodFormat(extOf(url));
  let settle;
  const loaded = new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; reject(new Error(`splat load timeout (${LOAD_TIMEOUT_MS / 1000}s)`)); }
    }, LOAD_TIMEOUT_MS);
    settle = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      err ? reject(err) : resolve();
    };
  });
  const mesh = new SplatMesh({
    url,
    lod: isLod,
    nonLod: true,
    onLoad: () => settle(),
    onError: (e) => settle(e || new Error('splat load error')),
  });
  // initialized が拒否された場合も拾う（onError と両方は発火しない前提でガード済み）。
  if (mesh.initialized && typeof mesh.initialized.catch === 'function') {
    mesh.initialized.catch((e) => settle(e || new Error('splat init error')));
  }
  return { mesh, loaded };
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

/**
 * シーンの向き { rx, ry, rz }（度）を解決する（検証システム orientOf 準拠）。
 * -Y-up で学習された 3DGS は既定の X軸180° で上向きに直る。無指定は rx=180。
 * 点群等 up 軸が異なるシーンは orient で上書きする（例: { rx: 90 }）。
 */
function orientOf(entry) {
  const o = (entry && entry.orient) || {};
  return { rx: o.rx ?? 180, ry: o.ry ?? 0, rz: o.rz ?? 0 };
}

/** 向き（度）を splat に適用する。 */
function applyOrient(splat, o) {
  if (splat.rotation && typeof splat.rotation.set === 'function') {
    splat.rotation.set(o.rx * DEG, o.ry * DEG, o.rz * DEG);
  }
  if (typeof splat.updateMatrixWorld === 'function') {
    splat.updateMatrixWorld(true);
  }
}

/** 有限数 3 要素の配列 [x,y,z] か。 */
function isVec3Arr(a) {
  return Array.isArray(a) && a.length === 3 && a.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/**
 * 手調整カメラ { pos:[x,y,z], look:[x,y,z] } を適用する（検証システム方式）。
 * camera.position.set(...pos) + controls.target(...look) + lookAt。適用したら true。
 */
function applyCamera(cam, camera, controls) {
  if (!cam || !isVec3Arr(cam.pos) || !isVec3Arr(cam.look)) return false;
  camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
  camera.lookAt(cam.look[0], cam.look[1], cam.look[2]);
  controls.target.set(cam.look[0], cam.look[1], cam.look[2]);
  controls.update();
  return true;
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

/**
 * 床の傾き診断（開発補助・F キー）。
 * splat 中心をワールド座標でサンプリング → (x,z) セルごとの床高（下位2番目の y で
 * floater を弾く）→ 平面 y = a·x + b·z + c を最小二乗フィットし、床の傾きを算出する。
 * a=x方向勾配, b=z方向勾配。傾き角 = atan(勾配)。水平なら a,b≈0。
 * 「社屋に近づくと足が埋まる」= その進行方向に床が上る（勾配が大きい）ことを数値で示す。
 */
function analyzeFloor(splat) {
  if (!splat) { console.warn('[床診断] splat が未ロード'); return; }
  splat.updateMatrixWorld(true);
  const m = splat.matrixWorld;
  const v = new THREE.Vector3();
  const CELL = 1.0; // セルサイズ

  // 列挙ソースを順に試す（LOD では SplatMesh 直下が 0 のことがある）。
  const sources = [
    ['splat', splat],
    ['splat.packedSplats', splat.packedSplats],
    ['splat.splats', splat.splats],
  ];
  console.log('[床診断] カウント:',
    JSON.stringify({
      'splat.numSplats': splat.numSplats ?? null,
      'packedSplats.numSplats': splat.packedSplats?.numSplats ?? null,
      'splats.numSplats': splat.splats?.numSplats ?? null,
    })
  );

  // ワールド座標の bbox（スケール/オフセット把握用）と (x,z) セル床高を集める。
  const cells = new Map();
  const bb = { minx: Infinity, maxx: -Infinity, miny: Infinity, maxy: -Infinity, minz: Infinity, maxz: -Infinity };
  let raw = 0, srcUsed = null;
  const runOn = (obj) => {
    if (!obj || typeof obj.forEachSplat !== 'function') return 0;
    let n = 0;
    obj.forEachSplat((idx, center) => {
      v.copy(center).applyMatrix4(m);
      n++;
      if (v.x < bb.minx) bb.minx = v.x; if (v.x > bb.maxx) bb.maxx = v.x;
      if (v.y < bb.miny) bb.miny = v.y; if (v.y > bb.maxy) bb.maxy = v.y;
      if (v.z < bb.minz) bb.minz = v.z; if (v.z > bb.maxz) bb.maxz = v.z;
      const cx = Math.round(v.x / CELL), cz = Math.round(v.z / CELL);
      const k = cx + ',' + cz;
      const c = cells.get(k);
      if (!c) cells.set(k, { m1: v.y, m2: Infinity });
      else if (v.y < c.m1) { c.m2 = c.m1; c.m1 = v.y; }
      else if (v.y < c.m2) { c.m2 = v.y; }
    });
    return n;
  };
  for (const [name, obj] of sources) {
    raw = runOn(obj);
    if (raw > 0) { srcUsed = name; break; }
    cells.clear();
  }
  const r3 = (n) => Math.round(n * 1000) / 1000;
  console.log('[床診断] 列挙結果:', JSON.stringify({
    使用ソース: srcUsed, 反復数: raw, セル数: cells.size,
    worldBBox: srcUsed ? {
      x: [r3(bb.minx), r3(bb.maxx)], y: [r3(bb.miny), r3(bb.maxy)], z: [r3(bb.minz), r3(bb.maxz)],
    } : null,
  }, null, 2));
  if (raw === 0) {
    console.warn('[床診断] どのソースからも splat 中心を列挙できませんでした。' +
      'LOD(RAD) は splat データが Worker 常駐で main スレッドから列挙不可の可能性大。別手法を検討します。');
    return;
  }
  if (cells.size < 8) {
    console.warn(`[床診断] セル数が少なすぎます（${cells.size}）`);
    return;
  }

  // 最小二乗: [Sxx Sxz Sx; Sxz Szz Sz; Sx Sz N]·[a;b;c] = [Sxy; Szy; Sy]
  let Sxx = 0, Sxz = 0, Sx = 0, Szz = 0, Sz = 0, N = 0, Sxy = 0, Szy = 0, Sy = 0;
  const floorPts = [];
  for (const [k, c] of cells) {
    const [cx, cz] = k.split(',').map(Number);
    const x = cx * CELL, z = cz * CELL;
    const y = Number.isFinite(c.m2) ? c.m2 : c.m1;
    floorPts.push([x, z, y]);
    Sxx += x * x; Sxz += x * z; Sx += x; Szz += z * z; Sz += z; N += 1;
    Sxy += x * y; Szy += z * y; Sy += y;
  }
  const det3 = (a) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const M = [[Sxx, Sxz, Sx], [Sxz, Szz, Sz], [Sx, Sz, N]];
  const D = det3(M);
  if (Math.abs(D) < 1e-9) { console.warn('[床診断] 行列が特異でフィット不可'); return; }
  const rhs = [Sxy, Szy, Sy];
  const col = (M0, j, r) => M0.map((row, ri) => row.map((val, ci) => (ci === j ? r[ri] : val)));
  const a = det3(col(M, 0, rhs)) / D;
  const b = det3(col(M, 1, rhs)) / D;
  const cc = det3(col(M, 2, rhs)) / D;

  // 残差RMS（フィットの信頼度）
  let se = 0;
  for (const [x, z, y] of floorPts) { const e = a * x + b * z + cc - y; se += e * e; }
  const rms = Math.sqrt(se / floorPts.length);

  const DEG_ = 180 / Math.PI;
  const sampled = raw;
  const tiltX = Math.atan(b) * DEG_; // z方向勾配 → X軸まわりの傾き
  const tiltZ = Math.atan(a) * DEG_; // x方向勾配 → Z軸まわりの傾き
  const slopeDeg = Math.atan(Math.hypot(a, b)) * DEG_;
  const dirDeg = (Math.atan2(b, a) * DEG_ + 360) % 360; // 最急上り方向（xz平面, +xから反時計)

  const at = (x, z) => (a * x + b * z + cc);
  console.log(
    '[床診断] 平面フィット結果\n' +
    JSON.stringify({
      サンプル数: sampled, セル数: cells.size, 残差RMS_m: r3(rms),
      x方向勾配a: r3(a), z方向勾配b: r3(b), 切片c_床高at原点: r3(cc),
      最急勾配deg: r3(slopeDeg), 最急上り方向deg: r3(dirDeg),
      推定傾きX_deg: r3(tiltX), 推定傾きZ_deg: r3(tiltZ),
      床高_spawn_2_n1: r3(at(2, -1)),
      床高_z手前_0_10: r3(at(0, 10)),
      床高_z奥_0_n10: r3(at(0, -10)),
      補正案_orientに加算: { rx: r3(-tiltX), rz: r3(-tiltZ) },
    }, null, 2)
  );
  return { a, b, c: cc, tiltX, tiltZ, slopeDeg, dirDeg, rms };
}

async function main() {
  const container = document.getElementById('canvas-container');
  const music = setupAudio(); // BGM（T キー＝体操開始で再生制御）

  // ── renderer ──
  // FPS チューニング（中品質の見た目は保ったまま GPU コストのみ削減）:
  // - antialias:false … 3DGS splat は Spark 側の blurAmount で縁を柔らかくしており、
  //   全画面 MSAA は splat にほぼ効かず GPU 塗りコストだけ増える。無効化しても背景は不変
  //   （影響はアバターのポリゴン輪郭のみ）。
  // - powerPreference:'high-performance' … デュアル GPU 機で discrete GPU を優先。
  // - stencil:false … 未使用のステンシルバッファを持たない（帯域の無駄を削減）。
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER_CONFIG.PIXEL_RATIO_MAX));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  // ── scene / camera ──
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(RENDER_CONFIG.BACKGROUND_COLOR);

  // ── ライト（splat は自己発光だが GLB アバターには光源が必要）──
  // Avaturn 系 GLB は PBR マテリアルのため、環境マップ(IBL)が無いと黒くなる。
  // RoomEnvironment を PMREM で環境マップ化して scene.environment に設定する。
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.0));
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
  dirLight.position.set(5, 10, 5);
  scene.add(dirLight);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // ── 歩行面グリッド（位置関係の可視化・追従＋距離フェード）──
  // 問題点の対処: 巨大な一枚グリッドは遠方が地平線方向へ伸び、深度を書かない splat の
  // 手前（社殿など）に線が突き抜けて見える。そこで「アバター周辺だけ表示し遠方はフェード
  // アウトする追従グリッド」にする。マス目はワールド固定（世界座標で計算）、フェード中心が
  // アバターに追従する。高さ groundY は PageUp/Down で床に合わせる。G で表示トグル。
  let groundY = AVATAR_CONFIG.POSITION.y;
  let gridTiltX = 0; // 前後の傾き（rad）。傾いた splat 床に合わせる。
  let gridTiltZ = 0; // 左右の傾き（rad）。
  let markA = null;  // 2点接地法の A 地点 { x, z, y }
  const GRID_RADIUS = 9; // これを超えると完全に消える（社殿まで届かない）
  const gridMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    extensions: { derivatives: true }, // WebGL1 用（WebGL2 では core）
    uniforms: {
      uCenter: { value: new THREE.Vector3() }, // フェード中心（アバターのワールド座標）
      uCell: { value: 1.0 },                   // マス 1 単位
      uRadius: { value: GRID_RADIUS },
      uColor: { value: new THREE.Color(0x66ccff) },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      precision highp float;
      varying vec3 vWorld;
      uniform vec3 uCenter; uniform float uCell; uniform float uRadius; uniform vec3 uColor;
      void main() {
        vec2 p = vWorld.xz / uCell;                       // ワールド固定のマス目
        vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);   // 線までの距離（AA）
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        float d = distance(vWorld.xz, uCenter.xz);
        float fade = 1.0 - smoothstep(uRadius * 0.5, uRadius, d); // 半径でフェード
        float a = line * fade * 0.6;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
  });
  // 追従面はフェード半径を覆うサイズ（直径 + マージン）。XZ 平面へ寝かせる。
  const gridPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(GRID_RADIUS * 2 + 4, GRID_RADIUS * 2 + 4),
    gridMat
  );
  gridPlane.position.y = groundY;
  gridPlane.renderOrder = 1;
  gridPlane.visible = false; // 既定は非表示（開発時のみ G キーで表示）。本番では出さない。
  // 水平（-90°）を基準に、前後(X)・左右(Z)の傾きを足して床の傾斜へ合わせる。
  const applyGridRotation = () => gridPlane.rotation.set(-Math.PI / 2 + gridTiltX, 0, gridTiltZ);
  applyGridRotation();
  scene.add(gridPlane);

  const camera = new THREE.PerspectiveCamera(
    RENDER_CONFIG.CAMERA_FOV,
    window.innerWidth / window.innerHeight,
    RENDER_CONFIG.CAMERA_NEAR,
    RENDER_CONFIG.CAMERA_FAR
  );
  const p = RENDER_CONFIG.INITIAL_CAMERA_POSITION;
  camera.position.set(p.x, p.y, p.z);

  // ── Spark: SparkRenderer を scene に add すると splat 描画が有効化される ──
  // LOD 再walk/再ソートを描画パスから外し（preUpdate:false）、再ソートを間引く（RAD/SPZ 用）。
  const spark = new SparkRenderer({
    renderer,
    preUpdate: SPARK_CONFIG.PRE_UPDATE,
    minSortIntervalMs: SPARK_CONFIG.MIN_SORT_INTERVAL_MS,
  });
  scene.add(spark);
  // LOD 画質（RAD/SPZ のみ効く）。UI で切替可能。既定は DEFAULT_QUALITY。
  applyQuality(spark, renderer, DEFAULT_QUALITY);
  createQualityUI(DEFAULT_QUALITY, (name) => applyQuality(spark, renderer, name));
  const stats = createStatsUI(spark); // FPS / メモリ / splat 数

  // ── camera controls ──
  // 操作モードでは AvaturnController が三人称カメラを所有するため OrbitControls は使わない。
  const controllable = AVATAR_CONFIG.ENABLED && AVATAR_CONFIG.CONTROLLABLE;
  let controls = null;
  let avatarController = null;
  if (controllable) {
    avatarController = new AvaturnController(camera, renderer.domElement, {
      taisoUrl: AVATAR_CONFIG.BVH_URL, // T キーで体操エモート
      music, // 体操と同期する BGM
    });
  } else {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
  }

  // ── 視点キャプチャ（開発補助・非操作モードのみ）──
  // V キーで現在のカメラを scenes.json の "camera": { pos, look } 形式で console 出力。
  window.addEventListener('keydown', (e) => {
    if (!controls) return;
    if (e.key !== 'v' && e.key !== 'V') return;
    const r = (n) => Math.round(n * 1000) / 1000;
    const p = camera.position;
    const t = controls.target;
    const cam = { pos: [r(p.x), r(p.y), r(p.z)], look: [r(t.x), r(t.y), r(t.z)] };
    console.log('[viewer] 現在のカメラ（scenes.json の "camera" に貼り付け）:\n' + JSON.stringify(cam));
    setStatus('カメラをコンソールに出力しました（V キー）');
  });

  // ── resize ──
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ── アバター（体操モード用の TaisoAvatar / 操作モード用の GLB 参照）──
  let avatar = null;
  let ctrlModel = null; // 操作モードの GLB（床高調整で参照）
  let loadedSplat = null; // 読込済み SplatMesh（床傾き診断 F キーで参照）

  // ── 床高調整 & グリッド表示（操作モードの位置合わせ補助）──
  // PageUp/PageDown: 歩行面（アバター＋グリッド）を同時に上下。Shift で粗調整。
  // G: グリッド表示トグル。B: 現在の床高（POSITION.y）を console 出力。
  window.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.25 : 0.05;      // 高さステップ
    const tstep = e.shiftKey ? 0.02 : 0.005;     // 傾きステップ（rad）
    let handled = true;
    let rot = false;
    switch (e.key) {
      // 床高（アバター＋グリッド同時）。Mac は PageUp/Down が無いため R/C も割当。
      case 'PageUp': case 'r': case 'R': groundY += step; break;
      case 'PageDown': case 'c': case 'C': groundY -= step; break;
      // グリッドの傾き（床の傾斜合わせ）: I/K=前後, J/L=左右
      case 'i': case 'I': gridTiltX += tstep; rot = true; break;
      case 'k': case 'K': gridTiltX -= tstep; rot = true; break;
      case 'j': case 'J': gridTiltZ += tstep; rot = true; break;
      case 'l': case 'L': gridTiltZ -= tstep; rot = true; break;
      case 'g': case 'G': gridPlane.visible = !gridPlane.visible; break;
      // 床の傾き診断（splat列挙。LODでは不可なことが判明。2点接地法を使う）
      case 'f': case 'F': {
        setStatus('床の傾きを診断中…（コンソール出力）');
        analyzeFloor(loadedSplat);
        return;
      }
      // 2点接地法: 1=A地点マーク, 2=B地点マーク＋勾配/傾き/orient補正を自動計算。
      // 使い方: 各地点で PageUp/Down で足を床に接地させてから 1(手前)→移動→2(社屋付近)。
      case '1': {
        const pos = ctrlModel ? ctrlModel.position : (avatar && avatar.model && avatar.model.position);
        if (!pos) { setStatus('アバター未読込'); return; }
        markA = { x: pos.x, z: pos.z, y: groundY };
        const r = (n) => Math.round(n * 1000) / 1000;
        console.log('[2点法] A地点:', JSON.stringify({ x: r(markA.x), z: r(markA.z), y: r(markA.y) }));
        setStatus(`A地点マーク x=${r(markA.x)} z=${r(markA.z)} y=${r(markA.y)}（次にB地点へ移動し 2）`);
        return;
      }
      case '2': {
        const pos = ctrlModel ? ctrlModel.position : (avatar && avatar.model && avatar.model.position);
        if (!pos) { setStatus('アバター未読込'); return; }
        if (!markA) { setStatus('先に A 地点を 1 でマークしてください'); return; }
        const B = { x: pos.x, z: pos.z, y: groundY };
        const dx = B.x - markA.x, dz = B.z - markA.z, dy = B.y - markA.y;
        const dist = Math.hypot(dx, dz);
        const r = (n) => Math.round(n * 1000) / 1000;
        if (dist < 0.5) { setStatus('A/B が近すぎます（1m以上離してください）'); return; }
        const slope = dy / dist;                       // 進行方向の勾配
        const DEG_ = 180 / Math.PI;
        const tiltDeg = Math.atan(slope) * DEG_;        // 進行方向の傾き角
        const ux = dx / dist, uz = dz / dist;           // 進行方向の単位ベクトル
        // 勾配が進行方向に沿うと仮定して各軸成分に分解 → orient 補正。
        const aSlope = slope * ux, bSlope = slope * uz; // dy/dx, dy/dz
        const corrRx = -Math.atan(bSlope) * DEG_;
        const corrRz = -Math.atan(aSlope) * DEG_;
        console.log('[2点法] 結果:', JSON.stringify({
          A: { x: r(markA.x), z: r(markA.z), y: r(markA.y) },
          B: { x: r(B.x), z: r(B.z), y: r(B.y) },
          水平距離m: r(dist), 床高差dy_m: r(dy),
          進行方向勾配: r(slope), 進行方向傾きdeg: r(tiltDeg),
          進行方向: { ux: r(ux), uz: r(uz) },
          orient補正案_加算deg: { rx: r(corrRx), rz: r(corrRz) },
        }, null, 2));
        setStatus(`勾配 ${r(slope)}（${r(tiltDeg)}°）dy=${r(dy)}m/${r(dist)}m｜補正 rx+=${r(corrRx)} rz+=${r(corrRz)}`);
        return;
      }
      // stochastic（確率的透明）: ON で splat が深度を書く＝足/グリッドが正しく前後解決
      // （もや状の埋まり解消・splat が手前なら隠す）。代償に背景へディザノイズ。既定 OFF。
      case 'o': case 'O': {
        const v = spark.defaultView;
        v.stochastic = !v.stochastic;
        setStatus(`深度書込(stochastic) ${v.stochastic ? 'ON（埋まり解消・ノイズ有）' : 'OFF（従来画質）'}`);
        return;
      }
      case 'b': case 'B': {
        const r = (n) => Math.round(n * 1000) / 1000;
        const info = { 'POSITION.y': r(groundY), gridTiltX: r(gridTiltX), gridTiltZ: r(gridTiltZ) };
        console.log('[viewer] 床合わせ値（config/main.js へ貼付）:', JSON.stringify(info));
        setStatus(`床 y=${r(groundY)} tiltX=${r(gridTiltX)} tiltZ=${r(gridTiltZ)}（B出力）`);
        return;
      }
      default: handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    if (rot) applyGridRotation();
    if (ctrlModel) ctrlModel.position.y = groundY;
    if (avatar && avatar.model) avatar.model.position.y = groundY;
    // gridPlane の y は描画ループで groundY に追従。
  });

  // ── render loop ──
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    if (controls) controls.update();
    if (avatarController) avatarController.update(dt); // 操作モード（移動＋カメラ追従＋アニメ）
    else if (avatar) avatar.update(dt); // 体操モード
    // 追従グリッド: フェード中心と面をアバターへ、高さを床高へ同期。
    const follow = ctrlModel || (avatar && avatar.model);
    if (follow) {
      gridPlane.position.set(follow.position.x, groundY, follow.position.z);
      gridMat.uniforms.uCenter.value.copy(follow.position);
    } else {
      gridPlane.position.y = groundY;
    }
    renderer.render(scene, camera);
    stats.tick();
  });

  // ── アバター配置調整（開発補助）──
  // 矢印: X/Z 移動 / PageUp・Down: Y 移動 / [ ]: スケール / , .: Y回転 / B: 現在値を出力。
  window.addEventListener('keydown', (e) => {
    if (!avatar || !avatar.model) return;
    const m = avatar.model;
    const step = e.shiftKey ? 0.5 : 0.1;
    let handled = true;
    switch (e.key) {
      case 'ArrowUp': m.position.z -= step; break;
      case 'ArrowDown': m.position.z += step; break;
      case 'ArrowLeft': m.position.x -= step; break;
      case 'ArrowRight': m.position.x += step; break;
      case 'PageUp': m.position.y += step; break;
      case 'PageDown': m.position.y -= step; break;
      case '[': m.scale.multiplyScalar(0.9); break;
      case ']': m.scale.multiplyScalar(1.1); break;
      case ',': m.rotation.y -= 0.1; break;
      case '.': m.rotation.y += 0.1; break;
      case 'b': case 'B': {
        const r = (n) => Math.round(n * 1000) / 1000;
        const t = {
          POSITION: { x: r(m.position.x), y: r(m.position.y), z: r(m.position.z) },
          ROTATION_Y: r(m.rotation.y),
          SCALE: r(m.scale.x),
        };
        console.log('[viewer] アバター transform（config.js AVATAR_CONFIG へ）:\n' + JSON.stringify(t, null, 2));
        setStatus('アバター transform をコンソールに出力（B キー）');
        break;
      }
      default: handled = false;
    }
    if (handled) e.preventDefault();
  });

  // ── splat load（リンク駆動）──
  const target = await resolveSplatUrl();
  if (!target) {
    setStatus('表示できるシーンがありません（scenes.json / ?url= を確認）');
    return;
  }

  setStatus(`読込中: ${target.label} …`);
  try {
    // LOD 対応でロード。mesh は先に scene へ add（RAD/SPZ は add 後に段階ストリーム）。
    const { mesh: splat, loaded } = loadSplatMesh(target.url);
    applyOrient(splat, orientOf(target)); // 向き（既定 rx=180 / per-scene orient）
    scene.add(splat);
    await loaded;
    loadedSplat = splat; // 床傾き診断（F キー）用に参照を保持
    // カメラ: 操作モードは三人称カメラが所有するので枠取りしない。
    // 非操作モードのみ 手調整 camera{pos,look} → viewpoint → bbox 自動枠取り。
    if (controls) {
      if (
        !applyCamera(target.camera, camera, controls) &&
        !applyViewpoint(target.viewpoint, camera, controls)
      ) {
        await frameCameraToSplat(splat, camera, controls);
      }
    }
    setStatus(`表示中: ${target.label}`);
  } catch (e) {
    console.error('[viewer] splat 読込失敗:', e);
    setStatus(`読込失敗: ${target.label}（${e.message}）`);
  }

  // ── アバター読込 ──
  if (AVATAR_CONFIG.ENABLED) {
    const pos = AVATAR_CONFIG.POSITION;
    try {
      if (controllable) {
        // 操作モード: GLB を読込 → AvaturnController に渡す（idle/walk セットアップ＋カメラ追従）。
        const gltf = await new GLTFLoader().loadAsync(AVATAR_CONFIG.MODEL_URL);
        const model = gltf.scene;
        model.scale.setScalar(AVATAR_CONFIG.SCALE);
        model.position.set(pos.x, groundY, pos.z); // y は床高（PageUp/Down で調整）
        model.rotation.y = AVATAR_CONFIG.ROTATION_Y;
        scene.add(model);
        ctrlModel = model;
        avatarController.setModel(model);
        console.log('[viewer] 操作アバター読込完了（WASD 移動 / マウスでカメラ / T で体操）');
        setStatus(`表示中: ${target.label}（WASD移動・マウスでカメラ・Tで体操）`);
      } else {
        // 体操モード: TaisoAvatar（BVH ループ再生・静止）。
        const a = new TaisoAvatar();
        await a.load({
          modelUrl: AVATAR_CONFIG.MODEL_URL,
          bvhUrl: AVATAR_CONFIG.BVH_URL,
          position: new THREE.Vector3(pos.x, pos.y, pos.z),
          rotationY: AVATAR_CONFIG.ROTATION_Y,
          scale: AVATAR_CONFIG.SCALE,
          loop: AVATAR_CONFIG.LOOP,
        });
        scene.add(a.model);
        avatar = a;
        console.log('[viewer] 体操アバター読込完了（矢印/[ ]/, ./B で調整）');
      }
    } catch (e) {
      console.error('[viewer] アバター読込失敗:', e);
    }
  }
}

main();
