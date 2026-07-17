/**
 * Base Avatar Controller
 *
 * 各種アバターコントローラー（Mixamo, VRM, Avaturn）の
 * 共通インターフェースと基本実装を提供する抽象クラス
 *
 * InputManagerと統合することで、キーボード/マウス/タッチを
 * 統一的に扱うことができる
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { CameraController } from './camera-controller.js';
import {
  retargetAnimationClip,
  stripPositionTracks,
  createLowerBodyOnlyClip,
  getModelBoneNames,
  captureUpperBodyBoneRotations,
  restoreUpperBodyBoneRotations,
} from './bone-mapping.js';
import { isMobileDevice } from './mobile-utils.js';
import { VirtualJoystick } from './virtual-joystick.js';

/**
 * Locomotion State
 * アニメーション状態を定義
 */
export const LocomotionState = {
  IDLE: 'idle',
  WALK: 'walk',
  RUN: 'run',
  JUMP: 'jump',
};

/**
 * Base Avatar Controller
 * すべてのアバターコントローラーの基底クラス
 */
export class BaseAvatarController {
  /**
   * @param {THREE.Camera} camera - Three.jsカメラ
   * @param {HTMLElement} domElement - イベントリスナーを登録するDOM要素
   * @param {Object} options - オプション
   * @param {'mixamo'|'vrm'|'avaturn'} options.avatarType - アバタータイプ
   * @param {boolean} options.skipMobileControls - trueの場合、モバイルコントロールを自動セットアップしない
   * @param {import('./input/InputManager.js').InputManager} options.inputManager - 入力マネージャー（オプション）
   */
  constructor(camera, domElement = null, options = {}) {
    this.camera = camera;
    this.domElement = domElement || document.body;
    this.avatarType = options.avatarType || 'mixamo';

    // InputManager（オプション）
    this.inputManager = options.inputManager || null;

    // モデル参照（サブクラスで設定）
    this.model = null;

    // 移動設定
    this.walkSpeed = 2.0;
    this.runSpeed = 3.6;
    this.rotateSpeed = 2.0;

    // 回転補間用
    this.targetYaw = 0;
    this.walkRotationLerpFactor = 0.15;
    this.runRotationLerpFactor = 0.25;

    // キー入力状態（InputManager未使用時の後方互換）
    this.keys = {
      w: false,
      a: false,
      s: false,
      d: false,
      shift: false,
      space: false,
      r: false,
    };

    // 移動状態
    this.isMoving = false;

    // アニメーション状態
    this.currentState = LocomotionState.IDLE;
    this.baseLocomotionState = LocomotionState.IDLE;
    this.isJumping = false;

    // アニメーション関連
    this.fbxLoader = new FBXLoader();
    this.mixer = null;
    this.idleAction = null;
    this.idleLowerAction = null;
    this.walkAction = null;
    this.runAction = null;
    this.jumpAction = null;

    // トラッキング反映フラグ
    this.isTrackingEnabled = false;

    // 上半身ボーンホールド機構
    this._upperBodyHoldRotations = null;

    // 衝突判定マネージャー
    this.collisionManager = null;

    // カメラコントローラー（共通）
    // InputManager と各サブクラス固有のカメラオプション（invertPitch 等）を引き継ぐ
    this.cameraController = new CameraController(camera, domElement, {
      ...options,
      inputManager: this.inputManager,
    });

    // モバイル対応
    this.isMobile = isMobileDevice();
    this.virtualJoystick = null;
    this._skipMobileControls = options.skipMobileControls || false;

    // InputManagerを使用しない場合のみ、従来の入力処理を設定
    if (!this.inputManager) {
      // イベントリスナーの設定
      this.setupKeyboardListeners();

      // モバイルの場合はタッチコントロールを設定（skipMobileControlsがfalseの場合のみ）
      if (this.isMobile && !this._skipMobileControls) {
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
    this.cameraController.setCollisionManager(collisionManager);
  }

  /**
   * モデルを設定（サブクラスで実装）
   * @param {THREE.Object3D|VRM} model - モデル
   */
  setModel(model) {
    throw new Error('setModel must be implemented by subclass');
  }

  /**
   * モデルのObject3Dシーンを取得（サブクラスで実装）
   * VRMはvrm.scene、その他はmodelそのものを返す
   * @returns {THREE.Object3D}
   */
  getModelScene() {
    throw new Error('getModelScene must be implemented by subclass');
  }

  /**
   * アニメーションをセットアップ（サブクラスで実装）
   */
  async setupAnimations() {
    throw new Error('setupAnimations must be implemented by subclass');
  }

  /**
   * 共通のアニメーションセットアップヘルパー
   * @param {Object} clips - アニメーションクリップ
   * @param {THREE.AnimationClip} clips.idle
   * @param {THREE.AnimationClip} clips.walk
   * @param {THREE.AnimationClip} clips.run
   * @param {THREE.AnimationClip} clips.jump
   */
  setupAnimationActions(clips) {
    const modelScene = this.getModelScene();
    if (!modelScene) return;

    // ミキサーを作成
    this.mixer = new THREE.AnimationMixer(modelScene);

    // positionトラックを除外
    const walkNoPos = stripPositionTracks(clips.walk, 'walk');
    const runNoPos = stripPositionTracks(clips.run, 'run');
    const jumpNoPos = stripPositionTracks(clips.jump, 'jump');
    const idleNoPos = stripPositionTracks(clips.idle, 'idle');

    // 下半身のみのidleクリップを生成
    const idleLowerClip = createLowerBodyOnlyClip(idleNoPos, 'idle_lowerBody');

    // 各アクションを作成
    this.idleAction = this.mixer.clipAction(idleNoPos);
    this.idleLowerAction = this.mixer.clipAction(idleLowerClip);
    this.walkAction = this.mixer.clipAction(walkNoPos);
    this.runAction = this.mixer.clipAction(runNoPos);
    this.jumpAction = this.mixer.clipAction(jumpNoPos);

    // ループ設定
    this.idleAction.setLoop(THREE.LoopRepeat);
    this.idleLowerAction.setLoop(THREE.LoopRepeat);
    this.walkAction.setLoop(THREE.LoopRepeat);
    this.runAction.setLoop(THREE.LoopRepeat);
    this.jumpAction.setLoop(THREE.LoopOnce);
    this.jumpAction.clampWhenFinished = true;

    // ジャンプ終了時のイベントリスナー
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.jumpAction && this.isJumping) {
        this.isJumping = false;
        this.transitionToState(this.baseLocomotionState);
      }
    });

    // 初期状態はidle
    this.idleAction.play();
    this.currentState = LocomotionState.IDLE;
    this.baseLocomotionState = LocomotionState.IDLE;

  }

  /**
   * FBXアニメーションを読み込む
   * @param {string} url - FBXファイルのURL
   * @returns {Promise<THREE.Group>}
   */
  async loadFBXAnimation(url) {
    return new Promise((resolve, reject) => {
      this.fbxLoader.load(url, resolve, undefined, reject);
    });
  }

  /**
   * キーボードイベントの設定
   */
  setupKeyboardListeners() {
    this._onKeyDown = (e) => this.onKeyDown(e);
    this._onKeyUp = (e) => this.onKeyUp(e);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  /**
   * モバイルコントロールの設定
   */
  setupMobileControls() {

    // バーチャルジョイスティック（左側）
    this.virtualJoystick = new VirtualJoystick({
      container: document.body,
      position: 'left',
      size: 120,
      innerSize: 50,
      onMove: (x, y) => {
        const threshold = 0.3;
        this.keys.w = y > threshold;
        this.keys.s = y < -threshold;
        this.keys.d = x > threshold;
        this.keys.a = x < -threshold;
      },
      onEnd: () => {
        this.keys.w = false;
        this.keys.s = false;
        this.keys.a = false;
        this.keys.d = false;
      }
    });
    this.virtualJoystick.show();

    // ジョイスティックをカメラコントローラーの除外リストに追加
    this.cameraController.addExcludeElement(this.virtualJoystick.element);

    // モバイルアクションボタン（ジャンプ、ラン）
    this.setupMobileActionButtons();
  }

  /**
   * モバイルアクションボタンの設定
   */
  setupMobileActionButtons() {
    const jumpBtn = document.getElementById('mobile-jump-btn');
    const runBtn = document.getElementById('mobile-run-btn');

    if (jumpBtn) {
      jumpBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.keys.space = true;
        jumpBtn.classList.add('active');
      }, { passive: false });

      jumpBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        this.keys.space = false;
        jumpBtn.classList.remove('active');
      });
    }

    if (runBtn) {
      runBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.keys.shift = true;
        runBtn.classList.add('active');
      }, { passive: false });

      runBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        this.keys.shift = false;
        runBtn.classList.remove('active');
      });
    }
  }

  onKeyDown(event) {
    // 入力フォーム要素にフォーカスがある場合は無視
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      this.keys.shift = true;
      return;
    }
    if (event.code === 'Space') {
      this.keys.space = true;
      event.preventDefault();
      return;
    }
    if (event.code === 'KeyR') {
      this.cameraController.reset();
      return;
    }

    if (!event.key) return;
    const key = event.key.toLowerCase();
    if (key in this.keys && key !== 'shift' && key !== 'space' && key !== 'r') {
      this.keys[key] = true;
    }
  }

  onKeyUp(event) {
    // 入力フォーム要素にフォーカスがある場合は無視
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      this.keys.shift = false;
      return;
    }
    if (event.code === 'Space') {
      this.keys.space = false;
      return;
    }

    if (!event.key) return;
    const key = event.key.toLowerCase();
    if (key in this.keys && key !== 'shift' && key !== 'space') {
      this.keys[key] = false;
    }
  }

  /**
   * InputManagerを設定
   * @param {import('./input/InputManager.js').InputManager} inputManager
   */
  setInputManager(inputManager) {
    this.inputManager = inputManager;
    this.cameraController.setInputManager(inputManager);

    // InputManagerを使用する場合、従来のリスナーを削除
    if (inputManager) {
      this.removeKeyboardListeners();
      if (this.virtualJoystick) {
        this.virtualJoystick.dispose();
        this.virtualJoystick = null;
      }
    }
  }

  /**
   * キーボードリスナーを削除
   */
  removeKeyboardListeners() {
    if (this._onKeyDown) {
      window.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }
    if (this._onKeyUp) {
      window.removeEventListener('keyup', this._onKeyUp);
      this._onKeyUp = null;
    }
  }

  /**
   * 更新処理
   * @param {number} deltaTime
   */
  update(deltaTime) {
    const modelScene = this.getModelScene();
    if (!modelScene) return;

    // InputManagerを使用する場合
    if (this.inputManager) {
      // InputManagerの状態を更新（アダプターをポーリングして入力状態を反映）
      this.inputManager.update(deltaTime);

      // カメラ操作を更新
      this.cameraController.updateFromInput();

      // 移動処理（InputManager経由）
      this.handleMovementFromInput(modelScene, deltaTime);

      // アニメーション状態の更新（InputManager経由）
      this.updateAnimationFromInput(deltaTime);
    } else {
      // 従来の処理
      this.handleMovement(modelScene, deltaTime);
      this.updateAnimation(deltaTime);
    }

    // カメラ追従
    this.cameraController.updatePosition(false);
  }

  /**
   * InputManagerからの移動処理
   * @param {THREE.Object3D} modelScene - モデルシーン
   * @param {number} deltaTime
   */
  handleMovementFromInput(modelScene, deltaTime) {
    const { movement, actions } = this.inputManager.state;
    const isRunning = actions.run && this.inputManager.isMoving();
    const moveSpeed = isRunning ? this.runSpeed : this.walkSpeed;
    const moveAmount = moveSpeed * deltaTime;

    // カメラの前方向と右方向を取得
    const cameraForward = this.cameraController.getForwardDirection();
    const cameraRight = this.cameraController.getRightDirection();

    // アナログ値を直接使用して移動方向を計算
    const moveDir = new THREE.Vector3();
    moveDir.addScaledVector(cameraForward, movement.y);
    moveDir.addScaledVector(cameraRight, movement.x);

    let moved = false;
    if (moveDir.lengthSq() > 0.0001) {
      moveDir.normalize();

      // 移動ベクトルを計算（移動量にアナログ値の大きさを反映）
      const magnitude = this.inputManager.getMovementMagnitude();
      let moveVector = moveDir.clone().multiplyScalar(moveAmount * magnitude);

      // 衝突判定がある場合は衝突チェック
      if (this.collisionManager) {
        moveVector = this.collisionManager.checkCollision(modelScene.position, moveVector);
      }

      // 位置更新
      if (moveVector.lengthSq() > 0.0001) {
        modelScene.position.add(moveVector);
        moved = true;

        // キャラクターを移動方向に向ける
        this.rotateCharacterToDirection(modelScene, moveDir, isRunning);
      }
    }

    this.isMoving = moved;
  }

  /**
   * InputManagerからのアニメーション状態更新
   * @param {number} deltaTime
   */
  updateAnimationFromInput(deltaTime) {
    if (this.mixer) {
      this.mixer.update(deltaTime);
    }

    // トラッキングモード中は上半身姿勢を復元
    if (this.isTrackingEnabled && this._upperBodyHoldRotations) {
      restoreUpperBodyBoneRotations(this._upperBodyHoldRotations);
    }

    const { actions } = this.inputManager.state;
    const wantsToMove = this.inputManager.isMoving();
    const wantsToRun = wantsToMove && actions.run;

    if (this.isJumping) {
      if (wantsToRun) {
        this.baseLocomotionState = LocomotionState.RUN;
      } else if (wantsToMove) {
        this.baseLocomotionState = LocomotionState.WALK;
      } else {
        this.baseLocomotionState = LocomotionState.IDLE;
      }
      return;
    }

    let desiredState = this.currentState;

    if (actions.jump && this.jumpAction) {
      desiredState = LocomotionState.JUMP;
    } else if (wantsToRun) {
      desiredState = LocomotionState.RUN;
    } else if (wantsToMove) {
      desiredState = LocomotionState.WALK;
    } else {
      desiredState = LocomotionState.IDLE;
    }

    if (desiredState !== this.currentState) {
      this.transitionToState(desiredState);
    }
  }

  /**
   * アニメーション状態を更新
   */
  updateAnimation(deltaTime) {
    if (this.mixer) {
      this.mixer.update(deltaTime);
    }

    // トラッキングモード中は上半身姿勢を復元
    if (this.isTrackingEnabled && this._upperBodyHoldRotations) {
      restoreUpperBodyBoneRotations(this._upperBodyHoldRotations);
    }

    const wantsToMove = this.keys.w || this.keys.a || this.keys.s || this.keys.d;
    const wantsToRun = wantsToMove && this.keys.shift;

    if (this.isJumping) {
      if (wantsToRun) {
        this.baseLocomotionState = LocomotionState.RUN;
      } else if (wantsToMove) {
        this.baseLocomotionState = LocomotionState.WALK;
      } else {
        this.baseLocomotionState = LocomotionState.IDLE;
      }
      return;
    }

    let desiredState = this.currentState;

    if (this.keys.space && this.jumpAction) {
      desiredState = LocomotionState.JUMP;
    } else if (wantsToRun) {
      desiredState = LocomotionState.RUN;
    } else if (wantsToMove) {
      desiredState = LocomotionState.WALK;
    } else {
      desiredState = LocomotionState.IDLE;
    }

    if (desiredState !== this.currentState) {
      this.transitionToState(desiredState);
    }
  }

  /**
   * 状態に対応するアクションを取得
   */
  getActionForState(state) {
    switch (state) {
      case LocomotionState.IDLE:
        return this.isTrackingEnabled ? this.idleLowerAction : this.idleAction;
      case LocomotionState.WALK: return this.walkAction;
      case LocomotionState.RUN: return this.runAction;
      case LocomotionState.JUMP: return this.jumpAction;
      default: return null;
    }
  }

  /**
   * アニメーション状態を遷移
   */
  transitionToState(nextState) {
    const prevState = this.currentState;
    const prevAction = this.getActionForState(prevState);
    const nextAction = this.getActionForState(nextState);

    this.currentState = nextState;

    const crossFade = (fromAction, toAction, duration) => {
      if (fromAction) fromAction.fadeOut(duration);
      if (toAction) {
        toAction.reset().fadeIn(duration).play();
      }
    };

    switch (nextState) {
      case LocomotionState.IDLE:
        this.baseLocomotionState = LocomotionState.IDLE;
        crossFade(prevAction, this.getActionForState(LocomotionState.IDLE), 0.2);
        break;

      case LocomotionState.WALK:
        this.baseLocomotionState = LocomotionState.WALK;
        crossFade(prevAction, this.walkAction, 0.2);
        break;

      case LocomotionState.RUN:
        this.baseLocomotionState = LocomotionState.RUN;
        crossFade(prevAction, this.runAction, 0.15);
        break;

      case LocomotionState.JUMP:
        this.isJumping = true;
        if (prevState === LocomotionState.IDLE ||
            prevState === LocomotionState.WALK ||
            prevState === LocomotionState.RUN) {
          this.baseLocomotionState = prevState;
        }
        crossFade(prevAction, this.jumpAction, 0.1);
        break;
    }
  }

  /**
   * 移動処理（カメラ方向基準）
   * @param {THREE.Object3D} modelScene - モデルシーン
   * @param {number} deltaTime
   */
  handleMovement(modelScene, deltaTime) {
    const isRunning = this.keys.shift && (this.keys.w || this.keys.a || this.keys.s || this.keys.d);
    const moveSpeed = isRunning ? this.runSpeed : this.walkSpeed;
    const moveAmount = moveSpeed * deltaTime;

    // カメラの前方向と右方向を取得
    const cameraForward = this.cameraController.getForwardDirection();
    const cameraRight = this.cameraController.getRightDirection();

    const moveDir = new THREE.Vector3();

    if (this.keys.w) moveDir.add(cameraForward);
    if (this.keys.s) moveDir.sub(cameraForward);
    if (this.keys.d) moveDir.add(cameraRight);
    if (this.keys.a) moveDir.sub(cameraRight);

    let moved = false;
    if (moveDir.lengthSq() > 0.0001) {
      moveDir.normalize();

      // 移動ベクトルを計算
      let moveVector = moveDir.clone().multiplyScalar(moveAmount);

      // 衝突判定がある場合は衝突チェック
      if (this.collisionManager) {
        moveVector = this.collisionManager.checkCollision(modelScene.position, moveVector);
      }

      // 位置更新
      if (moveVector.lengthSq() > 0.0001) {
        modelScene.position.add(moveVector);
        moved = true;

        // キャラクターを移動方向に向ける
        this.rotateCharacterToDirection(modelScene, moveDir, isRunning);
      }
    }

    this.isMoving = moved;
  }

  /**
   * キャラクターを移動方向に向ける（サブクラスでオーバーライド可能）
   * @param {THREE.Object3D} modelScene - モデルシーン
   * @param {THREE.Vector3} moveDir - 移動方向（正規化済み）
   * @param {boolean} isRunning - 走行中かどうか
   */
  rotateCharacterToDirection(modelScene, moveDir, isRunning) {
    // デフォルト実装: +Z方向が前（Mixamo/Avaturn）
    this.targetYaw = Math.atan2(moveDir.x, moveDir.z);

    // 角度の差を-π〜πの範囲に正規化してLerp
    let angleDiff = this.targetYaw - modelScene.rotation.y;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    const lerpFactor = isRunning ? this.runRotationLerpFactor : this.walkRotationLerpFactor;
    modelScene.rotation.y += angleDiff * lerpFactor;
  }

  /**
   * 上半身ボーンの回転を現在の状態で更新
   */
  updateUpperBodyHoldRotations() {
    if (this.isTrackingEnabled) {
      const modelScene = this.getModelScene();
      if (modelScene) {
        this._upperBodyHoldRotations = captureUpperBodyBoneRotations(modelScene);
      }
    }
  }

  /**
   * トラッキング反映フラグを設定
   */
  setTrackingEnabled(enabled) {
    const wasEnabled = this.isTrackingEnabled;
    this.isTrackingEnabled = enabled;

    if (enabled && !wasEnabled) {
      const modelScene = this.getModelScene();
      if (modelScene) {
        this._upperBodyHoldRotations = captureUpperBodyBoneRotations(modelScene);
      }
    } else if (!enabled && wasEnabled) {
      this._upperBodyHoldRotations = null;
    }

    // idle状態の場合はアニメーションを切り替え
    if (wasEnabled !== enabled && this.currentState === LocomotionState.IDLE) {
      const prevAction = wasEnabled ? this.idleLowerAction : this.idleAction;
      const nextAction = enabled ? this.idleLowerAction : this.idleAction;

      if (prevAction && nextAction && prevAction !== nextAction) {
        const currentTime = prevAction.time;
        prevAction.fadeOut(0.2);
        nextAction.time = currentTime;
        nextAction.fadeIn(0.2).play();
      }
    }
  }

  /**
   * 移動中かどうかを取得
   * @returns {boolean}
   */
  getIsMoving() {
    return this.isMoving;
  }

  /**
   * ユーザーが移動操作を行っているかどうかを取得
   * @returns {boolean}
   */
  getHasUserMovementInput() {
    if (this.inputManager) {
      const { actions } = this.inputManager.state;
      return this.inputManager.isMoving() || actions.run || actions.jump;
    }
    return this.keys.w || this.keys.a || this.keys.s || this.keys.d ||
           this.keys.shift || this.keys.space;
  }

  /**
   * 現在のアニメーション状態を取得（マルチプレイヤー同期用）
   * @returns {Object}
   */
  getAnimationState() {
    let speed = 0;
    if (this.currentState === 'walk') {
      speed = this.walkSpeed;
    } else if (this.currentState === 'run') {
      speed = this.runSpeed;
    }

    return {
      speed: speed,
      motionSpeed: 1,
      grounded: !this.isJumping,
      jump: this.isJumping,
      freeFall: false,
    };
  }

  /**
   * リソースの解放
   */
  dispose() {
    // キーボードイベントリスナーの削除
    this.removeKeyboardListeners();

    // モバイルコントロールの解放
    if (this.virtualJoystick) {
      this.virtualJoystick.dispose();
      this.virtualJoystick = null;
    }

    // カメラコントローラーの解放
    if (this.cameraController) {
      this.cameraController.dispose();
    }

    // ミキサーの停止
    if (this.mixer) {
      this.mixer.stopAllAction();
    }

    this.inputManager = null;
  }
}
