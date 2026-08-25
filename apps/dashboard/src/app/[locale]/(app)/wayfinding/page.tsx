'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  MapPin, Building2, Layers, Plus, Trash2, Pencil, X, Upload, ChevronRight, Loader2,
  Route, Link2, MousePointer2, CirclePlus, AlertTriangle, Users2,
} from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { POI_CATEGORY_PRESETS } from '@lumina/types';
import {
  wayfindingApi, assetsApi, screensApi,
  type Building, type Floor, type PoiCategory, type Poi, type PoiStatus, type PoiInput, type PoiImportRow,
  type RouteNode, type RouteEdge, type RouteEdgeType, type Screen,
} from '@/lib/api';
import { ImagePicker } from '@/components/ImagePicker';
import { PoiMapEditor } from '@/components/PoiMapEditor';
import { RouteGraphEditor, type RouteGraphMode } from '@/components/RouteGraphEditor';
import { usePermissions } from '@/hooks/usePermissions';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import { useAuditLog } from '@/hooks/useAuditLog';
import { useAuth } from '@/context/AuthContext';

const POI_STATUSES: PoiStatus[] = ['OPEN', 'CLOSED', 'RELOCATED'];
const ROUTE_EDGE_TYPES: RouteEdgeType[] = ['WALK', 'ELEVATOR', 'ESCALATOR', 'STAIRS'];
const ICON_NAMES = Array.from(new Set(POI_CATEGORY_PRESETS.map((p) => p.icon)));

type LucideComponent = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

function CategoryIcon({ name, className, style }: { name: string; className?: string; style?: React.CSSProperties }) {
  const Icon = ((LucideIcons as unknown as Record<string, LucideComponent>)[name]) ?? MapPin;
  return <Icon className={className} style={style} />;
}

// Small quoted-field CSV parser — no such utility exists elsewhere in the repo, and this is the
// only place that needs one. Handles quoted fields containing commas/newlines and "" escapes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto"
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

const inputClass =
  'w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
const labelClass = 'text-xs text-gray-500 dark:text-gray-400 block mb-1';

export default function WayfindingPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { canEditContent } = usePermissions();
  const { confirmDelete } = useConfirmBeforeDelete();
  const logAction = useAuditLog();
  const t = useTranslations('wayfinding');
  const tc = useTranslations('common');

  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [buildingModal, setBuildingModal] = useState<'new' | Building | null>(null);
  const [floorModal, setFloorModal] = useState<'new' | Floor | null>(null);
  const [categoryModal, setCategoryModal] = useState<'new' | PoiCategory | null>(null);
  const [poiModal, setPoiModal] = useState<'new' | Poi | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [error, setError] = useState('');

  const { data: buildings = [], isLoading } = useQuery({ queryKey: ['buildings'], queryFn: wayfindingApi.listBuildings });
  const { data: categories = [] } = useQuery({ queryKey: ['poiCategories'], queryFn: wayfindingApi.listPoiCategories });
  const { data: assets = [] } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list });
  const { data: screens = [] } = useQuery({ queryKey: ['screens'], queryFn: screensApi.list });
  const [notice, setNotice] = useState('');
  const { data: pois = [] } = useQuery({
    queryKey: ['pois', selectedFloorId],
    queryFn: () => wayfindingApi.listPois(selectedFloorId as string),
    enabled: !!selectedFloorId,
  });

  const selectedBuilding = buildings.find((b) => b.id === selectedBuildingId) ?? null;
  const selectedFloor = selectedBuilding?.floors.find((f) => f.id === selectedFloorId) ?? null;
  const floorPlanUrl = selectedFloor?.floorPlanAssetId
    ? (assets.find((a) => a.id === selectedFloor.floorPlanAssetId)?.url ?? null)
    : null;

  function selectBuilding(id: string) {
    setSelectedBuildingId(id);
    setSelectedFloorId(null);
  }

  // ── Buildings ──
  const saveBuildingMut = useMutation({
    mutationFn: (input: { id?: string; name: string; address: string }) =>
      input.id
        ? wayfindingApi.updateBuilding(input.id, input.name, input.address || undefined)
        : wayfindingApi.createBuilding(input.name, input.address || undefined),
    onSuccess: (saved, input) => {
      logAction({
        resourceType: 'BUILDING', resourceName: saved.name, action: input.id ? 'UPDATE' : 'CREATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      void qc.invalidateQueries({ queryKey: ['buildings'] });
      setBuildingModal(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const removeBuildingMut = useMutation({
    mutationFn: (b: Building) => wayfindingApi.removeBuilding(b.id),
    onSuccess: (_data, b) => {
      logAction({
        resourceType: 'BUILDING', resourceName: b.name, action: 'DELETE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      if (selectedBuildingId === b.id) { setSelectedBuildingId(null); setSelectedFloorId(null); }
      void qc.invalidateQueries({ queryKey: ['buildings'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  // ── Floors ──
  const saveFloorMut = useMutation({
    mutationFn: (input: { id?: string; level: number; label: string; floorPlanAssetId: string | null }) =>
      input.id
        ? wayfindingApi.updateFloor(input.id, input.level, input.label, input.floorPlanAssetId)
        : wayfindingApi.createFloor((selectedBuilding as Building).id, input.level, input.label, input.floorPlanAssetId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['buildings'] });
      setFloorModal(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const removeFloorMut = useMutation({
    mutationFn: (f: Floor) => wayfindingApi.removeFloor(f.id),
    onSuccess: (_data, f) => {
      if (selectedFloorId === f.id) setSelectedFloorId(null);
      void qc.invalidateQueries({ queryKey: ['buildings'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  // ── Categories ──
  const saveCategoryMut = useMutation({
    mutationFn: (input: { id?: string; label: string; labelAr: string; icon: string; color: string }) =>
      input.id
        ? wayfindingApi.updatePoiCategory(input.id, input.label, input.icon, input.color, input.labelAr || undefined)
        : wayfindingApi.createPoiCategory(input.label, input.icon, input.color, input.labelAr || undefined),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['poiCategories'] });
      setCategoryModal(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const removeCategoryMut = useMutation({
    mutationFn: (c: PoiCategory) => wayfindingApi.removePoiCategory(c.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['poiCategories'] }),
    onError: (e: Error) => setError(e.message),
  });

  // ── POIs ──
  const savePoiMut = useMutation({
    mutationFn: (input: { id?: string; dto: PoiInput }) =>
      input.id ? wayfindingApi.updatePoi(input.id, input.dto) : wayfindingApi.createPoi((selectedFloor as Floor).id, input.dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pois', selectedFloorId] });
      setPoiModal(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const removePoiMut = useMutation({
    mutationFn: (p: Poi) => wayfindingApi.removePoi(p.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pois', selectedFloorId] }),
    onError: (e: Error) => setError(e.message),
  });

  const importMut = useMutation({
    mutationFn: (rows: PoiImportRow[]) => wayfindingApi.importPois((selectedFloor as Floor).id, rows),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pois', selectedFloorId] });
      setImportOpen(false);
    },
  });

  // ── Evacuation mode / screen-group sync (7.4) ──
  const setEvacuationMut = useMutation({
    mutationFn: (input: { buildingId: string; active: boolean }) => wayfindingApi.setEvacuation(input.buildingId, input.active),
    onSuccess: () => {
      logAction({
        resourceType: 'BUILDING', resourceName: selectedBuilding?.name ?? '', action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      void qc.invalidateQueries({ queryKey: ['screens'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const syncScreenGroupMut = useMutation({
    mutationFn: (buildingId: string) => wayfindingApi.syncScreenGroup(buildingId),
    onSuccess: (group) => {
      setNotice(t('syncScreenGroupDone', { name: group.name, count: group._count.screens }));
      void qc.invalidateQueries({ queryKey: ['screens'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center justify-between text-xs text-red-600 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
          <span>{error}</span>
          <button onClick={() => setError('')}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm mb-4 text-gray-500 dark:text-gray-400">
        <button
          onClick={() => { setSelectedBuildingId(null); setSelectedFloorId(null); }}
          className={`hover:text-indigo-600 dark:hover:text-indigo-400 ${!selectedBuilding ? 'font-semibold text-gray-900 dark:text-gray-100' : ''}`}
        >
          {t('buildings')}
        </button>
        {selectedBuilding && (
          <>
            <ChevronRight className="w-3.5 h-3.5" />
            <button
              onClick={() => setSelectedFloorId(null)}
              className={`hover:text-indigo-600 dark:hover:text-indigo-400 ${!selectedFloor ? 'font-semibold text-gray-900 dark:text-gray-100' : ''}`}
            >
              {selectedBuilding.name}
            </button>
          </>
        )}
        {selectedFloor && (
          <>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="font-semibold text-gray-900 dark:text-gray-100">{selectedFloor.label}</span>
          </>
        )}
      </div>

      {isLoading && <p className="text-sm text-gray-400">{tc('loading')}</p>}

      {!isLoading && !selectedBuilding && (
        <BuildingsList
          buildings={buildings}
          canEdit={canEditContent}
          onSelect={selectBuilding}
          onNew={() => setBuildingModal('new')}
          onEdit={setBuildingModal}
          onDelete={(b) => { if (confirmDelete(t('deleteBuildingConfirm'))) removeBuildingMut.mutate(b); }}
          t={t}
        />
      )}

      {selectedBuilding && !selectedFloor && canEditContent && (
        <BuildingOpsPanel
          building={selectedBuilding}
          screens={screens}
          notice={notice}
          onDismissNotice={() => setNotice('')}
          onTriggerEvacuation={(active) => {
            // Deliberately not gated by the "confirm before delete" setting (useConfirmBeforeDelete)
            // — that's an opt-out toggle for routine deletions, and a safety-critical action like
            // this should always confirm regardless of what a user set that preference to.
            const confirmMsg = active ? t('triggerEvacuationConfirm') : t('clearEvacuationConfirm');
            if (window.confirm(confirmMsg)) setEvacuationMut.mutate({ buildingId: selectedBuilding.id, active });
          }}
          evacuating={setEvacuationMut.isPending}
          onSyncScreenGroup={() => syncScreenGroupMut.mutate(selectedBuilding.id)}
          syncing={syncScreenGroupMut.isPending}
          t={t}
        />
      )}

      {selectedBuilding && !selectedFloor && (
        <FloorsList
          building={selectedBuilding}
          canEdit={canEditContent}
          onSelect={setSelectedFloorId}
          onNew={() => setFloorModal('new')}
          onEdit={setFloorModal}
          onDelete={(f) => { if (confirmDelete(t('deleteFloorConfirm'))) removeFloorMut.mutate(f); }}
          t={t}
        />
      )}

      {selectedFloor && (
        <FloorDetail
          floor={selectedFloor}
          building={selectedBuilding as Building}
          floorPlanUrl={floorPlanUrl}
          categories={categories}
          pois={pois}
          canEdit={canEditContent}
          onNewCategory={() => setCategoryModal('new')}
          onEditCategory={setCategoryModal}
          onDeleteCategory={(c) => { if (confirmDelete(t('deleteCategoryConfirm'))) removeCategoryMut.mutate(c); }}
          onNewPoi={() => setPoiModal('new')}
          onEditPoi={setPoiModal}
          onDeletePoi={(p) => { if (confirmDelete(t('deletePoiConfirm'))) removePoiMut.mutate(p); }}
          onImport={() => setImportOpen(true)}
          t={t}
          tc={tc}
        />
      )}

      {buildingModal && (
        <BuildingFormModal
          building={buildingModal === 'new' ? null : buildingModal}
          saving={saveBuildingMut.isPending}
          onSave={(name, address) =>
            saveBuildingMut.mutate({ id: buildingModal === 'new' ? undefined : buildingModal.id, name, address })
          }
          onClose={() => setBuildingModal(null)}
          t={t}
          tc={tc}
        />
      )}

      {floorModal && selectedBuilding && (
        <FloorFormModal
          floor={floorModal === 'new' ? null : floorModal}
          saving={saveFloorMut.isPending}
          onSave={(level, label, floorPlanAssetId) =>
            saveFloorMut.mutate({ id: floorModal === 'new' ? undefined : floorModal.id, level, label, floorPlanAssetId })
          }
          onClose={() => setFloorModal(null)}
          t={t}
          tc={tc}
        />
      )}

      {categoryModal && (
        <CategoryFormModal
          category={categoryModal === 'new' ? null : categoryModal}
          saving={saveCategoryMut.isPending}
          onSave={(label, labelAr, icon, color) =>
            saveCategoryMut.mutate({ id: categoryModal === 'new' ? undefined : categoryModal.id, label, labelAr, icon, color })
          }
          onClose={() => setCategoryModal(null)}
          t={t}
          tc={tc}
        />
      )}

      {poiModal && selectedFloor && (
        <PoiFormModal
          poi={poiModal === 'new' ? null : poiModal}
          categories={categories}
          contextPins={pois.filter((p) => p.id !== (poiModal === 'new' ? undefined : poiModal.id))}
          floorPlanUrl={floorPlanUrl}
          saving={savePoiMut.isPending}
          onSave={(dto) => savePoiMut.mutate({ id: poiModal === 'new' ? undefined : poiModal.id, dto })}
          onClose={() => setPoiModal(null)}
          t={t}
          tc={tc}
        />
      )}

      {importOpen && selectedFloor && (
        <ImportModal
          importing={importMut.isPending}
          error={importMut.error instanceof Error ? importMut.error.message : ''}
          onImport={(rows) => importMut.mutate(rows)}
          onClose={() => setImportOpen(false)}
          t={t}
          tc={tc}
        />
      )}
    </div>
  );
}

type Translate = ReturnType<typeof useTranslations>;
type T = Translate;
type TC = Translate;

function BuildingsList({
  buildings, canEdit, onSelect, onNew, onEdit, onDelete, t,
}: {
  buildings: Building[]; canEdit: boolean;
  onSelect: (id: string) => void; onNew: () => void; onEdit: (b: Building) => void; onDelete: (b: Building) => void;
  t: T;
}) {
  return (
    <div>
      {canEdit && (
        <button
          onClick={onNew}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 mb-4"
        >
          <Plus className="w-4 h-4" /> {t('newBuilding')}
        </button>
      )}

      {buildings.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('noBuildings')}</p>
        </div>
      )}

      {buildings.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {buildings.map((b) => (
            <div
              key={b.id}
              onClick={() => onSelect(b.id)}
              className="cursor-pointer bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{b.name}</span>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={(e) => { e.stopPropagation(); onEdit(b); }} className="p-1 text-gray-400 hover:text-indigo-600">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onDelete(b); }} className="p-1 text-gray-400 hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
              {b.address && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 truncate">{b.address}</p>}
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{t('floorCount', { count: b.floors.length })}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Fire/evacuation mode + ScreenGroup building sync (7.4) — building-level bulk ops shown above
// the floors list. Evacuation status is derived live from the screens list (no separate
// "building is evacuating" field exists — it's just whether any of this building's kiosk screens
// currently has Screen.emergencyActive set) rather than tracked as local component state, so a
// second admin's toggle (or a screen coming back online) is reflected on refetch.
function BuildingOpsPanel({
  building, screens, notice, onDismissNotice, onTriggerEvacuation, evacuating, onSyncScreenGroup, syncing, t,
}: {
  building: Building; screens: Screen[]; notice: string; onDismissNotice: () => void;
  onTriggerEvacuation: (active: boolean) => void; evacuating: boolean;
  onSyncScreenGroup: () => void; syncing: boolean;
  t: T;
}) {
  const floorIds = new Set(building.floors.map((f) => f.id));
  const kiosks = screens.filter((s) => s.kioskLocation && floorIds.has(s.kioskLocation.floorId));
  const activeCount = kiosks.filter((s) => s.emergencyActive).length;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
      {activeCount > 0 && (
        <span className="flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
          <AlertTriangle className="w-3.5 h-3.5" />
          {t('evacuationActive', { count: activeCount })}
        </span>
      )}
      <div className="flex items-center gap-2 ms-auto">
        <button
          onClick={() => onTriggerEvacuation(activeCount === 0)}
          disabled={evacuating || kiosks.length === 0}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 ${
            activeCount > 0
              ? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700'
              : 'bg-red-600 text-white hover:bg-red-700'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          {activeCount > 0 ? t('clearEvacuation') : t('triggerEvacuation')}
        </button>
        <button
          onClick={onSyncScreenGroup}
          disabled={syncing}
          title={t('syncScreenGroupHint')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          <Users2 className="w-3.5 h-3.5" />
          {t('syncScreenGroup')}
        </button>
      </div>
      {notice && (
        <div className="w-full flex items-center justify-between text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-900 rounded-lg px-3 py-2">
          <span>{notice}</span>
          <button onClick={onDismissNotice}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}
    </div>
  );
}

function FloorsList({
  building, canEdit, onSelect, onNew, onEdit, onDelete, t,
}: {
  building: Building; canEdit: boolean;
  onSelect: (id: string) => void; onNew: () => void; onEdit: (f: Floor) => void; onDelete: (f: Floor) => void;
  t: T;
}) {
  return (
    <div>
      {canEdit && (
        <button
          onClick={onNew}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 mb-4"
        >
          <Plus className="w-4 h-4" /> {t('newFloor')}
        </button>
      )}

      {building.floors.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Layers className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('noFloors')}</p>
        </div>
      )}

      {building.floors.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {building.floors.map((f) => (
            <div
              key={f.id}
              onClick={() => onSelect(f.id)}
              className="cursor-pointer flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-800/60"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Layers className="w-4 h-4 text-indigo-600 shrink-0" />
                <div className="min-w-0">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{f.label}</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500 ms-2">
                    {t('poiCount', { count: f._count?.pois ?? 0 })}
                  </span>
                </div>
              </div>
              {canEdit && (
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={(e) => { e.stopPropagation(); onEdit(f); }} className="p-1 text-gray-400 hover:text-indigo-600">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onDelete(f); }} className="p-1 text-gray-400 hover:text-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FloorDetail({
  floor, building, floorPlanUrl, categories, pois, canEdit,
  onNewCategory, onEditCategory, onDeleteCategory,
  onNewPoi, onEditPoi, onDeletePoi, onImport, t, tc,
}: {
  floor: Floor; building: Building; floorPlanUrl: string | null; categories: PoiCategory[]; pois: Poi[]; canEdit: boolean;
  onNewCategory: () => void; onEditCategory: (c: PoiCategory) => void; onDeleteCategory: (c: PoiCategory) => void;
  onNewPoi: () => void; onEditPoi: (p: Poi) => void; onDeletePoi: (p: Poi) => void; onImport: () => void;
  t: T; tc: TC;
}) {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('categories')}</h2>
          {canEdit && (
            <button onClick={onNewCategory} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium">
              <Plus className="w-3.5 h-3.5" /> {t('newCategory')}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => {
            const isCustom = c.organizationId !== null;
            return (
              <button
                key={c.id}
                onClick={() => (isCustom && canEdit ? onEditCategory(c) : undefined)}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border ${isCustom && canEdit ? 'cursor-pointer hover:border-indigo-300' : 'cursor-default'}`}
                style={{ borderColor: c.color + '55', background: c.color + '15', color: c.color }}
              >
                <CategoryIcon name={c.icon} className="w-3.5 h-3.5" />
                {c.label}
                {isCustom && canEdit && (
                  <Trash2
                    className="w-3 h-3 opacity-60 hover:opacity-100"
                    onClick={(e) => { e.stopPropagation(); onDeleteCategory(c); }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('pois')}</h2>
            {canEdit && (
              <div className="flex items-center gap-2">
                <button onClick={onImport} className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-indigo-600 font-medium">
                  <Upload className="w-3.5 h-3.5" /> {t('import.button')}
                </button>
                <button onClick={onNewPoi} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                  <Plus className="w-3.5 h-3.5" /> {t('newPoi')}
                </button>
              </div>
            )}
          </div>

          {pois.length === 0 && <p className="text-sm text-gray-400 py-6 text-center">{t('noPois')}</p>}

          {pois.length > 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
              {pois.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <CategoryIcon name={p.category.icon} className="w-3.5 h-3.5 shrink-0" style={{ color: p.category.color }} />
                    <span className="text-sm text-gray-900 dark:text-gray-100 truncate">{p.name}</span>
                    {p.status !== 'OPEN' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 font-medium shrink-0">
                        {t(`status.${p.status}`)}
                      </span>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => onEditPoi(p)} className="p-1 text-gray-400 hover:text-indigo-600">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => onDeletePoi(p)} className="p-1 text-gray-400 hover:text-red-500">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">{t('floorPlan')}</h2>
          <PoiMapEditor
            imageUrl={floorPlanUrl}
            pins={pois.map((p) => ({ id: p.id, x: p.x, y: p.y, color: p.category.color, label: p.name }))}
            activePin={null}
            onActivePinChange={() => {}}
            disabled
            emptyLabel={t('noFloorPlanHint')}
          />
        </div>
      </div>

      <RouteGraphSection floor={floor} building={building} floorPlanUrl={floorPlanUrl} canEdit={canEdit} t={t} tc={tc} />
    </div>
  );
}

function RouteGraphSection({
  floor, building, floorPlanUrl, canEdit, t, tc,
}: { floor: Floor; building: Building; floorPlanUrl: string | null; canEdit: boolean; t: T; tc: TC }) {
  const qc = useQueryClient();
  const buildingId = floor.buildingId;

  const { data: graph } = useQuery({
    queryKey: ['routeGraph', buildingId],
    queryFn: () => wayfindingApi.getRouteGraph(buildingId),
  });
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const floorNodes = nodes.filter((n) => n.floorId === floor.id);
  const floorNodeIds = new Set(floorNodes.map((n) => n.id));
  const sameFloorEdges = edges.filter((e) => floorNodeIds.has(e.fromNodeId) && floorNodeIds.has(e.toNodeId));
  const crossFloorEdges = edges.filter((e) => floorNodeIds.has(e.fromNodeId) !== floorNodeIds.has(e.toNodeId));
  const crossFloorNodeIds = new Set(crossFloorEdges.map((e) => (floorNodeIds.has(e.fromNodeId) ? e.fromNodeId : e.toNodeId)));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const [mode, setMode] = useState<RouteGraphMode>('select');
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  function changeMode(m: RouteGraphMode) {
    setMode(m);
    setConnectFromId(null);
  }

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['routeGraph', buildingId] });
  }

  const createNodeMut = useMutation({
    mutationFn: (input: { x: number; y: number }) => wayfindingApi.createRouteNode(floor.id, input),
    onSuccess: invalidate,
  });
  const moveNodeMut = useMutation({
    mutationFn: (input: { id: string; x: number; y: number; label: string | null }) =>
      wayfindingApi.updateRouteNode(input.id, { x: input.x, y: input.y, label: input.label ?? undefined }),
    onSuccess: invalidate,
  });
  const removeNodeMut = useMutation({
    mutationFn: (id: string) => wayfindingApi.removeRouteNode(id),
    onSuccess: () => { setSelectedNodeId(null); invalidate(); },
  });
  const createEdgeMut = useMutation({
    mutationFn: (input: { fromNodeId: string; toNodeId: string; type?: RouteEdgeType; weight: number }) =>
      wayfindingApi.createRouteEdge(buildingId, input),
    onSuccess: invalidate,
  });
  const updateEdgeMut = useMutation({
    mutationFn: (input: { id: string; type: RouteEdgeType; weight: number }) =>
      wayfindingApi.updateRouteEdge(input.id, input.type, input.weight),
    onSuccess: invalidate,
  });
  const removeEdgeMut = useMutation({
    mutationFn: (id: string) => wayfindingApi.removeRouteEdge(id),
    onSuccess: () => { setSelectedEdgeId(null); invalidate(); },
  });

  function handleAddNode(x: number, y: number) {
    createNodeMut.mutate({ x, y });
  }

  function handleMoveNode(id: string, x: number, y: number) {
    const node = nodeById.get(id);
    moveNodeMut.mutate({ id, x, y, label: node?.label ?? null });
  }

  function handleSelectNode(id: string) {
    if (mode === 'connect') {
      if (!connectFromId) { setConnectFromId(id); setSelectedNodeId(id); return; }
      if (connectFromId === id) { setConnectFromId(null); setSelectedNodeId(null); return; }
      const from = nodeById.get(connectFromId);
      const to = nodeById.get(id);
      const weight = from && to ? Math.hypot(to.x - from.x, to.y - from.y) : 10;
      createEdgeMut.mutate({ fromNodeId: connectFromId, toNodeId: id, weight: Math.max(1, Math.round(weight * 10) / 10) });
      setConnectFromId(null);
      setSelectedNodeId(null);
      return;
    }
    setSelectedEdgeId(null);
    setSelectedNodeId(id);
  }

  function handleSelectEdge(id: string) {
    setSelectedNodeId(null);
    setSelectedEdgeId(id);
  }

  const selectedNode = selectedNodeId ? (nodeById.get(selectedNodeId) ?? null) : null;
  const selectedEdge = selectedEdgeId ? (edges.find((e) => e.id === selectedEdgeId) ?? null) : null;
  const selectedNodeCrossFloorEdges = selectedNodeId
    ? edges.filter((e) => e.fromNodeId === selectedNodeId || e.toNodeId === selectedNodeId)
      .filter((e) => {
        const other = e.fromNodeId === selectedNodeId ? nodeById.get(e.toNodeId) : nodeById.get(e.fromNodeId);
        return other && other.floorId !== floor.id;
      })
    : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Route className="w-4 h-4 text-indigo-600" />
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('routeGraph.title')}</h2>
          <span className="text-xs text-gray-400 dark:text-gray-500">{t('routeGraph.nodeCount', { count: floorNodes.length })}</span>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
            <button
              onClick={() => changeMode('select')}
              title={t('routeGraph.modeSelect')}
              className={`p-1.5 rounded-md ${mode === 'select' ? 'bg-white dark:bg-gray-700 shadow text-indigo-600' : 'text-gray-500 dark:text-gray-400'}`}
            >
              <MousePointer2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => changeMode('addNode')}
              title={t('routeGraph.modeAddNode')}
              className={`p-1.5 rounded-md ${mode === 'addNode' ? 'bg-white dark:bg-gray-700 shadow text-indigo-600' : 'text-gray-500 dark:text-gray-400'}`}
            >
              <CirclePlus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => changeMode('connect')}
              title={t('routeGraph.modeConnect')}
              className={`p-1.5 rounded-md ${mode === 'connect' ? 'bg-white dark:bg-gray-700 shadow text-indigo-600' : 'text-gray-500 dark:text-gray-400'}`}
            >
              <Link2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
        {mode === 'addNode' ? t('routeGraph.addNodeHint')
          : mode === 'connect' ? (connectFromId ? t('routeGraph.connectArmedHint') : t('routeGraph.connectHint'))
          : t('routeGraph.hint')}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RouteGraphEditor
          imageUrl={floorPlanUrl}
          nodes={floorNodes}
          edges={sameFloorEdges}
          crossFloorNodeIds={crossFloorNodeIds}
          mode={canEdit ? mode : 'select'}
          connectFromId={connectFromId}
          selectedNodeId={selectedNodeId}
          selectedEdgeId={selectedEdgeId}
          onAddNode={handleAddNode}
          onMoveNode={handleMoveNode}
          onSelectNode={handleSelectNode}
          onSelectEdge={handleSelectEdge}
          onDeselect={() => { setSelectedNodeId(null); setSelectedEdgeId(null); }}
          emptyLabel={t('routeGraph.noFloorPlanHint')}
        />

        <div>
          {!selectedNode && !selectedEdge && (
            <p className="text-sm text-gray-400 py-6 text-center">{t('routeGraph.selectNodeHint')}</p>
          )}

          {selectedNode && (
            <NodeInspector
              key={selectedNode.id}
              node={selectedNode}
              floor={floor}
              building={building}
              nodes={nodes}
              crossFloorEdges={selectedNodeCrossFloorEdges}
              canEdit={canEdit}
              saving={moveNodeMut.isPending}
              onSaveLabel={(label) => moveNodeMut.mutate({ id: selectedNode.id, x: selectedNode.x, y: selectedNode.y, label: label || null })}
              onDelete={() => { if (confirmDeleteRouteNode(t)) removeNodeMut.mutate(selectedNode.id); }}
              onAddCrossFloorEdge={(toNodeId, type, weight) =>
                createEdgeMut.mutate({ fromNodeId: selectedNode.id, toNodeId, type, weight })}
              onDeleteCrossFloorEdge={(id) => { if (confirmDeleteRouteEdge(t)) removeEdgeMut.mutate(id); }}
              t={t}
              tc={tc}
            />
          )}

          {selectedEdge && (
            <EdgeInspector
              key={selectedEdge.id}
              edge={selectedEdge}
              saving={updateEdgeMut.isPending}
              canEdit={canEdit}
              onSave={(type, weight) => updateEdgeMut.mutate({ id: selectedEdge.id, type, weight })}
              onDelete={() => { if (confirmDeleteRouteEdge(t)) removeEdgeMut.mutate(selectedEdge.id); }}
              t={t}
              tc={tc}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function confirmDeleteRouteNode(t: T) {
  return window.confirm(t('routeGraph.deleteNodeConfirm'));
}
function confirmDeleteRouteEdge(t: T) {
  return window.confirm(t('routeGraph.deleteEdgeConfirm'));
}

function NodeInspector({
  node, floor, building, nodes, crossFloorEdges, canEdit, saving, onSaveLabel, onDelete, onAddCrossFloorEdge, onDeleteCrossFloorEdge, t, tc,
}: {
  node: RouteNode; floor: Floor; building: Building; nodes: RouteNode[]; crossFloorEdges: RouteEdge[]; canEdit: boolean; saving: boolean;
  onSaveLabel: (label: string) => void; onDelete: () => void;
  onAddCrossFloorEdge: (toNodeId: string, type: RouteEdgeType, weight: number) => void;
  onDeleteCrossFloorEdge: (id: string) => void;
  t: T; tc: TC;
}) {
  const [label, setLabel] = useState(node.label ?? '');

  const otherFloorNodes = nodes.filter((n) => n.floorId !== floor.id);
  const otherFloorIds = Array.from(new Set(otherFloorNodes.map((n) => n.floorId)));
  const [targetFloorId, setTargetFloorId] = useState(otherFloorIds[0] ?? '');
  const targetNodes = otherFloorNodes.filter((n) => n.floorId === (targetFloorId || otherFloorIds[0]));
  const [targetNodeId, setTargetNodeId] = useState('');
  const [edgeType, setEdgeType] = useState<RouteEdgeType>('ELEVATOR');
  const [weight, setWeight] = useState(15);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-4">
      <div>
        <label className={labelClass}>{t('routeGraph.nodeLabel')}</label>
        <div className="flex gap-2">
          <input
            value={label} onChange={(e) => setLabel(e.target.value)} disabled={!canEdit}
            placeholder={t('routeGraph.nodeLabelPlaceholder')} className={inputClass}
          />
          {canEdit && (
            <button
              onClick={() => onSaveLabel(label.trim())} disabled={saving}
              className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 shrink-0"
            >
              {tc('save')}
            </button>
          )}
        </div>
      </div>

      {canEdit && (
        <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">{t('routeGraph.crossFloorTitle')}</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{t('routeGraph.crossFloorHint')}</p>

          {crossFloorEdges.length === 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{t('routeGraph.crossFloorNone')}</p>
          )}
          {crossFloorEdges.length > 0 && (
            <ul className="space-y-1 mb-3">
              {crossFloorEdges.map((e) => (
                <li key={e.id} className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-300">
                  <span>{t(`routeGraph.edgeTypes.${e.type}`)} · {e.weight}</span>
                  <button onClick={() => onDeleteCrossFloorEdge(e.id)} className="p-1 text-gray-400 hover:text-red-500">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {otherFloorIds.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">{t('routeGraph.noOtherFloorNodes')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 mb-2">
              <select
                value={targetFloorId || otherFloorIds[0]}
                onChange={(e) => { setTargetFloorId(e.target.value); setTargetNodeId(''); }}
                className={inputClass}
              >
                {otherFloorIds.map((fid) => (
                  <option key={fid} value={fid}>{building.floors.find((f) => f.id === fid)?.label ?? fid}</option>
                ))}
              </select>
              <select value={targetNodeId || targetNodes[0]?.id || ''} onChange={(e) => setTargetNodeId(e.target.value)} className={inputClass}>
                {targetNodes.map((n) => <option key={n.id} value={n.id}>{n.label || n.id.slice(0, 8)}</option>)}
              </select>
              <select value={edgeType} onChange={(e) => setEdgeType(e.target.value as RouteEdgeType)} className={inputClass}>
                {(['ELEVATOR', 'ESCALATOR', 'STAIRS'] as RouteEdgeType[]).map((et) => (
                  <option key={et} value={et}>{t(`routeGraph.edgeTypes.${et}`)}</option>
                ))}
              </select>
              <input
                type="number" min={0.1} step={0.5} value={weight}
                onChange={(e) => setWeight(parseFloat(e.target.value) || 0)} className={inputClass}
                title={t('routeGraph.edgeWeight')}
              />
            </div>
          )}
          {otherFloorIds.length > 0 && (
            <button
              onClick={() => { const to = targetNodeId || targetNodes[0]?.id; if (to) onAddCrossFloorEdge(to, edgeType, weight); }}
              disabled={!targetNodes.length}
              className="w-full flex items-center justify-center gap-1.5 border border-indigo-200 dark:border-indigo-900 text-indigo-600 py-1.5 rounded-lg text-xs font-medium hover:bg-indigo-50 dark:hover:bg-indigo-950/40 disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" /> {t('routeGraph.crossFloorAdd')}
            </button>
          )}
        </div>
      )}

      {canEdit && (
        <button
          onClick={onDelete}
          className="w-full flex items-center justify-center gap-1.5 text-red-600 border border-red-200 dark:border-red-900 py-1.5 rounded-lg text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/40"
        >
          <Trash2 className="w-3.5 h-3.5" /> {t('routeGraph.deleteNode')}
        </button>
      )}
    </div>
  );
}

function EdgeInspector({
  edge, saving, canEdit, onSave, onDelete, t, tc,
}: {
  edge: RouteEdge; saving: boolean; canEdit: boolean;
  onSave: (type: RouteEdgeType, weight: number) => void; onDelete: () => void; t: T; tc: TC;
}) {
  const [type, setType] = useState<RouteEdgeType>(edge.type);
  const [weight, setWeight] = useState(edge.weight);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3">
      <div>
        <label className={labelClass}>{t('routeGraph.edgeType')}</label>
        <select value={type} onChange={(e) => setType(e.target.value as RouteEdgeType)} disabled={!canEdit} className={inputClass}>
          {ROUTE_EDGE_TYPES.map((et) => <option key={et} value={et}>{t(`routeGraph.edgeTypes.${et}`)}</option>)}
        </select>
      </div>
      <div>
        <label className={labelClass}>{t('routeGraph.edgeWeight')}</label>
        <input
          type="number" min={0.1} step={0.5} value={weight} disabled={!canEdit}
          onChange={(e) => setWeight(parseFloat(e.target.value) || 0)} className={inputClass}
        />
      </div>
      {canEdit && (
        <div className="flex gap-2">
          <button
            onClick={() => onSave(type, weight)} disabled={saving}
            className="flex-1 bg-indigo-600 text-white py-1.5 rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {tc('save')}
          </button>
          <button
            onClick={onDelete}
            className="flex-1 flex items-center justify-center gap-1.5 text-red-600 border border-red-200 dark:border-red-900 py-1.5 rounded-lg text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/40"
          >
            <Trash2 className="w-3.5 h-3.5" /> {t('routeGraph.deleteEdge')}
          </button>
        </div>
      )}
    </div>
  );
}

function BuildingFormModal({
  building, saving, onSave, onClose, t, tc,
}: { building: Building | null; saving: boolean; onSave: (name: string, address: string) => void; onClose: () => void; t: T; tc: TC }) {
  const [name, setName] = useState(building?.name ?? '');
  const [address, setAddress] = useState(building?.address ?? '');
  return (
    <Modal title={building ? tc('edit') : t('newBuilding')} onClose={onClose}>
      <label className={labelClass}>{t('buildingName')}</label>
      <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputClass} mb-3`} autoFocus />
      <label className={labelClass}>{t('buildingAddress')}</label>
      <input value={address} onChange={(e) => setAddress(e.target.value)} className={`${inputClass} mb-4`} />
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
          {tc('cancel')}
        </button>
        <button
          onClick={() => onSave(name.trim(), address.trim())}
          disabled={!name.trim() || saving}
          className="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? tc('loading') : tc('save')}
        </button>
      </div>
    </Modal>
  );
}

function FloorFormModal({
  floor, saving, onSave, onClose, t, tc,
}: {
  floor: Floor | null; saving: boolean;
  onSave: (level: number, label: string, floorPlanAssetId: string | null) => void; onClose: () => void; t: T; tc: TC;
}) {
  const [level, setLevel] = useState(floor?.level ?? 0);
  const [label, setLabel] = useState(floor?.label ?? '');
  const [assetId, setAssetId] = useState<string | null>(floor?.floorPlanAssetId ?? null);
  return (
    <Modal title={floor ? tc('edit') : t('newFloor')} onClose={onClose}>
      <label className={labelClass} title={t('floorLevelTitle')}>{t('floorLevel')}</label>
      <input
        type="number" value={level} onChange={(e) => setLevel(parseInt(e.target.value, 10) || 0)}
        className={`${inputClass} mb-3`}
      />
      <label className={labelClass}>{t('floorLabel')}</label>
      <input
        value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('floorLabelPlaceholder')}
        className={`${inputClass} mb-3`} autoFocus
      />
      <label className={labelClass}>{t('floorPlan')}</label>
      <div className="mb-4">
        <ImagePicker
          value={assetId}
          placeholder={t('noFloorPlanAsset')}
          onChange={setAssetId}
          labels={{
            existing: t('imageSourceExisting'),
            upload: t('imageSourceUpload'),
            paste: t('imageSourcePaste'),
            stock: t('imageSourceStock'),
            uploading: t('uploadingImage'),
            uploadFailed: t('uploadImageFailed'),
            pasteHint: t('pasteImageHint'),
            pasteError: t('pasteImageError'),
            removeBackground: t('removeBackground'),
            removingBackground: t('removingBackground'),
            removeBackgroundFailed: t('removeBackgroundFailed'),
            stockSearchPlaceholder: t('stockSearchPlaceholder'),
            stockEmpty: t('stockEmpty'),
            stockNotConfigured: t('stockNotConfigured'),
            stockCredit: t('stockCredit'),
            importStockFailed: t('importStockFailed'),
          }}
        />
      </div>
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
          {tc('cancel')}
        </button>
        <button
          onClick={() => onSave(level, label.trim(), assetId)}
          disabled={!label.trim() || saving}
          className="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? tc('loading') : tc('save')}
        </button>
      </div>
    </Modal>
  );
}

function CategoryFormModal({
  category, saving, onSave, onClose, t, tc,
}: {
  category: PoiCategory | null; saving: boolean;
  onSave: (label: string, labelAr: string, icon: string, color: string) => void; onClose: () => void; t: T; tc: TC;
}) {
  const [label, setLabel] = useState(category?.label ?? '');
  const [labelAr, setLabelAr] = useState(category?.labelAr ?? '');
  const [icon, setIcon] = useState(category?.icon ?? ICON_NAMES[0] ?? 'MapPin');
  const [color, setColor] = useState(category?.color ?? '#2563eb');
  return (
    <Modal title={category ? tc('edit') : t('newCategory')} onClose={onClose}>
      <label className={labelClass}>{t('categoryLabel')}</label>
      <input value={label} onChange={(e) => setLabel(e.target.value)} className={`${inputClass} mb-3`} autoFocus />
      <label className={labelClass}>{t('categoryLabelAr')}</label>
      <input value={labelAr} onChange={(e) => setLabelAr(e.target.value)} dir="rtl" className={`${inputClass} mb-3`} />
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className={labelClass}>{t('categoryIcon')}</label>
          <select value={icon} onChange={(e) => setIcon(e.target.value)} className={inputClass}>
            {ICON_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>{t('categoryColor')}</label>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-full h-[38px] rounded-lg border border-gray-300 dark:border-gray-600" />
        </div>
      </div>
      <div className="flex items-center gap-2 mb-4 text-xs text-gray-500 dark:text-gray-400">
        {t('categoryIcon')}: <CategoryIcon name={icon} className="w-4 h-4" style={{ color }} />
      </div>
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
          {tc('cancel')}
        </button>
        <button
          onClick={() => onSave(label.trim(), labelAr.trim(), icon, color)}
          disabled={!label.trim() || saving}
          className="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? tc('loading') : tc('save')}
        </button>
      </div>
    </Modal>
  );
}

function PoiFormModal({
  poi, categories, contextPins, floorPlanUrl, saving, onSave, onClose, t, tc,
}: {
  poi: Poi | null; categories: PoiCategory[]; contextPins: Poi[]; floorPlanUrl: string | null; saving: boolean;
  onSave: (dto: PoiInput) => void; onClose: () => void; t: T; tc: TC;
}) {
  const [name, setName] = useState(poi?.name ?? '');
  const [nameAr, setNameAr] = useState(poi?.nameAr ?? '');
  const [categoryId, setCategoryId] = useState(poi?.categoryId ?? categories[0]?.id ?? '');
  const [status, setStatus] = useState<PoiStatus>(poi?.status ?? 'OPEN');
  const [description, setDescription] = useState(poi?.description ?? '');
  const [descriptionAr, setDescriptionAr] = useState(poi?.descriptionAr ?? '');
  const [point, setPoint] = useState<{ x: number; y: number } | null>(poi ? { x: poi.x, y: poi.y } : null);

  return (
    <Modal title={poi ? tc('edit') : t('newPoi')} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className={labelClass}>{t('poiName')}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoFocus />
        </div>
        <div>
          <label className={labelClass}>{t('poiNameAr')}</label>
          <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" className={inputClass} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className={labelClass}>{t('poiCategory')}</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>{t('poiStatus')}</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as PoiStatus)} className={inputClass}>
            {POI_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className={labelClass}>{t('poiDescription')}</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>{t('poiDescriptionAr')}</label>
          <input value={descriptionAr} onChange={(e) => setDescriptionAr(e.target.value)} dir="rtl" className={inputClass} />
        </div>
      </div>

      <label className={labelClass}>{t('poiPlacementHint')}</label>
      <div className="mb-4">
        <PoiMapEditor
          imageUrl={floorPlanUrl}
          pins={contextPins.map((p) => ({ id: p.id, x: p.x, y: p.y, color: p.category.color, label: p.name }))}
          activePin={point}
          onActivePinChange={(x, y) => setPoint({ x, y })}
          emptyLabel={t('noFloorPlanHint')}
        />
      </div>

      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
          {tc('cancel')}
        </button>
        <button
          onClick={() =>
            point &&
            categoryId &&
            onSave({
              name: name.trim(), nameAr: nameAr.trim() || undefined, x: point.x, y: point.y, categoryId,
              description: description.trim() || undefined, descriptionAr: descriptionAr.trim() || undefined, status,
            })
          }
          disabled={!name.trim() || !categoryId || !point || saving}
          className="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? tc('loading') : tc('save')}
        </button>
      </div>
    </Modal>
  );
}

function ImportModal({
  importing, error, onImport, onClose, t, tc,
}: { importing: boolean; error: string; onImport: (rows: PoiImportRow[]) => void; onClose: () => void; t: T; tc: TC }) {
  const [rows, setRows] = useState<PoiImportRow[] | null>(null);
  const [parseError, setParseError] = useState('');

  function handleFile(file: File) {
    setParseError('');
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const table = parseCsv(text).filter((r) => r.some((cell) => cell.trim() !== ''));
      if (table.length < 2) { setParseError(t('import.error')); return; }
      const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
      const idx = (name: string) => header.indexOf(name.toLowerCase());
      const nameIdx = idx('name'), xIdx = idx('x'), yIdx = idx('y'), catIdx = idx('categorylabel');
      if (nameIdx < 0 || xIdx < 0 || yIdx < 0 || catIdx < 0) { setParseError(t('import.error')); return; }
      const nameArIdx = idx('namear'), descIdx = idx('description');
      const parsed: PoiImportRow[] = table.slice(1).map((r) => ({
        name: r[nameIdx]?.trim() ?? '',
        nameAr: nameArIdx >= 0 ? (r[nameArIdx]?.trim() || undefined) : undefined,
        x: Number(r[xIdx]),
        y: Number(r[yIdx]),
        categoryLabel: r[catIdx]?.trim() ?? '',
        description: descIdx >= 0 ? (r[descIdx]?.trim() || undefined) : undefined,
      }));
      setRows(parsed);
    };
    reader.readAsText(file);
  }

  return (
    <Modal title={t('import.button')} onClose={onClose}>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{t('import.hint')}</p>
      <input
        type="file" accept=".csv,text/csv"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        className="text-sm mb-3"
      />
      {rows && <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{t('import.rowsFound', { count: rows.length })}</p>}
      {(parseError || error) && <p className="text-xs text-red-600 mb-3">{parseError || error}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
          {tc('cancel')}
        </button>
        <button
          onClick={() => rows && onImport(rows)}
          disabled={!rows || rows.length === 0 || importing}
          className="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {importing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {importing ? t('import.importing') : t('import.button')}
        </button>
      </div>
    </Modal>
  );
}
