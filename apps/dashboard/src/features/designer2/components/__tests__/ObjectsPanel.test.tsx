import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBlankDesignDocument } from '@lumina/design-schema';
import type * as LuminaApi from '@/lib/api';
import { createShapeElement } from '../../lib/defaultElements';
import { useDesignerStore } from '../../state/designer.store';
import { ObjectsPanel } from '../ObjectsPanel';

vi.mock('@/hooks/useConfirmBeforeDelete', () => ({ useConfirmBeforeDelete: () => ({ confirmDelete: () => true }) }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof LuminaApi>()),
  assetsApi: { list: vi.fn(async () => []) },
}));

const size = { width: 400, height: 300 };

function setup() {
  const doc = buildBlankDesignDocument('Test');
  const a = { ...createShapeElement('rectangle', size, []), id: 'el_a', name: 'Rect A' };
  const elementsSoFar = [a];
  const b = { ...createShapeElement('rectangle', size, elementsSoFar), id: 'el_b', name: 'Rect B' };
  doc.scenes[0]!.elements.push(a, b);
  useDesignerStore.getState().loadDocument(doc);
  const commit = vi.fn((mutator: () => void) => mutator());
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ObjectsPanel onReorder={vi.fn()} adapter={null} commit={commit} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), commit };
}

const elements = () => useDesignerStore.getState().document!.scenes[0]!.elements;
const byId = (id: string) => elements().find((el) => el.id === id)!;

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { vi.clearAllMocks(); });

describe('Designer2 ObjectsPanel — layer row actions (M4)', () => {
  it('renames an element via double-click on its row label', async () => {
    const { user } = setup();
    const label = screen.getByText('Rect A');
    await user.dblClick(label);
    const input = screen.getByDisplayValue('Rect A');
    await user.clear(input);
    await user.type(input, 'Renamed{Enter}');
    expect(byId('el_a').name).toBe('Renamed');
  });

  it('does not rename on Escape', async () => {
    const { user } = setup();
    await user.dblClick(screen.getByText('Rect A'));
    const input = screen.getByDisplayValue('Rect A');
    await user.type(input, 'X{Escape}');
    expect(byId('el_a').name).toBe('Rect A');
  });

  it('toggles visibility from the row icon without needing to select the element', async () => {
    const { user } = setup();
    expect(byId('el_a').visible).toBe(true);
    const row = screen.getByText('Rect A').closest('div')!;
    await user.click(row.querySelector('button[title="Hide"]')!);
    expect(byId('el_a').visible).toBe(false);
  });

  it('toggles lock from the row icon, setting both movable and resizable', async () => {
    const { user } = setup();
    const row = screen.getByText('Rect A').closest('div')!;
    await user.click(row.querySelector('button[title="Lock"]')!);
    expect(byId('el_a').movable).toBe(false);
    expect(byId('el_a').resizable).toBe(false);
  });

  it('opens the row actions menu and duplicates the element', async () => {
    const { user } = setup();
    const row = screen.getByText('Rect A').closest('div')!;
    await user.click(row.querySelector('button[title="More actions"]')!);
    await user.click(await screen.findByText('Duplicate'));
    expect(elements()).toHaveLength(3);
  });

  it('opens the row actions menu and deletes the element', async () => {
    const { user } = setup();
    const row = screen.getByText('Rect A').closest('div')!;
    await user.click(row.querySelector('button[title="More actions"]')!);
    await user.click(await screen.findByText('Delete'));
    expect(elements().map((el) => el.id)).not.toContain('el_a');
  });

  it('reorders via the row actions menu (Send Backward)', async () => {
    const { user } = setup();
    const before = byId('el_b').zIndex;
    const row = screen.getByText('Rect B').closest('div')!;
    await user.click(row.querySelector('button[title="More actions"]')!);
    await user.click(await screen.findByText('Send Backward'));
    expect(byId('el_b').zIndex).toBeLessThan(before);
  });

  it('wraps every row action in commit()', async () => {
    const { user, commit } = setup();
    const row = screen.getByText('Rect A').closest('div')!;
    await user.click(row.querySelector('button[title="Hide"]')!);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
