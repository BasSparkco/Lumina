// Tiny cross-zone/element cache for raw <img> elements used to build fabric.FabricImage objects.
// A resize/rotate/shape-change commit rebuilds a zone/element's fabric content synchronously
// (see LayoutCanvasPanel/ThemeCanvasPanel) — without this, every one of those rebuilds would
// re-fetch the same asset URL, and `getCachedImageElement` lets that rebuild skip the async
// round-trip entirely once the first load has resolved. Keyed by URL; multiple zones/elements
// referencing the same asset share one load.
const resolved = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement>>();

export function loadImageElement(url: string): Promise<HTMLImageElement> {
  const cached = resolved.get(url);
  if (cached) return Promise.resolve(cached);
  let promise = pending.get(url);
  if (!promise) {
    promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        resolved.set(url, img);
        pending.delete(url);
        resolve(img);
      };
      img.onerror = () => {
        pending.delete(url);
        reject(new Error(`Failed to load image: ${url}`));
      };
      img.src = url;
    });
    pending.set(url, promise);
  }
  return promise;
}

/** Synchronous cache read — the element if already loaded, otherwise undefined (caller should
 * fall back to `loadImageElement` and swap the result in once it resolves). */
export function getCachedImageElement(url: string): HTMLImageElement | undefined {
  return resolved.get(url);
}
