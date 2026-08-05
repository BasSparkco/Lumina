'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { PowerCircle, Plus, Trash2, Pencil, Check, X, Volume2, Search } from 'lucide-react';
import { powerSchedulesApi, realScreenGroupsApi, screensApi, type PowerScheduleEntry, type CreatePowerScheduleInput } from '@/lib/api';
import { PowerPreviewChip } from './PowerPreviewChip';
import { usePermissions } from '@/hooks/usePermissions';
import { useTimeFormat, formatTime } from '@/hooks/useTimeFormat';
import { TimeInput } from '@/components/TimeInput';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

type TargetType = 'screen' | 'group';

interface FormState {
  targetType: TargetType;
  screenId: string;
  groupId: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
}

const empty = (): FormState => ({ targetType: 'screen', screenId: '', groupId: '', daysOfWeek: [], startTime: '', endTime: '' });

function toPayload(f: FormState): CreatePowerScheduleInput {
  return {
    screenId: f.targetType === 'screen' ? f.screenId : undefined,
    groupId: f.targetType === 'group' ? f.groupId : undefined,
    daysOfWeek: f.daysOfWeek,
    startTime: f.startTime,
    endTime: f.endTime,
  };
}

function GroupVolumeControl({ group }: { group: { id: string; name: string; volume: number | null } }) {
  const qc = useQueryClient();
  const t = useTranslations('powerSchedule');
  // Local draft so the slider tracks the pointer smoothly; the mutation only fires once the
  // user releases it, matching the same pattern as the per-screen volume slider.
  const [draft, setDraft] = useState(group.volume ?? 100);

  const volumeMut = useMutation({
    mutationFn: (volume: number) => realScreenGroupsApi.setVolume(group.id, volume),
    onSuccess: (updated) => {
      qc.setQueryData<{ id: string; name: string; volume: number | null }[]>(['realScreenGroups'], (old) =>
        old?.map(g => (g.id === updated.id ? updated : g)));
    },
  });

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-2">
      <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
        <Volume2 className="w-3 h-3" /> {t('groupVolume')} <span className="ms-auto">{draft}%</span>
      </label>
      <input
        type="range" min={0} max={100} value={draft}
        onChange={e => setDraft(Number(e.target.value))}
        onMouseUp={() => volumeMut.mutate(draft)}
        onTouchEnd={() => volumeMut.mutate(draft)}
        className="w-full accent-indigo-600"
      />
    </div>
  );
}

export default function PowerSchedulePage() {
  const qc = useQueryClient();
  const { canEditContent } = usePermissions();
  const { confirmDelete } = useConfirmBeforeDelete();
  const { format: timeFormat } = useTimeFormat();
  const t = useTranslations('powerSchedule');
  const tc = useTranslations('common');
  const { data: rules = [], isLoading } = useQuery({ queryKey: ['powerSchedules'], queryFn: () => powerSchedulesApi.list({}) });
  const { data: screens = [] } = useQuery({ queryKey: ['screens'], queryFn: screensApi.list });
  const { data: groups = [] } = useQuery({ queryKey: ['realScreenGroups'], queryFn: realScreenGroupsApi.list });

  const [editing, setEditing] = useState<PowerScheduleEntry | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(empty());
  const [newGroupName, setNewGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [search, setSearch] = useState('');

  const createGroupMut = useMutation({
    mutationFn: () => realScreenGroupsApi.create(newGroupName.trim()),
    onSuccess: (created) => {
      qc.setQueryData<{ id: string; name: string; volume: number | null }[]>(['realScreenGroups'], (old) => (old ? [...old, created] : [created]));
      setForm(f => ({ ...f, groupId: created.id }));
      setNewGroupName('');
      setCreatingGroup(false);
    },
  });

  const createMut = useMutation({
    mutationFn: () => powerSchedulesApi.create(toPayload(form)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['powerSchedules'] });
      setEditing(null);
    },
    onError: (e: Error) => setSaveError(e.message),
  });

  const updateMut = useMutation({
    mutationFn: () => powerSchedulesApi.update((editing as PowerScheduleEntry).id, toPayload(form)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['powerSchedules'] });
      setEditing(null);
    },
    onError: (e: Error) => setSaveError(e.message),
  });

  const removeMut = useMutation({
    mutationFn: (rule: PowerScheduleEntry) => powerSchedulesApi.remove(rule.id),
    onSuccess: (_data, rule) => {
      qc.setQueryData<PowerScheduleEntry[]>(['powerSchedules'], (old) => old?.filter(r => r.id !== rule.id));
      void qc.invalidateQueries({ queryKey: ['powerSchedules'] });
    },
  });

  function openNew() {
    setEditing('new');
    setForm(empty());
    setSaveError('');
  }

  function openEdit(r: PowerScheduleEntry) {
    setEditing(r);
    setSaveError('');
    setForm({
      targetType: r.groupId ? 'group' : 'screen',
      screenId: r.screenId ?? '',
      groupId: r.groupId ?? '',
      daysOfWeek: r.daysOfWeek ?? [],
      startTime: r.startTime,
      endTime: r.endTime,
    });
  }

  function toggleDay(d: number) {
    setForm(f => ({
      ...f,
      daysOfWeek: f.daysOfWeek.includes(d) ? f.daysOfWeek.filter(x => x !== d) : [...f.daysOfWeek, d],
    }));
  }

  const saving = createMut.isPending || updateMut.isPending;
  const missing: string[] = [];
  if (form.targetType === 'screen' && !form.screenId) missing.push(t('missingScreen'));
  if (form.targetType === 'group' && !form.groupId) missing.push(t('missingGroup'));
  if (!form.startTime) missing.push(t('missingStartTime'));
  if (!form.endTime) missing.push(t('missingEndTime'));
  const canSave = missing.length === 0;

  const days = form.daysOfWeek;
  const crossesMidnight = !!form.startTime && !!form.endTime && form.startTime > form.endTime;
  const midnightGapDays = crossesMidnight && days.length > 0
    ? [...new Set(days.filter(d => !days.includes((d + 1) % 7)).map(d => t(`days.${DAY_KEYS[(d + 1) % 7]}`)))]
    : [];

  const filteredRules = rules.filter((r: PowerScheduleEntry) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (r.screen?.name ?? '').toLowerCase().includes(q) || (r.group?.name ?? '').toLowerCase().includes(q);
  });

  function formatRule(r: PowerScheduleEntry) {
    const parts: string[] = [];
    if (r.daysOfWeek?.length) parts.push(r.daysOfWeek.map(d => t(`days.${DAY_KEYS[d]}`)).join(', '));
    else parts.push(t('everyDay'));
    parts.push(`${formatTime(r.startTime, timeFormat)}–${formatTime(r.endTime, timeFormat)}`);
    return parts.join(' · ');
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
        </div>
        {canEditContent && (
          <button onClick={openNew}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 shrink-0">
            <Plus className="w-4 h-4" /> {t('newRule')}
          </button>
        )}
      </div>

      {editing && canEditContent && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 mb-8 shadow-sm space-y-4">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">{editing === 'new' ? t('newRule') : t('editRule')}</h2>

          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">{t('target')}</label>
            <div className="flex gap-1 mb-3">
              {(['screen', 'group'] as const).map(tt => (
                <button key={tt} onClick={() => setForm(f => ({ ...f, targetType: tt }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    form.targetType === tt
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}>
                  {t(tt === 'screen' ? 'targetScreen' : 'targetGroup')}
                </button>
              ))}
            </div>

            {form.targetType === 'screen' ? (
              <select value={form.screenId} onChange={e => setForm(f => ({ ...f, screenId: e.target.value }))}
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">{t('selectScreen')}</option>
                {screens.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : (
              <div className="space-y-2">
                <select value={form.groupId} onChange={e => setForm(f => ({ ...f, groupId: e.target.value }))}
                  className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">{t('selectGroup')}</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                {creatingGroup ? (
                  <div className="flex gap-2">
                    <input autoFocus value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
                      placeholder={t('newGroupNamePlaceholder')}
                      onKeyDown={e => { if (e.key === 'Enter' && newGroupName.trim()) createGroupMut.mutate(); if (e.key === 'Escape') setCreatingGroup(false); }}
                      className="flex-1 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    <button onClick={() => createGroupMut.mutate()} disabled={!newGroupName.trim() || createGroupMut.isPending}
                      className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => setCreatingGroup(false)} className="px-2 text-gray-400 hover:text-gray-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setCreatingGroup(true)} className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
                    <Plus className="w-3 h-3" /> {t('newGroup')}
                  </button>
                )}
                {form.groupId && groups.find(g => g.id === form.groupId) && (
                  <GroupVolumeControl group={groups.find(g => g.id === form.groupId)!} />
                )}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">{t('daysOfWeek')}</label>
            <div className="flex gap-1">
              {DAY_KEYS.map((d, i) => (
                <button key={d} onClick={() => toggleDay(i)}
                  className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${
                    form.daysOfWeek.includes(i)
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}>
                  {t(`days.${d}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{t('startTime')}</label>
              <TimeInput value={form.startTime} onChange={v => setForm(f => ({ ...f, startTime: v }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{t('endTime')}</label>
              <TimeInput value={form.endTime} onChange={v => setForm(f => ({ ...f, endTime: v }))} />
            </div>
          </div>

          {midnightGapDays.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
              {t('midnightWarning', { days: midnightGapDays.join(', ') })}
            </p>
          )}

          {saveError && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
              {saveError}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
            {!canSave && (
              <p className="text-xs text-gray-400 dark:text-gray-500 me-auto">{tc('stillNeed', { items: missing.join(', ') })}</p>
            )}
            <button onClick={() => setEditing(null)}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
              <X className="w-4 h-4 inline mr-1" />{tc('cancel')}
            </button>
            <button onClick={() => editing === 'new' ? createMut.mutate() : updateMut.mutate()}
              disabled={!canSave || saving}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              <Check className="w-4 h-4" />{saving ? t('saving') : t('saveRule')}
            </button>
          </div>
        </div>
      )}

      {!editing && rules.length > 0 && (
        <div className="relative mb-5 max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute start-2.5 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={tc('search')}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg ps-8 pe-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>
      )}

      {isLoading && <p className="text-sm text-gray-400">{t('loading')}</p>}

      {!isLoading && rules.length === 0 && !editing && (
        <div className="text-center py-16 text-gray-400">
          <PowerCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('empty')}</p>
        </div>
      )}

      {!isLoading && !editing && rules.length > 0 && filteredRules.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{tc('noMatches')}</p>
        </div>
      )}

      <div className="space-y-3">
        {filteredRules.map((r: PowerScheduleEntry) => (
          <div key={r.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                  {r.screen?.name ?? r.group?.name ?? r.screenId ?? r.groupId}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${r.groupId ? 'bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400' : 'bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400'}`}>
                  {r.groupId ? t('groupBadge') : t('screenBadge')}
                </span>
                {r.screenId && <PowerPreviewChip screenId={r.screenId} onLabel={t('onNow')} offLabel={t('offNow')} />}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{formatRule(r)}</p>
            </div>
            {canEditContent && (
              <div className="flex gap-1 shrink-0">
                <button onClick={() => openEdit(r)} title={t('edit')} className="p-1 text-gray-400 dark:text-gray-500 hover:text-indigo-600">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => { if (confirmDelete(t('deleteConfirm'))) removeMut.mutate(r); }}
                  title={t('delete')} className="p-1 text-gray-400 dark:text-gray-500 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
