/**
 * アプリ設定。
 * Phase 1（現在）は 3DGS 描画のみ。マルチプレイヤー（同一サーバー共用）は後続フェーズ。
 */

// シーンマニフェストの場所。既定はデプロイ成果物に同梱した scenes.json。
// ローカル前提を持たず、デプロイ/ホスト環境の相対パスで解決する。
export const MANIFEST_URL = import.meta.env.VITE_MANIFEST_URL || './scenes/scenes.json';

// splat アセットの配信ベース URL。
// 本ビューアは MetaVarsee と同一 Web サーバー（同一オリジン）に相乗りし、
// MetaVarsee が既に配信している splat（spz/scene.spz, ply/spaces/scene.ply）を流用する。
// 既定は MetaVarsee の実デプロイ base（dist/index.html・build:dev より確定）。
// scenes.json の相対 url はこれを前置して解決する。絶対 URL（http…）はそのまま使う。
// ローカルにアセットは置かない。必要なら VITE_ASSET_BASE で上書き。
export const ASSET_BASE =
  import.meta.env.VITE_ASSET_BASE || '/xr/NeccosMetaverse_WebGPU_Dev/';

// レンダリング設定（既存 Metavarse_3dgs / ViewerApp の実績値に準拠）。
export const RENDER_CONFIG = {
  BACKGROUND_COLOR: 0x0b0b12,
  CAMERA_FOV: 60,
  CAMERA_NEAR: 0.01,
  CAMERA_FAR: 1000,
  INITIAL_CAMERA_POSITION: { x: 0, y: 0.5, z: 4 },
  PIXEL_RATIO_MAX: 2,
};

// 読込タイムアウト（大容量 splat の安全弁）。
export const LOAD_TIMEOUT_MS = 60_000;

// ─────────────────────────────────────────────
// BGM（ラジオ体操の曲）。ビューアに同梱。ブラウザの autoplay 制限のため初回操作で再生。
// ─────────────────────────────────────────────
export const AUDIO_CONFIG = {
  ENABLED: true,
  URL: `${import.meta.env.BASE_URL}audio/taiso.mp3`,
  LOOP: false, // 1回再生。曲が終わったら体操も idle に戻る（ラジオ体操1セット）。
  VOLUME: 0.7,
};

// ─────────────────────────────────────────────
// ラジオ体操アバター（GLB + BVH）。ビューアに同梱（同一オリジン、R2 ではない）。
// 位置/スケール/回転は splat シーンに合わせて目視調整する（B キーで現在値を console 出力）。
// ─────────────────────────────────────────────
export const AVATAR_CONFIG = {
  ENABLED: true,
  // true: 操作モード（AvaturnController = WASD移動 + 三人称カメラ + idle/walk）。
  // false: 体操モード（TaisoAvatar = neccos_taiso.bvh をループ再生・静止）+ OrbitControls。
  CONTROLLABLE: true,
  MODEL_URL: `${import.meta.env.BASE_URL}model.glb`,
  BVH_URL: `${import.meta.env.BASE_URL}neccos_taiso.bvh`,
  POSITION: { x: 2, y: 0.6, z: -1 }, // 初期配置。y=床高（床の傾き補正 orient rx=182.578 と対で接地）
  ROTATION_Y: 0,
  SCALE: 1,
  LOOP: true,
};

// ─────────────────────────────────────────────
// Spark LOD / 画質設定（検証システム ~/Desktop/splats/viewer の実績値に準拠）。
// RAD/SPZ は LOD ツリーを持つため lodSplatCount 等が効く。生 PLY は LOD 無で無効。
// - preUpdate:false … LOD 再walk/再ソートを描画パスから外しカメラ移動を滑らかに。
// - minSortIntervalMs … 毎フレームではなく ~30回/秒に再ソートを間引く。
// ─────────────────────────────────────────────
export const SPARK_CONFIG = {
  PRE_UPDATE: false,
  MIN_SORT_INTERVAL_MS: 33,
};

// LOD 画質プリセット（検証システム ~/Desktop/splats/viewer の QUALITY 準拠）。UI で切替可。
// 画質を上げるほど精細だが FPS 低下＆ダウンロード量増（lodSplatCount が主コスト・DL量に直結）。
// - lodSplatCount: 常駐 splat 数 / - lodRenderScale: 1未満で精細
// - maxStdDev: splat の裾クリップ / - blurAmount: AA 膨張 / - pixelRatio: 描画解像度上限
export const QUALITY_PRESETS = {
  high:   { lodSplatCount: 5_000_000, lodRenderScale: 0.5, maxStdDev: 3.5,  blurAmount: 0.2,  pixelRatio: 2 },
  medium: { lodSplatCount: 2_500_000, lodRenderScale: 1.0, maxStdDev: 2.4,  blurAmount: 0.2,  pixelRatio: 1.5 },
  low:    { lodSplatCount: 1_200_000, lodRenderScale: 1.0, maxStdDev: 2.83, blurAmount: 0.3,  pixelRatio: 1 },
  vlow:   { lodSplatCount: 500_000,   lodRenderScale: 1.5, maxStdDev: 2.83, blurAmount: 0.35, pixelRatio: 1 },
};
export const QUALITY_LABELS = { high: '高（綺麗）', medium: '中（標準）', low: '低（軽い）', vlow: '最軽（最速）' };
export const DEFAULT_QUALITY = 'medium';

// ─────────────────────────────────────────────
// 後続フェーズ用（現在は未使用）。メタバース本体と同一の WebSocket サーバーを共用する。
// 有効化時は websocket-manager / binary-protocol を MetaVarsee から移植し、
// binary-protocol.js のワイヤフォーマットを両者で一致させること。
// ─────────────────────────────────────────────
export const WS_CONFIG = {
  SERVER_URL: 'wss://neccosmetaverse-websocketserver.onrender.com',
  ENABLED: false, // Phase 1 では無効
};
