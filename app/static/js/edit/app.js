import { downloadFileObject, downloadFromUrl } from './download.js';
import { getEditElements } from './dom.js';
import { renderEditOps } from './operations.js';
import { createPdfPreview } from './pdf-preview.js';
import { bindToolHoverDescriptions, setActiveTool } from './tools.js';

const MAX_UNDO_HISTORY = 20;

export function createEditApp() {
  const elements = getEditElements();

  let latestDownloadUrl = null;
  let latestDownloadFilename = null;
  let editOps = [];
  let insertedImages = [];
  let undoStack = [];
  let currentTool = 'blank';
  let imageOverlayRatio = null;
  let syncingImageOverlaySize = false;

  function setEditStatus(message) {
    elements.editStatusLine.textContent = message;
  }

  const preview = createPdfPreview(elements, setEditStatus);

  function updateEditOps() {
    renderEditOps(elements.editOpList, editOps);
  }

  function updateUndoButton() {
    elements.undoEditApply.disabled = undoStack.length === 0;
  }

  function makeUndoSnapshot() {
    const targetPdfFile = preview.getTargetPdfFile();

    if (!targetPdfFile) {
      return null;
    }

    return {
      file: targetPdfFile,
      downloadUrl: latestDownloadUrl,
      downloadFilename: latestDownloadFilename
    };
  }

  function pushUndoSnapshot(snapshot) {
    if (!snapshot) {
      return;
    }

    undoStack.push(snapshot);

    if (undoStack.length > MAX_UNDO_HISTORY) {
      undoStack.shift();
    }

    updateUndoButton();
  }

  function clearUndoHistory() {
    undoStack = [];
    updateUndoButton();
  }

  async function handlePdfFileChange() {
    const file = elements.editPdfFile.files[0];

    if (!file) {
      return;
    }

    if (file.type !== 'application/pdf') {
      alert('Select a PDF file.');
      elements.editPdfFile.value = '';
      return;
    }

    try {
      setEditStatus('Loading PDF...');
      await preview.loadPdfFromFile(file);

      latestDownloadUrl = null;
      latestDownloadFilename = null;
      elements.downloadEditedPdf.disabled = true;
      editOps = [];
      insertedImages = [];
      updateEditOps();
      clearUndoHistory();
    } catch (error) {
      console.error(error);
      alert(`Failed to load PDF.\n\n${error?.message || error}`);
      setEditStatus(`Failed to load PDF: ${error?.message || error}`);
    }
  }

  function addBlankPageOperation() {
    if (!preview.requireTargetPdf()) {
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
      const page = preview.parsePageInput(pageInput);

      if (page === null) {
        alert('Enter a valid page number.');
        return;
      }

      op.page = page;
    }

    editOps.push(op);
    updateEditOps();
  }

  function addImagePageOperation() {
    if (!preview.requireTargetPdf()) {
      return;
    }

    const imageFile = elements.insertImageFile.files[0];

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
      const page = preview.parsePageInput(pageInput);

      if (page === null) {
        alert('Enter a valid page number.');
        return;
      }

      op.page = page;
    }

    editOps.push(op);
    updateEditOps();
  }

  function addRotateOperation() {
    if (!preview.requireTargetPdf()) {
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

    updateEditOps();
  }

  function addDeletePagesOperation() {
    if (!preview.requireTargetPdf()) {
      return;
    }

    const pages = document.getElementById('deletePages').value.trim();

    if (!pages) {
      alert('Enter pages to delete.');
      return;
    }

    editOps.push({
      type: 'delete_pages',
      pages
    });

    updateEditOps();
  }

  function addMovePagesOperation() {
    if (!preview.requireTargetPdf()) {
      return;
    }

    const pages = document.getElementById('movePages').value.trim();
    const position = document.getElementById('movePosition').value;
    const targetPageInput = document.getElementById('moveTargetPage');

    if (!pages) {
      alert('Enter pages to move.');
      return;
    }

    const op = {
      type: 'move_pages',
      pages,
      position
    };

    if (position !== 'end') {
      const targetPage = preview.parsePageInput(targetPageInput);

      if (targetPage === null) {
        alert('Enter a valid target page number.');
        return;
      }

      op.target_page = targetPage;
    }

    editOps.push(op);
    updateEditOps();
  }

  function updateTextOverlayCoordinate(coordinate) {
    if (!coordinate) {
      return;
    }

    elements.textOverlayPage.value = String(coordinate.page);
    elements.textOverlayX.value = coordinate.x.toFixed(1);
    elements.textOverlayY.value = coordinate.y.toFixed(1);

    if (elements.textOverlayCoordinateHint) {
      elements.textOverlayCoordinateHint.textContent = `Selected page ${coordinate.page}, x ${coordinate.x.toFixed(1)} pt, y ${coordinate.y.toFixed(1)} pt.`;
      elements.textOverlayCoordinateHint.classList.add('selected');
    }
  }

  function updateImageOverlayCoordinate(coordinate) {
    if (!coordinate) {
      return;
    }

    elements.imageOverlayPage.value = String(coordinate.page);
    elements.imageOverlayX.value = coordinate.x.toFixed(1);
    elements.imageOverlayY.value = coordinate.y.toFixed(1);

    if (elements.imageOverlayCoordinateHint) {
      elements.imageOverlayCoordinateHint.textContent = `Selected page ${coordinate.page}, x ${coordinate.x.toFixed(1)} pt, y ${coordinate.y.toFixed(1)} pt.`;
      elements.imageOverlayCoordinateHint.classList.add('selected');
    }
  }

  function handlePreviewCoordinateClick(coordinate) {
    if (currentTool === 'text') {
      updateTextOverlayCoordinate(coordinate);
      return;
    }

    if (currentTool === 'imageOverlay') {
      updateImageOverlayCoordinate(coordinate);
    }
  }

  function parsePositiveNumber(inputElement, label) {
    const value = Number.parseFloat(inputElement.value);

    if (!Number.isFinite(value) || value < 0) {
      alert(`Enter a valid ${label}.`);
      return null;
    }

    return value;
  }

  function parsePositiveDimension(inputElement, label) {
    const value = Number.parseFloat(inputElement.value);

    if (!Number.isFinite(value) || value <= 0) {
      alert(`Enter a valid ${label}.`);
      return null;
    }

    return value;
  }

  function parseFontSize(inputElement) {
    const value = Number.parseInt(inputElement.value, 10);

    if (!Number.isFinite(value) || value < 1 || value > 300) {
      alert('Enter a valid font size between 1 and 300.');
      return null;
    }

    return value;
  }

  function parseOpacity(inputElement) {
    const value = Number.parseFloat(inputElement.value);

    if (!Number.isFinite(value) || value < 0 || value > 1) {
      alert('Enter a valid opacity between 0 and 1.');
      return null;
    }

    return value;
  }

  function addTextOverlayOperation() {
    if (!preview.requireTargetPdf()) {
      return;
    }

    const text = elements.textOverlayText.value.trim();

    if (!text) {
      alert('Enter text to insert.');
      elements.textOverlayText.focus();
      return;
    }

    const page = preview.parsePageInput(elements.textOverlayPage);
    if (page === null) {
      alert('Click the PDF preview or enter a valid page number.');
      return;
    }

    const x = parsePositiveNumber(elements.textOverlayX, 'X coordinate');
    if (x === null) {
      return;
    }

    const y = parsePositiveNumber(elements.textOverlayY, 'Y coordinate');
    if (y === null) {
      return;
    }

    const fontSize = parseFontSize(elements.textOverlayFontSize);
    if (fontSize === null) {
      return;
    }

    const opacity = parseOpacity(elements.textOverlayOpacity);
    if (opacity === null) {
      return;
    }

    editOps.push({
      type: 'overlay_text',
      page,
      x,
      y,
      text,
      font_size: fontSize,
      opacity
    });

    updateEditOps();
  }

  function addImageOverlayOperation() {
    if (!preview.requireTargetPdf()) {
      return;
    }

    const imageFile = elements.imageOverlayFile.files[0];

    if (!imageFile) {
      alert('Choose an image file.');
      return;
    }

    const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

    if (!allowedTypes.has(imageFile.type)) {
      alert('Choose a PNG, JPEG, or WebP image.');
      return;
    }

    const page = preview.parsePageInput(elements.imageOverlayPage);
    if (page === null) {
      alert('Click the PDF preview or enter a valid page number.');
      return;
    }

    const x = parsePositiveNumber(elements.imageOverlayX, 'X coordinate');
    if (x === null) {
      return;
    }

    const y = parsePositiveNumber(elements.imageOverlayY, 'Y coordinate');
    if (y === null) {
      return;
    }

    const width = parsePositiveDimension(elements.imageOverlayWidth, 'image width');
    if (width === null) {
      return;
    }

    const height = parsePositiveDimension(elements.imageOverlayHeight, 'image height');
    if (height === null) {
      return;
    }

    const opacity = parseOpacity(elements.imageOverlayOpacity);
    if (opacity === null) {
      return;
    }

    const imageId = `overlay_image_${Date.now()}_${insertedImages.length}`;
    insertedImages.push({
      id: imageId,
      file: imageFile
    });

    editOps.push({
      type: 'overlay_image',
      image_id: imageId,
      image_name: imageFile.name,
      page,
      x,
      y,
      width,
      height,
      opacity
    });

    updateEditOps();
  }

  function removeEditOperation(event) {
    const button = event.target.closest('button[data-index]');

    if (!button) {
      return;
    }

    const index = Number.parseInt(button.dataset.index, 10);
    editOps.splice(index, 1);
    updateEditOps();
  }

  function clearOperations() {
    editOps = [];
    insertedImages = [];
    updateEditOps();
  }

  async function applyOperations() {
    if (!preview.requireTargetPdf()) {
      return;
    }

    if (editOps.length === 0) {
      alert('Add at least one edit operation.');
      return;
    }

    const targetPdfFile = preview.getTargetPdfFile();
    const formData = new FormData();
    formData.append('pdf', targetPdfFile, targetPdfFile.name || 'target.pdf');
    formData.append('operations', JSON.stringify(editOps));

    insertedImages.forEach((item) => {
      formData.append(item.id, item.file, item.file.name || `${item.id}.png`);
    });

    const undoSnapshot = makeUndoSnapshot();

    try {
      elements.applyEditOps.disabled = true;
      elements.undoEditApply.disabled = true;
      elements.downloadEditedPdf.disabled = true;
      elements.applyEditOps.textContent = 'Applying...';
      setEditStatus('Applying edits...');

      const response = await fetch('/edit/apply', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (!response.ok || !result.ok) {
        alert(result.error || 'Failed to apply edits.');
        setEditStatus(result.error || 'Failed to apply edits.');
        return;
      }

      if (!result.download_url) {
        alert('Edit succeeded, but download URL was not returned.');
        setEditStatus('Edit succeeded, but preview update failed.');
        return;
      }

      setEditStatus('Loading edited preview...');

      const editedResponse = await fetch(result.download_url);

      if (!editedResponse.ok) {
        throw new Error(`Failed to fetch edited PDF: ${editedResponse.status}`);
      }

      const editedBlob = await editedResponse.blob();
      const editedFilename = result.filename || 'edited.pdf';

      const editedFile = new File(
        [editedBlob],
        editedFilename,
        { type: 'application/pdf' }
      );

      await preview.loadPdfFromFile(editedFile);
      pushUndoSnapshot(undoSnapshot);

      editOps = [];
      insertedImages = [];
      updateEditOps();

      latestDownloadUrl = result.download_url;
      latestDownloadFilename = editedFilename;
      elements.downloadEditedPdf.disabled = false;

      setEditStatus(`Applied edits. Current preview: ${editedFilename}`);
    } catch (error) {
      console.error(error);
      alert(`Failed to apply edits.\n\n${error?.message || error}`);
      setEditStatus(`Failed to apply edits: ${error?.message || error}`);
    } finally {
      elements.applyEditOps.disabled = false;
      elements.applyEditOps.textContent = 'Apply Edits';
      elements.downloadEditedPdf.disabled = !latestDownloadUrl;
      updateUndoButton();
    }
  }

  async function undoLastApply() {
    if (undoStack.length === 0) {
      return;
    }

    const snapshot = undoStack.pop();

    try {
      elements.undoEditApply.disabled = true;
      elements.applyEditOps.disabled = true;
      setEditStatus('Restoring previous preview...');

      await preview.loadPdfFromFile(snapshot.file);

      latestDownloadUrl = snapshot.downloadUrl;
      latestDownloadFilename = snapshot.downloadFilename;
      elements.downloadEditedPdf.disabled = !latestDownloadUrl;

      editOps = [];
      insertedImages = [];
      updateEditOps();

      setEditStatus(`Undone. Current preview: ${snapshot.file.name}`);
    } catch (error) {
      undoStack.push(snapshot);
      console.error(error);
      alert(`Failed to undo.\n\n${error?.message || error}`);
      setEditStatus(`Failed to undo: ${error?.message || error}`);
    } finally {
      elements.applyEditOps.disabled = false;
      updateUndoButton();
    }
  }

  function downloadEditedPdf() {
    if (latestDownloadUrl) {
      downloadFromUrl(latestDownloadUrl, latestDownloadFilename || 'edited.pdf');
      return;
    }

    const targetPdfFile = preview.getTargetPdfFile();

    if (targetPdfFile) {
      downloadFileObject(targetPdfFile, targetPdfFile.name || 'edited.pdf');
    }
  }

  function updateSelectedImageName() {
    const imageFile = elements.insertImageFile.files[0];

    if (!imageFile) {
      elements.insertImageName.textContent = 'No image selected.';
      return;
    }

    elements.insertImageName.textContent = imageFile.name;
  }

  function syncImageOverlayHeightFromWidth() {
    if (syncingImageOverlaySize || !elements.imageOverlayLockRatio.checked || !imageOverlayRatio) {
      return;
    }

    const width = Number.parseFloat(elements.imageOverlayWidth.value);

    if (!Number.isFinite(width) || width <= 0) {
      return;
    }

    syncingImageOverlaySize = true;
    elements.imageOverlayHeight.value = (width * imageOverlayRatio).toFixed(1);
    syncingImageOverlaySize = false;
  }

  function syncImageOverlayWidthFromHeight() {
    if (syncingImageOverlaySize || !elements.imageOverlayLockRatio.checked || !imageOverlayRatio) {
      return;
    }

    const height = Number.parseFloat(elements.imageOverlayHeight.value);

    if (!Number.isFinite(height) || height <= 0) {
      return;
    }

    syncingImageOverlaySize = true;
    elements.imageOverlayWidth.value = (height / imageOverlayRatio).toFixed(1);
    syncingImageOverlaySize = false;
  }

  function updateSelectedImageOverlayName() {
    const imageFile = elements.imageOverlayFile.files[0];

    if (!imageFile) {
      elements.imageOverlayName.textContent = 'No image selected.';
      imageOverlayRatio = null;
      return;
    }

    const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

    if (!allowedTypes.has(imageFile.type)) {
      elements.imageOverlayName.textContent = imageFile.name;
      imageOverlayRatio = null;
      return;
    }

    elements.imageOverlayName.textContent = imageFile.name;

    const objectUrl = URL.createObjectURL(imageFile);
    const image = new Image();

    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        imageOverlayRatio = image.naturalHeight / image.naturalWidth;
        syncImageOverlayHeightFromWidth();
      }

      URL.revokeObjectURL(objectUrl);
    };

    image.onerror = () => {
      imageOverlayRatio = null;
      URL.revokeObjectURL(objectUrl);
    };

    image.src = objectUrl;
  }

  function bindEvents() {
    bindToolHoverDescriptions(elements);

    elements.editPdfFile.addEventListener('change', handlePdfFileChange);
    elements.prevPageButton.addEventListener('click', preview.previousPage);
    elements.nextPageButton.addEventListener('click', preview.nextPage);
    elements.previewPageInput.addEventListener('change', preview.goToInputPage);
    elements.zoomOutButton.addEventListener('click', preview.zoomOut);
    elements.zoomInButton.addEventListener('click', preview.zoomIn);
    elements.previewZoomSelect.addEventListener('change', () => {
      preview.setZoom(elements.previewZoomSelect.value);
    });
    preview.onCoordinateClick(handlePreviewCoordinateClick);

    elements.editToolButtons.forEach((button) => {
      button.addEventListener('click', () => {
        currentTool = button.dataset.tool;
        setActiveTool(elements, currentTool);
      });
    });

    elements.addBlankPageOp.addEventListener('click', addBlankPageOperation);
    elements.addImagePageOp.addEventListener('click', addImagePageOperation);
    elements.addRotateOp.addEventListener('click', addRotateOperation);
    elements.addDeletePagesOp.addEventListener('click', addDeletePagesOperation);
    elements.addMovePagesOp.addEventListener('click', addMovePagesOperation);
    elements.addTextOverlayOp.addEventListener('click', addTextOverlayOperation);
    elements.addImageOverlayOp.addEventListener('click', addImageOverlayOperation);

    elements.editOpList.addEventListener('click', removeEditOperation);
    elements.clearEditOps.addEventListener('click', clearOperations);
    elements.undoEditApply.addEventListener('click', undoLastApply);
    elements.applyEditOps.addEventListener('click', applyOperations);
    elements.downloadEditedPdf.addEventListener('click', downloadEditedPdf);
    elements.insertImageFile.addEventListener('change', updateSelectedImageName);
    elements.imageOverlayFile.addEventListener('change', updateSelectedImageOverlayName);
    elements.imageOverlayWidth.addEventListener('input', syncImageOverlayHeightFromWidth);
    elements.imageOverlayHeight.addEventListener('input', syncImageOverlayWidthFromHeight);
    elements.imageOverlayLockRatio.addEventListener('change', syncImageOverlayHeightFromWidth);
  }

  function init() {
    bindEvents();
    currentTool = 'blank';
    setActiveTool(elements, currentTool);
    updateEditOps();
    updateUndoButton();
  }

  return { init };
}
