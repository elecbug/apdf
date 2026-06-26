export function getEditElements() {
  return {
    editPdfFile: document.getElementById('editPdfFile'),
    editStatusLine: document.getElementById('editStatusLine'),

    previewInfo: document.getElementById('previewInfo'),
    pdfPreviewBox: document.getElementById('pdfPreviewBox'),
    pdfCanvas: document.getElementById('pdfCanvas'),
    previewCoordinateLine: document.getElementById('previewCoordinateLine'),
    prevPageButton: document.getElementById('prevPageButton'),
    nextPageButton: document.getElementById('nextPageButton'),
    previewPageInput: document.getElementById('previewPageInput'),
    previewPageCount: document.getElementById('previewPageCount'),
    zoomOutButton: document.getElementById('zoomOutButton'),
    previewZoomSelect: document.getElementById('previewZoomSelect'),
    zoomInButton: document.getElementById('zoomInButton'),

    editToolButtons: document.querySelectorAll('.edit-tool-button'),
    toolPanels: document.querySelectorAll('.tool-panel'),
    toolHoverDescription: document.getElementById('toolHoverDescription'),
    activeToolTitle: document.getElementById('activeToolTitle'),
    activeToolDescription: document.getElementById('activeToolDescription'),

    addBlankPageOp: document.getElementById('addBlankPageOp'),
    addImagePageOp: document.getElementById('addImagePageOp'),
    addRotateOp: document.getElementById('addRotateOp'),
    addDeletePagesOp: document.getElementById('addDeletePagesOp'),
    addMovePagesOp: document.getElementById('addMovePagesOp'),
    addTextOverlayOp: document.getElementById('addTextOverlayOp'),
    addImageOverlayOp: document.getElementById('addImageOverlayOp'),

    textOverlayText: document.getElementById('textOverlayText'),
    textOverlayPage: document.getElementById('textOverlayPage'),
    textOverlayX: document.getElementById('textOverlayX'),
    textOverlayY: document.getElementById('textOverlayY'),
    textOverlayCoordinateHint: document.getElementById('textOverlayCoordinateHint'),
    textOverlayFontSize: document.getElementById('textOverlayFontSize'),
    textOverlayOpacity: document.getElementById('textOverlayOpacity'),

    imageOverlayFile: document.getElementById('imageOverlayFile'),
    imageOverlayName: document.getElementById('imageOverlayName'),
    imageOverlayPage: document.getElementById('imageOverlayPage'),
    imageOverlayX: document.getElementById('imageOverlayX'),
    imageOverlayY: document.getElementById('imageOverlayY'),
    imageOverlayCoordinateHint: document.getElementById('imageOverlayCoordinateHint'),
    imageOverlayWidth: document.getElementById('imageOverlayWidth'),
    imageOverlayHeight: document.getElementById('imageOverlayHeight'),
    imageOverlayLockRatio: document.getElementById('imageOverlayLockRatio'),
    imageOverlayOpacity: document.getElementById('imageOverlayOpacity'),

    editOpList: document.getElementById('editOpList'),
    clearEditOps: document.getElementById('clearEditOps'),
    undoEditApply: document.getElementById('undoEditApply'),
    applyEditOps: document.getElementById('applyEditOps'),
    downloadEditedPdf: document.getElementById('downloadEditedPdf'),

    insertImageFile: document.getElementById('insertImageFile'),
    insertImageName: document.getElementById('insertImageName')
  };
}
