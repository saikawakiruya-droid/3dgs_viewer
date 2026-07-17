# 3DGS Viewer — 引き継ぎ指示書

このリポジトリは、既存の WebGPU アバターメタバース（`../MetaVarsee`）から **3DGS（3D Gaussian Splatting）描画を分離した新規プロジェクト**です。次セッションはこのディレクトリで開始してください。

- **作業場所**: `/Users/arai-narumi/Desktop/XR/Metavarse_3dgs-viewer`
- **作成日**: 2026-07-17
- **前提の経緯**: `../MetaVarsee` は Three.js **WebGPURenderer + TSL** に全面移行済みで、Spark（3DGS）は **WebGL2 専用**のため同一シーンに載せられない。よって 3DGS は別プロジェクトに切り出し、将来は**同一 WebSocket サーバーを共用**する方針（B案）。

---

## なぜ新規リポなのか（決定事項）

- Spark（`@sparkjsdev/spark`）は WebGL2 専用。`MetaVarsee` の WebGPU/TSL 資産とは同一レンダラーで共存不可。
- 既存の 3DGS 実装 `../Metavarse_3dgs` は Spark 2.1.0 で成熟しているが、アバター歩行・メッシュ合成・視点編集まで盛り込まれ複雑。今回は**「3DGS のみ表示」から作り直し、床などを段階追加する**方針のため、最小構成で新規作成した。
- API 実績（`SplatMesh` / `SparkRenderer` / 完了待機）は `../Metavarse_3dgs/src/rendering/SplatSceneLoader.js` と `src/app/ViewerApp.js` を参照して踏襲済み。

## スタック

- Vite ^6 / Three `~0.180.0` / `@sparkjsdev/spark` ^2.1.0（`../Metavarse_3dgs` と同一系列＝アセット互換）
- レンダラー: **WebGLRenderer**（WebGPU ではない）

---

## 現在の実装状況（Phase 1 = 完了済みの最小状態）

**3DGS を 1 シーンだけ表示するビューア**として動作する最小構成まで作成済み。

| ファイル | 役割 |
|---|---|
| `index.html` | canvas コンテナ + ステータス表示 |
| `src/main.js` | 中核。renderer/scene/camera/SparkRenderer/OrbitControls を配線し、**URL リンクで splat を選んで描画** |
| `src/config.js` | 描画定数、マニフェスト URL、後続用の `WS_CONFIG`（現在 `ENABLED:false`） |
| `public/scenes/scenes.json` | シーン一覧（id → splat URL） |
| `public/scenes/*.ply, *.spz` | アセット（**symlink**。`.gitignore` 済でリポには含めない） |

### リンク駆動の描画切替（今回の主眼）

`src/main.js` の `resolveSplatUrl()` が URL クエリを解釈する:

- `?url=<path>` … splat（.ply/.spz）を直接指定（最優先）
- `?scene=<id>` … `scenes.json` の id を選択
- 指定なし … `scenes.json` の `default`（無ければ先頭）

例:
- `http://localhost:3100/?scene=shrine-web`
- `http://localhost:3100/?scene=room`
- `http://localhost:3100/?url=/scenes/shrine_web.ply`

### アセット（symlink 実体）

- `public/scenes/shrine_web.ply` → `../Metavarse_3dgs/public/scenes/shrine_web.ply`（64MB, 軽量・既定）
- `public/scenes/room.spz` → `../MetaVarsee/public/spz/scene.spz`（104MB）

> 大容量のため Git には含めない（`.gitignore` 設定済）。配布時は外部ストレージ or Git LFS を検討。

---

## 起動方法（次セッション最初の手順）

```bash
cd /Users/arai-narumi/Desktop/XR/Metavarse_3dgs-viewer
npm install        # 未実行。最初に必要
npm run dev        # http://localhost:3100
```

- 起動後、左下ステータスに「表示中: Shrine (PLY, 軽量)」と出れば OK。
- **未検証**: `npm install` と `npm run dev` はまだ実行していない。最初に疎通確認すること。
- Spark のバージョン解決（`^2.1.0`）で API 差異が出た場合は `../Metavarse_3dgs/src/rendering/SplatSceneLoader.js` の実績実装に合わせる。

---

## 次にやること（Phase 2 以降のロードマップ）

1. **疎通確認**: `npm install` → `npm run dev` で shrine_web / room が表示されるか。表示されない場合は Spark の import 名（`SparkRenderer` / `SplatMesh`）と読込完了イベントを実 API と突き合わせる。
2. **床の追加**: `THREE.GridHelper` or `Mesh(PlaneGeometry)` を scene に足す。splat と mesh の前後（深度）関係の見え方を確認（`../Metavarse_3dgs-mesh` の深度合成ブランチが参考）。
3. **カメラ初期位置の自動調整**: splat の bounding box からカメラ距離を決める（`../Metavarse_3dgs/src/app/ViewerApp.js` に実装例あり）。
4. **同一サーバー共用（マルチプレイヤー）**: `config.js` の `WS_CONFIG.ENABLED` を true にし、`../MetaVarsee` から `websocket-manager.js` / `multiplayer-manager.js` / `binary-protocol.js` を移植。**`binary-protocol.js` のワイヤフォーマットを MetaVarsee と一致させる**こと（ズレると疎通不能）。サーバー本体は Render 上の別サービス（`wss://neccosmetaverse-websocketserver.onrender.com`）で無変更。
5. **アバター表示**: 他プレイヤー/自分のアバターを splat 空間内に描画（WebGL のため VRM/glTF はそのまま使える）。

## 参考リポジトリ

- `../MetaVarsee` — 本体（WebGPU アバターメタバース）。サーバー接続・binary-protocol の移植元。
- `../Metavarse_3dgs` — 先行 3DGS 実装（Spark 2.1.0）。SplatMesh/SparkRenderer の実績配線、シーンカタログ、視点編集の参照元。
- `../Metavarse_3dgs-mesh` — 上記の worktree（mesh + splat 深度合成ブランチ）。床/メッシュ合成の参照元。

## 未決事項 / 確認したいこと

- Git 初期化の要否（現状 `git init` 未実行）。別リモートを作るか、モノレポ化するか。
- リンク方式は `?scene=<id>` クエリで実装済み。パス方式（`/space/<id>`）やサブドメイン方式が必要なら要相談。
