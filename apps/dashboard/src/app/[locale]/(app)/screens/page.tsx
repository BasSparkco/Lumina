'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Monitor, Plus, Unplug, Trash2, Tv2, RefreshCw, Send, AlertTriangle, Moon } from 'lucide-react';
import { screensApi, playlistsApi, layoutsApi, type Screen } from '@/lib/api';
import { useScreenSocket } from '@/hooks/useScreenSocket';

const PRAYER_METHODS = [
  { value: 'UmmAlQura', label: 'Umm Al-Qura (Saudi Arabia)' },
  { value: 'Dubai', label: 'Dubai' },
  { value: 'Kuwait', label: 'Kuwait' },
  { value: 'Qatar', label: 'Qatar' },
  { value: 'Egyptian', label: 'Egyptian General Authority' },
  { value: 'MuslimWorldLeague', label: 'Muslim World League' },
  { value: 'Karachi', label: 'University of Islamic Sciences, Karachi' },
  { value: 'NorthAmerica', label: 'North America (ISNA)' },
  { value: 'MoonsightingCommittee', label: 'Moonsighting Committee' },
  { value: 'Singapore', label: 'Singapore' },
  { value: 'Tehran', label: 'Tehran' },
  { value: 'Turkey', label: 'Turkey' },
];

function PrayerPanel({ screen }: { screen: Screen }) {
  const qc = useQueryClient();
  const [lat, setLat] = useState(screen.latitude?.toString() ?? '');
  const [lon, setLon] = useState(screen.longitude?.toString() ?? '');
  const [method, setMethod] = useState(screen.prayerMethod ?? 'UmmAlQura');
  const [athan, setAthan] = useState(screen.athanEnabled ?? false);

  const prayerMut = useMutation({
    mutationFn: () =>
      screensApi.updatePrayer(screen.id, {
        latitude: lat ? parseFloat(lat) : undefined,
        longitude: lon ? parseFloat(lon) : undefined,
        prayerMethod: method,
        athanEnabled: athan,
      }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['screens'] }); },
  });

  return (
    <div className="border border-amber-200 rounded-lg p-3 bg-amber-50">
      <div className="flex items-center gap-1.5 mb-2 text-amber-700 font-medium text-xs">
        <Moon className="w-3.5 h-3.5" /> Faith / Prayer settings
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="text-xs text-gray-500 block mb-0.5">Latitude</label>
          <input type="number" step="0.0001" value={lat} onChange={e => setLat(e.target.value)}
            placeholder="e.g. 21.4225"
            className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-0.5">Longitude</label>
          <input type="number" step="0.0001" value={lon} onChange={e => setLon(e.target.value)}
            placeholder="e.g. 39.8262"
            className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
        </div>
      </div>
      <div className="mb-2">
        <label className="text-xs text-gray-500 block mb-0.5">Calculation method</label>
        <select value={method} onChange={e => setMethod(e.target.value)}
          className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400">
          {PRAYER_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      <label className="flex items-center gap-2 text-xs text-gray-600 mb-2 cursor-pointer">
        <input type="checkbox" checked={athan} onChange={e => setAthan(e.target.checked)}
          className="w-3.5 h-3.5 accent-amber-500" />
        Enable athan audio at prayer times
      </label>
      <button onClick={() => prayerMut.mutate()} disabled={prayerMut.isPending}
        className="w-full text-xs py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded font-medium disabled:opacity-50">
        {prayerMut.isPending ? 'Saving…' : 'Save faith settings'}
      </button>
    </div>
  );
}

export default function ScreensPage() {
  const qc = useQueryClient();
  const { data: screens = [], isLoading } = useQuery({ queryKey: ['screens'], queryFn: screensApi.list });
  const { data: playlists = [] } = useQuery({ queryKey: ['playlists'], queryFn: playlistsApi.list });
  const { data: layouts = [] } = useQuery({ queryKey: ['layouts'], queryFn: layoutsApi.list });
  const liveStatuses = useScreenSocket();

  const [showPair, setShowPair] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const [pairError, setPairError] = useState('');
  const [expandedPrayer, setExpandedPrayer] = useState<string | null>(null);

  const pairMut = useMutation({
    mutationFn: () => screensApi.pair(pairCode.trim().toUpperCase()),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['screens'] }); setShowPair(false); setPairCode(''); },
    onError: (e: Error) => setPairError(e.message),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => screensApi.remove(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['screens'] }); },
  });

  const assignMut = useMutation({
    mutationFn: ({ id, playlistId }: { id: string; playlistId: string }) => screensApi.assign(id, playlistId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['screens'] }); },
  });

  const publishMut = useMutation({ mutationFn: (id: string) => screensApi.publish(id) });
  const reloadMut = useMutation({ mutationFn: (id: string) => screensApi.reload(id) });
  const layoutMut = useMutation({
    mutationFn: ({ id, layoutId }: { id: string; layoutId: string | null }) =>
      screensApi.setLayout(id, layoutId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['screens'] }); },
  });
  const emergencyMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      screensApi.setEmergency(id, active),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['screens'] }); },
  });

  function statusFor(screen: Screen): 'ONLINE' | 'OFFLINE' {
    return liveStatuses[screen.id] ?? screen.status;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Screens</h1>
          <p className="text-sm text-gray-500 mt-1">Manage and monitor your displays</p>
        </div>
        <button onClick={() => { setShowPair(true); setPairError(''); }}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
          <Plus className="w-4 h-4" /> Pair screen
        </button>
      </div>

      {/* Pair modal */}
      {showPair && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><Unplug className="w-4 h-4 text-indigo-600" /> Pair a screen</h2>
            <p className="text-sm text-gray-500 mb-3">Enter the 6-character code shown on the screen.</p>
            <input value={pairCode} onChange={e => { setPairCode(e.target.value.toUpperCase()); setPairError(''); }}
              placeholder="ABC123" maxLength={6}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-center tracking-widest font-mono text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-2" />
            {pairError && <p className="text-xs text-red-600 mb-2">{pairError}</p>}
            <div className="flex gap-2 mt-2">
              <button onClick={() => setShowPair(false)}
                className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={() => pairMut.mutate()} disabled={pairCode.length < 6 || pairMut.isPending}
                className="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                {pairMut.isPending ? 'Pairing…' : 'Pair'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading && <p className="text-sm text-gray-400">Loading screens…</p>}

      {!isLoading && screens.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Monitor className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No screens yet. Open the player on a device and pair it.</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {screens.map((screen: Screen) => {
          const live = statusFor(screen);
          return (
            <div key={screen.id} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Tv2 className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="font-medium text-gray-900 text-sm">{screen.name}</span>
                </div>
                <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${live === 'ONLINE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${live === 'ONLINE' ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                  {live}
                </span>
              </div>

              <div>
                <label className="text-xs text-gray-400 mb-1 block">Default playlist</label>
                <select
                  value={screen.playlistId ?? ''}
                  onChange={e => { if (e.target.value) assignMut.mutate({ id: screen.id, playlistId: e.target.value }); }}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">— None —</option>
                  {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-400 mb-1 block">Layout (zones)</label>
                <select
                  value={screen.layoutId ?? ''}
                  onChange={e => layoutMut.mutate({ id: screen.id, layoutId: e.target.value || null })}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">— Fullscreen (no layout) —</option>
                  {layouts.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>

              {/* Prayer settings */}
              <button
                onClick={() => setExpandedPrayer(expandedPrayer === screen.id ? null : screen.id)}
                className="flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-700 font-medium">
                <Moon className="w-3.5 h-3.5" />
                {expandedPrayer === screen.id ? 'Hide' : 'Configure'} faith settings
                {screen.latitude && screen.longitude && (
                  <span className="ml-auto text-amber-500 opacity-70">✓ set</span>
                )}
              </button>
              {expandedPrayer === screen.id && <PrayerPanel screen={screen} />}

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => publishMut.mutate(screen.id)}
                  disabled={publishMut.isPending}
                  title="Push latest content to screen"
                  className="flex-1 flex items-center justify-center gap-1 border border-indigo-200 text-indigo-600 py-1.5 rounded-lg text-xs font-medium hover:bg-indigo-50 disabled:opacity-50">
                  <Send className="w-3 h-3" /> Publish
                </button>
                <button
                  onClick={() => emergencyMut.mutate({ id: screen.id, active: !screen.emergencyActive })}
                  disabled={emergencyMut.isPending}
                  title={screen.emergencyActive ? 'Deactivate emergency override' : 'Activate emergency override'}
                  className={`flex items-center justify-center gap-1 border py-1.5 px-3 rounded-lg text-xs disabled:opacity-50 ${
                    screen.emergencyActive
                      ? 'border-red-300 text-red-600 bg-red-50 hover:bg-red-100'
                      : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}>
                  <AlertTriangle className="w-3 h-3" />
                </button>
                <button
                  onClick={() => reloadMut.mutate(screen.id)}
                  disabled={reloadMut.isPending}
                  title="Reload screen player"
                  className="flex items-center justify-center gap-1 border border-gray-200 text-gray-500 py-1.5 px-3 rounded-lg text-xs hover:bg-gray-50 disabled:opacity-50">
                  <RefreshCw className="w-3 h-3" />
                </button>
              </div>

              <div className="flex justify-between items-center pt-1 border-t border-gray-100">
                <span className="text-xs text-gray-400">
                  {screen.lastSeenAt ? `Last seen ${new Date(screen.lastSeenAt).toLocaleString()}` : 'Never seen'}
                </span>
                <button onClick={() => { if (confirm('Delete this screen?')) removeMut.mutate(screen.id); }}
                  className="p-1 text-gray-400 hover:text-red-500 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
