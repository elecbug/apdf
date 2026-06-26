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

export function createPdfPreview(elements, setEditStatus) {
  let targetPdfFile = null;
  let targetPdfDocument = null;
  let currentPageNumber = 1;
  let zoomValue = loadSavedZoom();
  let lastRenderScale = Number.parseFloat(DEFAULT_ZOOM);

  syncZoomControl();

  async function loadPdfFromFile(file) {
    const data = await file.arrayBuffer();
    const pdfjs = await ensurePdfJs();

    targetPdfDocument = await pdfjs.getDocument({
      data
    }).promise;

    targetPdfFile = file;
    currentPageNumber = 1;

    elements.previewPageInput.value = '1';
    elements.previewPageInput.max = String(targetPdfDocument.numPages);
    elements.previewPageCount.textContent = `/ ${targetPdfDocument.numPages}`;

    elements.previewInfo.textContent = `${file.name} · ${targetPdfDocument.numPages} pages`;
    setEditStatus(`Loaded: ${file.name}`);

    await renderCurrentPage();
  }

  async function renderCurrentPage() {
    if (!targetPdfDocument) {
      return;
    }

    const page = await targetPdfDocument.getPage(currentPageNumber);
    const renderScale = resolveRenderScale(page);
    const viewport = page.getViewport({ scale: renderScale });

    lastRenderScale = renderScale;

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
    getTargetPdfFile: () => targetPdfFile,
    getTargetPdfDocument: () => targetPdfDocument
  };
}
