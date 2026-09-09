import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignElement, DesignScene } from '@lumina/design-schema';
import { ActiveSelection, FabricImage, Group, Rect } from 'fabric';
import type { Asset } from '@/lib/api';
import * as factory from '../FabricObjectFactory';
import { FabricCanvasAdapter } from '../FabricCanvasAdapter';
import { createMediaElement, createShapeElement, createTextElement, createVideoPlaceholderElement } from '../../lib/defaultElements';
import { applyElementPosition } from '../geometryContract';
import type { ElementGeometryPatch } from '../FabricEventBridge';

// jsdom has no raster backend in CI. Keep real Fabric selection/layout/events and stub
// only the drawing context; actual raster compositing is also checked in Chromium.
beforeEach(() => {
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    let context = contexts.get(this);
    if (!context) {
      context = new Proxy({
        canvas: this,
        measureText: (value: string) => ({ width: value.length * 12 }),
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      }, {
        get: (target, key) => key in target ? Reflect.get(target, key) : () => {},
      }) as unknown as CanvasRenderingContext2D;
      contexts.set(this, context);
    }
    return context;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext);
});

const size = { width: 400, height: 300 };
const adapters: FabricCanvasAdapter[] = [];

function setup(resolveAssetUrl: (id: string) => string | undefined = () => undefined, getViewportRect?: () => DOMRect) {
  const host = document.createElement('div');
  const stack = document.createElement('div');
  const canvas = document.createElement('canvas');
  host.append(stack, canvas);
  document.body.append(host);
  const onTextChanged = vi.fn();
  const onElementModified = vi.fn();
  const onElementsModified = vi.fn();
  const onSelectionChange = vi.fn();
  const adapter = new FabricCanvasAdapter(canvas, stack, {
    onSelectionChange, onElementModified, onElementsModified, onTextChanged,
    onGuidesChange: vi.fn(), onContextMenu: vi.fn(), onZoomChange: vi.fn(),
    onEmptyDoubleClick: vi.fn(), resolveAssetUrl, getViewportRect,
  });
  adapter.setDesignSize(size.width, size.height);
  adapter.setZoom(1);
  adapters.push(adapter);
  const doubleClick = () => host.querySelector('.upper-canvas')!.dispatchEvent(
    new MouseEvent('dblclick', { clientX: 30, clientY: 30, bubbles: true }),
  );
  return { adapter, host, stack, onTextChanged, onElementModified, onElementsModified, onSelectionChange, doubleClick };
}

function textElement(): DesignElement {
  return { ...createTextElement(size, []), x: 10, y: 10, width: 200, height: 100,
    type: 'text', text: 'مرحبا بالعالم', fontFamily: 'inter', fontSize: 24,
    fontWeight: 400, fill: '#000000', textAlign: 'right', direction: 'rtl' };
}

async function render() {
  await new Promise((resolve) => setTimeout(resolve, 40));
}

afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('Designer2 native text and layer stack', () => {
  const scene = (elements: DesignElement[]): DesignScene => ({
    id: 'scene', name: 'Scene', durationMs: 10000, background: { type: 'color', color: '#000' }, elements,
  });

  it.each(['IMAGE', 'VIDEO'] as const)('matches %s selection geometry to inserted media dimensions', async (type) => {
    const source = document.createElement('canvas');
    source.width = 1200;
    source.height = 600;
    vi.spyOn(FabricImage, 'fromURL').mockResolvedValue(new FabricImage(source));
    const element = createMediaElement(size, [], { asset: { id: 'media', name: 'Media', type } as Asset, width: 1200, height: 600 });
    const object = await factory.createFabricObject(element, () => 'https://example.test/media');
    expect(object.getScaledWidth()).toBeCloseTo(element.width);
    expect(object.getScaledHeight()).toBeCloseTo(element.height);
    if (object instanceof Group) {
      const image = object.getObjects()[0]!;
      expect(image.getScaledWidth()).toBeCloseTo(element.width);
      expect(image.getScaledHeight()).toBeCloseTo(element.height);
    }
    object.dispose();
  });

  it('calculates insertion bounds from the visible canvas at the current zoom and pan', () => {
    const { adapter, host } = setup(undefined, () => new DOMRect(0, 0, 400, 300));
    adapter.setZoom(2);
    vi.spyOn(host.querySelector('.lower-canvas')!, 'getBoundingClientRect').mockReturnValue(new DOMRect(-200, -100, 800, 600));
    expect(adapter.getInsertionBounds()).toEqual({ x: 100, y: 50, width: 200, height: 150 });
  });

  it('reconciles geometry, metadata and order without recreating objects or video', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const create = vi.spyOn(factory, 'createFabricObject');
    const { adapter, stack } = setup();
    const clear = vi.spyOn(adapter, 'clear');
    const text = textElement();
    const video = { ...createVideoPlaceholderElement(size, []), assetId: 'video', autoplay: false };
    await adapter.syncScene(scene([text, video]));
    const media = stack.querySelector('video')!;
    const overlay = stack.querySelector('div')!;
    media.currentTime = 12;
    adapter.setZoom(0.5);
    const calls = create.mock.calls.length;
    await adapter.syncScene(scene([{ ...text, x: 90, name: 'Renamed', zIndex: 50 }, video]));
    await render();
    expect(create).toHaveBeenCalledTimes(calls);
    expect(clear).not.toHaveBeenCalled();
    expect(stack.querySelector('video')).toBe(media);
    expect(stack.querySelector('div')).toBe(overlay);
    expect(media.currentTime).toBe(12);
    expect(Number(overlay.style.zIndex)).toBeGreaterThan(Number(media.style.zIndex));
    expect(stack.querySelector('video')!.style.transform).toContain('matrix(0.5');
  });

  it('disposes a delayed object when a newer scene supersedes its load', async () => {
    const { adapter, stack } = setup();
    let finish!: (object: Rect) => void;
    vi.spyOn(factory, 'createFabricObject').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const stale = new Rect({ width: 20, height: 20 });
    const dispose = vi.spyOn(stale, 'dispose');
    const pending = adapter.syncScene(scene([textElement()]));
    adapter.clear();
    await adapter.syncScene(scene([]));
    finish(stale);
    expect(await pending).toBe(false);
    expect(dispose).toHaveBeenCalledOnce();
    expect(stack.children).toHaveLength(0);
  });

  it('retains manual zoom across viewport resize but supports explicit fit', () => {
    const { adapter, host } = setup();
    adapter.setZoom(0.5);
    adapter.resizeViewport(800, 600);
    expect((host.querySelector('.lower-canvas') as HTMLCanvasElement).style.width).toBe('200px');
    adapter.fitToViewport(800, 600);
    expect((host.querySelector('.lower-canvas') as HTMLCanvasElement).style.width).toBe('800px');
    adapter.resizeViewport(400, 300);
    expect((host.querySelector('.lower-canvas') as HTMLCanvasElement).style.width).toBe('400px');
  });

  it('keeps text styling and repeated live size edits on the same object', async () => {
    const { adapter, stack } = setup();
    const create = vi.spyOn(factory, 'createFabricObject');
    const text = textElement();
    await adapter.syncScene(scene([text]));
    const object = await create.mock.results[0]!.value;
    const overlay = stack.querySelector('div');
    adapter.updateElement(text.id, { width: 400 });
    await adapter.syncScene(scene([{ ...text, width: 400 }]));
    adapter.updateElement(text.id, { width: 300 });
    await adapter.syncScene(scene([{ ...text, width: 300, type: 'text', fill: '#ff0000' } as DesignElement]));
    expect(object.width * object.scaleX).toBe(300);
    expect(create).toHaveBeenCalledTimes(1);
    expect(stack.querySelector('div')).toBe(overlay);
    expect(overlay!.style.color).toBe('rgb(255, 0, 0)');
  });

  it('releases pending resources on disposal without installing them', async () => {
    const { adapter, stack } = setup();
    let finish!: (object: Rect) => void;
    const create = vi.spyOn(factory, 'createFabricObject').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = adapter.syncScene(scene([textElement()]));
    const signal = create.mock.calls[0]![2]!;
    adapter.dispose();
    adapters.splice(adapters.indexOf(adapter), 1);
    expect(signal.aborted).toBe(true);
    const object = new Rect({ width: 20, height: 20 });
    const dispose = vi.spyOn(object, 'dispose');
    finish(object);
    expect(await pending).toBe(false);
    expect(dispose).toHaveBeenCalledOnce();
    expect(stack.children).toHaveLength(0);
  });

  it('refreshes only the media whose resolved resource changed', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    let url = 'https://example.test/first.mp4';
    const { adapter, stack } = setup((id) => id === 'first' ? url : 'https://example.test/second.mp4');
    const create = vi.spyOn(factory, 'createFabricObject');
    const first = { ...createVideoPlaceholderElement(size, []), assetId: 'first', autoplay: false };
    const second = { ...createVideoPlaceholderElement(size, []), assetId: 'second', autoplay: false };
    await adapter.syncScene(scene([first, second]));
    const original = Array.from(stack.querySelectorAll('video'));
    await adapter.syncScene(scene([first, second]));
    expect(create).toHaveBeenCalledTimes(2);
    url = 'https://example.test/refreshed.mp4';
    await adapter.syncScene(scene([first, second]));
    expect(create).toHaveBeenCalledTimes(3);
    expect(original[0]!.isConnected).toBe(false);
    expect(original[1]!.isConnected).toBe(true);
  });

  it('places shapes above text, reorders text above shapes, and hit-tests the front layer', async () => {
    const { adapter, stack, host, doubleClick } = setup();
    const text = textElement();
    const shape = { ...createShapeElement('rectangle', size, []), x: 10, y: 10 };
    await adapter.addElement(text);
    await adapter.addElement(shape);
    await render();
    const overlay = stack.querySelector('div')!;
    const painted = stack.querySelector('canvas')!;
    expect(Number(painted.style.zIndex)).toBeGreaterThan(Number(overlay.style.zIndex));
    doubleClick();
    expect(host.querySelector('textarea')).toBeNull();
    adapter.bringToFront(text.id);
    await render();
    expect(Number(overlay.style.zIndex)).toBeGreaterThan(Number(painted.style.zIndex));
    doubleClick();
    expect(host.querySelector('textarea')?.value).toBe('مرحبا بالعالم');
  });

  it('edits Arabic text inline and commits once on blur, while Escape cancels', async () => {
    const { adapter, host, stack, doubleClick, onTextChanged } = setup();
    const text = textElement();
    await adapter.addElement(text);
    await render();
    doubleClick();
    let editor = host.querySelector('textarea')!;
    expect(editor.dir).toBe('rtl');
    expect(document.activeElement).toBe(editor);
    editor.value = 'نص جديد\nسطر ثان';
    editor.blur();
    expect(onTextChanged).toHaveBeenCalledExactlyOnceWith(text.id, 'نص جديد\nسطر ثان');
    expect(host.querySelector('textarea')).toBeNull();
    expect(stack.querySelector('div')!.style.visibility).toBe('');
    doubleClick();
    editor = host.querySelector('textarea')!;
    editor.value = 'cancelled';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onTextChanged).toHaveBeenCalledTimes(1);
    expect(host.querySelector('textarea')).toBeNull();
  });

  it('interleaves videos with text and painted objects and cleans up removed layers', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const { adapter, stack } = setup();
    const text = textElement();
    const video = { ...createVideoPlaceholderElement(size, []), assetId: 'video', autoplay: false };
    const shape = createShapeElement('rectangle', size, []);
    await adapter.addElement(text);
    await adapter.addElement(video);
    await adapter.addElement(shape);
    await render();
    const overlay = stack.querySelector('div')!;
    const media = stack.querySelector('video')!;
    const painted = stack.querySelector('canvas')!;
    expect(Number(overlay.style.zIndex)).toBeLessThan(Number(media.style.zIndex));
    expect(Number(media.style.zIndex)).toBeLessThan(Number(painted.style.zIndex));
    adapter.sendToBack(video.id);
    await render();
    expect(Number(media.style.zIndex)).toBeLessThan(Number(overlay.style.zIndex));
    adapter.removeElement(shape.id);
    await render();
    expect(stack.querySelector('canvas')).toBeNull();
    adapter.clear();
    expect(stack.children).toHaveLength(0);
  });

  it('respects editing locks and cancels editing when the element is removed', async () => {
    const { adapter, host, doubleClick, onTextChanged } = setup();
    const text = textElement();
    await adapter.addElement({ ...text, editable: false });
    await render();
    doubleClick();
    expect(host.querySelector('textarea')).toBeNull();
    adapter.clear();
    await adapter.addElement(text);
    await render();
    doubleClick();
    host.querySelector('textarea')!.value = 'unsaved';
    adapter.removeElement(text.id);
    expect(host.querySelector('textarea')).toBeNull();
    expect(onTextChanged).not.toHaveBeenCalled();
  });
});

// M3 — the JSON x/y contract is the unrotated content box's top-left with rotation about that
// box's center (matches apps/player's DesignRenderer.tsx); Fabric's own left/top only agree with
// that at rotation 0. These exercise the boundary through the real adapter, not just the pure
// geometryContract helpers already covered by geometryContract.test.ts.
describe('Designer2 rotation/position contract (M3)', () => {
  const scene = (elements: DesignElement[]): DesignScene => ({
    id: 'scene', name: 'Scene', durationMs: 10000, background: { type: 'color', color: '#000' }, elements,
  });

  it('creates a rotated object at the declared unrotated box, not Fabric left/top === x/y', async () => {
    const { adapter } = setup();
    const create = vi.spyOn(factory, 'createFabricObject');
    const shape = { ...createShapeElement('rectangle', size, []), x: 40, y: 20, width: 200, height: 100, rotation: 30 };
    await adapter.syncScene(scene([shape]));
    const object = await create.mock.results[0]!.value;
    object.setCoords();
    expect(object.angle).toBe(30);
    // At 30°, Fabric's own left/top (the rotated position of the local origin corner) must NOT
    // equal the declared x/y — that was the exact bug (comment previously claimed "no conversion
    // needed"). The object's *center*, not its left/top, is what must match the declared box.
    expect(object.left).not.toBeCloseTo(shape.x, 3);
    expect(object.getCenterPoint().x).toBeCloseTo(shape.x + shape.width / 2, 6);
    expect(object.getCenterPoint().y).toBeCloseTo(shape.y + shape.height / 2, 6);
  });

  it.each([0.25, 1, 2, 3])('places and extracts rotated geometry identically regardless of canvas zoom (%sx)', async (zoom) => {
    // element x/y/width/height/rotation is a design-space (canvas/model) contract, independent of
    // the viewport zoom a particular editing session happens to be at — the same design must
    // produce the same JSON whether a user is zoomed in or out. geometryContract.ts's position
    // math never reads canvas.getZoom(); this exercises that invariant through the real adapter,
    // including whatever `zoom`-dependent CSS overlay math sits alongside it (applyOverlayGeometry
    // multiplies the DOM matrix by zoom for on-screen rendering — that must stay purely cosmetic
    // and never feed back into committed geometry).
    const { adapter, onElementModified } = setup();
    const create = vi.spyOn(factory, 'createFabricObject');
    const shape = { ...createShapeElement('rectangle', size, []), x: 40, y: 20, width: 200, height: 100, rotation: 45 };
    adapter.setZoom(zoom);
    await adapter.syncScene(scene([shape]));
    const object = await create.mock.results[0]!.value;
    expect(object.getCenterPoint().x).toBeCloseTo(shape.x + shape.width / 2, 6);
    expect(object.getCenterPoint().y).toBeCloseTo(shape.y + shape.height / 2, 6);

    object.set('angle', 60);
    applyElementPosition(object, shape);
    object.setCoords();
    object.canvas!.fire('object:modified', { target: object });

    const [, patch] = onElementModified.mock.calls[0]!;
    expect(patch.x).toBeCloseTo(shape.x, 3);
    expect(patch.y).toBeCloseTo(shape.y, 3);
    expect(patch.rotation).toBeCloseTo(60, 5);
  });

  it('extracts rotated geometry through object:modified back to the declared unrotated box', async () => {
    const { adapter, onElementModified } = setup();
    const create = vi.spyOn(factory, 'createFabricObject');
    const shape = { ...createShapeElement('rectangle', size, []), x: 40, y: 20, width: 200, height: 100, rotation: 0 };
    await adapter.syncScene(scene([shape]));
    const object = await create.mock.results[0]!.value;

    // Simulate a user rotating the object 30° via the on-canvas control and releasing (the
    // gesture Fabric fires `object:modified` for): Fabric's own centered-interactive-rotation
    // keeps the visual center fixed while spinning, which is exactly what applyElementPosition
    // reproduces for the same declared box.
    object.set('angle', 30);
    applyElementPosition(object, shape);
    object.setCoords();
    object.canvas!.fire('object:modified', { target: object });

    expect(onElementModified).toHaveBeenCalledTimes(1);
    const [id, patch] = onElementModified.mock.calls[0]!;
    expect(id).toBe(shape.id);
    expect(patch.rotation).toBe(30);
    // The reported x/y must stay the declared unrotated top-left's rotation-invariant center-based
    // position, not Fabric's raw (and now angle-shifted) left/top.
    expect(patch.x).toBeCloseTo(shape.x, 3);
    expect(patch.y).toBeCloseTo(shape.y, 3);
  });

  it('batches a rotated multi-select gesture into one onElementsModified call, not per-member commits', async () => {
    const { adapter, onElementModified, onElementsModified } = setup();
    const create = vi.spyOn(factory, 'createFabricObject');
    const shapeA = { ...createShapeElement('rectangle', size, []), x: 0, y: 0, width: 20, height: 20, rotation: 0 };
    const shapeB = { ...createShapeElement('rectangle', size, []), x: 40, y: 0, width: 20, height: 20, rotation: 0 };
    await adapter.syncScene(scene([shapeA, shapeB]));
    const objectA = await create.mock.results[0]!.value;
    adapter.selectElements([shapeA.id, shapeB.id]);
    const selection = objectA.canvas!.getActiveObject() as ActiveSelection;

    // Rotate the whole selection 90° around its own (bounding-box) center, the way dragging
    // Fabric's own rotate control would leave it, then fire the gesture-end event on it —
    // exactly what a real multi-select rotate does.
    selection.rotate(90);
    selection.setCoords();
    selection.canvas!.fire('object:modified', { target: selection });

    expect(onElementModified).not.toHaveBeenCalled();
    expect(onElementsModified).toHaveBeenCalledTimes(1);
    const updates = onElementsModified.mock.calls[0]![0] as { id: string; patch: ElementGeometryPatch }[];
    expect(updates).toHaveLength(2);
    const byId = new Map(updates.map((u) => [u.id, u.patch]));
    // Group bounding-box center is (30, 10) (a centered at (10,10), b at (50,10)). Rotating 90°
    // around that center swings a's center to (30,-10) and b's to (30,30) — independently
    // verified against Fabric's own getCoords() output before wiring this up.
    expect(byId.get(shapeA.id)!.rotation).toBeCloseTo(90, 5);
    expect(byId.get(shapeA.id)!.width).toBeCloseTo(20, 5);
    expect(byId.get(shapeA.id)!.height).toBeCloseTo(20, 5);
    expect(byId.get(shapeA.id)!.x).toBeCloseTo(20, 3);
    expect(byId.get(shapeA.id)!.y).toBeCloseTo(-20, 3);
    expect(byId.get(shapeB.id)!.rotation).toBeCloseTo(90, 5);
    expect(byId.get(shapeB.id)!.x).toBeCloseTo(20, 3);
    expect(byId.get(shapeB.id)!.y).toBeCloseTo(20, 3);
  });

  it('folds a corner-scaled text object\'s scale into fontSize instead of leaving scaleX/Y non-1', async () => {
    const { adapter, onElementModified } = setup();
    const create = vi.spyOn(factory, 'createFabricObject');
    const text = { ...textElement(), x: 10, y: 10, width: 200, fontSize: 20, rotation: 0 };
    await adapter.syncScene(scene([text]));
    const object = await create.mock.results[0]!.value;
    const widthBefore = object.width;

    // Simulate Fabric's own `scalingEqually` corner-drag action (Textbox's tl/tr/bl/br
    // controls) — it always keeps scaleX === scaleY for a Textbox.
    object.set({ scaleX: 1.5, scaleY: 1.5 });
    object.setCoords();
    object.canvas!.fire('object:modified', { target: object });

    expect(onElementModified).toHaveBeenCalledTimes(1);
    const [, patch] = onElementModified.mock.calls[0]!;
    // Nothing here persists scaleX/scaleY (DesignElement has no such field) — the live object
    // itself must carry the change as fontSize/width instead, or it reverts on the next recreate.
    expect(object.scaleX).toBe(1);
    expect(object.scaleY).toBe(1);
    expect(object.fontSize).toBeCloseTo(30, 5);
    expect(object.width).toBeCloseTo(widthBefore * 1.5, 5);
    // The committed width must match what's now actually rendered (base width × 1, since scale
    // was folded away), not a stale pre-fold value.
    expect(patch.width).toBeCloseTo(widthBefore * 1.5, 3);
  });
});

// M4 — selection reporting must reflect the full current canvas selection, not Fabric's raw
// event delta.
describe('Designer2 selection reporting (M4)', () => {
  const scene = (elements: DesignElement[]): DesignScene => ({
    id: 'scene', name: 'Scene', durationMs: 10000, background: { type: 'color', color: '#000' }, elements,
  });

  it('reports the full multi-select, not just the newly shift-clicked object', async () => {
    const { adapter, onSelectionChange } = setup();
    const create = vi.spyOn(factory, 'createFabricObject');
    const shapeA = createShapeElement('rectangle', size, []);
    const shapeB = createShapeElement('rectangle', size, []);
    await adapter.syncScene(scene([shapeA, shapeB]));
    const objectA = await create.mock.results[0]!.value;
    const objectB = await create.mock.results[1]!.value;
    const canvas = objectA.canvas!;

    canvas.setActiveObject(objectA);
    onSelectionChange.mockClear();

    // Fabric's own shift-click-to-add-to-selection path: replacing the active object with a new
    // ActiveSelection containing the previously-selected object plus the newly clicked one. This
    // is exactly the scenario where Fabric's `selection:updated` event payload's own `e.selected`
    // contains only the newly added object (verified empirically against the installed Fabric
    // 7.4.0), not the full selection — the bug the audit flagged.
    const selection = new ActiveSelection([objectA, objectB], { canvas });
    canvas.setActiveObject(selection);

    expect(onSelectionChange).toHaveBeenCalled();
    const reported = onSelectionChange.mock.calls.at(-1)![0] as string[];
    expect(new Set(reported)).toEqual(new Set([shapeA.id, shapeB.id]));
  });

  it.each([
    ['hidden', { visible: false }],
    ['locked/non-selectable', { selectable: false }],
  ])('does not make a %s element the canvas active object, but still resolves a mixed selection to the rest', async (_label, override) => {
    const { adapter } = setup();
    const create = vi.spyOn(factory, 'createFabricObject');
    const hidden = { ...createShapeElement('rectangle', size, []), ...override };
    const visible = createShapeElement('rectangle', size, []);
    await adapter.syncScene(scene([hidden, visible]));
    const hiddenObject = await create.mock.results[0]!.value;
    const visibleObject = await create.mock.results[1]!.value;
    const canvas = hiddenObject.canvas!;

    adapter.selectElements([hidden.id]);
    expect(canvas.getActiveObjects()).toHaveLength(0);

    adapter.selectElements([hidden.id, visible.id]);
    expect(canvas.getActiveObjects()).toEqual([visibleObject]);
  });
});
