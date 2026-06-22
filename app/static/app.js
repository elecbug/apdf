
const fileInput = document.getElementById('pdfFiles');
const clearSourcesButton = document.getElementById('clearSources');
const sourceRows = document.getElementById('sourceRows');
const assemblyList = document.getElementById('assemblyList');
const clearAssembly = document.getElementById('clearAssembly');
const buildButton = document.getElementById('buildButton');
const statusLine = document.getElementById('statusLine');
const clientId = getOrCreateClientId();
const ASSEMBLY_STORAGE_KEY = `apdf_assembly_${clientId}`;

let sources = [];
let assembly = [];

function saveAssembly() {
  localStorage.setItem(ASSEMBLY_STORAGE_KEY, JSON.stringify(assembly));
}

function loadAssembly() {
  const raw = localStorage.getItem(ASSEMBLY_STORAGE_KEY);

  if (!raw) {
    assembly = [];
    return;
  }

  try {
    const loaded = JSON.parse(raw);

    if (!Array.isArray(loaded)) {
      assembly = [];
      return;
    }

    const validSourceIds = new Set(sources.map(source => source.source_id));

    assembly = loaded
      .filter(item => validSourceIds.has(item.source_id))
      .map(item => {
        const source = sources.find(source => source.source_id === item.source_id);
        const maxPage = source.pages;

        const start = Math.max(1, Math.min(Number.parseInt(item.start, 10) || 1, maxPage));
        const end = Math.max(start, Math.min(Number.parseInt(item.end, 10) || maxPage, maxPage));

        return {
          source_id: item.source_id,
          name: source.name,
          start,
          end
        };
      });

  } catch {
    assembly = [];
  }
}

function clearSavedAssembly() {
  localStorage.removeItem(ASSEMBLY_STORAGE_KEY);
}

function setStatus(message) {
  statusLine.textContent = message;
}

function getOrCreateClientId() {
  let clientId = localStorage.getItem('apdf_client_id');
  if (!clientId) {
    clientId = crypto.randomUUID();
    localStorage.setItem('apdf_client_id', clientId);
  }
  return clientId;
}

function normalizePositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clampInput(input) {
  const min = Number.parseInt(input.min, 10);
  const max = Number.parseInt(input.max, 10);
  let value = Number.parseInt(input.value, 10);

  if (Number.isNaN(value)) return;
  if (value < min) input.value = min;
  if (value > max) input.value = max;
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function loadSources() {
  const data = await apiJson(`/api/clients/${encodeURIComponent(clientId)}/sources`);
  sources = data.sources || [];
  renderSources();
}

function renderSources() {
  sourceRows.innerHTML = '';

  if (sources.length === 0) {
    sourceRows.innerHTML = '<tr class="empty"><td colspan="5">No PDFs loaded.</td></tr>';
    return;
  }

  sources.forEach((source) => {
    const tr = document.createElement('tr');
    tr.dataset.sourceId = source.source_id;
    tr.innerHTML = `
      <td class="filename" title="${source.name}">${source.name}</td>
      <td>${source.pages}</td>
      <td>
        <input class="page-input"
               id="start-${source.source_id}"
               type="number"
               min="1"
               max="${source.pages}"
               value="1">
      </td>
      <td>
        <input class="page-input"
               id="end-${source.source_id}"
               type="number"
               min="1"
               max="${source.pages}"
               value="${source.pages}">
      </td>
      <td class="source-actions">
        <button type="button" class="add-btn" data-source-id="${source.source_id}">Add</button>
        <button type="button" class="remove-source" data-source-id="${source.source_id}">Remove</button>
      </td>
    `;
    sourceRows.appendChild(tr);
  });
}

function renderAssembly() {
  assemblyList.innerHTML = '';

  assembly.forEach((item, index) => {
    const li = document.createElement('li');

    li.innerHTML = `
      <span>
        <strong>${index + 1}.</strong>
        ${item.name}
        <code>${item.start}-${item.end}</code>
      </span>
      <span class="item-actions">
        <button type="button" data-action="up" data-index="${index}">↑</button>
        <button type="button" data-action="down" data-index="${index}">↓</button>
        <button type="button" data-action="remove" data-index="${index}">Remove</button>
      </span>
    `;

    assemblyList.appendChild(li);
  });

  saveAssembly();
}

async function uploadSelectedFiles() {
  if (!fileInput.files || fileInput.files.length === 0) {
    return;
  }

  const formData = new FormData();

  for (const file of fileInput.files) {
    formData.append('files', file);
  }

  const count = fileInput.files.length;

  fileInput.disabled = true;
  setStatus(`Uploading ${count} PDF(s)...`);

  try {
    const data = await apiJson(`/api/clients/${encodeURIComponent(clientId)}/sources`, {
      method: 'POST',
      body: formData
    });

    fileInput.value = '';

    await loadSources();

    setStatus(`Added ${data.sources.length} PDF(s) to Sources.`);
  } catch (error) {
    alert(error.message);
    setStatus('Upload failed.');
  } finally {
    fileInput.disabled = false;
  }
}

fileInput.addEventListener('change', async () => {
  await uploadSelectedFiles();
});

sourceRows.addEventListener('input', (event) => {
  const input = event.target.closest('input.page-input');
  if (!input) return;
  clampInput(input);
});

sourceRows.addEventListener('click', async (event) => {
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
    renderAssembly();
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
      renderAssembly();
      setStatus('Source removed.');
    } catch (error) {
      alert(error.message);
    }
  }
});

assemblyList.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;

  const index = Number.parseInt(button.dataset.index, 10);
  const action = button.dataset.action;

  if (action === 'remove') assembly.splice(index, 1);
  if (action === 'up' && index > 0) [assembly[index - 1], assembly[index]] = [assembly[index], assembly[index - 1]];
  if (action === 'down' && index < assembly.length - 1) [assembly[index + 1], assembly[index]] = [assembly[index], assembly[index + 1]];

  renderAssembly();
});

clearAssembly.addEventListener('click', () => {
  assembly = [];
  clearSavedAssembly();
  renderAssembly();
});

clearSourcesButton.addEventListener('click', async () => {
  if (!confirm('Clear all source PDFs for this browser session?')) return;

  try {
    await apiJson(`/api/clients/${encodeURIComponent(clientId)}/sources`, {
      method: 'DELETE'
    });
    sources = [];
    assembly = [];
    clearSavedAssembly();
    renderSources();
    renderAssembly();
    setStatus('Sources cleared.');
  } catch (error) {
    alert(error.message);
  }
});

buildButton.addEventListener('click', async () => {
  if (assembly.length === 0) {
    alert('Add at least one range to Assembly.');
    return;
  }

  buildButton.disabled = true;
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
    buildButton.disabled = false;
  }
});

(async function init() {
  try {
    await loadSources();
    loadAssembly();
    renderAssembly();
    setStatus(`Session: ${clientId.slice(0, 8)}...`);
  } catch (error) {
    setStatus('Failed to restore sources.');
  }
})();