'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { CalendarClock, Plus, Trash2, Pencil, Check, X, PencilLine, Copy, Search } from 'lucide-react';
import { schedulesApi, screensApi, playlistsApi, type ScheduleEntry, type CreateScheduleInput } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useTimeFormat, formatTime } from '@/hooks/useTimeFormat';
import { TimeInput } from '@/components/TimeInput';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const empty = (): CreateScheduleInput => ({
  name: '', screenId: '', playlistId: '', priority: 0,
  startTime: '', endTime: '', daysOfWeek: [], startDate: '', endDate: '',
});

/** The backend validates startTime/endTime/startDate/endDate with format-specific
 * decorators (@Matches, @IsDateString) that reject an empty string — @IsOptional()
 * only skips validation for undefined/null, not ''. The form always carries '' for
 * these fields until the user fills them in, so every save must strip empties down
 * to undefined before the request leaves the browser, or it 400s every time. */
const emptyToUndefined = (v?: string) => (v === '' ? undefined : v);

function toPayload(f: CreateScheduleInput, screenId: string): CreateScheduleInput {
  return {
    ...f,
    screenId,
    startTime: emptyToUndefined(f.startTime),
    endTime: emptyToUndefined(f.endTime),
    startDate: emptyToUndefined(f.startDate),
    endDate: emptyToUndefined(f.endDate),
  };
}

export default function SchedulesPage() {
  const qc = useQueryClient();
  const { canEditContent } = usePermissions();
  const { confirmDelete } = useConfirmBeforeDelete();
  const { format: timeFormat } = useTimeFormat();
  const t = useTranslations('schedules');
  const tc = useTranslations('common');
  const { data: schedules = [], isLoading } = useQuery({ queryKey: ['schedules'], queryFn: () => schedulesApi.list() });
  const { data: screens = [] } = useQuery({ queryKey: ['screens'], queryFn: screensApi.list });
  const { data: playlists = [] } = useQuery({ queryKey: ['playlists'], queryFn: playlistsApi.list });

  const [editing, setEditing] = useState<ScheduleEntry | 'new' | null>(null);
  const [form, setForm] = useState<CreateScheduleInput>(empty());
  const [changingTarget, setChangingTarget] = useState(false);
  const [selectedScreenIds, setSelectedScreenIds] = useState<string[]>([]);
  const [screenSearch, setScreenSearch] = useState('');
  const [saveError, setSaveError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [search, setSearch] = useState('');

  const createMut = useMutation({
    mutationFn: () => Promise.all(selectedScreenIds.map(screenId => schedulesApi.create(toPayload(form, screenId)))),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['schedules'] });
      setEditing(null);
    },
    onError: (e: Error) => setSaveError(e.message),
  });

  const updateMut = useMutation({
    mutationFn: () => schedulesApi.update((editing as ScheduleEntry).id, toPayload(form, form.screenId)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['schedules'] });
      setEditing(null);
    },
    onError: (e: Error) => setSaveError(e.message),
  });

  const renameMut = useMutation({
    mutationFn: ({ schedule, name }: { schedule: ScheduleEntry; name: string }) =>
      schedulesApi.update(schedule.id, toPayload({
        name, screenId: schedule.screenId, playlistId: schedule.playlistId,
        priority: schedule.priority, startTime: schedule.startTime, endTime: schedule.endTime,
        daysOfWeek: schedule.daysOfWeek, startDate: schedule.startDate, endDate: schedule.endDate,
      }, schedule.screenId)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['schedules'] });
      setRenamingId(null);
    },
  });

  function startRename(s: ScheduleEntry) {
    if (!canEditContent) return;
    setRenamingId(s.id);
    setRenameValue(s.name);
  }

  function commitRename(s: ScheduleEntry) {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === s.name) { setRenamingId(null); return; }
    renameMut.mutate({ schedule: s, name: trimmed });
  }

  const removeMut = useMutation({
    mutationFn: (schedule: ScheduleEntry) => schedulesApi.remove(schedule.id),
    onSuccess: (_data, schedule) => {
      qc.setQueryData<ScheduleEntry[]>(['schedules'], (old) => old?.filter(s => s.id !== schedule.id));
      void qc.invalidateQueries({ queryKey: ['schedules'] });
    },
  });

  function openNew() {
    setEditing('new');
    setForm(empty());
    setChangingTarget(true);
    setSelectedScreenIds([]);
    setScreenSearch('');
    setSaveError('');
  }

  function openEdit(s: ScheduleEntry) {
    setEditing(s);
    setChangingTarget(false);
    setSaveError('');
    setForm({
      name: s.name, screenId: s.screenId, playlistId: s.playlistId,
      priority: s.priority ?? 0, startTime: s.startTime ?? '',
      endTime: s.endTime ?? '', daysOfWeek: s.daysOfWeek ?? [],
      startDate: s.startDate ? s.startDate.substring(0, 10) : '',
      endDate: s.endDate ? s.endDate.substring(0, 10) : '',
    });
  }

  /** Pre-fills the "new schedule" form from an existing one, without touching the original —
   * for making a similar schedule (e.g. same rule, different screen) without editing it in place. */
  function openDuplicate(s: ScheduleEntry) {
    setEditing('new');
    setChangingTarget(true);
    setSelectedScreenIds([s.screenId]);
    setScreenSearch('');
    setSaveError('');
    setForm({
      name: `${s.name} (copy)`, screenId: s.screenId, playlistId: s.playlistId,
      priority: s.priority ?? 0, startTime: s.startTime ?? '',
      endTime: s.endTime ?? '', daysOfWeek: s.daysOfWeek ?? [],
      startDate: s.startDate ? s.startDate.substring(0, 10) : '',
      endDate: s.endDate ? s.endDate.substring(0, 10) : '',
    });
  }

  function toggleScreen(id: string) {
    setSelectedScreenIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
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
  const isNew = editing === 'new';
  const missing: string[] = [];
  if (!form.name) missing.push(t('missingName'));
  if (isNew ? selectedScreenIds.length === 0 : !form.screenId) missing.push(isNew ? t('missingScreens') : t('missingScreen'));
  if (!form.playlistId) missing.push(t('missingPlaylist'));
  const canSave = missing.length === 0;

  // Day-of-week filtering uses the actual calendar day, so an overnight window
  // (e.g. 22:00-06:00) only covers its after-midnight half if the *next* day is
  // also selected — otherwise that portion silently never plays.
  const days = form.daysOfWeek ?? [];
  const crossesMidnight = !!form.startTime && !!form.endTime && form.startTime > form.endTime;
  const midnightGapDays = crossesMidnight && days.length > 0
    ? [...new Set(days.filter(d => !days.includes((d + 1) % 7)).map(d => t(`days.${DAY_KEYS[(d + 1) % 7]}`)))]
    : [];

  const filteredSchedules = schedules.filter((s: ScheduleEntry) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return s.name.toLowerCase().includes(q)
      || (s.screen?.name ?? '').toLowerCase().includes(q)
      || (s.playlist?.name ?? '').toLowerCase().includes(q);
  });

  function formatRule(s: ScheduleEntry) {
    const parts: string[] = [];
    if (s.daysOfWeek?.length) parts.push(s.daysOfWeek.map(d => t(`days.${DAY_KEYS[d]}`)).join(', '));
    if (s.startTime && s.endTime) parts.push(`${formatTime(s.startTime, timeFormat)}–${formatTime(s.endTime, timeFormat)}`);
    if (s.startDate) parts.push(t('from', { date: s.startDate.substring(0, 10) }));
    if (s.endDate) parts.push(t('until', { date: s.endDate.substring(0, 10) }));
    return parts.length ? parts.join(' · ') : t('always');
  }

  return (
    <div className="signal-page signal-workspace-page signal-schedules-page space-y-6">
      <div className="signal-page-heading">
        <div>
          <h1 className="text-2xl font-bold text-[var(--deck-text-hi)]">{t('title')}</h1>
          <p className="text-sm text-[var(--deck-text-mid)] mt-1">{t('subtitle')}</p>
        </div>
        {canEditContent && (
          <button onClick={openNew}
            className="flex items-center gap-2 bg-[var(--deck-accent)] text-white px-4 py-2 rounded-lg text-sm font-medium ">
            <Plus className="w-4 h-4" /> {t('newRule')}
          </button>
        )}
      </div>

      {/* Form */}
      {editing && canEditContent && (
        <div className="glass-panel rounded-2xl border border-[var(--deck-glass-border)] p-6 mb-8 shadow-sm space-y-4">
          <h2 className="font-semibold text-[var(--deck-text-hi)]">{editing === 'new' ? t('newScheduleRule') : t('editRule')}</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="signal-schedules-field-1" className="text-xs text-[var(--deck-text-mid)] mb-1 block">{t('ruleName')}</label>
              <input id="signal-schedules-field-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)]"
                placeholder={t('ruleNamePlaceholder')} />
            </div>
            <div>
              <label htmlFor="signal-schedules-field-2" className="text-xs text-[var(--deck-text-mid)] mb-1 block">{t('priority')}</label>
              <input id="signal-schedules-field-2" type="number" value={form.priority ?? 0} onChange={e => setForm(f => ({ ...f, priority: parseInt(e.target.value) || 0 }))}
                className="w-full border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)]" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[var(--deck-text-mid)] mb-1 block">
                {isNew ? t('screensSelect') : t('screen')}
              </label>
              {isNew ? (
                <div className="border border-[var(--deck-glass-border)] rounded-lg overflow-hidden">
                  {screens.length > 0 && (
                    <div className="relative border-b border-[var(--deck-glass-border-soft)]">
                      <Search className="w-3 h-3 text-[var(--deck-text-low)] absolute top-1/2 -translate-y-1/2 start-2.5" />
                      <input value={screenSearch} onChange={e => setScreenSearch(e.target.value)}
                        placeholder={t('searchScreens')}
                        className="w-full ps-7 pe-2 py-1.5 text-xs bg-transparent text-[var(--deck-text-hi)] focus:outline-none" />
                    </div>
                  )}
                  <div className="max-h-32 overflow-y-auto divide-y divide-[var(--deck-glass-border-soft)]">
                    {screens.length === 0 && <p className="text-xs text-[var(--deck-text-low)] px-3 py-2">{t('noScreensYet')}</p>}
                    {screens.length > 0 && screens.filter(s => s.name.toLowerCase().includes(screenSearch.toLowerCase())).length === 0 && (
                      <p className="text-xs text-[var(--deck-text-low)] px-3 py-2">{tc('noMatches')}</p>
                    )}
                    {screens.filter(s => s.name.toLowerCase().includes(screenSearch.toLowerCase())).map(s => (
                      <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--deck-text-hi)] cursor-pointer hover:bg-[var(--deck-glass-fill-strong)]">
                        <input type="checkbox" checked={selectedScreenIds.includes(s.id)} onChange={() => toggleScreen(s.id)}
                          className="w-3.5 h-3.5 accent-[var(--deck-accent)]" />
                        {s.name}
                      </label>
                    ))}
                  </div>
                </div>
              ) : changingTarget ? (
                <select value={form.screenId} onChange={e => setForm(f => ({ ...f, screenId: e.target.value }))}
                  className="w-full border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)]">
                  <option value="">{t('selectScreen')}</option>
                  {screens.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              ) : (
                <div className="flex items-center justify-between border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm bg-[var(--deck-glass-fill-strong)]">
                  <span className="text-[var(--deck-text-hi)]">{screens.find(s => s.id === form.screenId)?.name ?? form.screenId}</span>
                  <button onClick={() => setChangingTarget(true)} className="flex items-center gap-1 text-xs text-[var(--deck-accent)] hover:text-[var(--deck-accent)] shrink-0">
                    <PencilLine className="w-3 h-3" /> {t('change')}
                  </button>
                </div>
              )}
            </div>
            <div>
              <label className="text-xs text-[var(--deck-text-mid)] mb-1 block">{t('playlistToShow')}</label>
              {changingTarget ? (
                <select value={form.playlistId} onChange={e => setForm(f => ({ ...f, playlistId: e.target.value }))}
                  className="w-full border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)]">
                  <option value="">{t('selectPlaylist')}</option>
                  {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              ) : (
                <div className="flex items-center justify-between border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm bg-[var(--deck-glass-fill-strong)]">
                  <span className="text-[var(--deck-text-hi)]">{playlists.find(p => p.id === form.playlistId)?.name ?? form.playlistId}</span>
                  <button onClick={() => setChangingTarget(true)} className="flex items-center gap-1 text-xs text-[var(--deck-accent)] hover:text-[var(--deck-accent)] shrink-0">
                    <PencilLine className="w-3 h-3" /> {t('change')}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs text-[var(--deck-text-mid)] mb-2 block">{t('daysOfWeek')}</label>
            <div className="flex gap-1">
              {DAY_KEYS.map((d, i) => (
                <button key={d} onClick={() => toggleDay(i)}
                  className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${
                    form.daysOfWeek?.includes(i)
                      ? 'bg-[var(--deck-accent)] text-white border-[var(--deck-accent)]'
                      : 'border-[var(--deck-glass-border)] text-[var(--deck-text-mid)] hover:bg-[var(--deck-glass-fill-strong)]'
                  }`}>
                  {t(`days.${d}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[var(--deck-text-mid)] mb-1 block">{t('startTime')}</label>
              <TimeInput value={form.startTime ?? ''} onChange={v => setForm(f => ({ ...f, startTime: v }))} />
            </div>
            <div>
              <label className="text-xs text-[var(--deck-text-mid)] mb-1 block">{t('endTime')}</label>
              <TimeInput value={form.endTime ?? ''} onChange={v => setForm(f => ({ ...f, endTime: v }))} />
            </div>
          </div>

          {midnightGapDays.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
              {t('midnightWarning', { days: midnightGapDays.join(', ') })}
            </p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="signal-schedules-field-3" className="text-xs text-[var(--deck-text-mid)] mb-1 block">{t('activeFrom')}</label>
              <input id="signal-schedules-field-3" type="date" value={form.startDate ?? ''} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                className="w-full border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)]" />
            </div>
            <div>
              <label htmlFor="signal-schedules-field-4" className="text-xs text-[var(--deck-text-mid)] mb-1 block">{t('activeUntil')}</label>
              <input id="signal-schedules-field-4" type="date" value={form.endDate ?? ''} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                className="w-full border border-[var(--deck-glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--deck-accent)]" />
            </div>
          </div>

          {saveError && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
              {saveError}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-[var(--deck-glass-border-soft)]">
            {!canSave && (
              <p className="text-xs text-[var(--deck-text-low)] me-auto">{tc('stillNeed', { items: missing.join(', ') })}</p>
            )}
            <button onClick={() => setEditing(null)}
              className="px-4 py-2 text-sm text-[var(--deck-text-mid)] border border-[var(--deck-glass-border)] rounded-lg hover:bg-[var(--deck-glass-fill-strong)]">
              <X className="w-4 h-4 inline me-1" />{tc('cancel')}
            </button>
            <button onClick={() => editing === 'new' ? createMut.mutate() : updateMut.mutate()}
              disabled={!canSave || saving}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-[var(--deck-accent)] text-white rounded-lg  disabled:opacity-50">
              <Check className="w-4 h-4" />{saving ? t('saving') : t('saveRule')}
            </button>
          </div>
        </div>
      )}

      {!editing && schedules.length > 0 && (
        <div className="relative mb-5 max-w-sm">
          <Search className="w-4 h-4 text-[var(--deck-text-low)] absolute start-2.5 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={tc('search')}
            className="w-full border border-[var(--deck-glass-border)] rounded-lg ps-8 pe-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--deck-accent)]" />
        </div>
      )}

      {isLoading && <p className="text-sm text-[var(--deck-text-low)]">{t('loading')}</p>}

      {!isLoading && schedules.length === 0 && !editing && (
        <div className="text-center py-16 text-[var(--deck-text-low)]">
          <CalendarClock className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('empty')}</p>
        </div>
      )}

      {!isLoading && !editing && schedules.length > 0 && filteredSchedules.length === 0 && (
        <div className="text-center py-16 text-[var(--deck-text-low)]">
          <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{tc('noMatches')}</p>
        </div>
      )}

      <div className="space-y-3">
        {filteredSchedules.map((s: ScheduleEntry) => (
          <div key={s.id} className="glass-panel rounded-2xl border border-[var(--deck-glass-border)] p-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                {renamingId === s.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(s)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename(s);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    disabled={renameMut.isPending}
                    className="font-medium text-sm text-[var(--deck-text-hi)] border border-[var(--deck-accent)] rounded px-1 -mx-1 focus:outline-none focus:ring-1 focus:ring-[var(--deck-accent)]"
                  />
                ) : (
                  <span
                    onClick={() => startRename(s)}
                    title={canEditContent ? tc('clickToRename') : undefined}
                    className={`font-medium text-[var(--deck-text-hi)] text-sm ${canEditContent ? 'cursor-text hover:text-[var(--deck-accent)]' : ''}`}>
                    {s.name}
                  </span>
                )}
                <span className="text-xs bg-[var(--deck-accent-soft)] text-[var(--deck-accent)] px-2 py-0.5 rounded-full">P{s.priority ?? 0}</span>
              </div>
              <p className="text-xs text-[var(--deck-text-mid)]">
                <span className="font-medium text-[var(--deck-text-hi)]">{s.screen?.name ?? s.screenId}</span>
                {' → '}
                <span className="font-medium text-[var(--deck-text-hi)]">{s.playlist?.name ?? s.playlistId}</span>
                {' · '}
                {formatRule(s)}
              </p>
            </div>
            {canEditContent && (
              <div className="flex gap-1 shrink-0">
                <button onClick={() => openDuplicate(s)} title={t('duplicate')} className="p-1 text-[var(--deck-text-low)] hover:text-[var(--deck-accent)]">
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => openEdit(s)} title={t('edit')} className="p-1 text-[var(--deck-text-low)] hover:text-[var(--deck-accent)]">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => { if (confirmDelete(t('deleteConfirm'))) removeMut.mutate(s); }}
                  title={t('delete')} className="p-1 text-[var(--deck-text-low)] hover:text-red-500">
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
