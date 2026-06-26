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

  if (op.type === 'move_pages') {
    if (op.position === 'end') {
      return `pages ${op.pages} to end`;
    }

    return `pages ${op.pages} ${op.position} page ${op.target_page}`;
  }

  if (op.type === 'overlay_text') {
    const shortText = op.text.length > 24 ? `${op.text.slice(0, 24)}...` : op.text;
    return `\"${shortText}\" on page ${op.page} at (${Number(op.x).toFixed(1)}, ${Number(op.y).toFixed(1)})`;
  }

  if (op.type === 'overlay_image') {
    return `${op.image_name} on page ${op.page} at (${Number(op.x).toFixed(1)}, ${Number(op.y).toFixed(1)}), ${Number(op.width).toFixed(1)}×${Number(op.height).toFixed(1)} pt`;
  }

  return JSON.stringify(op);
}
