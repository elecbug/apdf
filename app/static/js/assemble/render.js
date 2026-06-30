function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderSources(sourceRows, sources) {
  sourceRows.innerHTML = '';

  if (sources.length === 0) {
    sourceRows.innerHTML = '<tr class="empty"><td colspan="5">No PDFs loaded.</td></tr>';
    return;
  }

  sources.forEach((source, index) => {
    const tr = document.createElement('tr');
    const safeName = escapeHtml(source.name);
    const isFirst = index === 0;
    const isLast = index === sources.length - 1;

    tr.dataset.sourceId = source.source_id;
    tr.innerHTML = `
      <td class="filename" title="${safeName}">${safeName}</td>
      <td>${source.pages}</td>
      <td>
        <input class="page-input"
               id="start-${source.source_id}"
               type="number"
               min="1"
               max="${source.pages}"
               value="${source.start || 1}">
      </td>
      <td>
        <input class="page-input"
               id="end-${source.source_id}"
               type="number"
               min="1"
               max="${source.pages}"
               value="${source.end || source.pages}">
      </td>
      <td class="source-actions">
        <button type="button"
                class="move-source"
                data-action="up"
                data-source-id="${source.source_id}"
                ${isFirst ? 'disabled' : ''}
                title="Move up">↑</button>
        <button type="button"
                class="move-source"
                data-action="down"
                data-source-id="${source.source_id}"
                ${isLast ? 'disabled' : ''}
                title="Move down">↓</button>
        <button type="button" class="remove-source" data-source-id="${source.source_id}">Remove</button>
      </td>
    `;
    sourceRows.appendChild(tr);
  });
}
