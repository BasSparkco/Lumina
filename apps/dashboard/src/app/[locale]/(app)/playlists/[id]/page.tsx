'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ImageIcon, Film, Music, Trash2, ChevronUp, ChevronDown, Plus, ArrowLeft, RefreshCw } from 'lucide-react';
import { playlistsApi, assetsApi, type PlaylistItem, type Asset } from '@/lib/api';
import { useLocale } from 'next-intl';

export default function PlaylistPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const qc = useQueryClient();
  const locale = useLocale();
  const [showAssetPicker, setShowAssetPicker] = useState(false);

  const { data: playlist, isLoading } = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => playlistsApi.get(id),
  });

  const { data: assets = [] } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list, enabled: showAssetPicker });

  const addMut = useMutation({
    mutationFn: ({ assetId, dur }: { assetId: string; dur: number }) =>
      playlistsApi.addItem(id, assetId, dur),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playlist', id] }); setShowAssetPicker(false); },
  });

  const removeMut = useMutation({
    mutationFn: (itemId: string) => playlistsApi.removeItem(id, itemId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playlist', id] }); },
  });

  const durMut = useMutation({
    mutationFn: ({ itemId, dur }: { itemId: string; dur: number }) => playlistsApi.updateItem(id, itemId, dur),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playlist', id] }); },
  });

  const reorderMut = useMutation({
    mutationFn: (ids: string[]) => playlistsApi.reorder(id, ids),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playlist', id] }); },
  });

  function move(index: number, dir: -1 | 1) {
    if (!playlist) return;
    const items = [...playlist.items];
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target]!, items[index]!];
    reorderMut.mutate(items.map(i => i.id));
  }

  const typeIcon: Record<string, React.ReactNode> = {
    IMAGE: <ImageIcon className="w-3.5 h-3.5 text-blue-500" />,
    VIDEO: <Film className="w-3.5 h-3.5 text-purple-500" />,
    AUDIO: <Music className="w-3.5 h-3.5 text-green-500" />,
  };

  if (isLoading) return <div className="p-8 text-sm text-gray-400">Loading…</div>;
  if (!playlist) return <div className="p-8 text-sm text-red-500">Playlist not found</div>;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <a href={`/${locale}/playlists`} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-6">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to playlists
      </a>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{playlist.name}</h1>
          <p className="text-sm text-gray-500 mt-1">{playlist.items.length} item{playlist.items.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setShowAssetPicker(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
          <Plus className="w-4 h-4" /> Add item
        </button>
      </div>

      {/* Asset picker modal */}
      {showAssetPicker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-5 w-full max-w-lg shadow-xl max-h-[70vh] flex flex-col">
            <h2 className="font-semibold text-gray-900 mb-3">Pick an asset</h2>
            <div className="overflow-y-auto flex-1 space-y-1">
              {assets.filter((a: Asset) => a.status === 'READY').map((a: Asset) => (
                <button key={a.id} onClick={() => addMut.mutate({ assetId: a.id, dur: 10 })}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 text-start transition-colors">
                  {a.thumbnailUrl
                    ? <img src={a.thumbnailUrl} className="w-10 h-10 rounded object-cover shrink-0" alt="" />
                    : <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center shrink-0">{typeIcon[a.type]}</div>
                  }
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{a.name}</p>
                    <p className="text-xs text-gray-400 flex items-center gap-1">{typeIcon[a.type]} {a.type}</p>
                  </div>
                  {addMut.isPending && <RefreshCw className="w-3.5 h-3.5 text-gray-400 animate-spin ms-auto" />}
                </button>
              ))}
              {assets.filter((a: Asset) => a.status === 'READY').length === 0 && (
                <p className="text-sm text-gray-400 py-4 text-center">No ready assets. Upload some first.</p>
              )}
            </div>
            <button onClick={() => setShowAssetPicker(false)}
              className="mt-3 w-full border border-gray-200 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      {playlist.items.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">No items in this playlist. Add some assets above.</p>
        </div>
      )}

      <div className="space-y-2">
        {playlist.items.map((item: PlaylistItem, i: number) => (
          <div key={item.id} className="bg-white border border-gray-200 rounded-xl flex items-center gap-3 px-3 py-2.5">
            <div className="flex flex-col gap-0.5">
              <button onClick={() => move(i, -1)} disabled={i === 0}
                className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-20">
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => move(i, 1)} disabled={i === playlist.items.length - 1}
                className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-20">
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>

            <span className="text-xs text-gray-300 w-4 text-center">{i + 1}</span>

            {item.asset.thumbnailUrl
              ? <img src={item.asset.thumbnailUrl} className="w-10 h-10 rounded object-cover shrink-0" alt="" />
              : <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center shrink-0">{typeIcon[item.asset.type]}</div>
            }

            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{item.asset.name}</p>
              <p className="text-xs text-gray-400 flex items-center gap-1">{typeIcon[item.asset.type]} {item.asset.type}</p>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <input type="number" min={1} max={3600} value={item.durationSecs}
                onChange={e => durMut.mutate({ itemId: item.id, dur: Number(e.target.value) })}
                className="w-14 border border-gray-200 rounded px-2 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              <span className="text-xs text-gray-400">s</span>
            </div>

            <button onClick={() => removeMut.mutate(item.id)}
              className="p-1 text-gray-300 hover:text-red-500 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
