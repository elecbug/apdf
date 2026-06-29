import { apiJson } from '../shared/api.js';
import { getOrCreateClientId } from '../shared/client-id.js';
import { clampInput, normalizePositiveInt } from '../shared/input.js';
import { getAssembleElements } from './dom.js';
import { renderAssembly, renderSources } from './render.js';
import { createAssemblyStorage } from './storage.js';

export function createAssembleApp() {
  const elements = getAssembleElements();
  const clientId = getOrCreateClientId();
  const assemblyStorage = createAssemblyStorage(clientId);

  let sources = [];
  let assembly = [];

  function setStatus(message) {
    elements.statusLine.textContent = message;
  }

  function updateSources() {
    renderSources(elements.sourceRows, sources);
  }

  function updateAssembly() {
    renderAssembly(elements.assemblyList, assembly);
    assemblyStorage.save(assembly);
  }

  async function loadSources() {
    const data = await apiJson(`/api/clients/${encodeURIComponent(clientId)}/sources`);
    sources = data.sources || [];
    updateSources();
  }

  function getPdfFiles(fileList) {
    return Array.from(fileList || []).filter((file) => (
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    ));
  }

  async function uploadFiles(fileList) {
    const pdfFiles = getPdfFiles(fileList);

    if (pdfFiles.length === 0) {
      return;
    }

    if (fileList.length !== pdfFiles.length) {
      setStatus('Only PDF files were added. Non-PDF files were ignored.');
    }

    const formData = new FormData();

    for (const file of pdfFiles) {
      formData.append('files', file);
    }

    elements.fileInput.disabled = true;
    setStatus(`Uploading ${pdfFiles.length} PDF(s)...`);

    try {
      const data = await apiJson(`/api/clients/${encodeURIComponent(clientId)}/sources`, {
        method: 'POST',
        body: formData
      });

      elements.fileInput.value = '';

      await loadSources();

      setStatus(`Added ${data.sources.length} PDF(s) to Sources.`);
    } catch (error) {
      alert(error.message);
      setStatus('Upload failed.');
    } finally {
      elements.fileInput.disabled = false;
    }
  }

  async function uploadSelectedFiles() {
    await uploadFiles(elements.fileInput.files);
  }

  function bindDropUpload(dropZone) {
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
      setStatus('Drop PDF files to add them to Sources.');
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

      void uploadFiles(event.dataTransfer.files);
    });
  }

  function handleSourceInput(event) {
    const input = event.target.closest('input.page-input');
    if (!input) return;
    clampInput(input);
  }

  async function handleSourceClick(event) {
    const addButton = event.target.closest('button.add-btn');
    const removeButton = event.target.closest('button.remove-source');

    if (addButton) {
      const sourceId = addButton.dataset.sourceId;
      const source = sources.find((item) => item.source_id === sourceId);
      if (!source) return;

      const startInput = document.getElementById(`start-${sourceId}`);
      const endInput = document.getElementById(`end-${sourceId}`);
      const start = normalizePositiveInt(startInput.value, 1);
      const end = normalizePositiveInt(endInput.value, source.pages);

      if (start > source.pages || end > source.pages) {
        alert(`Page range exceeds PDF page count. Max: ${source.pages}`);
        return;
      }
      if (end < start) {
        alert('Last page must be greater than or equal to First page.');
        return;
      }

      assembly.push({
        source_id: source.source_id,
        name: source.name,
        start,
        end
      });
      updateAssembly();
      return;
    }

    if (removeButton) {
      const sourceId = removeButton.dataset.sourceId;
      if (!confirm('Remove this source PDF from the browser-session cache?')) return;

      try {
        await apiJson(`/api/clients/${encodeURIComponent(clientId)}/sources/${encodeURIComponent(sourceId)}`, {
          method: 'DELETE'
        });
        assembly = assembly.filter((item) => item.source_id !== sourceId);
        await loadSources();
        updateAssembly();
        setStatus('Source removed.');
      } catch (error) {
        alert(error.message);
      }
    }
  }

  function handleAssemblyClick(event) {
    const button = event.target.closest('button');
    if (!button) return;

    const index = Number.parseInt(button.dataset.index, 10);
    const action = button.dataset.action;

    if (action === 'remove') assembly.splice(index, 1);
    if (action === 'up' && index > 0) [assembly[index - 1], assembly[index]] = [assembly[index], assembly[index - 1]];
    if (action === 'down' && index < assembly.length - 1) [assembly[index + 1], assembly[index]] = [assembly[index], assembly[index + 1]];

    updateAssembly();
  }

  function clearAssembly() {
    assembly = [];
    assemblyStorage.clear();
    updateAssembly();
  }

  async function clearSources() {
    if (!confirm('Clear all source PDFs for this browser session?')) return;

    try {
      await apiJson(`/api/clients/${encodeURIComponent(clientId)}/sources`, {
        method: 'DELETE'
      });
      sources = [];
      assembly = [];
      assemblyStorage.clear();
      updateSources();
      updateAssembly();
      setStatus('Sources cleared.');
    } catch (error) {
      alert(error.message);
    }
  }

  async function buildPdf() {
    if (assembly.length === 0) {
      alert('Add at least one range to Assembly.');
      return;
    }

    elements.buildButton.disabled = true;
    setStatus('Building PDF...');

    try {
      const payload = {
        client_id: clientId,
        plan: assembly.map(({source_id, start, end}) => ({source_id, start, end}))
      };

      const data = await apiJson('/compose', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
      });

      window.location.href = data.url;
    } catch (error) {
      alert(error.message);
      setStatus('Build failed.');
    } finally {
      elements.buildButton.disabled = false;
    }
  }

  function bindEvents() {
    elements.fileInput.addEventListener('change', async () => {
      await uploadSelectedFiles();
    });
    bindDropUpload(elements.sourceDropZone);

    elements.sourceRows.addEventListener('input', handleSourceInput);
    elements.sourceRows.addEventListener('click', handleSourceClick);
    elements.assemblyList.addEventListener('click', handleAssemblyClick);
    elements.clearAssembly.addEventListener('click', clearAssembly);
    elements.clearSourcesButton.addEventListener('click', clearSources);
    elements.buildButton.addEventListener('click', buildPdf);
  }

  async function init() {
    bindEvents();

    try {
      await loadSources();
      assembly = assemblyStorage.load(sources);
      updateAssembly();
      setStatus(`Session: ${clientId.slice(0, 8)}...`);
    } catch (error) {
      setStatus('Failed to restore sources.');
    }
  }

  return { init };
}
