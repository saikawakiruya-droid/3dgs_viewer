/**
 * Mobile Utilities
 * モバイル端末の検出とタッチ操作のユーティリティ
 */

/**
 * モバイル端末かどうかを判定
 * @returns {boolean}
 */
export function isMobileDevice() {
  // User Agent による判定
  const userAgentCheck = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
  // iPadOS 13+ 判定: UA が Mac と同一になるため maxTouchPoints で判定
  const iPadOSCheck = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  
  // タッチイベント対応による判定
  const touchCheck = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  
  // 画面サイズによる判定（タブレットも含む）
  const screenCheck = window.innerWidth <= 1024;
  
  return userAgentCheck || iPadOSCheck || (touchCheck && screenCheck);
}

/**
 * タッチデバイスかどうかを判定（PCでもタッチ対応の場合true）
 * @returns {boolean}
 */
export function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/**
 * モバイルUIを初期化
 * body要素にモバイル用のクラスを追加
 */
export function initMobileUI() {
  if (isMobileDevice()) {
    document.body.classList.add('is-mobile');
  }
  
  if (isTouchDevice()) {
    document.body.classList.add('is-touch');
  }
  
  // 画面サイズ変更時に再判定
  window.addEventListener('resize', () => {
    const wasMobile = document.body.classList.contains('is-mobile');
    const isMobile = isMobileDevice();
    
    if (wasMobile !== isMobile) {
      if (isMobile) {
        document.body.classList.add('is-mobile');
      } else {
        document.body.classList.remove('is-mobile');
      }
    }
  });
}
