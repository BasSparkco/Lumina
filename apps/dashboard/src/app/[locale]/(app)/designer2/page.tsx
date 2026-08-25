'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DesignDocumentSchema, type DesignDocument } from '@lumina/design-schema';
import { useDesignerStore } from '@/features/designer2/state/designer.store';
import { usePermissions } from '@/hooks/usePermissions';
import { useRouteGuard } from '@/hooks/useRouteGuard';
import { adminTemplatesApi } from '@/lib/api';

// Fabric touches window/document at construction time — the whole shell is meaningless (and
// unsafe) to render during SSR.
const DesignerShell = dynamic(
  () => import('@/features/designer2/components/DesignerShell').then((m) => m.DesignerShell),
  { ssr: false, loading: () => <DesignerLoading /> },
);

function DesignerLoading() {
  return <div className="flex h-full w-full items-center justify-center text-sm text-gray-400 dark:text-gray-600">Loading…</div>;
}

function buildEmptyDocument(): DesignDocument {
  const id = `design_${crypto.randomUUID()}`;
  const sceneId = `scene_${crypto.randomUUID()}`;
  // Validated below via .parse() rather than trusted as-is — a cheap regression guard against
  // schema drift between this literal and @lumina/design-schema.
  return DesignDocumentSchema.parse({
    schemaVersion: 1,
    id,
    name: 'Untitled Design',
    canvas: { width: 1920, height: 1080, backgroundColor: '#000000' },
    settings: { defaultSceneDurationMs: 10000 },
    scenes: [
      {
        id: sceneId,
        name: 'Scene 1',
        durationMs: 10000,
        background: { type: 'color', color: '#111111' },
        elements: [],
      },
    ],
  });
}

// designer.md Phase 5 — `?templateId=` puts this same editor into Template-authoring mode: Super
// Admin only (§10.1's "Only Super Admin can... Modify Template source"), loads/saves against
// /admin/templates/:id instead of the blank in-memory document plain designer2 still uses (real
// customer Design Asset persistence is designer.md Phase 10, not this). One shared editor surface
// for both, matching this app's existing "one /designer page, no tab switcher" convention for
// Layouts/Themes.
function Designer2PageInner() {
  const t = useTranslations('nav');
  const searchParams = useSearchParams();
  const templateId = searchParams.get('templateId');
  const { isSuperAdmin } = usePermissions();
  const canRender = useRouteGuard(!templateId || isSuperAdmin, 'designer2');
  const loadDocument = useDesignerStore((s) => s.loadDocument);
  // Tracks which source (a specific templateId, or the sentinel 'blank') has already been loaded,
  // so switching between plain designer2 and a template URL in the same session reloads correctly
  // instead of only ever running once like Phase 1's original ref-boolean guard did.
  const loadedKey = useRef<string | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!canRender) return;
    const key = templateId ?? 'blank';
    if (loadedKey.current === key) return;
    loadedKey.current = key;

    if (!templateId) {
      loadDocument(buildEmptyDocument());
      return;
    }
    // No `cancelled`-flag guard here (unlike a typical fetch-in-effect): React 18 Strict Mode's
    // dev-only double-invoke (mount -> cleanup -> mount) would otherwise write `loadedKey.current`
    // on the first, throwaway invocation and then have that invocation's own cleanup mark its
    // still-in-flight fetch "cancelled" — the second, real invocation then sees loadedKey already
    // set and never starts its own fetch, so nothing ever applies the result. Letting the
    // throwaway invocation's fetch finish and apply the result is exactly what should happen
    // (setTemplateName/loadDocument are stable regardless of which invocation's closure calls
    // them); the loadedKey guard already prevents a second, redundant fetch for the same id.
    adminTemplatesApi
      .get(templateId)
      .then((template) => {
        setTemplateName(template.name);
        loadDocument(DesignDocumentSchema.parse(template.designJson));
      })
      .catch((e) => {
        setLoadError(e instanceof Error ? e.message : 'Failed to load template');
      });
  }, [canRender, templateId, loadDocument]);

  if (!canRender) return null;

  if (templateId && loadError) {
    return <div className="p-8 text-sm text-red-600 dark:text-red-400">{loadError}</div>;
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <h1 className="sr-only">{t('designer2')}</h1>
      <DesignerShell templateId={templateId ?? undefined} templateName={templateName ?? undefined} />
    </div>
  );
}

export default function Designer2Page() {
  return (
    <Suspense fallback={null}>
      <Designer2PageInner />
    </Suspense>
  );
}
