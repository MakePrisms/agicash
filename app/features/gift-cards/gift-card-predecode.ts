import { GIFT_CARD_IMAGES } from './use-discover-cards';

/**
 * Schedules non-critical work after initial render.
 * Uses idle time when available to avoid impacting UI responsiveness.
 */
function scheduleAfterPaint(callback: () => void) {
  if (typeof window === 'undefined') {
    return;
  }

  if (window.requestIdleCallback) {
    window.requestIdleCallback(callback);
    return;
  }

  window.setTimeout(callback, 0);
}

/**
 * Warms gift card images by preloading and decoding offscreen.
 * Reduces first-render flashing when the gift cards route is opened.
 */
export function scheduleGiftCardPredecode() {
  const predecode = () => {
    const decodes = GIFT_CARD_IMAGES.map((imageUrl) => {
      const img = new Image();
      img.src = imageUrl;
      return img.decode ? img.decode() : Promise.resolve();
    });

    void Promise.allSettled(decodes);
  };

  scheduleAfterPaint(predecode);
}
