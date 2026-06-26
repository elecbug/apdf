import { downloadFileObject, downloadFromUrl } from './download.js';
import { getEditElements } from './dom.js';
import { renderEditOps } from './operations.js';
import { createPdfPreview } from './pdf-preview.js';
import { setActiveTool } from './tools.js';

const MAX_UNDO_HISTORY = 20;

export function createEditApp() {
  const elements = getEditElements();

  let latestDownloadUrl = null;
  let latestDownloadFilename = null;
  let editOps = [];
  let insertedImages = [];
  let undoStack = [];

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

  function bindEvents() {
    elements.editPdfFile.addEventListener('change', handlePdfFileChange);
    elements.prevPageButton.addEventListener('click', preview.previousPage);
    elements.nextPageButton.addEventListener('click', preview.nextPage);
    elements.previewPageInput.addEventListener('change', preview.goToInputPage);
    elements.zoomOutButton.addEventListener('click', preview.zoomOut);
    elements.zoomInButton.addEventListener('click', preview.zoomIn);
    elements.previewZoomSelect.addEventListener('change', () => {
      preview.setZoom(elements.previewZoomSelect.value);
    });

    elements.editToolButtons.forEach((button) => {
      button.addEventListener('click', () => {
        setActiveTool(elements, button.dataset.tool);
      });
    });

    elements.addBlankPageOp.addEventListener('click', addBlankPageOperation);
    elements.addImagePageOp.addEventListener('click', addImagePageOperation);
    elements.addRotateOp.addEventListener('click', addRotateOperation);
    elements.addDeletePagesOp.addEventListener('click', addDeletePagesOperation);
    elements.addMovePagesOp.addEventListener('click', addMovePagesOperation);

    elements.editOpList.addEventListener('click', removeEditOperation);
    elements.clearEditOps.addEventListener('click', clearOperations);
    elements.undoEditApply.addEventListener('click', undoLastApply);
    elements.applyEditOps.addEventListener('click', applyOperations);
    elements.downloadEditedPdf.addEventListener('click', downloadEditedPdf);
    elements.insertImageFile.addEventListener('change', updateSelectedImageName);
  }

  function init() {
    bindEvents();
    setActiveTool(elements, 'blank');
    updateEditOps();
    updateUndoButton();
  }

  return { init };
}
