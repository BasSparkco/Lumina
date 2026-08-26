'use client';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { X, LayoutTemplate, Check } from 'lucide-react';
import { templatesApi } from '@/lib/api';

interface TemplatesGalleryPanelProps {
  onClose: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  RESTAURANT_MENU: 'Restaurant Menu',
  RETAIL_PROMO: 'Retail Promo',
  HOTEL_LOBBY: 'Hotel Lobby',
  CLINIC_WAITING: 'Clinic Waiting',
  MOSQUE: 'Mosque',
  GENERIC: 'Generic',
};

// designer.md §11's customer-facing half of the Template -> Asset workflow: browse authorized
// Templates (backend already filters to PUBLISHED + GLOBAL/authorized-tenant — see
// TemplatesService.customerList), "Use" one to clone it into a new tenant-owned DesignAsset (the
// Critical Backend Rule — never an update to the Template itself). Still stops at a confirmation
// rather than opening the clone in this editor — designer2 can load `?designId=` now (designer.md
// Phase 10), but there's no "My Designs" browse page yet to navigate to it from (still deferred).
export function TemplatesGalleryPanel({ onClose }: TemplatesGalleryPanelProps) {
  const { data: templates = [], isLoading } = useQuery({ queryKey: ['templates'], queryFn: templatesApi.list });
  const [createdName, setCreatedName] = useState<string | null>(null);

  const useMut = useMutation({
    mutationFn: (id: string) => templatesApi.createDesign(id),
    onSuccess: (asset) => setCreatedName(asset.name),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col gap-4 overflow-hidden rounded-xl bg-white p-5 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
            <LayoutTemplate className="h-4 w-4 text-indigo-600" /> Templates
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        {createdName && (
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-400">
            <Check className="h-4 w-4 shrink-0" />
            &ldquo;{createdName}&rdquo; was added to My Designs.
          </div>
        )}
        {useMut.isError && <p className="text-xs text-red-500">{(useMut.error as Error).message}</p>}

        <div className="grid grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
          {isLoading && <p className="col-span-full py-8 text-center text-sm text-gray-400 dark:text-gray-600">Loading…</p>}
          {!isLoading && templates.length === 0 && (
            <p className="col-span-full py-8 text-center text-sm text-gray-400 dark:text-gray-600">No templates are available yet.</p>
          )}
          {templates.map((t) => (
            <div key={t.id} className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
              <div className="flex h-24 items-center justify-center rounded-md bg-gray-100 text-[10px] text-gray-400 dark:bg-gray-800 dark:text-gray-500">
                {CATEGORY_LABELS[t.category] ?? t.category}
              </div>
              <p className="truncate text-xs font-medium text-gray-900 dark:text-gray-100">{t.name}</p>
              {t.description && <p className="line-clamp-2 text-[11px] text-gray-500 dark:text-gray-400">{t.description}</p>}
              <button
                disabled={useMut.isPending}
                onClick={() => useMut.mutate(t.id)}
                className="mt-auto rounded-md bg-indigo-600 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Use this template
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
