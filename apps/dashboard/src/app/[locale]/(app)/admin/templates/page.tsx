'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, PenTool, Globe, Users, EyeOff, Archive, X } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { useRouteGuard } from '@/hooks/useRouteGuard';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import {
  adminTemplatesApi,
  orgApi,
  type DesignTemplate,
  type DesignTemplateInput,
  type TemplateStatus,
  type TemplateVisibility,
} from '@/lib/api';
import type { ThemeCategory } from '@/lib/api';

// This is a genuinely new feature area (designer.md Phase 5), not an extension of an existing
// translated page — see the same call made for designer2's own PropertiesPanel strings. English
// literals stand in until the rest of the Templates/designer2 surface is wired for i18n.
const CATEGORIES: ThemeCategory[] = ['GENERIC', 'RESTAURANT_MENU', 'RETAIL_PROMO', 'HOTEL_LOBBY', 'CLINIC_WAITING', 'MOSQUE'];
const CATEGORY_LABELS: Record<ThemeCategory, string> = {
  GENERIC: 'Generic',
  RESTAURANT_MENU: 'Restaurant Menu',
  RETAIL_PROMO: 'Retail Promo',
  HOTEL_LOBBY: 'Hotel Lobby',
  CLINIC_WAITING: 'Clinic Waiting',
  MOSQUE: 'Mosque',
};
const VISIBILITIES: TemplateVisibility[] = ['HIDDEN', 'GLOBAL', 'SELECTED_TENANTS'];
const VISIBILITY_LABELS: Record<TemplateVisibility, string> = {
  HIDDEN: 'Hidden',
  GLOBAL: 'Global (all tenants)',
  SELECTED_TENANTS: 'Selected tenants',
};

const STATUS_STYLES: Record<TemplateStatus, string> = {
  DRAFT: 'bg-[var(--deck-glass-fill-strong)] text-[var(--deck-text-mid)]',
  PUBLISHED: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  ARCHIVED: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
};

const inputClass =
  'w-full rounded-lg border border-[var(--deck-glass-border)] bg-[var(--deck-glass-fill-strong)] px-3 py-1.5 text-sm text-[var(--deck-text-hi)] focus:border-[var(--deck-accent)] focus:outline-none';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={onClose}>
      <div
        className="glass-popup flex max-h-[85vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--deck-text-hi)]">{title}</h2>
          <button onClick={onClose} className="text-[var(--deck-text-low)] hover:text-[var(--deck-text-hi)]">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MetadataForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: DesignTemplateInput;
  submitLabel: string;
  onSubmit: (input: DesignTemplateInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? '');
  const [category, setCategory] = useState<ThemeCategory>(initial.category ?? 'GENERIC');
  const [visibility, setVisibility] = useState<TemplateVisibility>(initial.visibility ?? 'HIDDEN');

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name: name.trim(), description: description.trim() || undefined, category, visibility });
      }}
    >
      <label className="text-xs font-medium text-[var(--deck-text-mid)]">
        Name
        <input className={`${inputClass} mt-1`} value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="text-xs font-medium text-[var(--deck-text-mid)]">
        Description
        <textarea className={`${inputClass} mt-1`} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="text-xs font-medium text-[var(--deck-text-mid)]">
        Category
        <select className={`${inputClass} mt-1`} value={category} onChange={(e) => setCategory(e.target.value as ThemeCategory)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </label>
      <label className="text-xs font-medium text-[var(--deck-text-mid)]">
        Visibility
        <select className={`${inputClass} mt-1`} value={visibility} onChange={(e) => setVisibility(e.target.value as TemplateVisibility)}>
          {VISIBILITIES.map((v) => (
            <option key={v} value={v}>{VISIBILITY_LABELS[v]}</option>
          ))}
        </select>
      </label>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-[var(--deck-glass-border)] px-3 py-1.5 text-xs font-medium text-[var(--deck-text-hi)] hover:bg-[var(--deck-glass-fill-strong)]">
          Cancel
        </button>
        <button type="submit" className="rounded-lg bg-[var(--deck-accent)] px-3 py-1.5 text-xs font-medium text-white ">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function TenantAccessModal({ template, onClose }: { template: DesignTemplate; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: orgs = [] } = useQuery({ queryKey: ['org', 'all'], queryFn: orgApi.listAllOrganizations });
  const { data: access = [] } = useQuery({
    queryKey: ['admin-templates', template.id, 'tenant-access'],
    queryFn: () => adminTemplatesApi.getTenantAccess(template.id),
  });
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const current = selected ?? new Set(access.map((a) => a.tenantId));

  const saveMut = useMutation({
    mutationFn: (tenantIds: string[]) => adminTemplatesApi.setTenantAccess(template.id, tenantIds),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-templates'] });
      onClose();
    },
  });

  function toggle(id: string) {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  return (
    <Modal title={`Tenant access — ${template.name}`} onClose={onClose}>
      <p className="text-xs text-[var(--deck-text-mid)]">
        Only meaningful while visibility is &ldquo;Selected tenants&rdquo;. Check every organization allowed to see this template.
      </p>
      <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-[var(--deck-glass-border)] p-2">
        {orgs.map((org) => (
          <label key={org.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-[var(--deck-glass-fill-strong)]">
            <input type="checkbox" checked={current.has(org.id)} onChange={() => toggle(org.id)} />
            <span className="text-[var(--deck-text-hi)]">{org.name}</span>
            <span className="ml-auto text-[11px] text-[var(--deck-text-low)]">{org.slug}</span>
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-[var(--deck-glass-border)] px-3 py-1.5 text-xs font-medium text-[var(--deck-text-hi)] hover:bg-[var(--deck-glass-fill-strong)]">
          Cancel
        </button>
        <button
          onClick={() => saveMut.mutate([...current])}
          disabled={saveMut.isPending}
          className="rounded-lg bg-[var(--deck-accent)] px-3 py-1.5 text-xs font-medium text-white  disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

export default function AdminTemplatesPage() {
  const locale = useLocale();
  const qc = useQueryClient();
  const { isSuperAdmin } = usePermissions();
  const canRender = useRouteGuard(isSuperAdmin);
  const { confirmDelete } = useConfirmBeforeDelete();

  const { data: templates = [], isLoading } = useQuery({ queryKey: ['admin-templates'], queryFn: adminTemplatesApi.list, enabled: canRender });

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<DesignTemplate | null>(null);
  const [tenantAccessFor, setTenantAccessFor] = useState<DesignTemplate | null>(null);

  const createMut = useMutation({
    mutationFn: (input: DesignTemplateInput) => adminTemplatesApi.create(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-templates'] });
      setShowCreate(false);
    },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: DesignTemplateInput }) => adminTemplatesApi.update(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-templates'] });
      setEditing(null);
    },
  });
  const publishMut = useMutation({
    mutationFn: (id: string) => adminTemplatesApi.publish(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-templates'] }),
  });
  const unpublishMut = useMutation({
    mutationFn: (id: string) => adminTemplatesApi.unpublish(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-templates'] }),
  });
  const archiveMut = useMutation({
    mutationFn: (id: string) => adminTemplatesApi.archive(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-templates'] }),
  });

  if (!canRender) return null;

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--deck-text-hi)]">Design Templates</h1>
          <p className="mt-1 text-sm text-[var(--deck-text-mid)]">
            Super Admin only — curated designer2 templates, published and assigned to tenants (designer.md Phase 5).
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-[var(--deck-accent)] px-4 py-2 text-sm font-medium text-white "
        >
          <Plus className="h-4 w-4" /> New Template
        </button>
      </div>

      {(publishMut.error || unpublishMut.error || archiveMut.error || createMut.error || updateMut.error) && (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400">
          {((publishMut.error ?? unpublishMut.error ?? archiveMut.error ?? createMut.error ?? updateMut.error) as Error).message}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-[var(--deck-glass-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--deck-glass-fill-strong)] text-left text-xs uppercase tracking-wide text-[var(--deck-text-mid)]">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Visibility</th>
              <th className="px-4 py-2">Version</th>
              <th className="px-4 py-2">Designs cloned</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--deck-glass-border-soft)]">
            {isLoading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--deck-text-low)]">Loading…</td></tr>
            )}
            {!isLoading && templates.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--deck-text-low)]">No templates yet.</td></tr>
            )}
            {templates.map((t) => (
              <tr key={t.id} className="text-[var(--deck-text-hi)]">
                <td className="px-4 py-2 font-medium">{t.name}</td>
                <td className="px-4 py-2 text-xs text-[var(--deck-text-mid)]">{CATEGORY_LABELS[t.category]}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[t.status]}`}>{t.status}</span>
                </td>
                <td className="px-4 py-2 text-xs text-[var(--deck-text-mid)]">
                  <span className="inline-flex items-center gap-1">
                    {t.visibility === 'GLOBAL' && <Globe className="h-3 w-3" />}
                    {t.visibility === 'SELECTED_TENANTS' && <Users className="h-3 w-3" />}
                    {t.visibility === 'HIDDEN' && <EyeOff className="h-3 w-3" />}
                    {VISIBILITY_LABELS[t.visibility]}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-[var(--deck-text-mid)]">v{t.versionNumber}</td>
                <td className="px-4 py-2 text-xs text-[var(--deck-text-mid)]">{t._count?.designAssets ?? 0}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-end gap-1.5">
                    <Link
                      href={`/${locale}/designer2?templateId=${t.id}`}
                      title="Edit design"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--deck-text-mid)] hover:bg-[var(--deck-glass-fill-strong)] hover:text-[var(--deck-text-hi)]"
                    >
                      <PenTool className="h-3.5 w-3.5" />
                    </Link>
                    <button onClick={() => setEditing(t)} className="rounded-md px-2 py-1 text-xs text-[var(--deck-text-mid)] hover:bg-[var(--deck-glass-fill-strong)]">
                      Edit
                    </button>
                    {t.visibility === 'SELECTED_TENANTS' && (
                      <button onClick={() => setTenantAccessFor(t)} className="rounded-md px-2 py-1 text-xs text-[var(--deck-text-mid)] hover:bg-[var(--deck-glass-fill-strong)]">
                        Tenants
                      </button>
                    )}
                    {t.status !== 'ARCHIVED' && (
                      t.status === 'PUBLISHED' ? (
                        <button onClick={() => unpublishMut.mutate(t.id)} className="rounded-md px-2 py-1 text-xs text-[var(--deck-text-mid)] hover:bg-[var(--deck-glass-fill-strong)]">
                          Unpublish
                        </button>
                      ) : (
                        <button onClick={() => publishMut.mutate(t.id)} className="rounded-md px-2 py-1 text-xs font-medium text-[var(--deck-accent)] hover:bg-[var(--deck-accent-soft)]">
                          Publish
                        </button>
                      )
                    )}
                    {t.status !== 'ARCHIVED' && (
                      <button
                        title="Archive"
                        onClick={() => {
                          if (confirmDelete(`Archive "${t.name}"? Customers already using it keep their own copy.`)) archiveMut.mutate(t.id);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <Modal title="New Template" onClose={() => setShowCreate(false)}>
          <MetadataForm
            initial={{ name: '', visibility: 'HIDDEN', category: 'GENERIC' }}
            submitLabel="Create"
            onCancel={() => setShowCreate(false)}
            onSubmit={(input) => createMut.mutate(input)}
          />
        </Modal>
      )}

      {editing && (
        <Modal title={`Edit — ${editing.name}`} onClose={() => setEditing(null)}>
          <MetadataForm
            initial={{ ...editing, description: editing.description ?? undefined }}
            submitLabel="Save"
            onCancel={() => setEditing(null)}
            onSubmit={(input) => updateMut.mutate({ id: editing.id, input })}
          />
        </Modal>
      )}

      {tenantAccessFor && <TenantAccessModal template={tenantAccessFor} onClose={() => setTenantAccessFor(null)} />}
    </div>
  );
}
