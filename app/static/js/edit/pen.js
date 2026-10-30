import { drawPenStroke } from './pen-brushes.js?v=1';

const MAX_STROKES = 200;
const MAX_STROKE_POINTS = 5000;
const MAX_DRAWING_POINTS = 30000;

export function createPenTool(elements, preview, applyOperation, onChange) {
  const presets = JSON.parse(elements.penBrushPresets.textContent);
  const overlay = document.createElement('canvas');
  overlay.className = 'pen-preview-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.hidden = true;
  let strokes = [];
  let current = null;
  let pointerId = null;
  let active = false;
  let busy = false;
  let sourceFile = null;
  let frame = null;

  function readStyle(report = false) {
    const width = Number(elements.penWidth.value);
    const opacity = Number(elements.penOpacity.value);
    if (!elements.penWidth.value.trim() || !Number.isFinite(width) || width < 0.1 || width > 100) {
      if (report) alert('Enter a pen width between 0.1 and 100 pt.');
      return null;
    }
    if (!elements.penOpacity.value.trim() || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      if (report) alert('Enter a pen alpha between 0 and 1.');
      return null;
    }
    return { color: elements.penColor.value, width, opacity, texture: elements.penTexture.value };
  }

  function updateControls() {
    elements.applyPenDrawing.disabled = busy || current !== null || strokes.length === 0;
    elements.undoPenStroke.disabled = busy || current !== null || strokes.length === 0;
    elements.clearPenDrawing.disabled = busy || current !== null || strokes.length === 0;
    const pages = new Set(strokes.map(stroke => stroke.page)).size;
    elements.penStatus.textContent = strokes.length
      ? `${strokes.length} pending stroke(s) on ${pages} page(s). Apply drawing to save them to the PDF.`
      : 'Select Pen, then draw on the PDF preview.';
    onChange();
  }

  function render() {
    frame = null;
    const geometry = preview.getPageGeometry();
    if (!geometry) {
      overlay.hidden = true;
      return;
    }
    const rect = elements.pdfCanvas.getBoundingClientRect();
    const box = elements.pdfPreviewBox;
    const boxRect = box.getBoundingClientRect();
    overlay.style.left = `${rect.left - boxRect.left - box.clientLeft + box.scrollLeft}px`;
    overlay.style.top = `${rect.top - boxRect.top - box.clientTop + box.scrollTop}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    if (overlay.width !== elements.pdfCanvas.width || overlay.height !== elements.pdfCanvas.height) {
      overlay.width = elements.pdfCanvas.width;
      overlay.height = elements.pdfCanvas.height;
    }
    const context = overlay.getContext('2d');
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, overlay.width, overlay.height);
    const visible = strokes.filter(stroke => stroke.page === geometry.page);
    if (current?.page === geometry.page) visible.push(current);
    overlay.hidden = visible.length === 0;
    context.setTransform(overlay.width / geometry.width, 0, 0, -overlay.height / geometry.height, 0, overlay.height);
    visible.forEach(stroke => drawPenStroke(context, stroke, presets));
  }

  function scheduleRender() {
    if (frame === null) frame = requestAnimationFrame(render);
  }

  function drawSample() {
    const canvas = elements.penBrushSample;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    const style = readStyle();
    if (!style) return;
    const points = Array.from({ length: 100 }, (_, index) => [12 + index * 2.75, 48 + Math.sin(index / 12) * 15]);
    drawPenStroke(context, { ...style, points }, presets);
  }

  function releasePointer() {
    try { elements.pdfCanvas.releasePointerCapture(pointerId); } catch { /* Capture may already be released. */ }
    pointerId = null;
  }

  function finishStroke() {
    if (!current) return;
    strokes.push(current);
    current = null;
    releasePointer();
    updateControls();
    scheduleRender();
  }

  function cancelStroke() {
    current = null;
    releasePointer();
    updateControls();
    scheduleRender();
  }

  function addPoint(event, force = false) {
    const coordinate = preview.getPointerCoordinate(event, true);
    if (!coordinate || !current || coordinate.page !== current.page) return;
    const point = roundedPoint(coordinate);
    const last = current.points[current.points.length - 1];
    const distance = Math.hypot(point[0] - last[0], point[1] - last[1]);
    if (distance === 0 || (!force && distance < Math.max(0.2, current.width * 0.05))) return;
    const total = strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
    if (current.points.length >= MAX_STROKE_POINTS || total + current.points.length >= MAX_DRAWING_POINTS) {
      finishStroke();
      elements.penStatus.textContent = 'Apply this drawing before adding more strokes.';
      return;
    }
    current.points.push(point);
  }

  function roundedPoint(coordinate) {
    const geometry = preview.getPageGeometry();
    return [
      Math.min(Number(coordinate.x.toFixed(2)), geometry.width),
      Math.min(Number(coordinate.y.toFixed(2)), geometry.height)
    ];
  }

  function capture(event) {
    if (!active) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }

  function pointerDown(event) {
    if (!capture(event) || busy || current || event.button !== 0 || event.isPrimary === false) return;
    const coordinate = preview.getPointerCoordinate(event);
    const style = readStyle(true);
    if (!coordinate || !style) return;
    const total = strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
    if (strokes.length >= MAX_STROKES || total >= MAX_DRAWING_POINTS) {
      alert('Apply this drawing before adding more strokes.');
      return;
    }
    current = { ...style, page: coordinate.page, points: [roundedPoint(coordinate)] };
    pointerId = event.pointerId;
    try { elements.pdfCanvas.setPointerCapture(pointerId); } catch { /* Pointer capture is optional. */ }
    updateControls();
    scheduleRender();
  }

  function pointerMove(event) {
    if (!capture(event) || busy || !current || event.pointerId !== pointerId) return;
    const events = event.getCoalescedEvents?.() || [];
    [...events, event].forEach(point => addPoint(point));
    scheduleRender();
  }

  function pointerUp(event) {
    if (!capture(event) || !current || event.pointerId !== pointerId) return;
    addPoint(event, true);
    finishStroke();
  }

  function undoStroke() {
    if (busy || current) return;
    strokes.pop();
    updateControls();
    scheduleRender();
  }

  function clear() {
    if (busy) return;
    strokes = [];
    current = null;
    releasePointer();
    updateControls();
    render();
  }

  async function apply() {
    if (busy || current || strokes.length === 0) return false;
    return applyOperation({ type: 'overlay_drawing', strokes }, [], elements.applyPenDrawing);
  }

  function bindEvents() {
    elements.pdfPreviewBox.appendChild(overlay);
    const canvas = elements.pdfCanvas;
    canvas.addEventListener('pointerdown', pointerDown, true);
    canvas.addEventListener('pointermove', pointerMove, true);
    canvas.addEventListener('pointerup', pointerUp, true);
    canvas.addEventListener('click', capture, true);
    canvas.addEventListener('pointercancel', event => {
      if (capture(event) && event.pointerId === pointerId) cancelStroke();
    }, true);
    canvas.addEventListener('lostpointercapture', event => {
      if (current && event.pointerId === pointerId) cancelStroke();
    });
    for (const input of [elements.penColor, elements.penWidth, elements.penOpacity, elements.penTexture]) {
      input.addEventListener('input', drawSample);
      input.addEventListener('change', drawSample);
    }
    elements.undoPenStroke.addEventListener('click', undoStroke);
    elements.clearPenDrawing.addEventListener('click', clear);
    elements.applyPenDrawing.addEventListener('click', () => { void apply(); });
    preview.onRender(() => {
      if (sourceFile !== preview.getTargetPdfFile()) {
        sourceFile = preview.getTargetPdfFile();
        strokes = [];
        current = null;
        releasePointer();
        updateControls();
      }
      render();
    });
    new ResizeObserver(scheduleRender).observe(elements.pdfPreviewBox);
    drawSample();
    updateControls();
  }

  return {
    bindEvents, apply, undoStroke,
    hasStrokes: () => strokes.length > 0 || current !== null,
    setBusy(value) { busy = value; updateControls(); },
    setActive(value) {
      if (!value && current) finishStroke();
      active = value;
      elements.pdfCanvas.classList.toggle('is-pen-mode', value);
      scheduleRender();
    }
  };
}
