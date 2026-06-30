export function getAssembleElements() {
  return {
    fileInput: document.getElementById('pdfFiles'),
    sourceDropZone: document.getElementById('sourceDropZone'),
    clearSourcesButton: document.getElementById('clearSources'),
    sourceRows: document.getElementById('sourceRows'),
    buildButton: document.getElementById('buildButton'),
    statusLine: document.getElementById('statusLine')
  };
}
