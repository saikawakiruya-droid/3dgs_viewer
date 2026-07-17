/**
 * アプリ設定。
 * Phase 1（現在）は 3DGS 描画のみ。マルチプレイヤー（同一サーバー共用）は後続フェーズ。
 */

// 同梱シーンマニフェスト（public/scenes/scenes.json が /scenes/ で配信される）。
export const MANIFEST_URL = '/scenes/scenes.json';

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
// 後続フェーズ用（現在は未使用）。メタバース本体と同一の WebSocket サーバーを共用する。
// 有効化時は websocket-manager / binary-protocol を MetaVarsee から移植し、
// binary-protocol.js のワイヤフォーマットを両者で一致させること。
// ─────────────────────────────────────────────
export const WS_CONFIG = {
  SERVER_URL: 'wss://neccosmetaverse-websocketserver.onrender.com',
  ENABLED: false, // Phase 1 では無効
};
