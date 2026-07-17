import {
  retargetAnimationClip,
  getModelBoneNames,
} from './bone-mapping.js';
import { yieldToMain } from './parse-utils.js';
import { BaseAvatarController, LocomotionState } from './base-avatar-controller.js';

/**
 * Avaturn Controller
 * Avaturnアバターの移動制御とカメラ追従を管理する
 * BaseAvatarControllerを継承し、Avaturn固有の処理のみ実装
 */
export class AvaturnController extends BaseAvatarController {
  /**
   * @param {THREE.Camera} camera
   * @param {HTMLElement} domElement
   * @param {Object} options
   * @param {boolean} options.skipMobileControls - trueの場合、モバイルコントロールを自動セットアップしない
   */
  constructor(camera, domElement = null, options = {}) {
    super(camera, domElement, {
      ...options,
      avatarType: 'avaturn',
    });
  }

  /**
   * Avaturnモデルを設定
   * @param {THREE.Group} model - GLBモデル
   */
  setModel(model) {
    this.model = model;

    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
      this.idleAction = null;
      this.idleLowerAction = null;
      this.walkAction = null;
      this.runAction = null;
      this.jumpAction = null;
    }

    this.currentState = LocomotionState.IDLE;
    this.baseLocomotionState = LocomotionState.IDLE;
    this.isJumping = false;

    if (model) {
      // カメラコントローラーにターゲットを設定
      this.cameraController.setTarget(model);

      this.setupAnimations();
    }
  }

  /**
   * モデルのObject3Dシーンを取得
   * @returns {THREE.Object3D|null}
   */
  getModelScene() {
    return this.model || null;
  }

  /**
   * Avaturnアニメーションをセットアップ
   * FBXLoaderで読み込んだクリップをbone-mapping.jsでリターゲット（avaturnタイプ）
   */
  async setupAnimations() {
    if (!this.model) return;

    try {
      const BASE_URL = import.meta.env.BASE_URL;
      const basePath = `${BASE_URL}animations/Female Basic Locomotion Pack`;

      // FBXアニメーションを並列で読み込み（基底クラスのloadFBXAnimationを使用）
      const [idleFbx, walkFbx, runFbx, jumpFbx] = await Promise.all([
        this.loadFBXAnimation(`${basePath}/idle.fbx`),
        this.loadFBXAnimation(`${basePath}/walking.fbx`),
        this.loadFBXAnimation(`${basePath}/running.fbx`),
        this.loadFBXAnimation(`${basePath}/jump.fbx`),
      ]);

      // モデルのボーン名を取得（bone-mapping.jsの関数を使用）
      const modelBoneNames = getModelBoneNames(this.model);

      // クリップを取得してリターゲット（各クリップ間でメインスレッドに制御を返す）
      let idleClip = retargetAnimationClip(idleFbx.animations[0], modelBoneNames, { targetType: 'avaturn' });
      await yieldToMain();
      let walkClip = retargetAnimationClip(walkFbx.animations[0], modelBoneNames, { targetType: 'avaturn' });
      await yieldToMain();
      let runClip = retargetAnimationClip(runFbx.animations[0], modelBoneNames, { targetType: 'avaturn' });
      await yieldToMain();
      let jumpClip = retargetAnimationClip(jumpFbx.animations[0], modelBoneNames, { targetType: 'avaturn' });
      await yieldToMain();

      // 共通のアニメーションセットアップを使用
      this.setupAnimationActions({
        idle: idleClip,
        walk: walkClip,
        run: runClip,
        jump: jumpClip,
      });

    } catch (error) {
      console.error('[AvaturnController] Failed to setup animations:', error);
    }
  }
}
