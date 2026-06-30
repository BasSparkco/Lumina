'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { schedulesApi, screensApi, playlistsApi, type ScheduleEntry, type CreateScheduleInput } from '@/lib/api';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const empty = (): CreateScheduleInput => ({
  name: '', screenId: '', playlistId: '', priority: 0,
  startTime: '', endTime: '', daysOfWeek: [], startDate: '', endDate: '',
});

export default function SchedulesPage() {
  const qc = useQueryClient();
  const { data: schedules = [], isLoading } = useQuery({ queryKey: ['schedules'], queryFn: () => schedulesApi.list() });
  const { data: screens = [] } = useQuery({ queryKey: ['screens'], queryFn: screensApi.list });
  const { data: playlists = [] } = useQuery({ queryKey: ['playlists'], queryFn: playlistsApi.list });

  const [editing, setEditing] = useState<ScheduleEntry | 'new' | null>(null);
  const [form, setForm] = useState<CreateScheduleInput>(empty());

  const createMut = useMutation({
    mutationFn: () => schedulesApi.create(form),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['schedules'] }); setEditing(null); },
  });

  const updateMut = useMutation({
    mutationFn: () => schedulesApi.update((editing as ScheduleEntry).id, form),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['schedules'] }); setEditing(null); },
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => schedulesApi.remove(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['schedules'] }); },
  });

  function openNew() {
    setEditing('new');
    setForm(empty());
  }

  function openEdit(s: ScheduleEntry) {
    setEditing(s);
    setForm({
      name: s.name, screenId: s.screenId, playlistId: s.playlistId,
      priority: s.priority ?? 0, startTime: s.startTime ?? '',
      endTime: s.endTime ?? '', daysOfWeek: s.daysOfWeek ?? [],
      startDate: s.startDate ? s.startDate.substring(0, 10) : '',
      endDate: s.endDate ? s.endDate.substring(0, 10) : '',
    });
  }

  function toggleDay(d: number) {
    setForm(f => ({
      ...f,
      daysOfWeek: f.daysOfWeek?.includes(d)
        ? f.daysOfWeek.filter(x => x !== d)
        : [...(f.daysOfWeek ?? []), d],
    }));
  }

  const saving = createMut.isPending || updateMut.isPending;
  const canSave = form.name && form.screenId && form.playlistId;

  function formatRule(s: ScheduleEntry) {
    const parts: string[] = [];
    if (s.daysOfWeek?.length) parts.push(s.daysOfWeek.map(d => DAYS[d]).join(', '));
    if (s.startTime && s.endTime) parts.push(`${s.startTime}–${s.endTime}`);
    if (s.startDate) parts.push(`from ${s.startDate.substring(0, 10)}`);
    if (s.endDate) parts.push(`until ${s.endDate.substring(0, 10)}`);
    return parts.length ? parts.join(' · ') : 'Always';
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Schedules</h1>
          <p className="text-sm text-gray-500 mt-1">Control what plays when — dayparting, day-of-week, date ranges</p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
          <Plus className="w-4 h-4" /> New rule
        </button>
      </div>

      {/* Form */}
      {editing && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8 shadow-sm space-y-4">
          <h2 className="font-semibold text-gray-900">{editing === 'new' ? 'New schedule rule' : 'Edit rule'}</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Rule name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g. Breakfast menu" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Priority (higher wins)</label>
              <input type="number" value={form.priority ?? 0} onChange={e => setForm(f => ({ ...f, priority: parseInt(e.target.value) || 0 }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Screen</label>
              <select value={form.screenId} onChange={e => setForm(f => ({ ...f, screenId: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">— Select screen —</option>
                {screens.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Playlist to show</label>
              <select value={form.playlistId} onChange={e => setForm(f => ({ ...f, playlistId: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">— Select playlist —</option>
                {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-2 block">Days of week (empty = every day)</label>
            <div className="flex gap-1">
              {DAYS.map((d, i) => (
                <button key={d} onClick={() => toggleDay(i)}
                  className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${
                    form.daysOfWeek?.includes(i)
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Start time (HH:MM, empty = all day)</label>
              <input type="time" value={form.startTime ?? ''} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">End time (HH:MM)</label>
              <input type="time" value={form.endTime ?? ''} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Active from date (optional)</label>
              <input type="date" value={form.startDate ?? ''} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Active until date (optional)</label>
              <input type="date" value={form.endDate ?? ''} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <button onClick={() => setEditing(null)}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
              <X className="w-4 h-4 inline mr-1" />Cancel
            </button>
            <button onClick={() => editing === 'new' ? createMut.mutate() : updateMut.mutate()}
              disabled={!canSave || saving}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              <Check className="w-4 h-4" />{saving ? 'Saving…' : 'Save rule'}
            </button>
          </div>
        </div>
      )}

      {isLoading && <p className="text-sm text-gray-400">Loading schedules…</p>}

      {!isLoading && schedules.length === 0 && !editing && (
        <div className="text-center py-16 text-gray-400">
          <CalendarClock className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No schedule rules yet. Add one to control what plays when.</p>
        </div>
      )}

      <div className="space-y-3">
        {schedules.map((s: ScheduleEntry) => (
          <div key={s.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-gray-900 text-sm">{s.name}</span>
                <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">P{s.priority ?? 0}</span>
              </div>
              <p className="text-xs text-gray-500">
                <span className="font-medium text-gray-700">{s.playlist?.name ?? s.playlistId}</span>
                {' · '}
                {formatRule(s)}
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => openEdit(s)} className="p-1 text-gray-400 hover:text-indigo-600">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => { if (confirm('Delete this schedule rule?')) removeMut.mutate(s.id); }}
                className="p-1 text-gray-400 hover:text-red-500">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
