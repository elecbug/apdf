import { apiJson } from '../shared/api.js';
import { getOrCreateClientId } from '../shared/client-id.js';
import { clampInput, normalizePositiveInt } from '../shared/input.js';
import { getAssembleElements } from './dom.js';
import { renderSources } from './render.js';
import { createSourceOrderStorage } from './storage.js';

export function createAssembleApp() {
  const elements = getAssembleElements();
  const clientId = getOrCreateClientId();
  const sourceOrderStorage = createSourceOrderStorage(clientId);

  let sources = [];

  function setStatus(message) {
    elements.statusLine.textContent = message;
  }

  function downloadFromUrl(url, filename) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'assembled.pdf';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function readCurrentRange(source) {
    const startInput = document.getElementById(`start-${source.source_id}`);
    const endInput = document.getElementById(`end-${source.source_id}`);

    const start = normalizePositiveInt(startInput?.value, source.start || 1);
    const end = normalizePositiveInt(endInput?.value, source.end || source.pages);

    return {
      start: Math.max(1, Math.min(start, source.pages)),
      end: Math.max(1, Math.min(end, source.pages))
    };
  }

  function captureSourceRanges() {
    sources = sources.map((source) => ({
      ...source,
      ...readCurrentRange(source)
    }));
  }

  function normalizeSource(source, previousById) {
    const previous = previousById.get(source.source_id);
    const start = previous?.start || 1;
    const end = previous?.end || source.pages;

    return {
      ...source,
      start: Math.max(1, Math.min(start, source.pages)),
      end: Math.max(1, Math.min(Math.max(start, end), source.pages))
    };
  }

  function updateSources() {
    renderSources(elements.sourceRows, sources);
    sourceOrderStorage.save(sources);
  }

  async function loadSources() {
    const previousById = new Map(sources.map((source) => [source.source_id, source]));
    const data = await apiJson(`/api/clients/${encodeURIComponent(clientId)}/sources`);
    const loaded = (data.sources || []).map((source) => normalizeSource(source, previousById));
    sources = sourceOrderStorage.apply(loaded);
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

    captureSourceRanges();

    const formData = new FormData();

    for (const file of pdfFiles) {
      formData.append('files', file);
    }

    elements.fileInput.disabled = true;
    elements.buildButton.disabled = true;
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
      elements.buildButton.disabled = false;
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

    const row = input.closest('tr[data-source-id]');
    const source = sources.find((item) => item.source_id === row?.dataset.sourceId);

    if (source) {
      Object.assign(source, readCurrentRange(source));
    }
  }

  function moveSource(sourceId, direction) {
    captureSourceRanges();

    const index = sources.findIndex((item) => item.source_id === sourceId);
    if (index < 0) {
      return;
    }

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sources.length) {
      return;
    }

    [sources[index], sources[targetIndex]] = [sources[targetIndex], sources[index]];
    updateSources();
  }

  async function handleSourceClick(event) {
    const moveButton = event.target.closest('button.move-source');
    const removeButton = event.target.closest('button.remove-source');

    if (moveButton) {
      moveSource(moveButton.dataset.sourceId, moveButton.dataset.action);
      return;
    }

    if (removeButton) {
      const sourceId = removeButton.dataset.sourceId;

      try {
        captureSourceRanges();
        await apiJson(`/api/clients/${encodeURIComponent(clientId)}/sources/${encodeURIComponent(sourceId)}`, {
          method: 'DELETE'
        });
        sources = sources.filter((item) => item.source_id !== sourceId);
        updateSources();
        setStatus('Source removed.');
      } catch (error) {
        alert(error.message);
      }
    }
  }

  function buildPlanFromSources() {
    captureSourceRanges();

    if (sources.length === 0) {
      alert('Add at least one source PDF.');
      return null;
    }

    const plan = [];

    for (const source of sources) {
      const start = normalizePositiveInt(source.start, 1);
      const end = normalizePositiveInt(source.end, source.pages);

      if (start > source.pages || end > source.pages) {
        alert(`Page range exceeds PDF page count for ${source.name}. Max: ${source.pages}`);
        return null;
      }

      if (end < start) {
        alert(`Last page must be greater than or equal to First page for ${source.name}.`);
        return null;
      }

      plan.push({
        source_id: source.source_id,
        start,
        end
      });
    }

    return plan;
  }

  async function clearSources() {
    try {
      await apiJson(`/api/clients/${encodeURIComponent(clientId)}/sources`, {
        method: 'DELETE'
      });
      sources = [];
      sourceOrderStorage.clear();
      updateSources();
      setStatus('Sources cleared.');
    } catch (error) {
      alert(error.message);
    }
  }

  async function buildPdf() {
    const plan = buildPlanFromSources();

    if (!plan) {
      return;
    }

    elements.buildButton.disabled = true;
    setStatus('Building PDF...');

    try {
      const payload = {
        client_id: clientId,
        plan
      };

      const data = await apiJson('/compose', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
      });

      if (data.download_url) {
        downloadFromUrl(data.download_url, data.filename || 'assembled.pdf');
        setStatus(`Built PDF. Download started. Result code: ${data.code}`);
        return;
      }

      if (data.url) {
        window.location.href = data.url;
        return;
      }

      throw new Error('Build succeeded, but no download or result URL was returned.');
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
    elements.clearSourcesButton.addEventListener('click', clearSources);
    elements.buildButton.addEventListener('click', buildPdf);
  }

  async function init() {
    bindEvents();

    try {
      await loadSources();
      setStatus(`Session: ${clientId.slice(0, 8)}...`);
    } catch (error) {
      setStatus('Failed to restore sources.');
    }
  }

  return { init };
}
