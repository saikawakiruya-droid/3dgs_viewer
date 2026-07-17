/**
 * Centralized Bone Mapping Utility
 *
 * 各種3Dモデル形式（Mixamo, VRM, Avaturn）のボーン名を
 * 統一された形式に変換するためのユーティリティ
 */

import * as THREE from 'three';

/**
 * 標準化されたヒューマノイドボーン名（VRM形式をベースに定義）
 * すべてのアバタータイプはこの形式に正規化される
 */
export const HumanoidBoneNames = {
  // 体幹
  HIPS: 'hips',
  SPINE: 'spine',
  CHEST: 'chest',
  UPPER_CHEST: 'upperChest',
  NECK: 'neck',
  HEAD: 'head',

  // 左腕
  LEFT_SHOULDER: 'leftShoulder',
  LEFT_UPPER_ARM: 'leftUpperArm',
  LEFT_LOWER_ARM: 'leftLowerArm',
  LEFT_HAND: 'leftHand',

  // 右腕
  RIGHT_SHOULDER: 'rightShoulder',
  RIGHT_UPPER_ARM: 'rightUpperArm',
  RIGHT_LOWER_ARM: 'rightLowerArm',
  RIGHT_HAND: 'rightHand',

  // 左脚
  LEFT_UPPER_LEG: 'leftUpperLeg',
  LEFT_LOWER_LEG: 'leftLowerLeg',
  LEFT_FOOT: 'leftFoot',
  LEFT_TOES: 'leftToes',

  // 右脚
  RIGHT_UPPER_LEG: 'rightUpperLeg',
  RIGHT_LOWER_LEG: 'rightLowerLeg',
  RIGHT_FOOT: 'rightFoot',
  RIGHT_TOES: 'rightToes',

  // 左手指
  LEFT_THUMB_PROXIMAL: 'leftThumbProximal',
  LEFT_THUMB_INTERMEDIATE: 'leftThumbIntermediate',
  LEFT_THUMB_DISTAL: 'leftThumbDistal',
  LEFT_INDEX_PROXIMAL: 'leftIndexProximal',
  LEFT_INDEX_INTERMEDIATE: 'leftIndexIntermediate',
  LEFT_INDEX_DISTAL: 'leftIndexDistal',
  LEFT_MIDDLE_PROXIMAL: 'leftMiddleProximal',
  LEFT_MIDDLE_INTERMEDIATE: 'leftMiddleIntermediate',
  LEFT_MIDDLE_DISTAL: 'leftMiddleDistal',
  LEFT_RING_PROXIMAL: 'leftRingProximal',
  LEFT_RING_INTERMEDIATE: 'leftRingIntermediate',
  LEFT_RING_DISTAL: 'leftRingDistal',
  LEFT_LITTLE_PROXIMAL: 'leftLittleProximal',
  LEFT_LITTLE_INTERMEDIATE: 'leftLittleIntermediate',
  LEFT_LITTLE_DISTAL: 'leftLittleDistal',

  // 右手指
  RIGHT_THUMB_PROXIMAL: 'rightThumbProximal',
  RIGHT_THUMB_INTERMEDIATE: 'rightThumbIntermediate',
  RIGHT_THUMB_DISTAL: 'rightThumbDistal',
  RIGHT_INDEX_PROXIMAL: 'rightIndexProximal',
  RIGHT_INDEX_INTERMEDIATE: 'rightIndexIntermediate',
  RIGHT_INDEX_DISTAL: 'rightIndexDistal',
  RIGHT_MIDDLE_PROXIMAL: 'rightMiddleProximal',
  RIGHT_MIDDLE_INTERMEDIATE: 'rightMiddleIntermediate',
  RIGHT_MIDDLE_DISTAL: 'rightMiddleDistal',
  RIGHT_RING_PROXIMAL: 'rightRingProximal',
  RIGHT_RING_INTERMEDIATE: 'rightRingIntermediate',
  RIGHT_RING_DISTAL: 'rightRingDistal',
  RIGHT_LITTLE_PROXIMAL: 'rightLittleProximal',
  RIGHT_LITTLE_INTERMEDIATE: 'rightLittleIntermediate',
  RIGHT_LITTLE_DISTAL: 'rightLittleDistal',
};

/**
 * 上半身ボーン名セット（VRM形式）
 * トラッキング時に除外するボーン
 */
export const UPPER_BODY_BONES = new Set([
  // 体幹
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  // 左腕
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  // 左手指
  'leftThumbProximal', 'leftThumbIntermediate', 'leftThumbDistal',
  'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
  'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
  'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
  'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
  // 右腕
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  // 右手指
  'rightThumbProximal', 'rightThumbIntermediate', 'rightThumbDistal',
  'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
  'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
  'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
  'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
]);

/**
 * 上半身ボーンを判定するための正規表現パターン
 * Mixamo/Avaturnなど、様々なボーン命名規則に対応
 */
export const UPPER_BODY_PATTERNS = [
  /spine/i, /chest/i, /neck/i, /head/i,
  /shoulder/i, /arm/i, /hand/i,
  /thumb/i, /index/i, /middle/i, /ring/i, /little/i, /pinky/i
];

/**
 * Mixamo → VRM ボーン名マッピング
 * 公式three-vrm exampleに基づく
 * https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm/examples/humanoidAnimation/mixamoVRMRigMap.js
 */
export const MixamoToVRMMap = {
  'mixamorigHips': 'hips',
  'mixamorigSpine': 'spine',
  'mixamorigSpine1': 'chest',
  'mixamorigSpine2': 'upperChest',
  'mixamorigNeck': 'neck',
  'mixamorigHead': 'head',
  // 左腕
  'mixamorigLeftShoulder': 'leftShoulder',
  'mixamorigLeftArm': 'leftUpperArm',
  'mixamorigLeftForeArm': 'leftLowerArm',
  'mixamorigLeftHand': 'leftHand',
  // 左手指
  'mixamorigLeftHandThumb1': 'leftThumbProximal',
  'mixamorigLeftHandThumb2': 'leftThumbIntermediate',
  'mixamorigLeftHandThumb3': 'leftThumbDistal',
  'mixamorigLeftHandIndex1': 'leftIndexProximal',
  'mixamorigLeftHandIndex2': 'leftIndexIntermediate',
  'mixamorigLeftHandIndex3': 'leftIndexDistal',
  'mixamorigLeftHandMiddle1': 'leftMiddleProximal',
  'mixamorigLeftHandMiddle2': 'leftMiddleIntermediate',
  'mixamorigLeftHandMiddle3': 'leftMiddleDistal',
  'mixamorigLeftHandRing1': 'leftRingProximal',
  'mixamorigLeftHandRing2': 'leftRingIntermediate',
  'mixamorigLeftHandRing3': 'leftRingDistal',
  'mixamorigLeftHandPinky1': 'leftLittleProximal',
  'mixamorigLeftHandPinky2': 'leftLittleIntermediate',
  'mixamorigLeftHandPinky3': 'leftLittleDistal',
  // 右腕
  'mixamorigRightShoulder': 'rightShoulder',
  'mixamorigRightArm': 'rightUpperArm',
  'mixamorigRightForeArm': 'rightLowerArm',
  'mixamorigRightHand': 'rightHand',
  // 右手指
  'mixamorigRightHandThumb1': 'rightThumbProximal',
  'mixamorigRightHandThumb2': 'rightThumbIntermediate',
  'mixamorigRightHandThumb3': 'rightThumbDistal',
  'mixamorigRightHandIndex1': 'rightIndexProximal',
  'mixamorigRightHandIndex2': 'rightIndexIntermediate',
  'mixamorigRightHandIndex3': 'rightIndexDistal',
  'mixamorigRightHandMiddle1': 'rightMiddleProximal',
  'mixamorigRightHandMiddle2': 'rightMiddleIntermediate',
  'mixamorigRightHandMiddle3': 'rightMiddleDistal',
  'mixamorigRightHandRing1': 'rightRingProximal',
  'mixamorigRightHandRing2': 'rightRingIntermediate',
  'mixamorigRightHandRing3': 'rightRingDistal',
  'mixamorigRightHandPinky1': 'rightLittleProximal',
  'mixamorigRightHandPinky2': 'rightLittleIntermediate',
  'mixamorigRightHandPinky3': 'rightLittleDistal',
  // 脚
  'mixamorigLeftUpLeg': 'leftUpperLeg',
  'mixamorigLeftLeg': 'leftLowerLeg',
  'mixamorigLeftFoot': 'leftFoot',
  'mixamorigLeftToeBase': 'leftToes',
  'mixamorigRightUpLeg': 'rightUpperLeg',
  'mixamorigRightLeg': 'rightLowerLeg',
  'mixamorigRightFoot': 'rightFoot',
  'mixamorigRightToeBase': 'rightToes',

  // プレーンなボーン名（Basic Locomotion Pack等のFBX用）
  'Hips': 'hips',
  'Spine': 'spine',
  'Spine1': 'chest',
  'Spine2': 'upperChest',
  'Neck': 'neck',
  'Head': 'head',
  // 左腕
  'LeftShoulder': 'leftShoulder',
  'LeftArm': 'leftUpperArm',
  'LeftForeArm': 'leftLowerArm',
  'LeftHand': 'leftHand',
  // 右腕
  'RightShoulder': 'rightShoulder',
  'RightArm': 'rightUpperArm',
  'RightForeArm': 'rightLowerArm',
  'RightHand': 'rightHand',
  // 脚
  'LeftUpLeg': 'leftUpperLeg',
  'LeftLeg': 'leftLowerLeg',
  'LeftFoot': 'leftFoot',
  'LeftToeBase': 'leftToes',
  'RightUpLeg': 'rightUpperLeg',
  'RightLeg': 'rightLowerLeg',
  'RightFoot': 'rightFoot',
  'RightToeBase': 'rightToes',
};

/**
 * Mixamo → Avaturn ボーン名マッピング
 * Avaturnモデルは複数のボーン命名規則に対応
 */
export const MixamoToAvaturnVariants = {
  'mixamorigHips': ['Hips', 'hips', 'Armature_Hips'],
  'mixamorigSpine': ['Spine', 'spine', 'Armature_Spine'],
  'mixamorigSpine1': ['Spine1', 'spine1', 'Armature_Spine1', 'Chest'],
  'mixamorigSpine2': ['Spine2', 'spine2', 'Armature_Spine2', 'UpperChest'],
  'mixamorigNeck': ['Neck', 'neck', 'Armature_Neck'],
  'mixamorigHead': ['Head', 'head', 'Armature_Head'],
  // 左腕
  'mixamorigLeftShoulder': ['LeftShoulder', 'leftShoulder', 'Armature_LeftShoulder'],
  'mixamorigLeftArm': ['LeftArm', 'leftArm', 'Armature_LeftArm', 'LeftUpperArm'],
  'mixamorigLeftForeArm': ['LeftForeArm', 'leftForeArm', 'Armature_LeftForeArm', 'LeftLowerArm'],
  'mixamorigLeftHand': ['LeftHand', 'leftHand', 'Armature_LeftHand'],
  // 右腕
  'mixamorigRightShoulder': ['RightShoulder', 'rightShoulder', 'Armature_RightShoulder'],
  'mixamorigRightArm': ['RightArm', 'rightArm', 'Armature_RightArm', 'RightUpperArm'],
  'mixamorigRightForeArm': ['RightForeArm', 'rightForeArm', 'Armature_RightForeArm', 'RightLowerArm'],
  'mixamorigRightHand': ['RightHand', 'rightHand', 'Armature_RightHand'],
  // 脚
  'mixamorigLeftUpLeg': ['LeftUpLeg', 'leftUpLeg', 'Armature_LeftUpLeg', 'LeftThigh'],
  'mixamorigLeftLeg': ['LeftLeg', 'leftLeg', 'Armature_LeftLeg', 'LeftShin'],
  'mixamorigLeftFoot': ['LeftFoot', 'leftFoot', 'Armature_LeftFoot'],
  'mixamorigLeftToeBase': ['LeftToeBase', 'leftToeBase', 'Armature_LeftToeBase', 'LeftToe'],
  'mixamorigRightUpLeg': ['RightUpLeg', 'rightUpLeg', 'Armature_RightUpLeg', 'RightThigh'],
  'mixamorigRightLeg': ['RightLeg', 'rightLeg', 'Armature_RightLeg', 'RightShin'],
  'mixamorigRightFoot': ['RightFoot', 'rightFoot', 'Armature_RightFoot'],
  'mixamorigRightToeBase': ['RightToeBase', 'rightToeBase', 'Armature_RightToeBase', 'RightToe'],
  // 左手指
  'mixamorigLeftHandThumb1': ['LeftHandThumb1', 'LeftThumbProximal'],
  'mixamorigLeftHandThumb2': ['LeftHandThumb2', 'LeftThumbIntermediate'],
  'mixamorigLeftHandThumb3': ['LeftHandThumb3', 'LeftThumbDistal'],
  'mixamorigLeftHandIndex1': ['LeftHandIndex1', 'LeftIndexProximal'],
  'mixamorigLeftHandIndex2': ['LeftHandIndex2', 'LeftIndexIntermediate'],
  'mixamorigLeftHandIndex3': ['LeftHandIndex3', 'LeftIndexDistal'],
  'mixamorigLeftHandMiddle1': ['LeftHandMiddle1', 'LeftMiddleProximal'],
  'mixamorigLeftHandMiddle2': ['LeftHandMiddle2', 'LeftMiddleIntermediate'],
  'mixamorigLeftHandMiddle3': ['LeftHandMiddle3', 'LeftMiddleDistal'],
  'mixamorigLeftHandRing1': ['LeftHandRing1', 'LeftRingProximal'],
  'mixamorigLeftHandRing2': ['LeftHandRing2', 'LeftRingIntermediate'],
  'mixamorigLeftHandRing3': ['LeftHandRing3', 'LeftRingDistal'],
  'mixamorigLeftHandPinky1': ['LeftHandPinky1', 'LeftLittleProximal'],
  'mixamorigLeftHandPinky2': ['LeftHandPinky2', 'LeftLittleIntermediate'],
  'mixamorigLeftHandPinky3': ['LeftHandPinky3', 'LeftLittleDistal'],
  // 右手指
  'mixamorigRightHandThumb1': ['RightHandThumb1', 'RightThumbProximal'],
  'mixamorigRightHandThumb2': ['RightHandThumb2', 'RightThumbIntermediate'],
  'mixamorigRightHandThumb3': ['RightHandThumb3', 'RightThumbDistal'],
  'mixamorigRightHandIndex1': ['RightHandIndex1', 'RightIndexProximal'],
  'mixamorigRightHandIndex2': ['RightHandIndex2', 'RightIndexIntermediate'],
  'mixamorigRightHandIndex3': ['RightHandIndex3', 'RightIndexDistal'],
  'mixamorigRightHandMiddle1': ['RightHandMiddle1', 'RightMiddleProximal'],
  'mixamorigRightHandMiddle2': ['RightHandMiddle2', 'RightMiddleIntermediate'],
  'mixamorigRightHandMiddle3': ['RightHandMiddle3', 'RightMiddleDistal'],
  'mixamorigRightHandRing1': ['RightHandRing1', 'RightRingProximal'],
  'mixamorigRightHandRing2': ['RightHandRing2', 'RightRingIntermediate'],
  'mixamorigRightHandRing3': ['RightHandRing3', 'RightRingDistal'],
  'mixamorigRightHandPinky1': ['RightHandPinky1', 'RightLittleProximal'],
  'mixamorigRightHandPinky2': ['RightHandPinky2', 'RightLittleIntermediate'],
  'mixamorigRightHandPinky3': ['RightHandPinky3', 'RightLittleDistal'],
};

/**
 * BVH → Mixamo ボーン名マッピング
 * MediaPipeから出力されたBVHファイルのボーン名をMixamoボーン名に変換
 */
export const BVHToMixamoMap = {
  // 体幹
  'Hips': 'mixamorigHips',
  'hips': 'mixamorigHips',
  'Spine': 'mixamorigSpine',
  'spine': 'mixamorigSpine',
  'Spine1': 'mixamorigSpine1',
  'spine1': 'mixamorigSpine1',
  'Spine2': 'mixamorigSpine2',
  'spine2': 'mixamorigSpine2',
  'Neck': 'mixamorigNeck',
  'neck': 'mixamorigNeck',
  'Head': 'mixamorigHead',
  'head': 'mixamorigHead',
  // 左腕
  'LeftShoulder': 'mixamorigLeftShoulder',
  'leftShoulder': 'mixamorigLeftShoulder',
  'LeftArm': 'mixamorigLeftArm',
  'leftArm': 'mixamorigLeftArm',
  'LeftForeArm': 'mixamorigLeftForeArm',
  'leftForeArm': 'mixamorigLeftForeArm',
  'LeftHand': 'mixamorigLeftHand',
  'leftHand': 'mixamorigLeftHand',
  // 右腕
  'RightShoulder': 'mixamorigRightShoulder',
  'rightShoulder': 'mixamorigRightShoulder',
  'RightArm': 'mixamorigRightArm',
  'rightArm': 'mixamorigRightArm',
  'RightForeArm': 'mixamorigRightForeArm',
  'rightForeArm': 'mixamorigRightForeArm',
  'RightHand': 'mixamorigRightHand',
  'rightHand': 'mixamorigRightHand',
  // 左脚
  'LeftUpLeg': 'mixamorigLeftUpLeg',
  'leftUpLeg': 'mixamorigLeftUpLeg',
  'LeftLeg': 'mixamorigLeftLeg',
  'leftLeg': 'mixamorigLeftLeg',
  'LeftFoot': 'mixamorigLeftFoot',
  'leftFoot': 'mixamorigLeftFoot',
  'LeftToeBase': 'mixamorigLeftToeBase',
  'leftToeBase': 'mixamorigLeftToeBase',
  // 右脚
  'RightUpLeg': 'mixamorigRightUpLeg',
  'rightUpLeg': 'mixamorigRightUpLeg',
  'RightLeg': 'mixamorigRightLeg',
  'rightLeg': 'mixamorigRightLeg',
  'RightFoot': 'mixamorigRightFoot',
  'rightFoot': 'mixamorigRightFoot',
  'RightToeBase': 'mixamorigRightToeBase',
  'rightToeBase': 'mixamorigRightToeBase',
  // 左手指
  'LeftHandThumb1': 'mixamorigLeftHandThumb1',
  'LeftHandThumb2': 'mixamorigLeftHandThumb2',
  'LeftHandThumb3': 'mixamorigLeftHandThumb3',
  'LeftHandIndex1': 'mixamorigLeftHandIndex1',
  'LeftHandIndex2': 'mixamorigLeftHandIndex2',
  'LeftHandIndex3': 'mixamorigLeftHandIndex3',
  'LeftHandMiddle1': 'mixamorigLeftHandMiddle1',
  'LeftHandMiddle2': 'mixamorigLeftHandMiddle2',
  'LeftHandMiddle3': 'mixamorigLeftHandMiddle3',
  'LeftHandRing1': 'mixamorigLeftHandRing1',
  'LeftHandRing2': 'mixamorigLeftHandRing2',
  'LeftHandRing3': 'mixamorigLeftHandRing3',
  'LeftHandPinky1': 'mixamorigLeftHandPinky1',
  'LeftHandPinky2': 'mixamorigLeftHandPinky2',
  'LeftHandPinky3': 'mixamorigLeftHandPinky3',
  // 右手指
  'RightHandThumb1': 'mixamorigRightHandThumb1',
  'RightHandThumb2': 'mixamorigRightHandThumb2',
  'RightHandThumb3': 'mixamorigRightHandThumb3',
  'RightHandIndex1': 'mixamorigRightHandIndex1',
  'RightHandIndex2': 'mixamorigRightHandIndex2',
  'RightHandIndex3': 'mixamorigRightHandIndex3',
  'RightHandMiddle1': 'mixamorigRightHandMiddle1',
  'RightHandMiddle2': 'mixamorigRightHandMiddle2',
  'RightHandMiddle3': 'mixamorigRightHandMiddle3',
  'RightHandRing1': 'mixamorigRightHandRing1',
  'RightHandRing2': 'mixamorigRightHandRing2',
  'RightHandRing3': 'mixamorigRightHandRing3',
  'RightHandPinky1': 'mixamorigRightHandPinky1',
  'RightHandPinky2': 'mixamorigRightHandPinky2',
  'RightHandPinky3': 'mixamorigRightHandPinky3',
};

/**
 * BVH → VRM ボーン名マッピング
 * MediaPipeから出力されたBVHファイルのボーン名をVRMボーン名に変換
 */
export const BVHToVRMMap = {
  // 体幹
  'Hips': 'hips',
  'hips': 'hips',
  'Spine': 'spine',
  'spine': 'spine',
  'Spine1': 'chest',
  'spine1': 'chest',
  'Spine2': 'upperChest',
  'spine2': 'upperChest',
  'Neck': 'neck',
  'neck': 'neck',
  'Head': 'head',
  'head': 'head',
  // 左腕
  'LeftShoulder': 'leftShoulder',
  'leftShoulder': 'leftShoulder',
  'LeftArm': 'leftUpperArm',
  'leftArm': 'leftUpperArm',
  'LeftForeArm': 'leftLowerArm',
  'leftForeArm': 'leftLowerArm',
  'LeftHand': 'leftHand',
  'leftHand': 'leftHand',
  // 右腕
  'RightShoulder': 'rightShoulder',
  'rightShoulder': 'rightShoulder',
  'RightArm': 'rightUpperArm',
  'rightArm': 'rightUpperArm',
  'RightForeArm': 'rightLowerArm',
  'rightForeArm': 'rightLowerArm',
  'RightHand': 'rightHand',
  'rightHand': 'rightHand',
  // 左脚
  'LeftUpLeg': 'leftUpperLeg',
  'leftUpLeg': 'leftUpperLeg',
  'LeftLeg': 'leftLowerLeg',
  'leftLeg': 'leftLowerLeg',
  'LeftFoot': 'leftFoot',
  'leftFoot': 'leftFoot',
  'LeftToeBase': 'leftToes',
  'leftToeBase': 'leftToes',
  // 右脚
  'RightUpLeg': 'rightUpperLeg',
  'rightUpLeg': 'rightUpperLeg',
  'RightLeg': 'rightLowerLeg',
  'rightLeg': 'rightLowerLeg',
  'RightFoot': 'rightFoot',
  'rightFoot': 'rightFoot',
  'RightToeBase': 'rightToes',
  'rightToeBase': 'rightToes',
  // 左手指
  'LeftHandThumb1': 'leftThumbProximal',
  'LeftHandThumb2': 'leftThumbIntermediate',
  'LeftHandThumb3': 'leftThumbDistal',
  'LeftHandIndex1': 'leftIndexProximal',
  'LeftHandIndex2': 'leftIndexIntermediate',
  'LeftHandIndex3': 'leftIndexDistal',
  'LeftHandMiddle1': 'leftMiddleProximal',
  'LeftHandMiddle2': 'leftMiddleIntermediate',
  'LeftHandMiddle3': 'leftMiddleDistal',
  'LeftHandRing1': 'leftRingProximal',
  'LeftHandRing2': 'leftRingIntermediate',
  'LeftHandRing3': 'leftRingDistal',
  'LeftHandPinky1': 'leftLittleProximal',
  'LeftHandPinky2': 'leftLittleIntermediate',
  'LeftHandPinky3': 'leftLittleDistal',
  // 右手指
  'RightHandThumb1': 'rightThumbProximal',
  'RightHandThumb2': 'rightThumbIntermediate',
  'RightHandThumb3': 'rightThumbDistal',
  'RightHandIndex1': 'rightIndexProximal',
  'RightHandIndex2': 'rightIndexIntermediate',
  'RightHandIndex3': 'rightIndexDistal',
  'RightHandMiddle1': 'rightMiddleProximal',
  'RightHandMiddle2': 'rightMiddleIntermediate',
  'RightHandMiddle3': 'rightMiddleDistal',
  'RightHandRing1': 'rightRingProximal',
  'RightHandRing2': 'rightRingIntermediate',
  'RightHandRing3': 'rightRingDistal',
  'RightHandPinky1': 'rightLittleProximal',
  'RightHandPinky2': 'rightLittleIntermediate',
  'RightHandPinky3': 'rightLittleDistal',
};

/**
 * ボーン名が上半身かどうかを判定（VRM形式のボーン名）
 * @param {string} boneName - VRM形式のボーン名
 * @returns {boolean}
 */
export function isUpperBodyBone(boneName) {
  return UPPER_BODY_BONES.has(boneName);
}

/**
 * ボーン名が上半身かどうかを判定（パターンマッチング）
 * Mixamo/Avaturnなど、様々な命名規則に対応
 * @param {string} boneName - ボーン名
 * @returns {boolean}
 */
export function isUpperBodyBoneByPattern(boneName) {
  return UPPER_BODY_PATTERNS.some(pattern => pattern.test(boneName));
}

/**
 * Mixamoボーン名を正規化（コロン形式の違いを吸収）
 * - mixamorigHips → mixamorigHips
 * - mixamorig:Hips → mixamorigHips
 * @param {string} boneName - Mixamoボーン名
 * @returns {string} 正規化されたボーン名
 */
export function normalizeMixamoBoneName(boneName) {
  if (boneName.includes(':')) {
    // mixamorig:Hips → mixamorigHips
    return boneName.replace('mixamorig:', 'mixamorig');
  }
  return boneName;
}

/**
 * アニメーションクリップをモデルのボーン名にリターゲット
 * @param {THREE.AnimationClip} clip - アニメーションクリップ
 * @param {Set<string>} modelBoneNames - モデルのボーン名セット
 * @param {Object} options - オプション
 * @param {'mixamo'|'vrm'|'avaturn'} options.targetType - ターゲットのアバタータイプ
 * @param {'mixamo'|'bvh'} options.sourceType - ソースのアニメーション形式（デフォルト: 'mixamo'）
 * @returns {THREE.AnimationClip} リターゲットされたクリップ
 */
export function retargetAnimationClip(clip, modelBoneNames, options = {}) {
  const { targetType = 'mixamo', sourceType = 'mixamo' } = options;
  let retargetedCount = 0;

  const retargetedTracks = clip.tracks.map(track => {
    const dotIndex = track.name.lastIndexOf('.');
    if (dotIndex === -1) return track;

    const boneName = track.name.substring(0, dotIndex);
    const property = track.name.substring(dotIndex + 1);

    // ボーン名がモデルに存在する場合はそのまま
    if (modelBoneNames.has(boneName)) {
      return track;
    }

    let newBoneName = null;

    // BVHソースの場合
    if (sourceType === 'bvh') {
      switch (targetType) {
        case 'vrm':
          // BVH → VRM
          newBoneName = BVHToVRMMap[boneName];
          if (newBoneName && !modelBoneNames.has(newBoneName)) {
            newBoneName = null;
          }
          break;

        case 'avaturn':
          // BVH → Avaturn（BVHボーン名はAvaturnと同じ形式なのでそのまま使える可能性が高い）
          // まずBVHToMixamoで変換してからMixamoToAvaturnVariantsで検索
          const mixamoBone = BVHToMixamoMap[boneName];
          if (mixamoBone) {
            const variants = MixamoToAvaturnVariants[mixamoBone];
            if (variants) {
              for (const variant of variants) {
                if (modelBoneNames.has(variant)) {
                  newBoneName = variant;
                  break;
                }
              }
            }
          }
          // フォールバック: BVHボーン名をそのまま試す（Avaturnと同形式の場合）
          if (!newBoneName && modelBoneNames.has(boneName)) {
            newBoneName = boneName;
          }
          break;

        case 'mixamo':
        default:
          // BVH → Mixamo
          newBoneName = BVHToMixamoMap[boneName];
          if (newBoneName && !modelBoneNames.has(newBoneName)) {
            // mixamorig:Xxx形式も試す
            const colonName = newBoneName.replace('mixamorig', 'mixamorig:');
            if (modelBoneNames.has(colonName)) {
              newBoneName = colonName;
            } else {
              newBoneName = null;
            }
          }
          break;
      }
    } else {
      // Mixamoソースの場合（既存ロジック）
      // 正規化されたMixamoボーン名を取得
      const normalizedBone = normalizeMixamoBoneName(boneName);

      switch (targetType) {
        case 'vrm':
          // Mixamo → VRM
          newBoneName = MixamoToVRMMap[normalizedBone];
          if (newBoneName && !modelBoneNames.has(newBoneName)) {
            newBoneName = null;
          }
          break;

        case 'avaturn':
          // Mixamo → Avaturn（バリアント検索）
          const variants = MixamoToAvaturnVariants[normalizedBone];
          if (variants) {
            for (const variant of variants) {
              if (modelBoneNames.has(variant)) {
                newBoneName = variant;
                break;
              }
            }
          }
          // フォールバック: プレフィックスを除去して検索
          if (!newBoneName && normalizedBone.startsWith('mixamorig')) {
            const stripped = normalizedBone.replace('mixamorig', '');
            if (modelBoneNames.has(stripped)) {
              newBoneName = stripped;
            } else {
              // 小文字版
              const lowercased = stripped.charAt(0).toLowerCase() + stripped.slice(1);
              if (modelBoneNames.has(lowercased)) {
                newBoneName = lowercased;
              }
              // Armature_プレフィックス版
              if (!newBoneName) {
                const armaturePrefixed = 'Armature_' + stripped;
                if (modelBoneNames.has(armaturePrefixed)) {
                  newBoneName = armaturePrefixed;
                }
              }
            }
          }
          break;

        case 'mixamo':
        default:
        // Mixamo → Mixamo（ボーン名形式の変換）
        // 1. mixamorigXxx → mixamorig:Xxx
        if (normalizedBone.startsWith('mixamorig') && !boneName.includes(':')) {
          const colonName = boneName.replace('mixamorig', 'mixamorig:');
          if (modelBoneNames.has(colonName)) {
            newBoneName = colonName;
          }
        }
        // 2. mixamorig:Xxx → mixamorigXxx
        if (!newBoneName && boneName.includes('mixamorig:')) {
          const noColonName = boneName.replace('mixamorig:', 'mixamorig');
          if (modelBoneNames.has(noColonName)) {
            newBoneName = noColonName;
          }
        }
        // 3. mixamorigXxx → Xxx（プレフィックスなし）
        if (!newBoneName && normalizedBone.startsWith('mixamorig')) {
          const noPrefixName = normalizedBone.replace('mixamorig', '');
          if (modelBoneNames.has(noPrefixName)) {
            newBoneName = noPrefixName;
          }
        }
        break;
      }
    }

    if (newBoneName) {
      retargetedCount++;
      const clonedTrack = track.clone();
      clonedTrack.name = `${newBoneName}.${property}`;
      return clonedTrack;
    }

    return track;
  });

  if (retargetedCount > 0) {
  }

  return new THREE.AnimationClip(clip.name, clip.duration, retargetedTracks);
}

/**
 * positionトラックを除外したクリップを生成
 * @param {THREE.AnimationClip} clip - アニメーションクリップ
 * @param {string} label - デバッグ用ラベル
 * @returns {THREE.AnimationClip}
 */
export function stripPositionTracks(clip, label = '') {
  const filteredTracks = clip.tracks.filter(track => {
    const isPosition = track.name.endsWith('.position');
    if (isPosition && label) {
    }
    return !isPosition;
  });
  return new THREE.AnimationClip(clip.name, clip.duration, filteredTracks);
}

/**
 * 下半身のみのクリップを生成（上半身ボーンを除外）
 * @param {THREE.AnimationClip} fullBodyClip - フルボディのアニメーションクリップ
 * @param {string} name - 新しいクリップの名前
 * @returns {THREE.AnimationClip}
 */
export function createLowerBodyOnlyClip(fullBodyClip, name) {
  const lowerBodyTracks = fullBodyClip.tracks.filter(track => {
    const trackBoneName = track.name.split('.')[0];
    const isUpperBody = isUpperBodyBoneByPattern(trackBoneName);
    return !isUpperBody;
  });

  const clipName = name || `${fullBodyClip.name}_lowerBody`;
  return new THREE.AnimationClip(clipName, fullBodyClip.duration, lowerBodyTracks);
}

/**
 * モデルからボーン名のセットを取得
 * @param {THREE.Object3D} model - Three.jsモデル
 * @returns {Set<string>}
 */
export function getModelBoneNames(model) {
  const boneNames = new Set();
  model.traverse((obj) => {
    if (obj.isBone) {
      boneNames.add(obj.name);
    }
  });
  return boneNames;
}

/**
 * 上半身ボーンの回転を取得（オブジェクト参照をキーとして使用）
 * トラッキングモード切替時にT-Poseに戻るのを防ぐ
 * @param {THREE.Object3D} model - モデル
 * @returns {Map<THREE.Bone, THREE.Quaternion>}
 */
export function captureUpperBodyBoneRotations(model) {
  const rotations = new Map();
  if (!model) return rotations;

  model.traverse((obj) => {
    if (obj.isBone && isUpperBodyBoneByPattern(obj.name)) {
      rotations.set(obj, obj.quaternion.clone());
    }
  });

  return rotations;
}

/**
 * 上半身ボーンの回転を復元
 * @param {Map<THREE.Bone, THREE.Quaternion>} rotations - captureUpperBodyBoneRotationsで取得した回転マップ
 */
export function restoreUpperBodyBoneRotations(rotations) {
  if (!rotations || rotations.size === 0) return;

  for (const [bone, quaternion] of rotations) {
    bone.quaternion.copy(quaternion);
  }
}

/**
 * VRMモデルの上半身ボーンの回転を取得
 * @param {VRM} vrm - VRMモデル
 * @param {Map<string, THREE.Quaternion>} [targetMap] - 既存Mapを渡すとcopy()で再利用（GC削減）。省略時は新規Mapをclone()で生成
 * @returns {Map<string, THREE.Quaternion>}
 */
export function captureVRMUpperBodyBoneRotations(vrm, targetMap) {
  if (!vrm || !vrm.humanoid) {
    if (targetMap) targetMap.clear();
    return targetMap || new Map();
  }

  if (targetMap) {
    // GC削減: 事前確保済みMapに書き込み
    for (const boneName of UPPER_BODY_BONES) {
      const boneNode = vrm.humanoid.getNormalizedBoneNode(boneName);
      if (boneNode) {
        let saved = targetMap.get(boneName);
        if (!saved) {
          saved = new THREE.Quaternion();
          targetMap.set(boneName, saved);
        }
        saved.copy(boneNode.quaternion);
      }
    }
    return targetMap;
  }

  // 後方互換: 新規Mapを生成
  const rotations = new Map();
  for (const boneName of UPPER_BODY_BONES) {
    const boneNode = vrm.humanoid.getNormalizedBoneNode(boneName);
    if (boneNode) {
      rotations.set(boneName, boneNode.quaternion.clone());
    }
  }
  return rotations;
}

/**
 * VRMモデルの上半身ボーンの回転を復元
 * @param {VRM} vrm - VRMモデル
 * @param {Map<string, THREE.Quaternion>} rotations - captureVRMUpperBodyBoneRotationsで取得した回転マップ
 */
export function restoreVRMUpperBodyBoneRotations(vrm, rotations) {
  if (!vrm || !vrm.humanoid || rotations.size === 0) return;

  for (const [boneName, quaternion] of rotations) {
    const boneNode = vrm.humanoid.getNormalizedBoneNode(boneName);
    if (boneNode) {
      boneNode.quaternion.copy(quaternion);
    }
  }
}
