/**
 * ラジオ体操アバター（GLB + BVH リターゲット再生）。
 *
 * MetaVarsee の体操NPC（NPCManager）から、GLB 読込・BVH リターゲット・再生の中核を
 * WebGL ビューア向けに抽出・移植したもの。
 *
 * リターゲットは幾何学的補正方式:
 *   各ボーンで BVH の子方向とモデル(Avaturn)の子方向から座標系変換 R を求め、
 *   Q_model = inv(R_parent · Wq_parent) · Q_bvh · (R · Wq)  として親チェーンで正しく伝播する。
 * 参考: ../MetaVarsee/src/npc-manager.js retargetBVHAnimation ほか / bone-mapping.js。
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import { BVHToMixamoMap, MixamoToAvaturnVariants } from './bone-mapping.js';

export class TaisoAvatar {
  constructor() {
    this.gltfLoader = new GLTFLoader();
    this.bvhLoader = new BVHLoader();
    this.model = null;
    this.mixer = null;
    this.action = null;
    this._bindPoses = null;
  }

  /**
   * GLB を読込→BVH をリターゲットして再生開始。model（THREE.Group）を返す。
   * @param {Object} o
   * @param {string} o.modelUrl GLB の URL
   * @param {string} o.bvhUrl   BVH の URL
   * @param {THREE.Vector3} [o.position] 配置位置
   * @param {number} [o.rotationY] Y 回転（ラジアン）
   * @param {number} [o.scale] スケール
   * @param {boolean} [o.loop] true でループ再生（既定 true）
   */
  async load({ modelUrl, bvhUrl, position, rotationY = 0, scale = 1, loop = true }) {
    const gltf = await this.gltfLoader.loadAsync(modelUrl);
    if (!gltf || !gltf.scene) throw new Error(`GLTF が読めません: ${modelUrl}`);
    const model = gltf.scene;
    model.scale.setScalar(scale);
    if (position) model.position.copy(position);
    model.rotation.y = rotationY;
    this.model = model;

    this.mixer = new THREE.AnimationMixer(model);
    const clip = await this._loadBVH(bvhUrl, model);
    if (clip) {
      const action = this.mixer.clipAction(clip);
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce);
      if (!loop) action.clampWhenFinished = true;
      action.play();
      this.action = action;
    }
    return model;
  }

  /** 毎フレーム呼ぶ（mixer 更新）。dt は秒。 */
  update(dt) {
    if (this.mixer) this.mixer.update(dt);
  }

  // ── BVH 読込 ──
  _loadBVH(url, targetModel) {
    return new Promise((resolve, reject) => {
      this.bvhLoader.load(
        url,
        (result) => resolve(this._retargetBVH(result.clip, targetModel, result.skeleton)),
        undefined,
        (err) => reject(err || new Error('BVH 読込失敗'))
      );
    });
  }

  // ── リターゲット本体（NPCManager.retargetBVHAnimation 相当）──
  _retargetBVH(clip, targetModel, bvhSkeleton) {
    const bvhToModel = this._buildBVHToModelMap(targetModel);
    this._bindPoses = this._computeRetargetData(targetModel, bvhSkeleton, bvhToModel);

    const neckBvhBones = new Set();
    for (const bvhName of Object.keys(bvhToModel)) {
      if (/^(neck|head)$/i.test(bvhName)) neckBvhBones.add(bvhName);
    }

    const retargetedTracks = [];
    for (const track of clip.tracks) {
      const dotIndex = track.name.lastIndexOf('.');
      if (dotIndex === -1) continue;
      const originalBoneName = track.name.substring(0, dotIndex);
      const property = track.name.substring(dotIndex + 1);
      if (property === 'position' || property === 'scale') continue;

      const targetBoneName = bvhToModel[originalBoneName];
      if (targetBoneName && property === 'quaternion') {
        const newTrack = track.clone();
        newTrack.name = `${targetBoneName}.${property}`;
        if (neckBvhBones.has(originalBoneName)) {
          this._stripPitchFromQuaternions(newTrack.values);
        }
        newTrack.values = this._retargetBVHQuaternion(newTrack.values, targetBoneName);
        retargetedTracks.push(newTrack);
      }
    }
    return new THREE.AnimationClip(clip.name, clip.duration, retargetedTracks);
  }

  _retargetBVHQuaternion(values, boneName) {
    const data = this._bindPoses ? this._bindPoses.get(boneName) : null;
    if (!data) return values;

    const { leftQ, rightQ } = data;
    const lx = leftQ.x, ly = leftQ.y, lz = leftQ.z, lw = leftQ.w;
    const rx = rightQ.x, ry = rightQ.y, rz = rightQ.z, rw = rightQ.w;

    const corrected = new Float32Array(values.length);
    for (let i = 0; i < values.length; i += 4) {
      const bx = values[i], by = values[i + 1], bz = values[i + 2], bw = values[i + 3];
      // temp = leftQ * Q_bvh
      const tx = lw * bx + lx * bw + ly * bz - lz * by;
      const ty = lw * by + ly * bw + lz * bx - lx * bz;
      const tz = lw * bz + lz * bw + lx * by - ly * bx;
      const tw = lw * bw - lx * bx - ly * by - lz * bz;
      // result = temp * rightQ
      corrected[i]     = tw * rx + tx * rw + ty * rz - tz * ry;
      corrected[i + 1] = tw * ry + ty * rw + tz * rx - tx * rz;
      corrected[i + 2] = tw * rz + tz * rw + tx * ry - ty * rx;
      corrected[i + 3] = tw * rw - tx * rx - ty * ry - tz * rz;
    }
    return corrected;
  }

  _stripPitchFromQuaternions(values) {
    const q = new THREE.Quaternion();
    const euler = new THREE.Euler();
    for (let i = 0; i < values.length; i += 4) {
      q.set(values[i], values[i + 1], values[i + 2], values[i + 3]);
      euler.setFromQuaternion(q, 'YXZ');
      euler.x = 0;
      q.setFromEuler(euler);
      values[i] = q.x;
      values[i + 1] = q.y;
      values[i + 2] = q.z;
      values[i + 3] = q.w;
    }
  }

  _buildBVHToModelMap(model) {
    const modelBoneNames = new Set();
    model.traverse((child) => {
      if (child.isBone) modelBoneNames.add(child.name);
    });

    const bvhToModel = {};
    for (const [bvhName, mixamoName] of Object.entries(BVHToMixamoMap)) {
      if (bvhToModel[bvhName]) continue;
      if (modelBoneNames.has(mixamoName)) {
        bvhToModel[bvhName] = mixamoName;
        continue;
      }
      const variants = MixamoToAvaturnVariants[mixamoName];
      if (variants) {
        for (const variant of variants) {
          if (modelBoneNames.has(variant)) {
            bvhToModel[bvhName] = variant;
            break;
          }
        }
      }
      if (!bvhToModel[bvhName] && modelBoneNames.has(bvhName)) {
        bvhToModel[bvhName] = bvhName;
      }
    }
    return bvhToModel;
  }

  _computeRetargetData(model, bvhSkeleton, bvhToModel) {
    const modelBones = new Map();
    model.traverse((child) => {
      if (!child.isBone) return;
      if (child.parent && child.parent.isBone && child.parent.name === child.name) return;
      modelBones.set(child.name, child);
    });

    const bvhBoneMap = new Map();
    for (const bone of bvhSkeleton.bones) bvhBoneMap.set(bone.name, bone);

    const worldRestQ = new Map();
    model.traverse((child) => {
      if (!child.isBone) return;
      if (child.parent && child.parent.isBone && child.parent.name === child.name) return;
      let parentWQ = new THREE.Quaternion();
      if (child.parent && child.parent.isBone && worldRestQ.has(child.parent.name)) {
        parentWQ = worldRestQ.get(child.parent.name);
      }
      worldRestQ.set(child.name, parentWQ.clone().multiply(child.quaternion.clone()));
    });

    const corrections = new Map();
    for (const [bvhBoneName, modelBoneName] of Object.entries(bvhToModel)) {
      const bvhBone = bvhBoneMap.get(bvhBoneName);
      const modelBone = modelBones.get(modelBoneName);
      if (!bvhBone || !modelBone) continue;

      const wq = worldRestQ.get(modelBoneName) || new THREE.Quaternion();
      for (const bvhChild of bvhBone.children) {
        if (!bvhChild.isBone) continue;
        const mapped = bvhToModel[bvhChild.name];
        if (!mapped || !modelBones.has(mapped)) continue;
        const modelChild = modelBones.get(mapped);
        if (modelChild.parent !== modelBone) continue;
        const bDir = bvhChild.position.clone();
        const mDir = modelChild.position.clone();
        if (bDir.lengthSq() > 0.0001 && mDir.lengthSq() > 0.0001) {
          const mDirWorld = mDir.normalize().applyQuaternion(wq);
          const bDirNorm = bDir.normalize();
          if (mDirWorld.dot(bDirNorm) < 0.9) {
            const R = new THREE.Quaternion().setFromUnitVectors(mDirWorld, bDirNorm);
            corrections.set(modelBoneName, R);
          }
          break;
        }
      }
    }

    const effectiveR = new Map();
    model.traverse((child) => {
      if (!child.isBone) return;
      if (child.parent && child.parent.isBone && child.parent.name === child.name) return;
      if (corrections.has(child.name)) {
        effectiveR.set(child.name, corrections.get(child.name));
      } else if (child.parent && child.parent.isBone && effectiveR.has(child.parent.name)) {
        effectiveR.set(child.name, effectiveR.get(child.parent.name));
      }
    });

    const retargetData = new Map();
    model.traverse((child) => {
      if (!child.isBone) return;
      if (child.parent && child.parent.isBone && child.parent.name === child.name) return;

      const wq = worldRestQ.get(child.name) || new THREE.Quaternion();
      const rg = effectiveR.get(child.name) || new THREE.Quaternion();
      const rightQ = rg.clone().multiply(wq);

      let leftQ = new THREE.Quaternion();
      if (child.parent && child.parent.isBone) {
        const parentName = child.parent.name;
        const parentWQ = worldRestQ.get(parentName) || new THREE.Quaternion();
        const parentRG = effectiveR.get(parentName) || new THREE.Quaternion();
        leftQ = parentRG.clone().multiply(parentWQ).invert();
      }
      retargetData.set(child.name, { leftQ, rightQ });
    });

    return retargetData;
  }
}
