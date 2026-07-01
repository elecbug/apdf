import { getEditElements } from './dom.js';
import { downloadFileObject, downloadFromUrl } from './download.js';
import { createPdfPreview } from './pdf-preview.js';
import { bindToolHoverDescriptions, setActiveTool } from './tools.js';

const MAX_UNDO_HISTORY = 20;

export function createEditApp() {
  const elements = getEditElements();

  let latestDownloadUrl = null;
  let latestDownloadFilename = null;
  let undoStack = [];
  let currentTool = 'blank';
  let imageOverlayRatio = null;
  let syncingImageOverlaySize = false;
  let imageSequence = 0;
  let applying = false;

  function setEditStatus(message) {
    elements.editStatusLine.textContent = message;
  }

  const preview = createPdfPreview(elements, setEditStatus);

  function updateUndoButton() {
    elements.undoEditApply.disabled = applying || undoStack.length === 0;
  }

  function updateDownloadButton() {
    elements.downloadEditedPdf.disabled = applying || !preview.getTargetPdfFile();
  }

  function getToolActionButtons() {
    return [
      elements.addBlankPageOp,
      elements.addImagePageOp,
      elements.addAppendPdfOp,
      elements.addRotateOp,
      elements.addPageNumbersOp,
      elements.addDeletePagesOp,
      elements.addMovePagesOp,
      elements.addTextOverlayOp,
      elements.addImageOverlayOp
    ].filter(Boolean);
  }

  function setToolActionButtonsDisabled(disabled) {
    getToolActionButtons().forEach((button) => {
      button.disabled = disabled;
    });
  }

  function makeUndoSnapshot() {
    const targetPdfFile = preview.getTargetPdfFile();

    if (!targetPdfFile) {
      return null;
    }

    return {
      file: targetPdfFile,
      pageNumber: preview.getCurrentPageNumber(),
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

  function isPdfFile(file) {
    return Boolean(file) && (
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    );
  }

  async function loadEditPdfFile(file) {
    if (!file) {
      return;
    }

    if (!isPdfFile(file)) {
      alert('Select a PDF file.');
      elements.editPdfFile.value = '';
      return;
    }

    try {
      setEditStatus('Loading PDF...');
      await preview.loadPdfFromFile(file);

      latestDownloadUrl = null;
      latestDownloadFilename = null;
      clearUndoHistory();
      updateDownloadButton();
    } catch (error) {
      console.error(error);
      alert(`Failed to load PDF.\n\n${error?.message || error}`);
      setEditStatus(`Failed to load PDF: ${error?.message || error}`);
    }
  }

  async function handlePdfFileChange() {
    await loadEditPdfFile(elements.editPdfFile.files[0]);
  }

  function bindSinglePdfDropZone(dropZone) {
    if (!dropZone) {
      return;
    }

    let dragDepth = 0;

    function hasFiles(event) {
      return Array.from(event.dataTransfer?.types || []).includes('Files');
    }

    dropZone.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) {
        return;
      }

      event.preventDefault();
      dragDepth += 1;
      dropZone.classList.add('drag-over');
      setEditStatus('Drop a PDF file to load it for editing.');
    });

    dropZone.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });

    dropZone.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);

      if (dragDepth === 0) {
        dropZone.classList.remove('drag-over');
      }
    });

    dropZone.addEventListener('drop', (event) => {
      if (!hasFiles(event)) {
        return;
      }

      event.preventDefault();
      dragDepth = 0;
      dropZone.classList.remove('drag-over');

      const pdfFiles = Array.from(event.dataTransfer.files || []).filter(isPdfFile);

      if (pdfFiles.length === 0) {
        alert('Drop a PDF file.');
        setEditStatus('Dropped files did not include a PDF.');
        return;
      }

      if (event.dataTransfer.files.length > 1) {
        setEditStatus('Multiple files dropped. Loading the first PDF only.');
      }

      elements.editPdfFile.value = '';
      void loadEditPdfFile(pdfFiles[0]);
    });
  }

  async function applySingleOperation(op, imageItems = [], triggerButton = null) {
    if (!preview.requireTargetPdf()) {
      return false;
    }

    if (applying) {
      return false;
    }

    const targetPdfFile = preview.getTargetPdfFile();
    const formData = new FormData();
    formData.append('pdf', targetPdfFile, targetPdfFile.name || 'target.pdf');
    formData.append('operations', JSON.stringify([op]));

    imageItems.forEach((item) => {
      formData.append(item.id, item.file, item.file.name || `${item.id}.png`);
    });

    const undoSnapshot = makeUndoSnapshot();
    const pageBeforeApply = preview.getCurrentPageNumber();
    const originalButtonText = triggerButton ? triggerButton.textContent : null;

    try {
      applying = true;
      setToolActionButtonsDisabled(true);
      updateUndoButton();
      updateDownloadButton();

      if (triggerButton) {
        triggerButton.textContent = 'Applying...';
      }

      setEditStatus('Applying edit...');

      const response = await fetch('/edit/apply', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (!response.ok || !result.ok) {
        alert(result.error || 'Failed to apply edit.');
        setEditStatus(result.error || 'Failed to apply edit.');
        return false;
      }

      if (!result.download_url) {
        alert('Edit succeeded, but download URL was not returned.');
        setEditStatus('Edit succeeded, but preview update failed.');
        return false;
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

      await preview.loadPdfFromFile(editedFile, { pageNumber: pageBeforeApply });
      pushUndoSnapshot(undoSnapshot);

      latestDownloadUrl = result.download_url;
      latestDownloadFilename = editedFilename;
      updateDownloadButton();

      setEditStatus(`Applied edit. Current preview: ${editedFilename}`);
      return true;
    } catch (error) {
      console.error(error);
      alert(`Failed to apply edit.\n\n${error?.message || error}`);
      setEditStatus(`Failed to apply edit: ${error?.message || error}`);
      return false;
    } finally {
      applying = false;
      setToolActionButtonsDisabled(false);

      if (triggerButton && originalButtonText !== null) {
        triggerButton.textContent = originalButtonText;
      }

      updateUndoButton();
      updateDownloadButton();
    }
  }

  async function addBlankPageOperation() {
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

    await applySingleOperation(op, [], elements.addBlankPageOp);
  }

  async function addImagePageOperation() {
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
    const imageId = `image_${Date.now()}_${imageSequence++}`;

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

    await applySingleOperation(op, [{ id: imageId, file: imageFile }], elements.addImagePageOp);
  }

  async function addAppendPdfOperation() {
    if (!preview.requireTargetPdf()) {
      return;
    }

    const appendFile = elements.appendPdfFile.files[0];

    if (!appendFile) {
      alert('Choose a PDF file to append.');
      return;
    }

    if (!isPdfFile(appendFile)) {
      alert('Choose a PDF file.');
      return;
    }

    const position = document.getElementById('appendPosition').value;
    const pageInput = document.getElementById('appendPageNumber');
    const appendPdfId = `append_pdf_${Date.now()}_${imageSequence++}`;

    const op = {
      type: 'append_pdf',
      pdf_id: appendPdfId,
      pdf_name: appendFile.name,
      position
    };

    if (position !== 'end') {
      const page = preview.parsePageInput(pageInput);

      if (page === null) {
        alert('Enter a valid page number.');
        return;
      }

      op.page = page;
    }

    await applySingleOperation(op, [{ id: appendPdfId, file: appendFile }], elements.addAppendPdfOp);
  }

  async function addRotateOperation() {
    if (!preview.requireTargetPdf()) {
      return;
    }

    const pages = document.getElementById('rotatePages').value.trim() || 'all';
    const angle = Number.parseInt(document.getElementById('rotateAngle').value, 10);

    await applySingleOperation({
      type: 'rotate',
      pages,
      angle
    }, [], elements.addRotateOp);
  }

  function parseNonNegativeInteger(inputElement, label) {
    const value = Number.parseInt(inputElement.value, 10);

    if (!Number.isInteger(value) || value < 0) {
      alert(`Enter a valid ${label}.`);
      return null;
    }

    return value;
  }

  async function addPageNumbersOperation() {
    if (!preview.requireTargetPdf()) {
      return;
    }

    const startPage = preview.parsePageInput(elements.pageNumberStartPage);
    if (startPage === null) {
      alert('Enter a valid start page.');
      return;
    }

    const startNumber = parseNonNegativeInteger(elements.pageNumberStartNumber, 'start number');
    if (startNumber === null) {
      return;
    }

    const rawFormat = elements.pageNumberFormat.value;
    const format = rawFormat === '' ? 'N' : rawFormat;

    await applySingleOperation({
      type: 'page_numbers',
      start_page: startPage,
      start_number: startNumber,
      position: elements.pageNumberPosition.value,
      format,
      numbering_style: elements.pageNumberStyle.value
    }, [], elements.addPageNumbersOp);
  }

  async function addDeletePagesOperation() {
    if (!preview.requireTargetPdf()) {
      return;
    }

    const pages = document.getElementById('deletePages').value.trim() || 'all';

    await applySingleOperation({
      type: 'delete_pages',
      pages
    }, [], elements.addDeletePagesOp);
  }

  async function addMovePagesOperation() {
    if (!preview.requireTargetPdf()) {
      return;
    }

    const pages = document.getElementById('movePages').value.trim() || 'all';
    const position = document.getElementById('movePosition').value;
    const targetPageInput = document.getElementById('moveTargetPage');

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

    await applySingleOperation(op, [], elements.addMovePagesOp);
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

  function updateTextOverlayRegion(region) {
    if (!region || region.width <= 0) {
      return;
    }

    elements.textOverlayPage.value = String(region.page);
    elements.textOverlayX.value = region.x.toFixed(1);
    elements.textOverlayY.value = region.topY.toFixed(1);

    if (elements.textOverlayMaxWidth) {
      elements.textOverlayMaxWidth.value = region.width.toFixed(1);
    }

    if (elements.textOverlayCoordinateHint) {
      elements.textOverlayCoordinateHint.textContent = `Selected text box on page ${region.page}: x ${region.x.toFixed(1)} pt, y ${region.topY.toFixed(1)} pt, width ${region.width.toFixed(1)} pt.`;
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

  function getImageOverlayRatioFallback() {
    if (imageOverlayRatio && Number.isFinite(imageOverlayRatio) && imageOverlayRatio > 0) {
      return imageOverlayRatio;
    }

    const width = Number.parseFloat(elements.imageOverlayWidth.value);
    const height = Number.parseFloat(elements.imageOverlayHeight.value);

    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      return height / width;
    }

    return null;
  }

  function updateImageOverlayRegion(region) {
    if (!region || region.width <= 0 || region.height <= 0) {
      return;
    }

    let width = region.width;
    let height = region.height;

    if (elements.imageOverlayLockRatio.checked) {
      const ratio = getImageOverlayRatioFallback();
      if (ratio) {
        height = width * ratio;
      }
    }

    elements.imageOverlayPage.value = String(region.page);
    elements.imageOverlayX.value = region.x.toFixed(1);
    elements.imageOverlayY.value = region.y.toFixed(1);
    elements.imageOverlayWidth.value = width.toFixed(1);
    elements.imageOverlayHeight.value = height.toFixed(1);

    if (elements.imageOverlayCoordinateHint) {
      elements.imageOverlayCoordinateHint.textContent = `Selected image box on page ${region.page}: x ${region.x.toFixed(1)} pt, y ${region.y.toFixed(1)} pt, width ${width.toFixed(1)} pt, height ${height.toFixed(1)} pt.`;
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

  function handlePreviewRegionSelect(region) {
    if (currentTool === 'text') {
      updateTextOverlayRegion(region);
      return;
    }

    if (currentTool === 'imageOverlay') {
      updateImageOverlayRegion(region);
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

  function parseOptionalPositiveDimension(inputElement, label) {
    const raw = inputElement.value.trim();

    if (!raw) {
      return undefined;
    }

    const value = Number.parseFloat(raw);

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

  function isTextStyleActive(button) {
    return Boolean(button) && button.getAttribute('aria-pressed') === 'true';
  }

  function setTextStyleActive(button, active) {
    if (!button) {
      return;
    }

    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  function toggleTextStyle(button) {
    if (!button) {
      return;
    }

    setTextStyleActive(button, !isTextStyleActive(button));
    elements.textOverlayText?.focus();
  }

  function bindTextStyleButton(button) {
    if (!button) {
      return;
    }

    button.addEventListener('click', () => {
      toggleTextStyle(button);
    });
  }

  function bindTextOverlayShortcuts() {
    if (!elements.textOverlayText) {
      return;
    }

    elements.textOverlayText.addEventListener('keydown', (event) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === 'b') {
        event.preventDefault();
        toggleTextStyle(elements.textOverlayBold);
        return;
      }

      if (key === 'i') {
        event.preventDefault();
        toggleTextStyle(elements.textOverlayItalic);
        return;
      }

      if (key === 'u') {
        event.preventDefault();
        toggleTextStyle(elements.textOverlayUnderline);
      }
    });
  }

  async function addTextOverlayOperation() {
    if (!preview.requireTargetPdf()) {
      return;
    }

    const text = elements.textOverlayText.value;

    if (!text.trim()) {
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

    const color = elements.textOverlayColor?.value || '#000000';

    const maxWidth = parseOptionalPositiveDimension(elements.textOverlayMaxWidth, 'text box width');
    if (maxWidth === null) {
      return;
    }

    const op = {
      type: 'overlay_text',
      page,
      x,
      y,
      text,
      font_size: fontSize,
      color,
      bold: isTextStyleActive(elements.textOverlayBold),
      italic: isTextStyleActive(elements.textOverlayItalic),
      underline: isTextStyleActive(elements.textOverlayUnderline),
      opacity
    };

    if (maxWidth !== undefined) {
      op.max_width = maxWidth;
    }

    const applied = await applySingleOperation(op, [], elements.addTextOverlayOp);

    if (applied && elements.textOverlayClearAfterApply?.checked) {
      elements.textOverlayText.value = '';
      elements.textOverlayText.focus();
    }
  }

  async function addImageOverlayOperation() {
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

    const imageId = `overlay_image_${Date.now()}_${imageSequence++}`;

    await applySingleOperation({
      type: 'overlay_image',
      image_id: imageId,
      image_name: imageFile.name,
      page,
      x,
      y,
      width,
      height,
      opacity
    }, [{ id: imageId, file: imageFile }], elements.addImageOverlayOp);
  }

  async function undoLastApply() {
    if (undoStack.length === 0 || applying) {
      return;
    }

    const snapshot = undoStack.pop();

    try {
      applying = true;
      setToolActionButtonsDisabled(true);
      updateUndoButton();
      updateDownloadButton();
      setEditStatus('Restoring previous preview...');

      await preview.loadPdfFromFile(snapshot.file, { pageNumber: snapshot.pageNumber });

      latestDownloadUrl = snapshot.downloadUrl;
      latestDownloadFilename = snapshot.downloadFilename;
      updateDownloadButton();

      setEditStatus(`Undone. Current preview: ${snapshot.file.name}`);
    } catch (error) {
      undoStack.push(snapshot);
      console.error(error);
      alert(`Failed to undo.\n\n${error?.message || error}`);
      setEditStatus(`Failed to undo: ${error?.message || error}`);
    } finally {
      applying = false;
      setToolActionButtonsDisabled(false);
      updateUndoButton();
      updateDownloadButton();
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

  function updateSelectedAppendPdfName() {
    const appendFile = elements.appendPdfFile.files[0];

    if (!appendFile) {
      elements.appendPdfName.textContent = 'No PDF selected.';
      return;
    }

    elements.appendPdfName.textContent = appendFile.name;
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
    bindSinglePdfDropZone(elements.editPdfDropZone);
    elements.prevPageButton.addEventListener('click', preview.previousPage);
    elements.nextPageButton.addEventListener('click', preview.nextPage);
    elements.previewPageInput.addEventListener('change', preview.goToInputPage);
    elements.zoomOutButton.addEventListener('click', preview.zoomOut);
    elements.zoomInButton.addEventListener('click', preview.zoomIn);
    elements.previewZoomSelect.addEventListener('change', () => {
      preview.setZoom(elements.previewZoomSelect.value);
    });
    preview.onCoordinateClick(handlePreviewCoordinateClick);
    preview.onRegionSelect(handlePreviewRegionSelect);

    elements.editToolButtons.forEach((button) => {
      button.addEventListener('click', () => {
        currentTool = button.dataset.tool;
        setActiveTool(elements, currentTool);
      });
    });

    elements.addBlankPageOp.addEventListener('click', () => { void addBlankPageOperation(); });
    elements.addImagePageOp.addEventListener('click', () => { void addImagePageOperation(); });
    elements.addAppendPdfOp.addEventListener('click', () => { void addAppendPdfOperation(); });
    elements.addRotateOp.addEventListener('click', () => { void addRotateOperation(); });
    elements.addPageNumbersOp.addEventListener('click', () => { void addPageNumbersOperation(); });
    elements.addDeletePagesOp.addEventListener('click', () => { void addDeletePagesOperation(); });
    elements.addMovePagesOp.addEventListener('click', () => { void addMovePagesOperation(); });
    elements.addTextOverlayOp.addEventListener('click', () => { void addTextOverlayOperation(); });
    elements.addImageOverlayOp.addEventListener('click', () => { void addImageOverlayOperation(); });

    elements.undoEditApply.addEventListener('click', () => { void undoLastApply(); });
    elements.downloadEditedPdf.addEventListener('click', downloadEditedPdf);
    elements.insertImageFile.addEventListener('change', updateSelectedImageName);
    elements.appendPdfFile.addEventListener('change', updateSelectedAppendPdfName);
    elements.imageOverlayFile.addEventListener('change', updateSelectedImageOverlayName);
    bindTextStyleButton(elements.textOverlayBold);
    bindTextStyleButton(elements.textOverlayItalic);
    bindTextStyleButton(elements.textOverlayUnderline);
    bindTextOverlayShortcuts();
    elements.imageOverlayWidth.addEventListener('input', syncImageOverlayHeightFromWidth);
    elements.imageOverlayHeight.addEventListener('input', syncImageOverlayWidthFromHeight);
    elements.imageOverlayLockRatio.addEventListener('change', syncImageOverlayHeightFromWidth);
  }

  function init() {
    bindEvents();
    currentTool = 'blank';
    setActiveTool(elements, currentTool);
    updateUndoButton();
    updateDownloadButton();
  }

  return { init };
}
