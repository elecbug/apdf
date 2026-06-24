export function renderEditOps(editOpList, editOps) {
  editOpList.innerHTML = '';

  editOps.forEach((op, index) => {
    const li = document.createElement('li');

    li.innerHTML = `
      <span>
        <strong>${index + 1}.</strong>
        <code>${op.type}</code>
        ${formatOperation(op)}
      </span>
      <button type="button" class="warning" data-index="${index}">Remove</button>
    `;

    editOpList.appendChild(li);
  });
}

export function formatOperation(op) {
  if (op.type === 'insert_blank') {
    if (op.position === 'end') {
      return 'at end';
    }

    return `${op.position} page ${op.page}`;
  }

  if (op.type === 'insert_image_page') {
    if (op.position === 'end') {
      return `${op.image_name} at end`;
    }

    return `${op.image_name} ${op.position} page ${op.page}`;
  }

  if (op.type === 'rotate') {
    return `pages ${op.pages}, ${op.angle}°`;
  }

  if (op.type === 'delete_pages') {
    return `pages ${op.pages}`;
  }

  return JSON.stringify(op);
}
