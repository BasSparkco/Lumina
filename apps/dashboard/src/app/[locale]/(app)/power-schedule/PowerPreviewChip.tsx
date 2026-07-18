'use client';
import { useQuery } from '@tanstack/react-query';
import { powerSchedulesApi } from '@/lib/api';

// Refetches often enough to visibly flip across a minute boundary while an admin is watching
// the page (e.g. testing a schedule that starts in a couple minutes), without hammering the API.
const REFRESH_MS = 15_000;

export function PowerPreviewChip({ screenId, onLabel, offLabel }: { screenId: string; onLabel: string; offLabel: string }) {
  const { data } = useQuery({
    queryKey: ['powerSchedulePreview', screenId],
    queryFn: () => powerSchedulesApi.previewNow(screenId),
    refetchInterval: REFRESH_MS,
  });
  if (!data) return null;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
      data.poweredOn
        ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'
        : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
    }`}>
      {data.poweredOn ? onLabel : offLabel}
    </span>
  );
}
