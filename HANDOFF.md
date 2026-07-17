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

例（`<host>` はデプロイ先。ローカル前提を持たない）:
- `https://<host>/?scene=shrine-web`
- `https://<host>/?scene=room`
- `https://<host>/?url=https://<asset-host>/shrine_web.ply` （リモート splat を直接指定）

### アセット配信 & ホスティング（重要: MetaVarsee のサーバーを流用）

**この プロジェクトはローカル環境での検証を行わない。** また splat 用に新しい CDN を立てず、**元 `MetaVarsee` と同一の Web サーバー（同一オリジン）に相乗り**する。

- **ビルド/デプロイ方式は MetaVarsee と同一**（[../MetaVarsee/docs/DEPLOYMENT.md](../MetaVarsee/docs/DEPLOYMENT.md)）: `npm run build` → `dist/` の中身を同じ Web サーバーのドキュメントルート（サブディレクトリ）へアップロード。サブディレクトリは `VITE_BASE_PATH` で指定（MetaVarsee と同じ規約。例 `/xr/…/`）。
- **splat アセットは MetaVarsee が既に配信中のものを流用**: 同サーバーの `spz/scene.spz`（104MB）と `ply/spaces/scene.ply`（1.1GB）。`scenes.json` はこの相対パスを指す。
- **配信ベースの実値は確定済み**: MetaVarsee は `/xr/NeccosMetaverse_WebGPU_Dev/` に配信（`../MetaVarsee/dist/index.html` と `package.json` の `build:dev` で確認）。よって splat は `/xr/NeccosMetaverse_WebGPU_Dev/spz/scene.spz`。この値を `ASSET_BASE` の既定として [src/config.js](src/config.js) に焼き込み済み。
- **本ビューアのデプロイ先**（既定）: 同サーバーの別サブディレクトリ `/xr/Metavarse_3dgs_viewer/`（[vite.config.js](vite.config.js) `base` 既定）。→ 両者 same-origin なので CORS/CORP 問題なし。
- `?url=https://…` で任意のリモート splat を直接指定も可。設定上書きは [.env.example](.env.example)。
- **マルチプレイヤーの wss サーバーも同じものを流用**: `wss://neccosmetaverse-websocketserver.onrender.com`（[src/config.js](src/config.js) `WS_CONFIG`、現在 `ENABLED:false`）。

---

## ビルド / デプロイ（ローカル検証はしない）

```bash
npm install
npm run build:dev   # = VITE_BASE_PATH/VITE_ASSET_BASE を確定値で焼き込んで dist/ 生成
# → dist/ の中身を MetaVarsee と同じ Web サーバーの /xr/Metavarse_3dgs_viewer/ へアップロード
```

- 検証は**デプロイ環境**で行う（`npm run dev` on localhost は本プロジェクトの前提にしない）。
- デプロイ後、左下ステータスが「表示中: Space (SPZ, 軽量)」になれば OK。
- **未検証**: `npm install` / build は未実行。Spark の API 差異が出た場合は `../Metavarse_3dgs/src/rendering/SplatSceneLoader.js` の実績実装に合わせる。

---

## 次にやること（Phase 2 以降のロードマップ）

1. **デプロイ設定の確定と疎通**: デプロイ先サブディレクトリ（`VITE_BASE_PATH`）と splat 配信ベース（`VITE_ASSET_BASE`）を確定し、MetaVarsee と同じサーバーへデプロイして space-spz / space-ply が表示されるか確認。表示されない場合は Spark の import 名（`SparkRenderer` / `SplatMesh`）と読込完了イベントを実 API と突き合わせる。cross-origin になる場合は MetaVarsee 側の CORP/CORS ヘッダ（`require-corp`）に注意。
2. **床の追加**: `THREE.GridHelper` or `Mesh(PlaneGeometry)` を scene に足す。splat と mesh の前後（深度）関係の見え方を確認（`../Metavarse_3dgs-mesh` の深度合成ブランチが参考）。
3. **カメラ初期位置の自動調整**: splat の bounding box からカメラ距離を決める（`../Metavarse_3dgs/src/app/ViewerApp.js` に実装例あり）。
4. **同一サーバー共用（マルチプレイヤー）**: `config.js` の `WS_CONFIG.ENABLED` を true にし、`../MetaVarsee` から `websocket-manager.js` / `multiplayer-manager.js` / `binary-protocol.js` を移植。**`binary-protocol.js` のワイヤフォーマットを MetaVarsee と一致させる**こと（ズレると疎通不能）。サーバー本体は Render 上の別サービス（`wss://neccosmetaverse-websocketserver.onrender.com`）で無変更。
5. **アバター表示**: 他プレイヤー/自分のアバターを splat 空間内に描画（WebGL のため VRM/glTF はそのまま使える）。

## 参考リポジトリ

- `../MetaVarsee` — 本体（WebGPU アバターメタバース）。サーバー接続・binary-protocol の移植元。
- `../Metavarse_3dgs` — 先行 3DGS 実装（Spark 2.1.0）。SplatMesh/SparkRenderer の実績配線、シーンカタログ、視点編集の参照元。
- `../Metavarse_3dgs-mesh` — 上記の worktree（mesh + splat 深度合成ブランチ）。床/メッシュ合成の参照元。

## 既存機能の洗い出しと優先度（既存3リポからの取り込み計画）

凡例: **流用可** = Spark/WebGL でそのまま使える / **要移植** = WebGPU 本体（MetaVarsee）から WebGL 化が必要。

### P0: 土台（本ビューアで実装済み）
- splat 描画（WebGLRenderer + SparkRenderer + SplatMesh）〔`Metavarse_3dgs` 流用〕
- リンク駆動シーン選択（`?scene` / `?url`）〔新規〕
- OrbitControls / リサイズ / 読込 60s タイムアウト

### P1: 最優先（roadmap 直近・低コストで効果大）
- **カメラ初期位置の自動調整**（splat の bounding box から距離決定）— 参考 `../Metavarse_3dgs/src/app/ViewerApp.js`
- **床の追加**（GridHelper / Plane）— 新規
- **splat × mesh 深度合成**（depthTest / renderOrder）— 参考 `../Metavarse_3dgs-mesh/src/rendering/MeshOverlay.js`
- SplatSceneLoader の切り出し（差替・dispose-before-create・タイムアウト）— `../Metavarse_3dgs` 流用

### P2: 中（同一サーバー共用 〜 アバター）
- **マルチプレイヤー（同一サーバー共用）**— `../MetaVarsee` の websocket-manager / multiplayer-manager / remote-player / remote-avatar-loader / **binary-protocol**（protocol 一致が必須。サーバー本体は無変更）
- **アバター表示**（他プレイヤー/自分、VRM/glTF。WebGL でそのまま可）— `../MetaVarsee` avatar-loader 系
- Fly/Orbit カメラ切替 + 切替 UI — `../Metavarse_3dgs` FlyController / CameraModeUI
- SceneCatalog（scenes.json 検証・正規化）— `../Metavarse_3dgs` 流用

### P3: 後回し / 任意（複雑 or 本ビューアに必須でない）
- 3DGS アバター歩行 + WalkableArea（円板接地判定。shrine 固有データ依存）— `../Metavarse_3dgs`
- 開始視点の編集 + IndexedDB 保存（ViewpointEditor / ViewpointRepository）— `../Metavarse_3dgs`
- MeshOverlay の GLB 差替 UI — `../Metavarse_3dgs`
- MediaPipe トラッキング（顔/手/pose）+ humanoid-pose-solver — `../MetaVarsee`（WebGPU 依存強・移植重い）
- チャット / NPC / オーディオ / 仮想ジョイスティック / エフェクト / HDRI 環境 — `../MetaVarsee`

## 確定済みの流用情報（元 MetaVarsee のサーバー）

- **splat 配信**: `/xr/NeccosMetaverse_WebGPU_Dev/spz/scene.spz`(104MB) / `…/ply/spaces/scene.ply`(1.1GB) ＝ MetaVarsee が既配信
- **本ビューアのデプロイ先**（既定）: 同サーバー `/xr/Metavarse_3dgs_viewer/`
- **wss サーバー**: `wss://neccosmetaverse-websocketserver.onrender.com`（後続フェーズで `WS_CONFIG.ENABLED=true`）
- **デプロイ方式**: `npm run build:dev` → `dist/` を同サーバーへアップロード（[../MetaVarsee/docs/DEPLOYMENT.md](../MetaVarsee/docs/DEPLOYMENT.md) と同じ）

## 未決事項 / 確認したいこと

- 本ビューアのサブディレクトリ名 `/xr/Metavarse_3dgs_viewer/` は仮。実運用の命名があれば `VITE_BASE_PATH` を差し替え。
- Git 初期化の要否（現状 `git init` 未実行）。別リモートを作るか、モノレポ化するか。
- リンク方式は `?scene=<id>` クエリで実装済み。パス方式（`/space/<id>`）やサブドメイン方式が必要なら要相談。
