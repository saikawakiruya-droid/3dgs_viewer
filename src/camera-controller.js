/**
 * CameraController - 三人称カメラ制御
 *
 * メタバース標準のTPS（三人称視点）カメラを提供
 * - 肩越しビュー
 * - マウス/タッチによる視点操作
 * - ホイールによるズーム
 * - カメラ衝突回避
 * - InputManager統合（オプション）
 */
import * as THREE from 'three';
import { isMobileDevice } from './mobile-utils.js';
import { TouchCameraController } from './touch-camera-controller.js';

export class CameraController {
  /**
   * @param {THREE.Camera} camera - Three.jsカメラ
   * @param {HTMLElement} domElement - イベントリスナーを登録するDOM要素
   * @param {Object} options - オプション
   * @param {import('./input/InputManager.js').InputManager} options.inputManager - 入力マネージャー（オプション）
   */
  constructor(camera, domElement = null, options = {}) {
    this.camera = camera;
    this.domElement = domElement || document.body;

    // InputManager（オプション）
    this.inputManager = options.inputManager || null;

    // 入力方向の反転（アバターによってはマウス上下を逆にする）
    this.invertPitch = options.invertPitch === true;
    console.log('[CameraController] constructed with invertPitch=', this.invertPitch);

    // 追従対象
    this.target = null;

    // カメラ設定
    this.distance = 1.8;
    this.height = 1.5;
    this.lookAtHeight = 1.2;
    this.sideOffset = 0.3; // 肩越しオフセット
    this.lerpAmount = 0.1;

    // カメラの向き
    this.yaw = 0;
    this.pitch = 0;
    this.initialYaw = 0;
    this.initialDistance = 1.8;

    // 制限
    this.minPitch = -Math.PI / 2 + 0.2;
    this.maxPitch = Math.PI / 3;
    this.minDistance = 1.5;
    this.maxDistance = 3.0; // ホイール／マウスドラッグ等の通常ズームの上限
    this.keyboardMaxDistance = 30.0; // キーボード（Q/E）操作時のみ拡張される上限

    // マウス操作設定
    this.mouseRotateSpeed = 0.005;
    this.mouseZoomSpeed = 0.3;
    this.isMouseDragging = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    // カメラの現在位置と注視点（補間用）
    this.currentCameraPos = new THREE.Vector3();
    this.currentLookAt = new THREE.Vector3();
    this.initialized = false;

    // 衝突判定マネージャー
    this.collisionManager = null;

    // モバイル対応
    this.isMobile = isMobileDevice();
    this.touchCameraController = null;

    // InputManagerを使用しない場合のみ、従来のイベントリスナーを設定
    if (!this.inputManager) {
      this.setupMouseListeners();

      if (this.isMobile) {
        this.setupMobileControls();
      }
    }
  }

  /**
   * 衝突判定マネージャーを設定
   * @param {CollisionManager} collisionManager
   */
  setCollisionManager(collisionManager) {
    this.collisionManager = collisionManager;
  }

  /**
   * 追従対象を設定
   * @param {THREE.Object3D} target - カメラが追従するオブジェクト
   */
  setTarget(target) {
    this.target = target;
    this.initialized = false;
    this._fixedTargetY = undefined; // 新ターゲットの y で再初期化

    if (target) {
      // 初期カメラ向きをターゲットの向きに合わせる
      const targetRotY = target.rotation.y;
      this.yaw = targetRotY;
      this.initialYaw = targetRotY;

      // カメラを即座に配置
      this.updatePosition(true);
    }
  }

  /**
   * マウスイベントの設定
   */
  setupMouseListeners() {
    this._onMouseDown = (e) => this.onMouseDown(e);
    this._onMouseMove = (e) => this.onMouseMove(e);
    this._onMouseUp = (e) => this.onMouseUp(e);
    this._onMouseLeave = (e) => this.onMouseLeave(e);
    this._onWheel = (e) => this.onWheel(e);

    this.domElement.addEventListener('mousedown', this._onMouseDown);
    this.domElement.addEventListener('mousemove', this._onMouseMove);
    this.domElement.addEventListener('mouseup', this._onMouseUp);
    this.domElement.addEventListener('mouseleave', this._onMouseLeave);
    this.domElement.addEventListener('wheel', this._onWheel, { passive: false });
  }

  /**
   * モバイルコントロールの設定
   */
  setupMobileControls() {
    this.touchCameraController = new TouchCameraController({
      domElement: this.domElement,
      rotateSpeed: 0.008,
      zoomSpeed: 0.02,
      onRotate: (deltaYaw, deltaPitch) => {
        this.yaw += deltaYaw;
        this.pitch += this.invertPitch ? deltaPitch : -deltaPitch;
        this.pitch = THREE.MathUtils.clamp(this.pitch, this.minPitch, this.maxPitch);
      },
      onZoom: (deltaZoom) => {
        this.distance += deltaZoom;
        this.distance = THREE.MathUtils.clamp(this.distance, this.minDistance, this.maxDistance);
      }
    });
    this.touchCameraController.enable();
  }

  onMouseDown(event) {
    if (event.button === 0) {
      this.isMouseDragging = true;
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
    }
  }

  onMouseMove(event) {
    if (!this.isMouseDragging) return;

    const dx = event.clientX - this.lastMouseX;
    const dy = event.clientY - this.lastMouseY;

    this.yaw -= dx * this.mouseRotateSpeed;
    const pitchDelta = dy * this.mouseRotateSpeed;
    this.pitch += this.invertPitch ? -pitchDelta : pitchDelta;
    this.pitch = THREE.MathUtils.clamp(this.pitch, this.minPitch, this.maxPitch);

    this.lastMouseX = event.clientX;
    this.lastMouseY = event.clientY;
  }

  onMouseUp(event) {
    if (event.button === 0) {
      this.isMouseDragging = false;
    }
  }

  onMouseLeave() {
    this.isMouseDragging = false;
  }

  onWheel(event) {
    event.preventDefault();
    const delta = event.deltaY;
    this.distance += delta * this.mouseZoomSpeed * 0.01;
    this.distance = THREE.MathUtils.clamp(this.distance, this.minDistance, this.maxDistance);
  }

  /**
   * タッチカメラコントローラーに除外要素を追加
   * @param {HTMLElement} element
   */
  addExcludeElement(element) {
    if (this.touchCameraController) {
      this.touchCameraController.addExcludeElement(element);
    }
  }

  /**
   * カメラ位置を更新
   * @param {boolean} immediate - true: 即座に移動, false: 補間して移動
   */
  updatePosition(immediate = false) {
    if (!this.target) return;

    const targetPos = this.target.position;
    const yaw = this.yaw;
    const pitch = this.pitch;
    const dist = this.distance;

    // 注視点の y は初回ターゲット高さで固定（移動でアバターyが変動してもカメラ高さは変えない）
    if (this._fixedTargetY === undefined) {
      this._fixedTargetY = targetPos.y + this.lookAtHeight;
    }

    // 注視点（キャラクターの x/z 位置に追従、高さは固定）
    const targetLookAt = new THREE.Vector3(
      targetPos.x,
      this._fixedTargetY,
      targetPos.z
    );

    // カメラ位置を球面座標で計算
    const verticalBase = this.height - this.lookAtHeight;
    const horizRadius = Math.cos(pitch) * dist;

    const offsetX = Math.sin(yaw) * horizRadius;
    const offsetZ = Math.cos(yaw) * horizRadius;
    const offsetY = verticalBase + Math.sin(pitch) * dist;

    // 肩越しオフセット
    const rightX = Math.sin(yaw + Math.PI / 2) * this.sideOffset;
    const rightZ = Math.cos(yaw + Math.PI / 2) * this.sideOffset;

    let targetCameraPos = new THREE.Vector3(
      targetLookAt.x + offsetX + rightX,
      targetLookAt.y + offsetY,
      targetLookAt.z + offsetZ + rightZ
    );

    // カメラ衝突回避
    if (this.collisionManager) {
      const result = this.collisionManager.checkCameraCollision(
        targetCameraPos,
        targetLookAt,
        this.minDistance
      );
      targetCameraPos = result.position;
    }

    if (immediate || !this.initialized) {
      this.currentCameraPos.copy(targetCameraPos);
      this.currentLookAt.copy(targetLookAt);
      this.initialized = true;
    } else {
      this.currentCameraPos.lerp(targetCameraPos, this.lerpAmount);
      this.currentLookAt.lerp(targetLookAt, this.lerpAmount);
    }

    this.camera.position.copy(this.currentCameraPos);
    this.camera.lookAt(this.currentLookAt);
  }

  /**
   * カメラを初期位置にリセット
   */
  reset() {
    if (!this.target) return;

    this.yaw = this.target.rotation.y;
    this.initialYaw = this.yaw;
    this.pitch = 0;
    this.distance = this.initialDistance;
    this.updatePosition(true);

  }

  /**
   * InputManagerを設定
   * @param {import('./input/InputManager.js').InputManager} inputManager
   */
  setInputManager(inputManager) {
    // 既存のリスナーを削除
    if (!this.inputManager && inputManager) {
      this.removeMouseListeners();
      if (this.touchCameraController) {
        this.touchCameraController.dispose();
        this.touchCameraController = null;
      }
    }
    this.inputManager = inputManager;
  }

  /**
   * InputManagerからカメラ操作を更新
   * InputManagerを使用する場合、フレームごとに呼び出す
   */
  updateFromInput() {
    if (!this.inputManager) return;

    const { camera, actions } = this.inputManager.state;

    // カメラ回転を適用
    this.yaw += camera.deltaYaw;
    this.pitch += this.invertPitch ? camera.deltaPitch : -camera.deltaPitch;
    this.pitch = THREE.MathUtils.clamp(this.pitch, this.minPitch, this.maxPitch);

    // ホイールズーム：遠ざかる方向は通常の maxDistance で制限（既に超えていれば維持）
    const wheelDelta = camera.deltaZoom;
    if (wheelDelta > 0) {
      this.distance = Math.min(this.distance + wheelDelta, Math.max(this.distance, this.maxDistance));
    } else if (wheelDelta < 0) {
      this.distance += wheelDelta; // 近づく方向は制限なし（最終 clamp で minDistance まで）
    }

    // キーボードズーム（Q: 近づく / E: 遠ざかる、押下中ずっと適用）
    // キーボードのみ keyboardMaxDistance（10倍）まで拡張
    const keyZoomSpeed = 0.04;
    if (actions.zoomIn) this.distance -= keyZoomSpeed;
    if (actions.zoomOut) this.distance += keyZoomSpeed;

    this.distance = THREE.MathUtils.clamp(this.distance, this.minDistance, this.keyboardMaxDistance);

    // カメラリセット
    if (actions.resetCamera) {
      this.reset();
    }
  }

  /**
   * マウスイベントリスナーを削除
   */
  removeMouseListeners() {
    if (this._onMouseDown) {
      this.domElement.removeEventListener('mousedown', this._onMouseDown);
      this._onMouseDown = null;
    }
    if (this._onMouseMove) {
      this.domElement.removeEventListener('mousemove', this._onMouseMove);
      this._onMouseMove = null;
    }
    if (this._onMouseUp) {
      this.domElement.removeEventListener('mouseup', this._onMouseUp);
      this._onMouseUp = null;
    }
    if (this._onMouseLeave) {
      this.domElement.removeEventListener('mouseleave', this._onMouseLeave);
      this._onMouseLeave = null;
    }
    if (this._onWheel) {
      this.domElement.removeEventListener('wheel', this._onWheel);
      this._onWheel = null;
    }
  }

  /**
   * カメラの前方向を取得（XZ平面投影）
   * @returns {THREE.Vector3}
   */
  getForwardDirection() {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() > 0.0001) forward.normalize();
    return forward;
  }

  /**
   * カメラの右方向を取得
   * @returns {THREE.Vector3}
   */
  getRightDirection() {
    const forward = this.getForwardDirection();
    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    return right;
  }

  /**
   * カメラ距離を設定
   * @param {number} distance
   */
  setDistance(distance) {
    this.distance = THREE.MathUtils.clamp(distance, this.minDistance, this.maxDistance);
  }

  /**
   * リソースの解放
   */
  dispose() {
    this.removeMouseListeners();

    if (this.touchCameraController) {
      this.touchCameraController.dispose();
      this.touchCameraController = null;
    }

    this.inputManager = null;
  }
}
