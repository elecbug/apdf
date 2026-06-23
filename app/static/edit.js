import * as pdfjsLib from '/static/pdfjs/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/static/pdfjs/pdf.worker.mjs';

const editPdfFile = document.getElementById('editPdfFile');
const editStatusLine = document.getElementById('editStatusLine');

const previewInfo = document.getElementById('previewInfo');
const pdfPreviewBox = document.getElementById('pdfPreviewBox');
const pdfCanvas = document.getElementById('pdfCanvas');
const prevPageButton = document.getElementById('prevPageButton');
const nextPageButton = document.getElementById('nextPageButton');
const previewPageInput = document.getElementById('previewPageInput');
const previewPageCount = document.getElementById('previewPageCount');

const editToolButtons = document.querySelectorAll('.edit-tool-button');
const toolPanels = document.querySelectorAll('.tool-panel');

const addBlankPageOp = document.getElementById('addBlankPageOp');
const addImagePageOp = document.getElementById('addImagePageOp');
const addRotateOp = document.getElementById('addRotateOp');

const editOpList = document.getElementById('editOpList');
const clearEditOps = document.getElementById('clearEditOps');
const applyEditOps = document.getElementById('applyEditOps');

let targetPdfFile = null;
let targetPdfDocument = null;
let currentPageNumber = 1;
let editOps = [];
let insertedImages = [];

function setEditStatus(message) {
  editStatusLine.textContent = message;
}

function setActiveTool(toolName) {
  editToolButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.tool === toolName);
  });

  toolPanels.forEach((panel) => {
    panel.classList.remove('active');
  });

  const panel = document.getElementById(`toolPanel${capitalize(toolName)}`);
  if (panel) {
    panel.classList.add('active');
  }
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

async function loadPdfFromFile(file) {
  const data = await file.arrayBuffer();

  targetPdfDocument = await pdfjsLib.getDocument({
    data
  }).promise;

  targetPdfFile = file;
  currentPageNumber = 1;

  previewPageInput.value = '1';
  previewPageInput.max = String(targetPdfDocument.numPages);
  previewPageCount.textContent = `/ ${targetPdfDocument.numPages}`;

  previewInfo.textContent = `${file.name} · ${targetPdfDocument.numPages} pages`;
  setEditStatus(`Loaded: ${file.name}`);

  await renderCurrentPage();
}

async function renderCurrentPage() {
  if (!targetPdfDocument) {
    return;
  }

  const page = await targetPdfDocument.getPage(currentPageNumber);
  const viewport = page.getViewport({ scale: 1.4 });

  const context = pdfCanvas.getContext('2d');
  pdfCanvas.width = Math.floor(viewport.width);
  pdfCanvas.height = Math.floor(viewport.height);

  pdfCanvas.style.display = 'block';

  const emptyBox = pdfPreviewBox.querySelector('.empty-box');
  if (emptyBox) {
    emptyBox.style.display = 'none';
  }

  await page.render({
    canvasContext: context,
    viewport
  }).promise;

  previewPageInput.value = String(currentPageNumber);
}

function clampPageNumber(pageNumber) {
  if (!targetPdfDocument) {
    return 1;
  }

  return Math.min(Math.max(pageNumber, 1), targetPdfDocument.numPages);
}

function renderEditOps() {
  editOpList.innerHTML = '';

  editOps.forEach((op, index) => {
    const li = document.createElement('li');

    li.innerHTML = `
      <span>
        <strong>${index + 1}.</strong>
        <code>${op.type}</code>
        ${formatOperation(op)}
      </span>
      <button type="button" class="warning" data-index="${index}">Remove</button>
    `;

    editOpList.appendChild(li);
  });
}

function formatOperation(op) {
  if (op.type === 'insert_blank') {
    if (op.position === 'end') {
      return 'at end';
    }

    return `${op.position} page ${op.page}`;
  }

  if (op.type === 'insert_image_page') {
    if (op.position === 'end') {
      return `${op.image_name} at end`;
    }

    return `${op.image_name} ${op.position} page ${op.page}`;
  }

  if (op.type === 'rotate') {
    return `pages ${op.pages}, ${op.angle}°`;
  }

  return JSON.stringify(op);
}

function requireTargetPdf() {
  if (!targetPdfFile || !targetPdfDocument) {
    alert('Choose a PDF first.');
    return false;
  }

  return true;
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

editPdfFile.addEventListener('change', async () => {
  const file = editPdfFile.files[0];

  if (!file) {
    return;
  }

  if (file.type !== 'application/pdf') {
    alert('Select a PDF file.');
    editPdfFile.value = '';
    return;
  }

  try {
    setEditStatus('Loading PDF...');
    await loadPdfFromFile(file);
  } catch (error) {
    console.error(error);
    alert('Failed to load PDF.');
    setEditStatus('Failed to load PDF.');
  }
});

prevPageButton.addEventListener('click', async () => {
  if (!targetPdfDocument) {
    return;
  }

  currentPageNumber = clampPageNumber(currentPageNumber - 1);
  await renderCurrentPage();
});

nextPageButton.addEventListener('click', async () => {
  if (!targetPdfDocument) {
    return;
  }

  currentPageNumber = clampPageNumber(currentPageNumber + 1);
  await renderCurrentPage();
});

previewPageInput.addEventListener('change', async () => {
  if (!targetPdfDocument) {
    return;
  }

  const requestedPage = Number.parseInt(previewPageInput.value, 10);
  currentPageNumber = clampPageNumber(requestedPage);
  await renderCurrentPage();
});

editToolButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setActiveTool(button.dataset.tool);
  });
});

addBlankPageOp.addEventListener('click', () => {
  if (!requireTargetPdf()) {
    return;
  }

  const position = document.getElementById('blankPosition').value;
  const pageInput = document.getElementById('blankPageNumber');
  const size = document.getElementById('blankPageSize').value;

  const op = {
    type: 'insert_blank',
    position,
    size
  };

  if (position !== 'end') {
    const page = parsePageInput(pageInput);

    if (page === null) {
      alert('Enter a valid page number.');
      return;
    }

    op.page = page;
  }

  editOps.push(op);
  renderEditOps();
});

addImagePageOp.addEventListener('click', () => {
  if (!requireTargetPdf()) {
    return;
  }

  const imageInput = document.getElementById('insertImageFile');
  const imageFile = imageInput.files[0];

  if (!imageFile) {
    alert('Choose an image file.');
    return;
  }

  const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

  if (!allowedTypes.has(imageFile.type)) {
    alert('Choose a PNG, JPEG, or WebP image.');
    return;
  }

  const position = document.getElementById('imagePosition').value;
  const pageInput = document.getElementById('imagePageNumber');
  const fit = document.getElementById('imageFitMode').value;

  const imageId = `image_${Date.now()}_${insertedImages.length}`;
  insertedImages.push({
    id: imageId,
    file: imageFile
  });

  const op = {
    type: 'insert_image_page',
    image_id: imageId,
    image_name: imageFile.name,
    position,
    fit
  };

  if (position !== 'end') {
    const page = parsePageInput(pageInput);

    if (page === null) {
      alert('Enter a valid page number.');
      return;
    }

    op.page = page;
  }

  editOps.push(op);
  renderEditOps();
});

addRotateOp.addEventListener('click', () => {
  if (!requireTargetPdf()) {
    return;
  }

  const pages = document.getElementById('rotatePages').value.trim();
  const angle = Number.parseInt(document.getElementById('rotateAngle').value, 10);

  if (!pages) {
    alert('Enter pages to rotate.');
    return;
  }

  editOps.push({
    type: 'rotate',
    pages,
    angle
  });

  renderEditOps();
});

editOpList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-index]');

  if (!button) {
    return;
  }

  const index = Number.parseInt(button.dataset.index, 10);
  editOps.splice(index, 1);
  renderEditOps();
});

clearEditOps.addEventListener('click', () => {
  editOps = [];
  insertedImages = [];
  renderEditOps();
});

applyEditOps.addEventListener('click', async () => {
  if (!requireTargetPdf()) {
    return;
  }

  if (editOps.length === 0) {
    alert('Add at least one edit operation.');
    return;
  }

  const formData = new FormData();
  formData.append('pdf', targetPdfFile);
  formData.append('operations', JSON.stringify(editOps));

  insertedImages.forEach((item) => {
    formData.append(item.id, item.file);
  });

  // Backend endpoint will be implemented later.
  // Expected endpoint:
  // POST /edit/apply
  //
  // const response = await fetch('/edit/apply', {
  //   method: 'POST',
  //   body: formData
  // });
  //
  // const result = await response.json();
  // window.location.href = result.job_url;

  alert('Edit backend is not implemented yet.');
});

setActiveTool('blank');
renderEditOps();