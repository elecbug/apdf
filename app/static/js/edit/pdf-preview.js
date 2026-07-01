let pdfjsLib = null;

const DEFAULT_ZOOM = '1.4';
const FIT_WIDTH_ZOOM = 'fit-width';
const ZOOM_STORAGE_KEY = 'apdf_edit_preview_zoom';
const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.4, 1.5, 2, 2.5, 3];
const MIN_ZOOM = ZOOM_LEVELS[0];
const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
const REGION_DRAG_THRESHOLD_PX = 6;

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
  let dragRegionOverlay = null;
  let suppressNextClick = false;
  const coordinateClickHandlers = [];
  const regionSelectHandlers = [];

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
    hideDragRegionOverlay();
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

  function pointerInfoFromEvent(event) {
    if (!currentViewport || !targetPdfDocument) {
      return null;
    }

    const canvas = elements.pdfCanvas;
    const rect = canvas.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
      return null;
    }

    const canvasX = (event.clientX - rect.left) * (canvas.width / rect.width);
    const canvasY = (event.clientY - rect.top) * (canvas.height / rect.height);

    if (canvasX < 0 || canvasY < 0 || canvasX > canvas.width || canvasY > canvas.height) {
      return null;
    }

    const [pdfX, pdfY] = currentViewport.convertToPdfPoint(canvasX, canvasY);

    return {
      clientX: event.clientX,
      clientY: event.clientY,
      canvasX,
      canvasY,
      coordinate: {
        page: currentPageNumber,
        x: pdfX,
        y: pdfY
      }
    };
  }

  function coordinateFromPointerEvent(event) {
    return pointerInfoFromEvent(event)?.coordinate || null;
  }

  function ensureDragRegionOverlay() {
    if (dragRegionOverlay) {
      return dragRegionOverlay;
    }

    dragRegionOverlay = document.createElement('div');
    dragRegionOverlay.className = 'pdf-drag-region-overlay';
    dragRegionOverlay.hidden = true;
    elements.pdfPreviewBox.appendChild(dragRegionOverlay);

    return dragRegionOverlay;
  }

  function hideDragRegionOverlay() {
    if (dragRegionOverlay) {
      dragRegionOverlay.hidden = true;
    }

    elements.pdfCanvas?.classList.remove('is-region-dragging');
  }

  function updateDragRegionOverlay(startInfo, currentInfo) {
    const overlay = ensureDragRegionOverlay();
    const boxRect = elements.pdfPreviewBox.getBoundingClientRect();
    const left = Math.min(startInfo.clientX, currentInfo.clientX) - boxRect.left + elements.pdfPreviewBox.scrollLeft;
    const top = Math.min(startInfo.clientY, currentInfo.clientY) - boxRect.top + elements.pdfPreviewBox.scrollTop;
    const width = Math.abs(currentInfo.clientX - startInfo.clientX);
    const height = Math.abs(currentInfo.clientY - startInfo.clientY);

    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;
    overlay.hidden = false;
  }

  function regionFromPointerInfos(startInfo, endInfo) {
    const start = startInfo.coordinate;
    const end = endInfo.coordinate;
    const leftX = Math.min(start.x, end.x);
    const rightX = Math.max(start.x, end.x);
    const bottomY = Math.min(start.y, end.y);
    const topY = Math.max(start.y, end.y);

    return {
      page: currentPageNumber,
      start: {...start},
      end: {...end},
      x: leftX,
      y: bottomY,
      leftX,
      rightX,
      bottomY,
      topY,
      width: rightX - leftX,
      height: topY - bottomY
    };
  }

  function formatRegionLine(region) {
    return `Region: page ${region.page}, x ${formatCoordinateNumber(region.x)} pt, y ${formatCoordinateNumber(region.y)} pt, width ${formatCoordinateNumber(region.width)} pt, height ${formatCoordinateNumber(region.height)} pt`;
  }

  function setRegionLine(region) {
    if (!elements.previewCoordinateLine) {
      return;
    }

    elements.previewCoordinateLine.textContent = formatRegionLine(region);
    elements.previewCoordinateLine.classList.add('locked');
  }

  function handlePointerDown(event) {
    if (event.button !== 0) {
      return;
    }

    const info = pointerInfoFromEvent(event);

    if (!info) {
      return;
    }

    dragState = {
      pointerId: event.pointerId,
      startInfo: info,
      currentInfo: info,
      dragging: false
    };

    try {
      elements.pdfCanvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is not critical; the drag can still finish on pointerup.
    }
  }

  function handlePointerMove(event) {
    if (dragState && dragState.pointerId === event.pointerId) {
      const info = pointerInfoFromEvent(event);

      if (!info) {
        return;
      }

      dragState.currentInfo = info;

      const dx = info.clientX - dragState.startInfo.clientX;
      const dy = info.clientY - dragState.startInfo.clientY;
      const distance = Math.hypot(dx, dy);

      if (!dragState.dragging && distance >= REGION_DRAG_THRESHOLD_PX) {
        dragState.dragging = true;
        suppressNextClick = true;
        elements.pdfCanvas.classList.add('is-region-dragging');
      }

      if (dragState.dragging) {
        event.preventDefault();
        updateDragRegionOverlay(dragState.startInfo, info);
        setRegionLine(regionFromPointerInfos(dragState.startInfo, info));
        return;
      }
    }

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

  function handlePointerUp(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const state = dragState;
    dragState = null;

    try {
      elements.pdfCanvas.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore release errors from browsers that already released capture.
    }

    if (!state.dragging) {
      hideDragRegionOverlay();
      return;
    }

    event.preventDefault();
    hideDragRegionOverlay();

    const region = regionFromPointerInfos(state.startInfo, state.currentInfo);

    if (region.width <= 0 || region.height <= 0) {
      return;
    }

    coordinateLocked = true;
    lastCoordinate = {...state.currentInfo.coordinate};
    setRegionLine(region);
    notifyRegionSelect(region);
  }

  function handlePointerCancel(event) {
    if (dragState && dragState.pointerId === event.pointerId) {
      dragState = null;
      hideDragRegionOverlay();
    }
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

  function notifyRegionSelect(region) {
    regionSelectHandlers.forEach((handler) => {
      try {
        handler({
          ...region,
          start: {...region.start},
          end: {...region.end}
        });
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

  function onRegionSelect(handler) {
    if (typeof handler !== 'function') {
      return () => {};
    }

    regionSelectHandlers.push(handler);

    return () => {
      const index = regionSelectHandlers.indexOf(handler);
      if (index >= 0) {
        regionSelectHandlers.splice(index, 1);
      }
    };
  }

  function handlePointerLeave() {
    if (dragState?.dragging) {
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
    onRegionSelect,
    getLastCoordinate: () => lastCoordinate ? {...lastCoordinate} : null,
    getCurrentPageNumber: () => currentPageNumber,
    getTargetPdfFile: () => targetPdfFile,
    getTargetPdfDocument: () => targetPdfDocument
  };
}
