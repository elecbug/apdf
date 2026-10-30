export function createShapeTool(elements, preview, applyOperation) {
  function updateCoordinate(coordinate) {
    elements.shapeOverlayPage.value = String(coordinate.page);
    elements.shapeOverlayX.value = coordinate.x.toFixed(1);
    elements.shapeOverlayY.value = coordinate.y.toFixed(1);
    elements.shapeOverlayCoordinateHint.textContent = `Selected page ${coordinate.page}: x ${coordinate.x.toFixed(1)} pt, y ${coordinate.y.toFixed(1)} pt.`;
    elements.shapeOverlayCoordinateHint.classList.add('selected');
  }

  function updateRegion(region) {
    if (!region || region.width <= 0 || region.height <= 0) {
      return;
    }
    updateCoordinate(region);
    elements.shapeOverlayWidth.value = region.width.toFixed(1);
    elements.shapeOverlayHeight.value = region.height.toFixed(1);
    elements.shapeOverlayCoordinateHint.textContent = `Selected shape box on page ${region.page}: x ${region.x.toFixed(1)} pt, y ${region.y.toFixed(1)} pt, width ${region.width.toFixed(1)} pt, height ${region.height.toFixed(1)} pt.`;
  }

  function syncPaintInputs() {
    elements.shapeOverlayFillColor.disabled = elements.shapeOverlayFillTransparent.checked;
    elements.shapeOverlayFillOpacity.disabled = elements.shapeOverlayFillTransparent.checked;
    elements.shapeOverlayStrokeColor.disabled = elements.shapeOverlayStrokeTransparent.checked;
    elements.shapeOverlayStrokeOpacity.disabled = elements.shapeOverlayStrokeTransparent.checked;
    elements.shapeOverlayStrokeWidth.disabled = elements.shapeOverlayStrokeTransparent.checked;
  }

  function number(input, label, positive = false, max = Infinity) {
    const value = Number(input.value);
    if (!input.value.trim() || !Number.isFinite(value) || value < 0 || (positive && value === 0) || value > max) {
      input.focus();
      throw new Error(`Enter a valid ${label}.`);
    }
    return value;
  }

  async function addShape() {
    if (!preview.requireTargetPdf()) {
      return;
    }
    const page = preview.parsePageInput(elements.shapeOverlayPage);
    if (page === null) {
      alert('Enter a valid page number.');
      return;
    }

    const x = number(elements.shapeOverlayX, 'X coordinate');
    const y = number(elements.shapeOverlayY, 'Y coordinate');
    const width = number(elements.shapeOverlayWidth, 'shape width', true);
    const height = number(elements.shapeOverlayHeight, 'shape height', true);
    const fillTransparent = elements.shapeOverlayFillTransparent.checked;
    const strokeTransparent = elements.shapeOverlayStrokeTransparent.checked;
    const fillOpacity = fillTransparent ? 0 : number(elements.shapeOverlayFillOpacity, 'fill alpha between 0 and 1', false, 1);
    const strokeOpacity = strokeTransparent ? 0 : number(elements.shapeOverlayStrokeOpacity, 'border alpha between 0 and 1', false, 1);
    const strokeWidth = strokeTransparent ? 0 : number(elements.shapeOverlayStrokeWidth, 'border width');
    if (strokeOpacity > 0 && strokeWidth >= Math.min(width, height)) {
      alert('Border width must be smaller than the shape width and height.');
      return;
    }

    await applyOperation({
      type: 'overlay_shape',
      shape: elements.shapeOverlayType.value,
      page, x, y, width, height,
      fill_color: fillTransparent ? null : elements.shapeOverlayFillColor.value,
      fill_opacity: fillOpacity,
      stroke_color: strokeTransparent ? null : elements.shapeOverlayStrokeColor.value,
      stroke_opacity: strokeOpacity,
      stroke_width: strokeWidth
    }, [], elements.addShapeOverlayOp);
  }

  function bindEvents() {
    elements.shapeOverlayFillTransparent.addEventListener('change', syncPaintInputs);
    elements.shapeOverlayStrokeTransparent.addEventListener('change', syncPaintInputs);
    elements.addShapeOverlayOp.addEventListener('click', () => {
      void addShape().catch(error => alert(error.message));
    });
    syncPaintInputs();
  }

  return { bindEvents, updateCoordinate, updateRegion };
}
