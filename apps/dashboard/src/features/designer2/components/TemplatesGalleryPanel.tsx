'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { templatesApi } from '@/lib/api';

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
// TemplatesService.customerList; this is the exact same DesignTemplate data the Super Admin
// manages on /admin/templates, just pre-filtered), "Use" one to clone it into a new tenant-owned
// DesignAsset (the Critical Backend Rule — never an update to the Template itself), then jump
// straight into editing that clone via `?designId=` (designer.md Phase 10) — it lands on Assets ->
// My Designs from there same as any other saved design, closing the loop this panel used to leave
// dangling at a plain confirmation message.
export function TemplatesGalleryPanel() {
  const router = useRouter();
  const locale = useLocale();
  const { data: templates = [], isLoading } = useQuery({ queryKey: ['templates'], queryFn: templatesApi.list });

  const useMut = useMutation({
    mutationFn: (id: string) => templatesApi.createDesign(id),
    onSuccess: (asset) => {
      router.push(`/${locale}/designer2?designId=${asset.id}`);
    },
  });

  return (
    <div className="p-3">
      {useMut.isError && <p className="mb-2 text-xs text-red-500">{(useMut.error as Error).message}</p>}

      <div className="grid grid-cols-2 gap-2">
        {isLoading && <p className="col-span-full py-8 text-center text-xs text-gray-400 dark:text-gray-600">Loading…</p>}
        {!isLoading && templates.length === 0 && (
          <p className="col-span-full py-8 text-center text-xs text-gray-400 dark:text-gray-600">No templates are available yet.</p>
        )}
        {templates.map((t) => (
          <div key={t.id} className="flex flex-col gap-1.5 rounded-lg border border-gray-200 p-2 dark:border-gray-800">
            <div className="flex h-16 items-center justify-center rounded-md bg-gray-100 text-center text-[9px] text-gray-400 dark:bg-gray-800 dark:text-gray-500">
              {CATEGORY_LABELS[t.category] ?? t.category}
            </div>
            <p className="truncate text-[11px] font-medium text-gray-900 dark:text-gray-100">{t.name}</p>
            <button
              disabled={useMut.isPending}
              onClick={() => useMut.mutate(t.id)}
              className="mt-auto rounded-md bg-indigo-600 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Use this template
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
