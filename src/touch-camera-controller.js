/**
 * Touch Camera Controller
 * モバイル端末用のタッチカメラ操作
 */

export class TouchCameraController {
  constructor(options = {}) {
    this.domElement = options.domElement || document.body;
    this.enabled = false;
    
    // 回転感度
    this.rotateSpeed = options.rotateSpeed || 0.005;
    
    // ピンチズーム感度
    this.zoomSpeed = options.zoomSpeed || 0.01;
    
    // タッチ状態
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.lastTouchX = 0;
    this.lastTouchY = 0;
    this.isTouching = false;
    this.touchId = null;
    
    // ピンチズーム用
    this.isPinching = false;
    this.lastPinchDistance = 0;
    
    // 出力値
    this.deltaYaw = 0;
    this.deltaPitch = 0;
    this.deltaZoom = 0;
    
    // コールバック
    this.onRotate = options.onRotate || null;
    this.onZoom = options.onZoom || null;
    
    // ジョイスティックの領域を除外するための参照
    this.excludeElements = [];
    
    // イベントハンドラのバインド
    this._onTouchStart = this.onTouchStart.bind(this);
    this._onTouchMove = this.onTouchMove.bind(this);
    this._onTouchEnd = this.onTouchEnd.bind(this);
    
    this.setupEventListeners();
  }
  
  /**
   * イベントリスナーを設定
   */
  setupEventListeners() {
    this.domElement.addEventListener('touchstart', this._onTouchStart, { passive: false });
    this.domElement.addEventListener('touchmove', this._onTouchMove, { passive: false });
    this.domElement.addEventListener('touchend', this._onTouchEnd);
    this.domElement.addEventListener('touchcancel', this._onTouchEnd);
  }
  
  /**
   * 有効化
   */
  enable() {
    this.enabled = true;
  }
  
  /**
   * 無効化
   */
  disable() {
    this.enabled = false;
    this.reset();
  }
  
  /**
   * 除外する要素を追加（ジョイスティックなど）
   */
  addExcludeElement(element) {
    this.excludeElements.push(element);
  }
  
  /**
   * タッチがUI要素上かどうかを判定
   */
  isTouchOnUI(touch) {
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!target) return false;
    
    // 除外要素のチェック
    for (const el of this.excludeElements) {
      if (el.contains(target)) {
        return true;
      }
    }
    
    // UIパネルのチェック
    const uiPanels = [
      'vrm-panel', 'fbx-panel', 'audio-panel', 'chat-panel',
      'camera-panel', 'connection-panel', 'loading-overlay',
      'virtual-joystick', 'mobile-action-buttons'
    ];
    
    for (const id of uiPanels) {
      const panel = document.getElementById(id);
      if (panel && panel.contains(target)) {
        return true;
      }
    }
    
    // クラス名でのチェック
    if (target.closest('.virtual-joystick') || 
        target.closest('.mobile-action-buttons') ||
        target.closest('[id$="-panel"]')) {
      return true;
    }
    
    return false;
  }
  
  /**
   * タッチ開始
   */
  onTouchStart(event) {
    if (!this.enabled) return;
    
    const touches = event.touches;
    
    // 2本指タッチ（ピンチズーム）
    if (touches.length === 2) {
      this.isPinching = true;
      this.isTouching = false;
      this.lastPinchDistance = this.getPinchDistance(touches[0], touches[1]);
      return;
    }
    
    // 1本指タッチ（回転）
    if (touches.length === 1) {
      const touch = touches[0];
      
      // UI要素上のタッチは無視
      if (this.isTouchOnUI(touch)) {
        return;
      }
      
      this.isTouching = true;
      this.touchId = touch.identifier;
      this.touchStartX = touch.clientX;
      this.touchStartY = touch.clientY;
      this.lastTouchX = touch.clientX;
      this.lastTouchY = touch.clientY;
    }
  }
  
  /**
   * タッチ移動
   */
  onTouchMove(event) {
    if (!this.enabled) return;
    
    const touches = event.touches;
    
    // ピンチズーム
    if (this.isPinching && touches.length === 2) {
      event.preventDefault();
      
      const currentDistance = this.getPinchDistance(touches[0], touches[1]);
      const delta = currentDistance - this.lastPinchDistance;
      
      this.deltaZoom = -delta * this.zoomSpeed;
      
      if (this.onZoom) {
        this.onZoom(this.deltaZoom);
      }
      
      this.lastPinchDistance = currentDistance;
      return;
    }
    
    // 1本指回転
    if (this.isTouching && touches.length === 1) {
      const touch = touches[0];
      
      if (touch.identifier !== this.touchId) return;
      
      event.preventDefault();
      
      const dx = touch.clientX - this.lastTouchX;
      const dy = touch.clientY - this.lastTouchY;
      
      this.deltaYaw = -dx * this.rotateSpeed;
      this.deltaPitch = -dy * this.rotateSpeed;
      
      if (this.onRotate) {
        this.onRotate(this.deltaYaw, this.deltaPitch);
      }
      
      this.lastTouchX = touch.clientX;
      this.lastTouchY = touch.clientY;
    }
  }
  
  /**
   * タッチ終了
   */
  onTouchEnd(event) {
    const touches = event.touches;
    
    if (touches.length < 2) {
      this.isPinching = false;
    }
    
    if (touches.length === 0) {
      this.reset();
    }
  }
  
  /**
   * 2点間の距離を計算
   */
  getPinchDistance(touch1, touch2) {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  
  /**
   * 状態をリセット
   */
  reset() {
    this.isTouching = false;
    this.isPinching = false;
    this.touchId = null;
    this.deltaYaw = 0;
    this.deltaPitch = 0;
    this.deltaZoom = 0;
  }
  
  /**
   * リソースを解放
   */
  dispose() {
    this.domElement.removeEventListener('touchstart', this._onTouchStart);
    this.domElement.removeEventListener('touchmove', this._onTouchMove);
    this.domElement.removeEventListener('touchend', this._onTouchEnd);
    this.domElement.removeEventListener('touchcancel', this._onTouchEnd);
  }
}
