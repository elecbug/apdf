export function getEditElements() {
  return {
    editPdfFile: document.getElementById('editPdfFile'),
    editStatusLine: document.getElementById('editStatusLine'),

    previewInfo: document.getElementById('previewInfo'),
    pdfPreviewBox: document.getElementById('pdfPreviewBox'),
    pdfCanvas: document.getElementById('pdfCanvas'),
    prevPageButton: document.getElementById('prevPageButton'),
    nextPageButton: document.getElementById('nextPageButton'),
    previewPageInput: document.getElementById('previewPageInput'),
    previewPageCount: document.getElementById('previewPageCount'),

    editToolButtons: document.querySelectorAll('.edit-tool-button'),
    toolPanels: document.querySelectorAll('.tool-panel'),

    addBlankPageOp: document.getElementById('addBlankPageOp'),
    addImagePageOp: document.getElementById('addImagePageOp'),
    addRotateOp: document.getElementById('addRotateOp'),
    addDeletePagesOp: document.getElementById('addDeletePagesOp'),
    addMovePagesOp: document.getElementById('addMovePagesOp'),

    editOpList: document.getElementById('editOpList'),
    clearEditOps: document.getElementById('clearEditOps'),
    applyEditOps: document.getElementById('applyEditOps'),
    downloadEditedPdf: document.getElementById('downloadEditedPdf'),

    insertImageFile: document.getElementById('insertImageFile'),
    insertImageName: document.getElementById('insertImageName')
  };
}
