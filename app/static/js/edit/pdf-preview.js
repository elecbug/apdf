let pdfjsLib = null;

async function ensurePdfJs() {
  if (pdfjsLib) {
    return pdfjsLib;
  }

  pdfjsLib = await import('/static/pdfjs/pdf.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/static/pdfjs/pdf.worker.mjs';

  return pdfjsLib;
}

export function createPdfPreview(elements, setEditStatus) {
  let targetPdfFile = null;
  let targetPdfDocument = null;
  let currentPageNumber = 1;

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
    const viewport = page.getViewport({ scale: 1.4 });

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

  return {
    loadPdfFromFile,
    renderCurrentPage,
    parsePageInput,
    requireTargetPdf,
    previousPage,
    nextPage,
    goToInputPage,
    getTargetPdfFile: () => targetPdfFile,
    getTargetPdfDocument: () => targetPdfDocument
  };
}
