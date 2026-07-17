import * as THREE from 'three';
import {
  retargetAnimationClip,
  getModelBoneNames,
} from './bone-mapping.js';
import { yieldToMain } from './parse-utils.js';
import { loadAndRetargetBVH } from './bvh-retarget.js';
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
    this.taisoUrl = options.taisoUrl || null; // ラジオ体操 BVH（任意・エモート）
    this.taisoAction = null;
    this._emoting = false; // 体操エモート中か
    this.music = options.music || null; // 体操と同期する BGM コントローラ（任意）
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

      // ラジオ体操 BVH をエモートとして用意（T キーで再生）。
      if (this.taisoUrl && this.mixer) {
        try {
          const taisoClip = await loadAndRetargetBVH(this.taisoUrl, this.model);
          this.taisoAction = this.mixer.clipAction(taisoClip);
          this.taisoAction.setLoop(THREE.LoopRepeat);
        } catch (e) {
          console.warn('[AvaturnController] 体操 BVH の読込に失敗:', e);
        }
      }

    } catch (error) {
      console.error('[AvaturnController] Failed to setup animations:', error);
    }
  }

  /** キー入力: 親の WASD 等に加え、T キーで体操エモートをトグル。 */
  onKeyDown(event) {
    super.onKeyDown(event);
    if (event.key === 't' || event.key === 'T') this.toggleTaiso();
  }

  /**
   * 体操エモートの開始/停止（音楽と同期）。
   * - 音楽が止まっている: 音楽を頭から再生 ＋ 体操を頭から（シンクロ）。
   * - 音楽が流れている: 体操を音楽の再生位置に合わせて開始（続きから）。
   * - 停止時: 体操をやめて idle へ（音楽は流したまま）。
   */
  toggleTaiso() {
    if (!this.taisoAction) return;
    this._emoting = !this._emoting;

    if (!this._emoting) {
      this.taisoAction.fadeOut(0.2);
      this.transitionToState(LocomotionState.IDLE);
      return;
    }

    const cur = this.getActionForState(this.currentState);
    if (cur) cur.fadeOut(0.2);

    // 音楽と同期して開始位置を決める。
    const dur = this.taisoAction.getClip()?.duration || 0;
    let startTime = 0;
    if (this.music) {
      if (this.music.isPlaying()) {
        startTime = dur > 0 ? this.music.time() % dur : 0; // 続きから
      } else {
        this.music.playFromStart(); // 音楽を頭から
        startTime = 0;
      }
    }

    this.taisoAction.reset();
    this.taisoAction.time = startTime;
    this.taisoAction.fadeIn(0.2).play();
  }

  /** 体操中は locomotion 遷移を止める。移動入力があれば体操を解除して歩行へ。 */
  updateAnimation(deltaTime) {
    if (this._emoting) {
      if (this.mixer) this.mixer.update(deltaTime);
      const wantsToMove = this.keys.w || this.keys.a || this.keys.s || this.keys.d;
      if (wantsToMove) {
        this._emoting = false;
        this.taisoAction.fadeOut(0.2);
        this.transitionToState(LocomotionState.WALK);
      }
      return;
    }
    super.updateAnimation(deltaTime);
  }
}
