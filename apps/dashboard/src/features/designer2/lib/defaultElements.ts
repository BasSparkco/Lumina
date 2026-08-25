import type { DesignElement, ShapeKindSchema } from '@lumina/design-schema';
import type { z } from 'zod';
import { nextLayerZIndex } from '@/lib/layers';

type ShapeKind = z.infer<typeof ShapeKindSchema>;

function centeredBox(canvas: { width: number; height: number }, width: number, height: number) {
  return { x: (canvas.width - width) / 2, y: (canvas.height - height) / 2, width, height };
}

function baseFields(canvas: { width: number; height: number }, elements: DesignElement[], width: number, height: number) {
  return {
    id: `el_${crypto.randomUUID()}`,
    ...centeredBox(canvas, width, height),
    rotation: 0,
    opacity: 1,
    visible: true,
    selectable: true,
    movable: true,
    resizable: true,
    deletable: true,
    editable: true,
    zIndex: nextLayerZIndex(elements),
  };
}

export function createTextElement(canvas: { width: number; height: number }, elements: DesignElement[]): DesignElement {
  return {
    ...baseFields(canvas, elements, 600, 120),
    name: 'Text',
    type: 'text',
    text: 'Text',
    fontFamily: 'inter',
    fontSize: 64,
    fontWeight: 600,
    fill: '#ffffff',
    textAlign: 'left',
    direction: 'ltr',
  };
}

const SHAPE_DEFAULT_SIZE: Record<ShapeKind, { width: number; height: number }> = {
  rectangle: { width: 320, height: 200 },
  'rounded-rectangle': { width: 320, height: 200 },
  circle: { width: 240, height: 240 },
  ellipse: { width: 320, height: 200 },
  triangle: { width: 280, height: 240 },
  line: { width: 320, height: 0 },
};

export function createShapeElement(
  shape: ShapeKind,
  canvas: { width: number; height: number },
  elements: DesignElement[],
): DesignElement {
  const { width, height } = SHAPE_DEFAULT_SIZE[shape];
  return {
    ...baseFields(canvas, elements, width, height),
    name: shape.replace('-', ' '),
    type: 'shape',
    shape,
    fill: shape === 'line' ? undefined : '#6366f1',
    stroke: shape === 'line' ? '#6366f1' : undefined,
    strokeWidth: shape === 'line' ? 4 : undefined,
    radius: shape === 'rounded-rectangle' ? 16 : undefined,
  };
}

export function createImagePlaceholderElement(
  canvas: { width: number; height: number },
  elements: DesignElement[],
): DesignElement {
  return {
    ...baseFields(canvas, elements, 400, 300),
    name: 'Image',
    type: 'image',
    fit: 'contain',
  };
}

export function createQrPlaceholderElement(
  canvas: { width: number; height: number },
  elements: DesignElement[],
): DesignElement {
  return {
    ...baseFields(canvas, elements, 240, 240),
    name: 'QR Code',
    type: 'qr',
    foregroundColor: '#000000',
    backgroundColor: '#ffffff',
    errorCorrection: 'M',
  };
}
