'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Sparkles, Loader2, Trash2, Plus, X, Send } from 'lucide-react';
import {
  wayfindingAiApi, wayfindingApi,
  type WayfindingAiEligibleScreen, type WayfindingAiScreenConfig, type PoiWithAliases, type WayfindingAiResolutionResult,
} from '@/lib/api';
import { useModuleRouteGuard } from '@/hooks/useModuleRouteGuard';

const inputClass =
  'w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
const labelClass = 'text-xs text-gray-500 dark:text-gray-400 block mb-1';
const cardClass = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl p-6 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// docs/modules/ai_wayfinding_module_plan.md §8 — dashboard experience for AI Wayfinding: eligible
// kiosks and per-screen activation, destination aliases, a test console, and a usage summary.
// This is a module page, not a second dashboard — it lives inside the existing authenticated
// Lumina shell exactly like /wayfinding does.
export default function WayfindingAiPage() {
  const qc = useQueryClient();
  const t = useTranslations('wayfindingAi');
  // A direct URL visit by a tenant without WAYFINDING_AI redirects away and starts no queries —
  // see docs/adr/platform-modules-and-entitlements.md.
  const canRender = useModuleRouteGuard('WAYFINDING_AI');

  const [configScreen, setConfigScreen] = useState<WayfindingAiEligibleScreen | null>(null);
  const [aliasBuildingId, setAliasBuildingId] = useState<string | null>(null);
  const [testBuildingId, setTestBuildingId] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState('');
  const [testLang, setTestLang] = useState<'en' | 'ar'>('en');
  const [testResult, setTestResult] = useState<WayfindingAiResolutionResult | null>(null);

  const screensQuery = useQuery({
    queryKey: ['wayfinding-ai', 'screens'],
    queryFn: wayfindingAiApi.listScreens,
    enabled: canRender,
  });
  const buildingsQuery = useQuery({
    queryKey: ['wayfinding', 'buildings'],
    queryFn: wayfindingApi.listBuildings,
    enabled: canRender,
  });
  const poisQuery = useQuery({
    queryKey: ['wayfinding-ai', 'pois', aliasBuildingId],
    queryFn: () => wayfindingAiApi.listPoisWithAliases(aliasBuildingId!),
    enabled: canRender && !!aliasBuildingId,
  });
  const usageQuery = useQuery({
    queryKey: ['wayfinding-ai', 'usage'],
    queryFn: () => wayfindingAiApi.getUsage(),
    enabled: canRender,
  });

  const updateConfigMutation = useMutation({
    mutationFn: (input: { screenId: string; dto: Parameters<typeof wayfindingAiApi.updateConfig>[1] }) =>
      wayfindingAiApi.updateConfig(input.screenId, input.dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wayfinding-ai', 'screens'] });
      setConfigScreen(null);
    },
  });
  const testMutation = useMutation({
    mutationFn: () => wayfindingAiApi.testResolve(testBuildingId!, testMessage, testLang),
    onSuccess: (result) => setTestResult(result),
  });
  const addAliasMutation = useMutation({
    mutationFn: (input: { poiId: string; value: string; language: 'en' | 'ar' }) =>
      wayfindingAiApi.addAlias(input.poiId, input.value, input.language),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['wayfinding-ai', 'pois', aliasBuildingId] }),
  });
  const removeAliasMutation = useMutation({
    mutationFn: (aliasId: string) => wayfindingAiApi.removeAlias(aliasId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['wayfinding-ai', 'pois', aliasBuildingId] }),
  });

  if (!canRender) return null;

  const screens = screensQuery.data ?? [];
  const buildings = buildingsQuery.data ?? [];
  const usage = usageQuery.data ?? [];
  const requestCount = usage.length;
  const modelCallPct = requestCount ? Math.round((usage.filter((u) => u.usedModel).length / requestCount) * 100) : 0;
  const noMatchPct = requestCount ? Math.round((usage.filter((u) => u.outcome === 'NO_MATCH').length / requestCount) * 100) : 0;
  const avgLatency = requestCount ? Math.round(usage.reduce((sum, u) => sum + u.latencyMs, 0) / requestCount) : 0;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Sparkles className="w-6 h-6 text-indigo-600" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
        </div>
      </div>

      {/* Eligible kiosks + per-screen activation */}
      <section className={cardClass}>
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('eligibleKiosks')}</h2>
        {screensQuery.isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
        ) : screens.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('noEligibleKiosks')}</p>
        ) : (
          <div className="space-y-2">
            {screens.map((screen) => (
              <div key={screen.id} className="flex items-center justify-between border border-gray-100 dark:border-gray-800 rounded-lg px-3 py-2">
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{screen.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{screen.kioskLocation?.floor.building.name}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${screen.wayfindingAiConfig?.enabled ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                    {screen.wayfindingAiConfig?.enabled ? t('enabled') : t('disabled')}
                  </span>
                  <button
                    className="text-sm text-indigo-600 hover:underline"
                    onClick={() => setConfigScreen(screen)}
                  >
                    {t('configure')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Destination aliases */}
      <section className={cardClass}>
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('aliases')}</h2>
        <div className="mb-3">
          <label className={labelClass}>{t('building')}</label>
          <select className={inputClass} value={aliasBuildingId ?? ''} onChange={(e) => setAliasBuildingId(e.target.value || null)}>
            <option value="">{t('selectBuilding')}</option>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        {aliasBuildingId && (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {(poisQuery.data ?? []).map((poi: PoiWithAliases) => (
              <AliasRow
                key={poi.id}
                poi={poi}
                onAdd={(value, language) => addAliasMutation.mutate({ poiId: poi.id, value, language })}
                onRemove={(aliasId) => removeAliasMutation.mutate(aliasId)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Test assistant */}
      <section className={cardClass}>
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('testAssistant')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 mb-3">
          <select className={inputClass} value={testBuildingId ?? ''} onChange={(e) => setTestBuildingId(e.target.value || null)}>
            <option value="">{t('selectBuilding')}</option>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className={inputClass} value={testLang} onChange={(e) => setTestLang(e.target.value as 'en' | 'ar')}>
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
          <button
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            disabled={!testBuildingId || !testMessage.trim() || testMutation.isPending}
            onClick={() => testMutation.mutate()}
          >
            {testMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {t('send')}
          </button>
        </div>
        <input
          className={inputClass}
          placeholder={t('testMessagePlaceholder')}
          value={testMessage}
          onChange={(e) => setTestMessage(e.target.value)}
        />
        {testResult && (
          <pre className="mt-3 text-xs bg-gray-50 dark:bg-gray-800 rounded-lg p-3 overflow-x-auto">
            {JSON.stringify(testResult, null, 2)}
          </pre>
        )}
      </section>

      {/* Usage summary */}
      <section className={cardClass}>
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('usageSummary')}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
          <div>
            <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{requestCount}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{t('requests')}</div>
          </div>
          <div>
            <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{modelCallPct}%</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{t('modelCallRate')}</div>
          </div>
          <div>
            <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{noMatchPct}%</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{t('noMatchRate')}</div>
          </div>
          <div>
            <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{avgLatency}ms</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{t('avgLatency')}</div>
          </div>
        </div>
      </section>

      {configScreen && (
        <ConfigModal
          screen={configScreen}
          onClose={() => setConfigScreen(null)}
          onSave={(dto) => updateConfigMutation.mutate({ screenId: configScreen.id, dto })}
          saving={updateConfigMutation.isPending}
        />
      )}
    </div>
  );
}

function ConfigModal({ screen, onClose, onSave, saving }: {
  screen: WayfindingAiEligibleScreen;
  onClose: () => void;
  onSave: (dto: { enabled: boolean; welcomeMessage: string; welcomeMessageAr: string; maxTurns: number }) => void;
  saving: boolean;
}) {
  const t = useTranslations('wayfindingAi');
  const existing: WayfindingAiScreenConfig | null = screen.wayfindingAiConfig;
  const [enabled, setEnabled] = useState(existing?.enabled ?? false);
  const [welcomeMessage, setWelcomeMessage] = useState(existing?.welcomeMessage ?? 'How can I help you find your destination?');
  const [welcomeMessageAr, setWelcomeMessageAr] = useState(existing?.welcomeMessageAr ?? 'كيف يمكنني مساعدتك في العثور على وجهتك؟');
  const [maxTurns, setMaxTurns] = useState(existing?.maxTurns ?? 8);

  return (
    <Modal title={`${t('configure')} — ${screen.name}`} onClose={onClose}>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t('enableForThisScreen')}
        </label>
        <div>
          <label className={labelClass}>{t('welcomeMessageEn')}</label>
          <input className={inputClass} value={welcomeMessage} onChange={(e) => setWelcomeMessage(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>{t('welcomeMessageAr')}</label>
          <input className={inputClass} dir="rtl" value={welcomeMessageAr} onChange={(e) => setWelcomeMessageAr(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>{t('maxTurns')}</label>
          <input type="number" min={1} max={8} className={inputClass} value={maxTurns} onChange={(e) => setMaxTurns(Number(e.target.value))} />
        </div>
        <button
          className="w-full mt-2 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          disabled={saving}
          onClick={() => onSave({ enabled, welcomeMessage, welcomeMessageAr, maxTurns })}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : t('save')}
        </button>
      </div>
    </Modal>
  );
}

function AliasRow({ poi, onAdd, onRemove }: {
  poi: PoiWithAliases;
  onAdd: (value: string, language: 'en' | 'ar') => void;
  onRemove: (aliasId: string) => void;
}) {
  const t = useTranslations('wayfindingAi');
  const [value, setValue] = useState('');
  const [language, setLanguage] = useState<'en' | 'ar'>('en');

  return (
    <div className="border border-gray-100 dark:border-gray-800 rounded-lg px-3 py-2">
      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{poi.name}</div>
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {poi.aliases.map((alias) => (
          <span key={alias.id} className="flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-800 rounded-full px-2 py-1">
            {alias.value}
            <button onClick={() => onRemove(alias.id)} className="text-gray-400 hover:text-red-500">
              <Trash2 className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5 mt-2">
        <input
          className={`${inputClass} text-xs py-1`}
          placeholder={t('addAliasPlaceholder')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <select className={`${inputClass} text-xs py-1 w-20`} value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'ar')}>
          <option value="en">EN</option>
          <option value="ar">AR</option>
        </select>
        <button
          className="px-2 text-indigo-600 disabled:opacity-40"
          disabled={!value.trim()}
          onClick={() => { onAdd(value.trim(), language); setValue(''); }}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
