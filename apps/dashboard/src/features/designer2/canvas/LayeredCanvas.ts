import { Canvas, type FabricObject } from 'fabric';

// Keep Fabric's hit testing and controls, but interleave its painted objects with native
// browser text/video in one DOM stack. Adjacent painted objects share a canvas surface.
export class LayeredCanvas extends Canvas {
  renderLayers?: (ctx: CanvasRenderingContext2D, objects: FabricObject[]) => void;

  override _renderObjects(ctx: CanvasRenderingContext2D, objects: FabricObject[]): void {
    if (this.renderLayers && ctx === this.contextContainer) this.renderLayers(ctx, objects);
    else super._renderObjects(ctx, objects);
  }
}
