'use client';
import { useState } from 'react';
import { Plus, X, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface EditorAddSidebarItem {
  key: string;
  label: string;
  icon: LucideIcon;
  // Fires immediately on click. Mutually exclusive with `panel` in practice — an item with a
  // panel expands inline instead, so its finishing action lives inside the panel itself.
  onClick?: () => void;
  // Renders inline below the item when expanded (click toggles it) — for items where the "add"
  // action benefits from a couple of quick choices first (e.g. shape + fill + color), instead of
  // dropping in with defaults and sending the user to scroll down to the element cards to fix
  // them up. Receives a close callback the panel's own confirm action should call when done.
  panel?: (close: () => void) => ReactNode;
}

export interface EditorAddSidebarSection {
  heading?: string;
  items: EditorAddSidebarItem[];
}

interface EditorAddSidebarProps {
  title: string;
  sections: EditorAddSidebarSection[];
  openLabel: string;
  closeLabel: string;
}

function SectionList({
  sections,
  onItemClick,
}: {
  sections: EditorAddSidebarSection[];
  onItemClick?: () => void;
}) {
  // Accordion-style: at most one item's quick-add panel open at a time, closes itself once its
  // own confirm action runs (see the `panel` close callback below).
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
      {sections.map((section, idx) => (
        <div
          key={section.heading ?? idx}
          className={`flex flex-col gap-1 ${idx > 0 ? 'border-t border-gray-100 pt-3 dark:border-gray-800' : ''}`}
        >
          {section.heading && (
            <div className="px-1.5 text-[10px] font-semibold tracking-wide text-gray-400 uppercase dark:text-gray-500">
              {section.heading}
            </div>
          )}
          {section.items.map((item) => {
            const isExpanded = expandedKey === item.key;
            return (
              <div key={item.key} className="flex flex-col">
                <button
                  type="button"
                  onClick={() => {
                    if (item.panel) {
                      setExpandedKey((k) => (k === item.key ? null : item.key));
                    } else {
                      item.onClick?.();
                      onItemClick?.();
                    }
                  }}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-indigo-600 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-indigo-400"
                >
                  <item.icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.panel && (
                    <ChevronDown
                      className={`h-3 w-3 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    />
                  )}
                </button>
                {item.panel && isExpanded && (
                  <div className="mt-1 rounded-md border border-gray-100 bg-gray-50 p-2 dark:border-gray-800 dark:bg-gray-800/60">
                    {item.panel(() => {
                      setExpandedKey(null);
                      onItemClick?.();
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Floating "insert" panel shared by the layouts (zones) and themes (elements) editors — deliberately
// lives outside the editor panel's own layout flow (not a flex sibling of the canvas/cards column)
// so opening it never shrinks the editing area. A persistent, non-overlapping right rail needs
// roughly 1900px+ of viewport before a centered 1400px-max editor panel leaves enough natural gutter
// for it — below that (i.e. on the vast majority of real laptop/desktop screens, not just phones/
// tablets) it collapses to a floating toggle + slide-in drawer instead, so the editing area stays
// exactly as wide as it was before this panel existed. The toggle sits opposite the main nav's own
// mobile hamburger (which opens from the start side), so the two never compete for the same corner.
export function EditorAddSidebar({
  title,
  sections,
  openLabel,
  closeLabel,
}: EditorAddSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Persistent rail — only on wide-enough viewports that it fits in the natural gutter
          beside the centered editor panel without costing it any width. Not part of the editor's
          own flex layout. */}
      <aside className="fixed inset-y-0 end-0 z-20 hidden w-64 flex-col border-s border-gray-200 bg-white/95 shadow-lg backdrop-blur-sm min-[1920px]:flex dark:border-gray-800 dark:bg-gray-900/95">
        <div className="border-b border-gray-100 px-3 py-3 text-xs font-semibold text-gray-500 dark:border-gray-800 dark:text-gray-400">
          {title}
        </div>
        <SectionList sections={sections} />
      </aside>

      {/* Below the persistent-rail breakpoint (i.e. on virtually all normal screens, not just
          phones/tablets): a floating trigger opposite the main nav's own top-end hamburger,
          opening a drawer that slides in from the end edge (mirrors the main nav drawer, reversed
          side). Costs zero layout width when closed, unlike the persistent rail above. */}
      {!mobileOpen && (
        <button
          onClick={() => setMobileOpen(true)}
          title={openLabel}
          className="fixed end-4 bottom-6 z-20 inline-flex h-12 w-12 items-center justify-center rounded-full border border-gray-200 bg-indigo-600 text-white shadow-lg min-[1920px]:hidden dark:border-gray-800"
        >
          <Plus className="h-5 w-5" />
        </button>
      )}

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 min-[1920px]:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 end-0 z-40 flex w-72 flex-col bg-white shadow-lg transition-transform duration-200 ease-in-out min-[1920px]:hidden dark:bg-gray-900 ${
          mobileOpen ? 'translate-x-0' : 'translate-x-full rtl:-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-3 py-3 dark:border-gray-800">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{title}</span>
          <button
            onClick={() => setMobileOpen(false)}
            title={closeLabel}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <SectionList sections={sections} onItemClick={() => setMobileOpen(false)} />
      </aside>
    </>
  );
}
