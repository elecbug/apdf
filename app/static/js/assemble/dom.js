export function getAssembleElements() {
  return {
    fileInput: document.getElementById('pdfFiles'),
    clearSourcesButton: document.getElementById('clearSources'),
    sourceRows: document.getElementById('sourceRows'),
    assemblyList: document.getElementById('assemblyList'),
    clearAssembly: document.getElementById('clearAssembly'),
    buildButton: document.getElementById('buildButton'),
    statusLine: document.getElementById('statusLine')
  };
}
