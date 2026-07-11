'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ImageIcon, Film, Music, Trash2, Upload, RefreshCw, X, Eye } from 'lucide-react';
import { assetsApi, type Asset } from '@/lib/api';

const typeIcon: Record<string, React.ReactNode> = {
  IMAGE: <ImageIcon className="w-4 h-4 text-blue-500" />,
  VIDEO: <Film className="w-4 h-4 text-purple-500" />,
  AUDIO: <Music className="w-4 h-4 text-green-500" />,
};

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 ** 2).toFixed(1)} MB`;
}

export default function AssetsPage() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);

  const { data: assets = [], isLoading } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list });

  const removeMut = useMutation({
    mutationFn: (id: string) => assetsApi.remove(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['assets'] }); },
  });

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setUploadError('');
    try {
      for (const file of Array.from(files)) {
        await assetsApi.upload(file, setProgress);
      }
      void qc.invalidateQueries({ queryKey: ['assets'] });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      setProgress(0);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Assets</h1>
          <p className="text-sm text-gray-500 mt-1">Images, videos, and audio files</p>
        </div>
        <button onClick={() => inputRef.current?.click()} disabled={uploading}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
          {uploading ? <><RefreshCw className="w-4 h-4 animate-spin" /> Uploading {progress}%</> : <><Upload className="w-4 h-4" /> Upload</>}
        </button>
        <input ref={inputRef} type="file" multiple accept="image/*,video/*,audio/*" className="hidden"
          onChange={e => { void handleFiles(e.target.files); }} />
      </div>

      {uploadError && <div className="mb-4 bg-red-50 text-red-700 text-sm px-4 py-2 rounded-lg">{uploadError}</div>}

      {isLoading && <p className="text-sm text-gray-400">Loading assets…</p>}

      {!isLoading && assets.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <ImageIcon className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No assets yet. Upload an image or video to get started.</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {assets.map((asset: Asset) => (
          <div key={asset.id}
            onClick={() => setPreviewAsset(asset)}
            className="bg-white rounded-xl border border-gray-200 overflow-hidden group cursor-pointer hover:border-indigo-300 hover:shadow-md transition-all">
            {/* Thumbnail */}
            <div className="relative aspect-video bg-gray-100 flex items-center justify-center overflow-hidden">
              {asset.thumbnailUrl ? (
                <img src={asset.thumbnailUrl} alt={asset.name}
                  className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-110" />
              ) : (
                <div className="text-gray-300">{typeIcon[asset.type]}</div>
              )}
              {asset.status === 'PROCESSING' && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <RefreshCw className="w-5 h-5 text-white animate-spin" />
                </div>
              )}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                <Eye className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
              </div>
            </div>
            <div className="p-3">
              <div className="flex items-start justify-between gap-1">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{asset.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                    {typeIcon[asset.type]} {formatBytes(asset.sizeBytes)}
                  </p>
                </div>
                <button onClick={e => { e.stopPropagation(); if (confirm('Delete this asset?')) removeMut.mutate(asset.id); }}
                  className="p-1 text-gray-300 hover:text-red-500 transition-colors shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {previewAsset && (
        <AssetPreviewModal asset={previewAsset} onClose={() => setPreviewAsset(null)} />
      )}
    </div>
  );
}

function AssetPreviewModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{asset.name}</p>
            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
              {typeIcon[asset.type]} {formatBytes(asset.sizeBytes)}
              {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}
              {asset.durationSecs ? ` · ${Math.round(asset.durationSecs)}s` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 bg-gray-900 flex items-center justify-center p-4">
          {asset.status === 'PROCESSING' && (
            <div className="text-gray-400 flex flex-col items-center gap-2 py-12">
              <RefreshCw className="w-6 h-6 animate-spin" />
              <p className="text-sm">Still processing…</p>
            </div>
          )}
          {asset.status !== 'PROCESSING' && asset.type === 'IMAGE' && asset.url && (
            <img src={asset.url} alt={asset.name} className="max-w-full max-h-[70vh] object-contain rounded" />
          )}
          {asset.status !== 'PROCESSING' && asset.type === 'VIDEO' && asset.url && (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video src={asset.url} controls autoPlay className="max-w-full max-h-[70vh] rounded" />
          )}
          {asset.status !== 'PROCESSING' && asset.type === 'AUDIO' && asset.url && (
            <div className="w-full flex flex-col items-center gap-4 py-8">
              <Music className="w-16 h-16 text-gray-500" />
              <audio src={asset.url} controls className="w-full max-w-md" />
            </div>
          )}
          {asset.status !== 'PROCESSING' && !asset.url && (
            <p className="text-sm text-gray-400 py-12">Preview unavailable.</p>
          )}
        </div>
      </div>
    </div>
  );
}
