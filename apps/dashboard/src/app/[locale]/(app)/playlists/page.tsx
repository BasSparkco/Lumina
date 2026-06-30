'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { List, Plus, Trash2, ChevronRight } from 'lucide-react';
import { playlistsApi, type PlaylistSummary } from '@/lib/api';
import { useLocale } from 'next-intl';

export default function PlaylistsPage() {
  const qc = useQueryClient();
  const locale = useLocale();
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const { data: playlists = [], isLoading } = useQuery({ queryKey: ['playlists'], queryFn: playlistsApi.list });

  const createMut = useMutation({
    mutationFn: () => playlistsApi.create(newName.trim()),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playlists'] }); setNewName(''); setCreating(false); },
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => playlistsApi.remove(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playlists'] }); },
  });

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Playlists</h1>
          <p className="text-sm text-gray-500 mt-1">Ordered sequences of media items</p>
        </div>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
          <Plus className="w-4 h-4" /> New playlist
        </button>
      </div>

      {creating && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 flex gap-2">
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) createMut.mutate(); if (e.key === 'Escape') setCreating(false); }}
            placeholder="Playlist name…"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <button onClick={() => createMut.mutate()} disabled={!newName.trim() || createMut.isPending}
            className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {createMut.isPending ? 'Creating…' : 'Create'}
          </button>
          <button onClick={() => setCreating(false)}
            className="border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
        </div>
      )}

      {isLoading && <p className="text-sm text-gray-400">Loading playlists…</p>}

      {!isLoading && playlists.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <List className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No playlists yet.</p>
        </div>
      )}

      <div className="space-y-2">
        {playlists.map((pl: PlaylistSummary) => (
          <div key={pl.id} className="bg-white border border-gray-200 rounded-xl flex items-center gap-3 px-4 py-3 hover:border-indigo-200 transition-colors group">
            <List className="w-4 h-4 text-gray-400 shrink-0" />
            <a href={`/${locale}/playlists/${pl.id}`} className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">{pl.name}</p>
              <p className="text-xs text-gray-400">{pl._count.items} item{pl._count.items !== 1 ? 's' : ''}</p>
            </a>
            <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-indigo-400 transition-colors" />
            <button onClick={e => { e.preventDefault(); if (confirm('Delete this playlist?')) removeMut.mutate(pl.id); }}
              className="p-1 text-gray-300 hover:text-red-500 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
