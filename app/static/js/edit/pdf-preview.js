let pdfjsLib = null;

const DEFAULT_ZOOM = '1.4';
const FIT_WIDTH_ZOOM = 'fit-width';
const ZOOM_STORAGE_KEY = 'apdf_edit_preview_zoom';
const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.4, 1.5, 2, 2.5, 3];
const MIN_ZOOM = ZOOM_LEVELS[0];
const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];

async function ensurePdfJs() {
  if (pdfjsLib) {
    return pdfjsLib;
  }

  pdfjsLib = await import('/static/pdfjs/pdf.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/static/pdfjs/pdf.worker.mjs';

  return pdfjsLib;
}

function loadSavedZoom() {
  try {
    return normalizeZoomValue(localStorage.getItem(ZOOM_STORAGE_KEY));
  } catch {
    return DEFAULT_ZOOM;
  }
}

function saveZoom(value) {
  try {
    localStorage.setItem(ZOOM_STORAGE_KEY, value);
  } catch {
    // localStorage can be unavailable in some browser privacy modes.
  }
}

function normalizeZoomValue(value) {
  if (value === FIT_WIDTH_ZOOM) {
    return FIT_WIDTH_ZOOM;
  }

  const scale = Number.parseFloat(value);

  if (!Number.isFinite(scale)) {
    return DEFAULT_ZOOM;
  }

  const clamped = Math.min(Math.max(scale, MIN_ZOOM), MAX_ZOOM);

  return String(clamped);
}

function formatZoomOptionValue(scale) {
  return String(scale);
}

function getNearestZoomLevel(scale, direction) {
  if (direction > 0) {
    return ZOOM_LEVELS.find((level) => level > scale + 0.001) || MAX_ZOOM;
  }

  return [...ZOOM_LEVELS].reverse().find((level) => level < scale - 0.001) || MIN_ZOOM;
}

function getPreviewBoxHorizontalPadding(previewBox) {
  const style = window.getComputedStyle(previewBox);
  const left = Number.parseFloat(style.paddingLeft) || 0;
  const right = Number.parseFloat(style.paddingRight) || 0;

  return left + right;
}

function formatCoordinateNumber(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '-';
}

function formatCoordinateLine(coordinate, label) {
  return `${label}: page ${coordinate.page}, x ${formatCoordinateNumber(coordinate.x)} pt, y ${formatCoordinateNumber(coordinate.y)} pt · origin: bottom-left`;
}

export function createPdfPreview(elements, setEditStatus) {
  let targetPdfFile = null;
  let targetPdfDocument = null;
  let currentPageNumber = 1;
  let zoomValue = loadSavedZoom();
  let lastRenderScale = Number.parseFloat(DEFAULT_ZOOM);
  let currentViewport = null;
  let coordinateLocked = false;
  let lastCoordinate = null;
  let dragState = null;
  let selectionBox = null;
  let suppressNextClick = false;
  const coordinateClickHandlers = [];
  const coordinateDragHandlers = [];

  syncZoomControl();
  bindCoordinateEvents();
  resetCoordinateLine('Coordinates: load a PDF to inspect page coordinates.');

  async function loadPdfFromFile(file, options = {}) {
    const data = await file.arrayBuffer();
    const pdfjs = await ensurePdfJs();

    targetPdfDocument = await pdfjs.getDocument({
      data
    }).promise;

    targetPdfFile = file;
    currentPageNumber = resolveInitialPageNumber(options.pageNumber);

    elements.previewPageInput.value = String(currentPageNumber);
    elements.previewPageInput.max = String(targetPdfDocument.numPages);
    elements.previewPageCount.textContent = `/ ${targetPdfDocument.numPages}`;

    elements.previewInfo.textContent = `${file.name} · ${targetPdfDocument.numPages} pages`;
    setEditStatus(`Loaded: ${file.name}`);

    await renderCurrentPage();
  }

  function resolveInitialPageNumber(pageNumber) {
    if (!targetPdfDocument) {
      return 1;
    }

    const requestedPage = Number.parseInt(pageNumber, 10);

    if (!Number.isFinite(requestedPage)) {
      return 1;
    }

    return Math.min(Math.max(requestedPage, 1), targetPdfDocument.numPages);
  }

  async function renderCurrentPage() {
    if (!targetPdfDocument) {
      return;
    }

    const page = await targetPdfDocument.getPage(currentPageNumber);
    const renderScale = resolveRenderScale(page);
    const viewport = page.getViewport({ scale: renderScale });

    lastRenderScale = renderScale;
    currentViewport = viewport;

    const context = elements.pdfCanvas.getContext('2d');
    elements.pdfCanvas.width = Math.floor(viewport.width);
    elements.pdfCanvas.height = Math.floor(viewport.height);

    elements.pdfCanvas.style.display = 'block';

    const emptyBox = elements.pdfPreviewBox.querySelector('.empty-box');
    if (emptyBox) {
      emptyBox.style.display = 'none';
    }

    await page.render({
      canvasContext: context,
      viewport
    }).promise;

    elements.previewPageInput.value = String(currentPageNumber);
    resetCoordinateLine('Coordinates: move pointer over the PDF to inspect page coordinates.');
  }

  function resetCoordinateLine(message) {
    coordinateLocked = false;
    lastCoordinate = null;

    if (!elements.previewCoordinateLine) {
      return;
    }

    elements.previewCoordinateLine.textContent = message;
    elements.previewCoordinateLine.classList.remove('locked');
  }

  function setCoordinateLine(coordinate, label, locked = false) {
    if (!elements.previewCoordinateLine) {
      return;
    }

    elements.previewCoordinateLine.textContent = formatCoordinateLine(coordinate, label);
    elements.previewCoordinateLine.classList.toggle('locked', locked);
  }

  function pointerStateFromEvent(event) {
    if (!currentViewport || !targetPdfDocument) {
      return null;
    }

    const canvas = elements.pdfCanvas;
    const rect = canvas.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
      return null;
    }

    const displayX = event.clientX - rect.left;
    const displayY = event.clientY - rect.top;

    if (displayX < 0 || displayY < 0 || displayX > rect.width || displayY > rect.height) {
      return null;
    }

    const canvasX = displayX * (canvas.width / rect.width);
    const canvasY = displayY * (canvas.height / rect.height);
    const [pdfX, pdfY] = currentViewport.convertToPdfPoint(canvasX, canvasY);

    return {
      coordinate: {
        page: currentPageNumber,
        x: pdfX,
        y: pdfY,
        pageWidth: currentViewport.viewBox[2] - currentViewport.viewBox[0],
        pageHeight: currentViewport.viewBox[3] - currentViewport.viewBox[1]
      },
      displayPoint: {
        x: displayX,
        y: displayY
      }
    };
  }

  function coordinateFromPointerEvent(event) {
    return pointerStateFromEvent(event)?.coordinate || null;
  }

  function handlePointerMove(event) {
    if (coordinateLocked) {
      return;
    }

    const coordinate = coordinateFromPointerEvent(event);

    if (!coordinate) {
      return;
    }

    lastCoordinate = coordinate;
    setCoordinateLine(coordinate, 'Pointer');
  }

  function handlePointerClick(event) {
    if (suppressNextClick) {
      suppressNextClick = false;
      event.preventDefault();
      return;
    }

    const coordinate = coordinateFromPointerEvent(event);

    if (!coordinate) {
      return;
    }

    coordinateLocked = true;
    lastCoordinate = coordinate;
    setCoordinateLine(coordinate, 'Pinned', true);
    notifyCoordinateClick(coordinate);
  }

  function notifyCoordinateClick(coordinate) {
    coordinateClickHandlers.forEach((handler) => {
      try {
        handler({...coordinate});
      } catch (error) {
        console.error(error);
      }
    });
  }

  function onCoordinateClick(handler) {
    if (typeof handler !== 'function') {
      return () => {};
    }

    coordinateClickHandlers.push(handler);

    return () => {
      const index = coordinateClickHandlers.indexOf(handler);
      if (index >= 0) {
        coordinateClickHandlers.splice(index, 1);
      }
    };
  }

  function notifyCoordinateDrag(selection) {
    coordinateDragHandlers.forEach((handler) => {
      try {
        handler({
          page: selection.page,
          start: {...selection.start},
          end: {...selection.end}
        });
      } catch (error) {
        console.error(error);
      }
    });
  }

  function onCoordinateDrag(handler) {
    if (typeof handler !== 'function') {
      return () => {};
    }

    coordinateDragHandlers.push(handler);

    return () => {
      const index = coordinateDragHandlers.indexOf(handler);
      if (index >= 0) {
        coordinateDragHandlers.splice(index, 1);
      }
    };
  }

  function ensureSelectionBox() {
    if (selectionBox) {
      return selectionBox;
    }

    selectionBox = document.createElement('div');
    selectionBox.className = 'pdf-drag-selection-box';
    selectionBox.hidden = true;
    elements.pdfPreviewBox.appendChild(selectionBox);

    return selectionBox;
  }

  function hideSelectionBox() {
    if (selectionBox) {
      selectionBox.hidden = true;
    }

    elements.pdfPreviewBox.classList.remove('is-selecting-region');
  }

  function updateSelectionBox(startDisplayPoint, endDisplayPoint) {
    const box = ensureSelectionBox();
    const canvas = elements.pdfCanvas;
    const left = canvas.offsetLeft + Math.min(startDisplayPoint.x, endDisplayPoint.x);
    const top = canvas.offsetTop + Math.min(startDisplayPoint.y, endDisplayPoint.y);
    const width = Math.abs(endDisplayPoint.x - startDisplayPoint.x);
    const height = Math.abs(endDisplayPoint.y - startDisplayPoint.y);

    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
    box.hidden = false;
    elements.pdfPreviewBox.classList.add('is-selecting-region');
  }

  function clearDragState() {
    if (dragState && elements.pdfCanvas.releasePointerCapture) {
      try {
        elements.pdfCanvas.releasePointerCapture(dragState.pointerId);
      } catch {
        // The pointer may already have been released by the browser.
      }
    }

    dragState = null;
    hideSelectionBox();
  }

  function handlePointerDown(event) {
    if (event.button !== 0) {
      return;
    }

    const state = pointerStateFromEvent(event);

    if (!state) {
      return;
    }

    dragState = {
      pointerId: event.pointerId,
      startCoordinate: state.coordinate,
      startDisplayPoint: state.displayPoint,
      lastCoordinate: state.coordinate,
      lastDisplayPoint: state.displayPoint,
      dragging: false
    };

    if (elements.pdfCanvas.setPointerCapture) {
      try {
        elements.pdfCanvas.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is a convenience, not a hard requirement.
      }
    }
  }

  function handlePointerDragMove(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const state = pointerStateFromEvent(event);

    if (!state || state.coordinate.page !== dragState.startCoordinate.page) {
      return;
    }

    dragState.lastCoordinate = state.coordinate;
    dragState.lastDisplayPoint = state.displayPoint;

    const dx = state.displayPoint.x - dragState.startDisplayPoint.x;
    const dy = state.displayPoint.y - dragState.startDisplayPoint.y;
    const distance = Math.hypot(dx, dy);

    if (!dragState.dragging && distance < 4) {
      return;
    }

    dragState.dragging = true;
    coordinateLocked = false;
    lastCoordinate = state.coordinate;
    setCoordinateLine(state.coordinate, 'Drag');
    updateSelectionBox(dragState.startDisplayPoint, state.displayPoint);
    event.preventDefault();
  }

  function handlePointerUp(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const state = pointerStateFromEvent(event);
    const wasDragging = dragState.dragging;
    const startCoordinate = dragState.startCoordinate;
    const endCoordinate = state?.coordinate || dragState.lastCoordinate;

    clearDragState();

    if (!wasDragging || !endCoordinate || endCoordinate.page !== startCoordinate.page) {
      return;
    }

    suppressNextClick = true;
    coordinateLocked = true;
    lastCoordinate = endCoordinate;
    setCoordinateLine(endCoordinate, 'Drag end', true);
    notifyCoordinateDrag({
      page: startCoordinate.page,
      start: startCoordinate,
      end: endCoordinate
    });
    event.preventDefault();
  }

  function handlePointerCancel(event) {
    if (dragState && dragState.pointerId === event.pointerId) {
      clearDragState();
    }
  }

  function handlePointerLeave() {
    if (dragState) {
      return;
    }

    if (coordinateLocked && lastCoordinate) {
      coordinateLocked = false;
      setCoordinateLine(lastCoordinate, 'Last');
      return;
    }

    if (targetPdfDocument) {
      resetCoordinateLine('Coordinates: move pointer over the PDF to inspect page coordinates.');
    } else {
      resetCoordinateLine('Coordinates: load a PDF to inspect page coordinates.');
    }
  }

  function bindCoordinateEvents() {
    if (!elements.pdfCanvas) {
      return;
    }

    elements.pdfCanvas.addEventListener('pointerdown', handlePointerDown);
    elements.pdfCanvas.addEventListener('pointermove', handlePointerMove);
    elements.pdfCanvas.addEventListener('pointermove', handlePointerDragMove);
    elements.pdfCanvas.addEventListener('pointerup', handlePointerUp);
    elements.pdfCanvas.addEventListener('pointercancel', handlePointerCancel);
    elements.pdfCanvas.addEventListener('click', handlePointerClick);
    elements.pdfCanvas.addEventListener('pointerleave', handlePointerLeave);
  }

  function resolveRenderScale(page) {
    if (zoomValue !== FIT_WIDTH_ZOOM) {
      return Number.parseFloat(zoomValue) || Number.parseFloat(DEFAULT_ZOOM);
    }

    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(
      elements.pdfPreviewBox.clientWidth - getPreviewBoxHorizontalPadding(elements.pdfPreviewBox),
      1
    );

    return Math.min(Math.max(availableWidth / baseViewport.width, MIN_ZOOM), MAX_ZOOM);
  }

  function syncZoomControl() {
    if (!elements.previewZoomSelect) {
      return;
    }

    elements.previewZoomSelect.value = zoomValue;

    if (elements.previewZoomSelect.value !== zoomValue) {
      elements.previewZoomSelect.value = DEFAULT_ZOOM;
      zoomValue = DEFAULT_ZOOM;
    }
  }

  function clampPageNumber(pageNumber) {
    if (!targetPdfDocument) {
      return 1;
    }

    return Math.min(Math.max(pageNumber, 1), targetPdfDocument.numPages);
  }

  function parsePageInput(inputElement) {
    const value = Number.parseInt(inputElement.value, 10);

    if (!Number.isFinite(value) || value < 1) {
      return null;
    }

    if (targetPdfDocument && value > targetPdfDocument.numPages) {
      return targetPdfDocument.numPages;
    }

    return value;
  }

  function requireTargetPdf() {
    if (!targetPdfFile || !targetPdfDocument) {
      alert('Choose a PDF first.');
      return false;
    }

    return true;
  }

  async function previousPage() {
    if (!targetPdfDocument) {
      return;
    }

    currentPageNumber = clampPageNumber(currentPageNumber - 1);
    await renderCurrentPage();
  }

  async function nextPage() {
    if (!targetPdfDocument) {
      return;
    }

    currentPageNumber = clampPageNumber(currentPageNumber + 1);
    await renderCurrentPage();
  }

  async function goToInputPage() {
    if (!targetPdfDocument) {
      return;
    }

    const requestedPage = Number.parseInt(elements.previewPageInput.value, 10);
    currentPageNumber = clampPageNumber(requestedPage);
    await renderCurrentPage();
  }

  async function setZoom(value) {
    zoomValue = normalizeZoomValue(value);
    saveZoom(zoomValue);
    syncZoomControl();
    await renderCurrentPage();
  }

  async function zoomIn() {
    const currentScale = zoomValue === FIT_WIDTH_ZOOM
      ? lastRenderScale
      : Number.parseFloat(zoomValue);
    const nextScale = getNearestZoomLevel(currentScale, 1);

    await setZoom(formatZoomOptionValue(nextScale));
  }

  async function zoomOut() {
    const currentScale = zoomValue === FIT_WIDTH_ZOOM
      ? lastRenderScale
      : Number.parseFloat(zoomValue);
    const nextScale = getNearestZoomLevel(currentScale, -1);

    await setZoom(formatZoomOptionValue(nextScale));
  }

  return {
    loadPdfFromFile,
    renderCurrentPage,
    parsePageInput,
    requireTargetPdf,
    previousPage,
    nextPage,
    goToInputPage,
    setZoom,
    zoomIn,
    zoomOut,
    onCoordinateClick,
    onCoordinateDrag,
    getLastCoordinate: () => lastCoordinate ? {...lastCoordinate} : null,
    getCurrentPageNumber: () => currentPageNumber,
    getTargetPdfFile: () => targetPdfFile,
    getTargetPdfDocument: () => targetPdfDocument
  };
}
