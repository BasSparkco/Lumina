'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { buildBlankDesignDocument, DesignDocumentSchema } from '@lumina/design-schema';
import { useDesignerStore } from '@/features/designer2/state/designer.store';
import { readLocalDraft } from '@/features/designer2/hooks/useAutosave';
import { usePermissions } from '@/hooks/usePermissions';
import { useRouteGuard } from '@/hooks/useRouteGuard';
import { adminTemplatesApi, designDraftsApi, designsApi } from '@/lib/api';

// Fabric touches window/document at construction time — the whole shell is meaningless (and
// unsafe) to render during SSR.
const DesignerShell = dynamic(
  () => import('@/features/designer2/components/DesignerShell').then((m) => m.DesignerShell),
  { ssr: false, loading: () => <DesignerLoading /> },
);

function DesignerLoading() {
  return <div className="flex h-full w-full items-center justify-center text-sm text-gray-400 dark:text-gray-600">Loading…</div>;
}

// designer.md Phase 5/10 — three modes behind one shared editor surface (this app's existing
// "one /designer page, no tab switcher" convention for Layouts/Themes):
//   ?templateId=   Super Admin Template authoring (§10.1), saves against /admin/templates/:id.
//   ?designId=     an existing persisted customer DesignAsset (§19.1/§21).
//   (neither)      a brand-new, not-yet-persisted design — stays purely in-memory until the
//                  *first* save (auto or manual) actually happens; opening a blank editor must
//                  not eagerly create a database row just from being visited.
function Designer2PageInner() {
  const t = useTranslations('nav');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const templateIdParam = searchParams.get('templateId');
  const designIdParam = searchParams.get('designId');
  const { isSuperAdmin } = usePermissions();
  const canRender = useRouteGuard(!templateIdParam || isSuperAdmin, 'designer2');
  const loadDocument = useDesignerStore((s) => s.loadDocument);
  // Tracks which source (a specific templateId/designId, or the sentinel 'blank') has already
  // been loaded, so switching between modes in the same session reloads correctly instead of
  // only ever running once like Phase 1's original ref-boolean guard did.
  const loadedKey = useRef<string | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  // designer.md Phase 10-style tracking, mirrored for Templates — the persisted DesignTemplate id
  // this session is tracking once there is one. `templateIdParam` seeds it on load; a Super
  // Admin's first save-as-template (see DesignerShell's saveAsTemplate branch) sets it via
  // handleTemplateSaved below, independent of the URL, updated separately just like designId.
  const [templateId, setTemplateId] = useState<string | null>(templateIdParam);
  const [loadError, setLoadError] = useState<string | null>(null);
  // designer.md Phase 10 — the persisted DesignAsset id/revision this session is tracking, once
  // there is one. `designIdParam` seeds it on load; a first save (create) updates it via
  // handleDesignSaved below, independent of the URL, which is updated separately (router.replace
  // doesn't synchronously update `searchParams` in the same render).
  const [designId, setDesignId] = useState<string | null>(designIdParam);
  const [designRevision, setDesignRevision] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!canRender) return;
    const key = templateIdParam ? `template:${templateIdParam}` : designIdParam ? `design:${designIdParam}` : 'blank';
    if (loadedKey.current === key) return;
    loadedKey.current = key;

    if (templateIdParam) {
      // No `cancelled`-flag guard here (unlike a typical fetch-in-effect): React 18 Strict Mode's
      // dev-only double-invoke (mount -> cleanup -> mount) would otherwise write `loadedKey.current`
      // on the first, throwaway invocation and then have that invocation's own cleanup mark its
      // still-in-flight fetch "cancelled" — the second, real invocation then sees loadedKey already
      // set and never starts its own fetch, so nothing ever applies the result. Letting the
      // throwaway invocation's fetch finish and apply the result is exactly what should happen.
      adminTemplatesApi
        .get(templateIdParam)
        .then((template) => {
          setTemplateName(template.name);
          loadDocument(DesignDocumentSchema.parse(template.designJson));
        })
        .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load template'));
      return;
    }

    if (designIdParam) {
      designsApi
        .get(designIdParam)
        .then(async (design) => {
          setDesignId(design.id);
          setDesignRevision(design.revision);
          // designer.md Phase 10 Acceptance: "browser crash/reload can recover recent work" —
          // prefer a draft over the saved content if one exists and is actually newer. Local
          // first (no network round-trip needed to know it exists), backend as a fallback for
          // "crashed on a different device/browser."
          const local = readLocalDraft(design.designJson.id);
          if (local && new Date(local.savedAt) > new Date(design.updatedAt)) {
            loadDocument(local.document);
            return;
          }
          const draft = await designDraftsApi.get(design.designJson.id).catch(() => null);
          if (draft && new Date(draft.updatedAt) > new Date(design.updatedAt)) {
            loadDocument(draft.draftJson);
            return;
          }
          loadDocument(design.designJson);
        })
        .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load design'));
      return;
    }

    loadDocument(buildBlankDesignDocument('Untitled Design'));
  }, [canRender, templateIdParam, designIdParam, loadDocument]);

  // designer.md Phase 10 — the first successful save (create) gets this design a real id for the
  // first time; reflect it in the URL (replace, not push — a blank editor turning into a saved
  // one isn't a new navigation entry a user would expect Back to undo) so a refresh reloads the
  // same persisted design instead of starting blank again. Subsequent saves (update/restore) just
  // refresh the tracked revision.
  function handleDesignSaved(result: { id: string; revision: number }) {
    setDesignId(result.id);
    setDesignRevision(result.revision);
    if (result.id !== designIdParam) {
      loadedKey.current = `design:${result.id}`;
      router.replace(`${pathname}?designId=${result.id}`);
    }
  }

  // Mirrors handleDesignSaved above — a Super Admin's first save-as-template (DesignerShell's
  // saveAsTemplate branch) gets this document a real Template id for the first time; reflect it
  // in the URL the same way so a refresh reloads the same Template instead of starting blank.
  function handleTemplateSaved(result: { id: string; name: string }) {
    setTemplateId(result.id);
    setTemplateName(result.name);
    if (result.id !== templateIdParam) {
      loadedKey.current = `template:${result.id}`;
      router.replace(`${pathname}?templateId=${result.id}`);
    }
  }

  if (!canRender) return null;

  if ((templateId || designIdParam) && loadError) {
    return <div className="p-8 text-sm text-red-600 dark:text-red-400">{loadError}</div>;
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <h1 className="sr-only">{t('designer2')}</h1>
      <DesignerShell
        templateId={templateId ?? undefined}
        templateName={templateName ?? undefined}
        designId={designId}
        designRevision={designRevision}
        onDesignSaved={handleDesignSaved}
        isSuperAdmin={isSuperAdmin}
        onTemplateSaved={handleTemplateSaved}
      />
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
