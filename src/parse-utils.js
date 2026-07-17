/**
 * Parse Utilities
 * モデルパース処理のノンブロッキング化を支援するユーティリティ
 *
 * 重い同期処理の間にメインスレッドに制御を返すことで、
 * レンダーループのフレーム落ちを軽減する
 */

/**
 * メインスレッドに制御を返す
 *
 * scheduler.yield() が利用可能な場合はそれを使用し、
 * そうでない場合は setTimeout(0) でフォールバックする
 *
 * 使用例:
 *   await yieldToMain();  // ブラウザにレンダリング機会を与える
 *
 * @returns {Promise<void>}
 */
export function yieldToMain() {
  if ('scheduler' in globalThis && 'yield' in globalThis.scheduler) {
    return globalThis.scheduler.yield();
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}
