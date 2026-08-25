import { assetsApi, type Asset } from '@/lib/api';

// Rasterizes the layout/theme editor's visual canvas to a PNG and uploads it as a brand-new
// image Asset. The layout/theme itself is untouched and keeps saving as its own structured
// template — this just gives an easier path to reuse the design as a plain picture (e.g. to
// drop it into a zone elsewhere, or run it through the asset-level crop/background-removal
// tools) without reopening the full editor. Same html2canvas capture the player app already
// uses for crash-report screenshots (apps/player/src/pages/PlayerPage.tsx).
export async function captureCanvasAsAsset(el: HTMLElement, name: string): Promise<Asset> {
  const { default: html2canvas } = await import('html2canvas');
  const canvas = await html2canvas(el, { backgroundColor: '#111111', useCORS: true, logging: false });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Failed to render design');
  const file = new File([blob], `${name.trim() || 'design'}.png`, { type: 'image/png' });
  return assetsApi.upload(file);
}

// fabric.js editors (currently just Layouts) rasterize themselves directly via
// canvas.toDataURL() instead of an external html2canvas DOM capture — this just turns that data
// URL into the same uploaded Asset the DOM-capture path above produces.
export async function captureFabricCanvasAsAsset(dataUrl: string, name: string): Promise<Asset> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const file = new File([blob], `${name.trim() || 'design'}.png`, { type: 'image/png' });
  return assetsApi.upload(file);
}
