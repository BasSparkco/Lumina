'use client';
import { ChevronLeft, ChevronRight, LayoutTemplate, SlidersHorizontal } from 'lucide-react';
import type { FabricCanvasAdapter } from '../canvas/FabricCanvasAdapter';
import { TemplatesGalleryPanel } from './TemplatesGalleryPanel';
import { PropertiesPanel } from './PropertiesPanel';

export type InspectorTab = 'templates' | 'properties';

// Ordered tab defs for the tab bar below — add an entry here (and a matching branch in the
// content switch) when a future tab is wired up; everything else is already generic over it.
const TAB_DEFS: { id: InspectorTab; label: string; icon: typeof LayoutTemplate }[] = [
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'properties', label: 'Properties', icon: SlidersHorizontal },
];

interface InspectorPanelProps {
  activeTab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  adapter: FabricCanvasAdapter | null;
  commit: (mutator: () => void) => void;
  isTemplateMode?: boolean;
}

// Merges the old separate Templates flyout and Properties panel into one tabbed sidebar
// (designer.md follow-up). Selection changes and the DesignerSidebar's Templates button drive
// `activeTab` from the parent (DesignerShell owns that state so both can reach it); this
// component only renders the tab bar/content and the slide-open/closed toggle.
//
// The toggle tab sits in the outer wrapper, as a sibling of the width-animated inner panel
// rather than a child of it — the inner panel clips to 0 width when collapsed (overflow-hidden),
// which would clip the toggle along with it if it lived inside. Because this panel is the last
// flex item in the row (canvas is the flex-1 sibling before it), the wrapper's own end edge
// stays anchored at the same physical position whether the inner panel is 320px or 0px wide, so
// `end-0` keeps the toggle pinned at the row's outer corner throughout the slide.
export function InspectorPanel({ activeTab, onTabChange, collapsed, onCollapsedChange, adapter, commit, isTemplateMode }: InspectorPanelProps) {
  return (
    <div className="relative flex h-full shrink-0">
      <button
        onClick={() => onCollapsedChange(!collapsed)}
        title={collapsed ? 'Show panel' : 'Hide panel'}
        className="absolute end-0 top-3 z-10 flex h-9 w-6 items-center justify-center rounded-s-md border border-e-0 border-gray-200 bg-white text-gray-400 shadow-sm hover:text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-500 dark:hover:text-gray-200"
      >
        {collapsed ? <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" /> : <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />}
      </button>
      <div
        className={`h-full overflow-hidden transition-[width] duration-200 ease-in-out ${collapsed ? 'w-0' : 'w-80'}`}
      >
        <div className="flex h-full w-80 flex-col border-s border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="flex shrink-0 border-b border-gray-200 dark:border-gray-800">
            {TAB_DEFS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => onTabChange(id)}
                aria-pressed={activeTab === id}
                className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium border-b-2 ${
                  activeTab === id
                    ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {activeTab === 'templates' && <TemplatesGalleryPanel />}
            {activeTab === 'properties' && <PropertiesPanel adapter={adapter} commit={commit} isTemplateMode={isTemplateMode} />}
          </div>
        </div>
      </div>
    </div>
  );
}
