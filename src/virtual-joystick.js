/**
 * Virtual Joystick
 * モバイル端末用のバーチャルジョイスティック
 */

export class VirtualJoystick {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.size = options.size || 120;
    this.innerSize = options.innerSize || 50;
    this.position = options.position || 'left'; // 'left' or 'right'
    
    // ジョイスティックの状態
    this.active = false;
    this.touchId = null;
    this.centerX = 0;
    this.centerY = 0;
    this.currentX = 0;
    this.currentY = 0;
    
    // 出力値（-1 to 1）
    this.x = 0;
    this.y = 0;
    
    // コールバック
    this.onMove = options.onMove || null;
    this.onEnd = options.onEnd || null;
    
    // DOM要素
    this.element = null;
    this.innerElement = null;
    
    // イベントハンドラのバインド
    this._onTouchStart = this.onTouchStart.bind(this);
    this._onTouchMove = this.onTouchMove.bind(this);
    this._onTouchEnd = this.onTouchEnd.bind(this);
    
    this.create();
  }
  
  /**
   * ジョイスティックのDOM要素を作成
   */
  create() {
    // 外側の円
    this.element = document.createElement('div');
    this.element.className = 'virtual-joystick';
    this.element.style.cssText = `
      position: fixed;
      bottom: calc(30px + env(safe-area-inset-bottom, 0px));
      ${this.position}: calc(30px + env(safe-area-inset-left, 0px));
      width: ${this.size}px;
      height: ${this.size}px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.2);
      border: 3px solid rgba(78, 205, 196, 0.7);
      touch-action: none;
      z-index: 10000;
      display: none;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
    `;
    
    // 内側の円（スティック）
    this.innerElement = document.createElement('div');
    this.innerElement.className = 'virtual-joystick-inner';
    this.innerElement.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      width: ${this.innerSize}px;
      height: ${this.innerSize}px;
      margin-left: -${this.innerSize / 2}px;
      margin-top: -${this.innerSize / 2}px;
      border-radius: 50%;
      background: rgba(78, 205, 196, 0.8);
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
      pointer-events: none;
    `;
    
    this.element.appendChild(this.innerElement);
    this.container.appendChild(this.element);
    
    // イベントリスナーを設定
    this.element.addEventListener('touchstart', this._onTouchStart, { passive: false });
    document.addEventListener('touchmove', this._onTouchMove, { passive: false });
    document.addEventListener('touchend', this._onTouchEnd);
    document.addEventListener('touchcancel', this._onTouchEnd);
  }
  
  /**
   * ジョイスティックを表示
   */
  show() {
    this.element.style.display = 'block';
  }
  
  /**
   * ジョイスティックを非表示
   */
  hide() {
    this.element.style.display = 'none';
    this.reset();
  }
  
  /**
   * タッチ開始
   */
  onTouchStart(event) {
    event.preventDefault();
    event.stopPropagation();

    if (this.active) return;

    const touch = event.changedTouches[0];
    this.touchId = touch.identifier;
    this.active = true;

    const rect = this.element.getBoundingClientRect();
    this.centerX = rect.left + rect.width / 2;
    this.centerY = rect.top + rect.height / 2;

    this.updatePosition(touch.clientX, touch.clientY);
  }
  
  /**
   * タッチ移動
   */
  onTouchMove(event) {
    if (!this.active) return;
    
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      if (touch.identifier === this.touchId) {
        event.preventDefault();
        this.updatePosition(touch.clientX, touch.clientY);
        break;
      }
    }
  }
  
  /**
   * タッチ終了
   */
  onTouchEnd(event) {
    if (!this.active) return;
    
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      if (touch.identifier === this.touchId) {
        this.reset();
        if (this.onEnd) {
          this.onEnd();
        }
        break;
      }
    }
  }
  
  /**
   * ジョイスティックの位置を更新
   */
  updatePosition(touchX, touchY) {
    const maxDistance = (this.size - this.innerSize) / 2;

    let dx = touchX - this.centerX;
    let dy = touchY - this.centerY;

    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > maxDistance) {
      dx = (dx / distance) * maxDistance;
      dy = (dy / distance) * maxDistance;
    }

    // 内側の円を移動
    this.innerElement.style.marginLeft = `${-this.innerSize / 2 + dx}px`;
    this.innerElement.style.marginTop = `${-this.innerSize / 2 + dy}px`;

    // 正規化された値を計算（-1 to 1）
    this.x = dx / maxDistance;
    this.y = -dy / maxDistance; // Y軸は反転（上が正）

    // デバッグ出力（頻度を抑制）
    if (!this._lastLogTime || Date.now() - this._lastLogTime > 500) {
      this._lastLogTime = Date.now();
    }

    if (this.onMove) {
      this.onMove(this.x, this.y);
    }
  }
  
  /**
   * ジョイスティックをリセット
   */
  reset() {
    this.active = false;
    this.touchId = null;
    this.x = 0;
    this.y = 0;
    
    // 内側の円を中央に戻す
    this.innerElement.style.marginLeft = `${-this.innerSize / 2}px`;
    this.innerElement.style.marginTop = `${-this.innerSize / 2}px`;
  }
  
  /**
   * 現在の入力値を取得
   */
  getInput() {
    return { x: this.x, y: this.y };
  }
  
  /**
   * リソースを解放
   */
  dispose() {
    this.element.removeEventListener('touchstart', this._onTouchStart);
    document.removeEventListener('touchmove', this._onTouchMove);
    document.removeEventListener('touchend', this._onTouchEnd);
    document.removeEventListener('touchcancel', this._onTouchEnd);
    
    if (this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}
