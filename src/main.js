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

/** FPS / メモリ / LOD 常駐 splat 数を表示する軽量パネルを作る。tick() を毎フレーム呼ぶ。 */
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

async function main() {
  const container = document.getElementById('canvas-container');
  const music = setupAudio(); // BGM（T キー＝体操開始で再生制御）

  // ── renderer ──
  const renderer = new THREE.WebGLRenderer({ antialias: true });
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

  // ── アバター（体操モード用の TaisoAvatar 参照）──
  let avatar = null;

  // ── render loop ──
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    if (controls) controls.update();
    if (avatarController) avatarController.update(dt); // 操作モード（移動＋カメラ追従＋アニメ）
    else if (avatar) avatar.update(dt); // 体操モード
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
        model.position.set(pos.x, pos.y, pos.z);
        model.rotation.y = AVATAR_CONFIG.ROTATION_Y;
        scene.add(model);
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
