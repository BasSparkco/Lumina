'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LayoutTemplate, Plus, Trash2, Pencil, X, Check } from 'lucide-react';
import { layoutsApi, playlistsApi, type Layout, type ZoneInput, type ZoneType } from '@/lib/api';

const ZONE_TYPE_LABELS: Record<ZoneType, string> = {
  MEDIA: 'Media (playlist)',
  PRAYER: 'Prayer times',
  WEATHER: 'Weather',
  CURRENCY: 'Currency rates',
  TICKER: 'News ticker (RSS)',
};

const PRESET_ZONES: Record<string, ZoneInput[]> = {
  'Fullscreen': [{ name: 'Main', x: 0, y: 0, width: 100, height: 100, zIndex: 0, zoneType: 'MEDIA' }],
  'Main + Ticker': [
    { name: 'Main', x: 0, y: 0, width: 100, height: 85, zIndex: 0, zoneType: 'MEDIA' },
    { name: 'Ticker', x: 0, y: 85, width: 100, height: 15, zIndex: 1, zoneType: 'TICKER' },
  ],
  'Split 50/50': [
    { name: 'Left', x: 0, y: 0, width: 50, height: 100, zIndex: 0, zoneType: 'MEDIA' },
    { name: 'Right', x: 50, y: 0, width: 50, height: 100, zIndex: 0, zoneType: 'MEDIA' },
  ],
  'Main + Sidebar': [
    { name: 'Main', x: 0, y: 0, width: 70, height: 100, zIndex: 0, zoneType: 'MEDIA' },
    { name: 'Sidebar', x: 70, y: 0, width: 30, height: 100, zIndex: 1, zoneType: 'PRAYER' },
  ],
  'Mosque': [
    { name: 'Content', x: 0, y: 0, width: 65, height: 100, zIndex: 0, zoneType: 'MEDIA' },
    { name: 'Prayer Times', x: 65, y: 0, width: 35, height: 75, zIndex: 1, zoneType: 'PRAYER' },
    { name: 'Weather', x: 65, y: 75, width: 35, height: 25, zIndex: 1, zoneType: 'WEATHER' },
  ],
};

const ZONE_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

const ZONE_TYPE_BADGE: Record<ZoneType, string> = {
  MEDIA: 'bg-indigo-100 text-indigo-700',
  PRAYER: 'bg-amber-100 text-amber-700',
  WEATHER: 'bg-sky-100 text-sky-700',
  CURRENCY: 'bg-emerald-100 text-emerald-700',
  TICKER: 'bg-orange-100 text-orange-700',
};

function WidgetConfigFields({ zone, onChange }: { zone: ZoneInput; onChange: (cfg: Record<string, unknown>) => void }) {
  const cfg = zone.widgetConfig ?? {};

  switch (zone.zoneType) {
    case 'PRAYER':
      return (
        <div className="col-span-7 grid grid-cols-3 gap-2 bg-amber-50 rounded p-2 text-xs mt-1">
          <div>
            <label className="text-gray-500 block mb-0.5">Method override</label>
            <select value={(cfg['method'] as string) ?? ''} onChange={e => onChange({ ...cfg, method: e.target.value || undefined })}
              className="w-full border border-gray-200 rounded px-1.5 py-1 focus:outline-none">
              <option value="">Inherit from screen</option>
              {['UmmAlQura', 'Dubai', 'Kuwait', 'Qatar', 'Egyptian', 'MuslimWorldLeague', 'NorthAmerica'].map(m =>
                <option key={m} value={m}>{m}</option>
              )}
            </select>
          </div>
          <div>
            <label className="text-gray-500 block mb-0.5">Language</label>
            <select value={(cfg['lang'] as string) ?? 'en'} onChange={e => onChange({ ...cfg, lang: e.target.value })}
              className="w-full border border-gray-200 rounded px-1.5 py-1 focus:outline-none">
              <option value="en">English</option>
              <option value="ar">Arabic (عربي)</option>
            </select>
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer self-end">
            <input type="checkbox" checked={!!(cfg['athanEnabled'])} onChange={e => onChange({ ...cfg, athanEnabled: e.target.checked })} />
            <span className="text-gray-600">Athan audio</span>
          </label>
        </div>
      );
    case 'WEATHER':
      return (
        <div className="col-span-7 grid grid-cols-2 gap-2 bg-sky-50 rounded p-2 text-xs mt-1">
          <div>
            <label className="text-gray-500 block mb-0.5">Language</label>
            <select value={(cfg['lang'] as string) ?? 'en'} onChange={e => onChange({ ...cfg, lang: e.target.value })}
              className="w-full border border-gray-200 rounded px-1.5 py-1 focus:outline-none">
              <option value="en">English</option>
              <option value="ar">Arabic</option>
            </select>
          </div>
          <p className="text-gray-400 self-center">Location inherited from screen settings</p>
        </div>
      );
    case 'CURRENCY':
      return (
        <div className="col-span-7 grid grid-cols-2 gap-2 bg-emerald-50 rounded p-2 text-xs mt-1">
          <div>
            <label className="text-gray-500 block mb-0.5">Base currency</label>
            <select value={(cfg['base'] as string) ?? 'USD'} onChange={e => onChange({ ...cfg, base: e.target.value })}
              className="w-full border border-gray-200 rounded px-1.5 py-1 focus:outline-none">
              {['USD', 'EUR', 'GBP', 'SAR', 'AED'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-gray-500 block mb-0.5">Language</label>
            <select value={(cfg['lang'] as string) ?? 'en'} onChange={e => onChange({ ...cfg, lang: e.target.value })}
              className="w-full border border-gray-200 rounded px-1.5 py-1 focus:outline-none">
              <option value="en">English</option>
              <option value="ar">Arabic</option>
            </select>
          </div>
        </div>
      );
    case 'TICKER':
      return (
        <div className="col-span-7 bg-orange-50 rounded p-2 text-xs mt-1">
          <label className="text-gray-500 block mb-0.5">RSS feed URL</label>
          <input type="url" value={(cfg['feedUrl'] as string) ?? ''} onChange={e => onChange({ ...cfg, feedUrl: e.target.value })}
            placeholder="https://feeds.bbcnews.com/world/rss.xml"
            className="w-full border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400" />
        </div>
      );
    default:
      return null;
  }
}

export default function LayoutsPage() {
  const qc = useQueryClient();
  const { data: layouts = [], isLoading } = useQuery({ queryKey: ['layouts'], queryFn: layoutsApi.list });
  const { data: playlists = [] } = useQuery({ queryKey: ['playlists'], queryFn: playlistsApi.list });

  const [editing, setEditing] = useState<Layout | 'new' | null>(null);
  const [name, setName] = useState('');
  const [zones, setZones] = useState<ZoneInput[]>([]);

  const createMut = useMutation({
    mutationFn: () => layoutsApi.create(name, zones),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['layouts'] }); setEditing(null); },
  });

  const updateMut = useMutation({
    mutationFn: () => layoutsApi.update((editing as Layout).id, name, zones),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['layouts'] }); setEditing(null); },
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => layoutsApi.remove(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['layouts'] }); },
  });

  function openNew() {
    setEditing('new');
    setName('New Layout');
    setZones(PRESET_ZONES['Fullscreen'] ?? []);
  }

  function openEdit(layout: Layout) {
    setEditing(layout);
    setName(layout.name);
    setZones(layout.zones.map(z => ({
      name: z.name, x: z.x, y: z.y, width: z.width, height: z.height,
      zIndex: z.zIndex,
      zoneType: (z.zoneType as ZoneType | undefined) ?? 'MEDIA',
      widgetConfig: z.widgetConfig,
      playlistId: z.playlist?.id,
    })));
  }

  function updateZone(i: number, patch: Partial<ZoneInput>) {
    setZones(prev => prev.map((z, idx) => idx === i ? { ...z, ...patch } : z));
  }

  const saving = createMut.isPending || updateMut.isPending;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Layouts</h1>
          <p className="text-sm text-gray-500 mt-1">Define screen zones and assign playlists or widgets to each area</p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
          <Plus className="w-4 h-4" /> New layout
        </button>
      </div>

      {/* Editor panel */}
      {editing && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <input value={name} onChange={e => setName(e.target.value)}
              className="text-lg font-semibold text-gray-900 border-b border-transparent hover:border-gray-300 focus:border-indigo-500 focus:outline-none bg-transparent w-64"
              placeholder="Layout name" />
            <div className="flex gap-2 flex-wrap">
              {Object.keys(PRESET_ZONES).map(preset => (
                <button key={preset} onClick={() => setZones(PRESET_ZONES[preset]!)}
                  className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Visual preview + zone list side by side */}
          <div className="flex gap-6">
            {/* Screen preview */}
            <div className="shrink-0">
              <div className="text-xs text-gray-400 mb-1">Preview (16:9)</div>
              <div style={{ width: 320, height: 180, background: '#111', position: 'relative', borderRadius: 6, overflow: 'hidden' }}>
                {zones.map((z, i) => (
                  <div key={i} style={{
                    position: 'absolute',
                    left: `${z.x}%`, top: `${z.y}%`,
                    width: `${z.width}%`, height: `${z.height}%`,
                    background: ZONE_COLORS[i % ZONE_COLORS.length] + '55',
                    border: `2px solid ${ZONE_COLORS[i % ZONE_COLORS.length]}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, color: '#fff', fontWeight: 600, textAlign: 'center',
                    flexDirection: 'column', gap: 2,
                  }}>
                    <span>{z.name}</span>
                    <span style={{ opacity: 0.7, fontSize: 8 }}>{z.zoneType ?? 'MEDIA'}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Zone list */}
            <div className="flex-1 space-y-3 max-h-80 overflow-y-auto">
              {zones.map((z, i) => (
                <div key={i} className="space-y-1">
                  <div className="grid grid-cols-7 gap-2 items-center text-xs">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: ZONE_COLORS[i % ZONE_COLORS.length] }} />
                    <input value={z.name} onChange={e => updateZone(i, { name: e.target.value })}
                      className="col-span-2 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="Name" />
                    {(['x', 'y', 'width', 'height'] as const).map(field => (
                      <input key={field} type="number" min={0} max={100}
                        value={z[field]} onChange={e => updateZone(i, { [field]: parseFloat(e.target.value) })}
                        className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        title={field} placeholder={field} />
                    ))}
                    {/* Zone type */}
                    <select value={z.zoneType ?? 'MEDIA'} onChange={e => updateZone(i, { zoneType: e.target.value as ZoneType, widgetConfig: {} })}
                      className="col-span-2 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                      {(Object.keys(ZONE_TYPE_LABELS) as ZoneType[]).map(t => (
                        <option key={t} value={t}>{ZONE_TYPE_LABELS[t]}</option>
                      ))}
                    </select>
                    {/* Playlist (only for MEDIA) */}
                    {(z.zoneType ?? 'MEDIA') === 'MEDIA' ? (
                      <select value={z.playlistId ?? ''} onChange={e => updateZone(i, { playlistId: e.target.value || undefined })}
                        className="col-span-2 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                        <option value="">— No playlist —</option>
                        {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    ) : (
                      <div className="col-span-2" />
                    )}
                    <button onClick={() => setZones(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                  </div>
                  {/* Widget-specific config */}
                  {z.zoneType && z.zoneType !== 'MEDIA' && (
                    <WidgetConfigFields
                      zone={z}
                      onChange={cfg => updateZone(i, { widgetConfig: cfg })}
                    />
                  )}
                </div>
              ))}
              <button onClick={() => setZones(prev => [...prev, { name: `Zone ${prev.length + 1}`, x: 0, y: 0, width: 50, height: 50, zoneType: 'MEDIA' }])}
                className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add zone
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-gray-100">
            <button onClick={() => setEditing(null)}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button onClick={() => editing === 'new' ? createMut.mutate() : updateMut.mutate()}
              disabled={!name.trim() || zones.length === 0 || saving}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              <Check className="w-4 h-4" /> {saving ? 'Saving…' : 'Save layout'}
            </button>
          </div>
        </div>
      )}

      {isLoading && <p className="text-sm text-gray-400">Loading layouts…</p>}

      {!isLoading && layouts.length === 0 && !editing && (
        <div className="text-center py-16 text-gray-400">
          <LayoutTemplate className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No layouts yet. Create one to split your screens into zones.</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {layouts.map((layout: Layout) => (
          <div key={layout.id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="font-medium text-gray-900 text-sm">{layout.name}</span>
              <div className="flex gap-1">
                <button onClick={() => openEdit(layout)}
                  className="p-1 text-gray-400 hover:text-indigo-600"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={() => { if (confirm('Delete layout?')) removeMut.mutate(layout.id); }}
                  className="p-1 text-gray-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>

            {/* Mini preview */}
            <div style={{ width: '100%', aspectRatio: '16/9', background: '#111', position: 'relative', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
              {layout.zones.map((z, i) => (
                <div key={z.id} style={{
                  position: 'absolute',
                  left: `${z.x}%`, top: `${z.y}%`,
                  width: `${z.width}%`, height: `${z.height}%`,
                  background: ZONE_COLORS[i % ZONE_COLORS.length] + '66',
                  border: `1px solid ${ZONE_COLORS[i % ZONE_COLORS.length]}`,
                }} />
              ))}
            </div>

            <div className="space-y-1">
              {layout.zones.map((z, i) => {
                const zt = (z.zoneType as ZoneType | undefined) ?? 'MEDIA';
                return (
                  <div key={z.id} className="flex items-center gap-2 text-xs text-gray-500">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: ZONE_COLORS[i % ZONE_COLORS.length] }} />
                    <span className="font-medium text-gray-700">{z.name}</span>
                    <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${ZONE_TYPE_BADGE[zt]}`}>{zt}</span>
                    {zt === 'MEDIA' && (
                      <>
                        <span className="text-gray-400">→</span>
                        <span>{z.playlist?.name ?? <em className="text-gray-300">no playlist</em>}</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {layout._count && (
              <p className="text-xs text-gray-400 mt-2">{layout._count.screens} screen{layout._count.screens !== 1 ? 's' : ''}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
