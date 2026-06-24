export function renderSources(sourceRows, sources) {
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

export function renderAssembly(assemblyList, assembly) {
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
}
