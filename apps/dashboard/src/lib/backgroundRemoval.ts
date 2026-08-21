import { assetsApi, type Asset } from '@/lib/api';

// Runs entirely client-side (no server round trip, no third-party API): loads an ONNX
// segmentation model on first use (cached by the library in IndexedDB afterward) and produces a
// transparent-background PNG, uploaded as a brand new asset so the original stays untouched and
// reusable elsewhere. Shared by ImagePicker's own "Remove background" button and the editor
// canvases' right-click "Hide background" action, so there's exactly one place that owns this.
export async function removeAssetBackground(asset: Asset, onProgress?: (pct: number) => void): Promise<Asset> {
  if (!asset.url) throw new Error('Asset has no url');
  const { removeBackground } = await import('@imgly/background-removal');
  const blob = await removeBackground(asset.url, {
    model: 'isnet_quint8',
    output: { format: 'image/png' },
    progress: (_key, current, total) => {
      if (total > 0) onProgress?.(Math.round((current / total) * 100));
    },
  });
  const name = asset.name.replace(/\.[^./]+$/, '');
  const file = new File([blob], `${name}-no-bg.png`, { type: 'image/png' });
  return assetsApi.upload(file);
}
