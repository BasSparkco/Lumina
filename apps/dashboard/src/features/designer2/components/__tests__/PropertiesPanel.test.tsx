import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBlankDesignDocument, type DesignElement } from '@lumina/design-schema';
import type * as LuminaApi from '@/lib/api';
import en from '../../../../../messages/en.json';
import type { FabricCanvasAdapter } from '../../canvas/FabricCanvasAdapter';
import { createImagePlaceholderElement, createQrPlaceholderElement, createShapeElement, createTextElement } from '../../lib/defaultElements';
import { useDesignerStore } from '../../state/designer.store';
import { PropertiesPanel } from '../PropertiesPanel';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof LuminaApi>()),
  assetsApi: { list: vi.fn(async () => []) },
}));
vi.mock('@/hooks/useConfirmBeforeDelete', () => ({ useConfirmBeforeDelete: () => ({ confirmDelete: () => true }) }));

const size = { width: 400, height: 300 };

function setup(element: DesignElement, opts: { isTemplateMode?: boolean } = {}) {
  const doc = buildBlankDesignDocument('Test');
  doc.scenes[0]!.elements.push(element);
  useDesignerStore.getState().loadDocument(doc);
  useDesignerStore.getState().setSelection([element.id]);
  const commit = vi.fn((mutator: () => void) => mutator());
  const adapter = { updateElement: vi.fn() } as unknown as FabricCanvasAdapter;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <QueryClientProvider client={queryClient}>
        <PropertiesPanel adapter={adapter} commit={commit} isTemplateMode={opts.isTemplateMode} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
  return { commit, adapter };
}

const byId = (id: string) => useDesignerStore.getState().document!.scenes[0]!.elements.find((el) => el.id === id)!;

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { vi.clearAllMocks(); });

describe('Designer2 PropertiesPanel — live/commit fields (M5)', () => {
  it('NumberField (Width): live-previews every tick through the adapter, commits once on blur', () => {
    const shape = createShapeElement('rectangle', size, []);
    const { commit, adapter } = setup(shape);
    const input = screen.getByLabelText('Width');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '150' } });
    fireEvent.change(input, { target: { value: '180' } });
    expect(adapter.updateElement).toHaveBeenCalledTimes(2);
    expect(commit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(commit).toHaveBeenCalledOnce();
    expect(byId(shape.id).width).toBe(180);
  });

  it('ColorField (Shape Fill): many native color-input ticks, exactly one commit on blur — the flooding regression test', () => {
    const shape = createShapeElement('rectangle', size, []);
    const { commit } = setup(shape);
    const input = screen.getByLabelText('Fill');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '#111111' } });
    fireEvent.change(input, { target: { value: '#222222' } });
    fireEvent.change(input, { target: { value: '#333333' } });
    expect(commit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(commit).toHaveBeenCalledOnce();
    expect(byId(shape.id).type).toBe('shape');
    expect((byId(shape.id) as Extract<DesignElement, { type: 'shape' }>).fill).toBe('#333333');
  });

  it('a no-op blur (focus then blur, no edit) on a NumberField never calls commit', () => {
    const shape = createShapeElement('rectangle', size, []);
    const { commit } = setup(shape);
    const input = screen.getByLabelText('Width');
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(commit).not.toHaveBeenCalled();
  });

  it('a no-op blur on the Name field (unedited) never calls commit', () => {
    const shape = createShapeElement('rectangle', size, []);
    const { commit } = setup(shape);
    const input = screen.getByLabelText('Name');
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(commit).not.toHaveBeenCalled();
  });

  it('Escape mid-edit reverts the displayed value, previews the revert, and never commits', () => {
    const shape = { ...createShapeElement('rectangle', size, []), width: 320 };
    const { commit, adapter } = setup(shape);
    const input = screen.getByLabelText('Width') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '999' } });
    expect(input.value).toBe('999');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('320');
    expect(adapter.updateElement).toHaveBeenLastCalledWith(shape.id, { width: 320 });
    fireEvent.blur(input);
    expect(commit).not.toHaveBeenCalled();
    expect(byId(shape.id).width).toBe(320);
  });

  it('Flip X and a Fit selection each commit exactly once', () => {
    const image = { ...createImagePlaceholderElement(size, []), flipX: false, assetId: 'asset_1' };
    const { commit } = setup(image);
    fireEvent.click(screen.getByRole('button', { name: /Flip X/ }));
    expect(commit).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Fit'), { target: { value: 'cover' } });
    expect(commit).toHaveBeenCalledTimes(2);
    expect(byId(image.id)).toMatchObject({ flipX: true, fit: 'cover' });
  });
});

describe('Designer2 PropertiesPanel — Template policy gating (M5)', () => {
  it('disables content fields (not style fields) when contentEditable is false, outside template-authoring mode', () => {
    const text = { ...createTextElement(size, []), templatePolicy: { contentEditable: false, styleEditable: true } };
    setup(text);
    expect(screen.getByLabelText('Text')).toBeDisabled();
    expect(screen.getByLabelText('Color')).not.toBeDisabled();
  });

  it('disables style fields (not content fields) when styleEditable is false, outside template-authoring mode', () => {
    const text = { ...createTextElement(size, []), templatePolicy: { contentEditable: true, styleEditable: false } };
    setup(text);
    expect(screen.getByLabelText('Text')).not.toBeDisabled();
    expect(screen.getByLabelText('Color')).toBeDisabled();
  });

  it('leaves every field enabled while authoring the Template itself, regardless of the stored policy', () => {
    const text = { ...createTextElement(size, []), templatePolicy: { contentEditable: false, styleEditable: false } };
    setup(text, { isTemplateMode: true });
    expect(screen.getByLabelText('Text')).not.toBeDisabled();
    expect(screen.getByLabelText('Color')).not.toBeDisabled();
  });
});

describe('Designer2 PropertiesPanel — bound (dynamic-variable) fields are read-only (M5)', () => {
  it('disables the Text field and shows a hint when bound to a dynamic variable', () => {
    const text = { ...createTextElement(size, []), dynamicBindings: [{ property: 'text', variable: 'offer.price', fallback: '$5' }] };
    setup(text);
    expect(screen.getByLabelText('Text')).toBeDisabled();
    expect(screen.getByText(/Bound to a dynamic variable/)).toBeInTheDocument();
  });

  it('disables the QR Value field and shows a hint when bound to a dynamic variable', () => {
    const qr = { ...createQrPlaceholderElement(size, []), dynamicBindings: [{ property: 'value', variable: 'offer.url' }] };
    setup(qr);
    expect(screen.getByLabelText('Value')).toBeDisabled();
    expect(screen.getByText(/Bound to a dynamic variable/)).toBeInTheDocument();
  });

  it('leaves an unbound Text field fully editable', () => {
    const text = createTextElement(size, []);
    setup(text);
    expect(screen.getByLabelText('Text')).not.toBeDisabled();
    expect(screen.queryByText(/Bound to a dynamic variable/)).not.toBeInTheDocument();
  });
});
