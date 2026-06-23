const editCodeInput = document.getElementById('editCodeInput');
const loadEditTarget = document.getElementById('loadEditTarget');
const editTargetInfo = document.getElementById('editTargetInfo');
const editOpList = document.getElementById('editOpList');
const clearEditOps = document.getElementById('clearEditOps');
const applyEditOps = document.getElementById('applyEditOps');

let editTarget = null;
let editOps = [];

function renderEditOps() {
  editOpList.innerHTML = '';

  if (editOps.length === 0) {
    return;
  }

  editOps.forEach((op, index) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>
        <strong>${index + 1}.</strong>
        <code>${op.type}</code>
        ${JSON.stringify(op)}
      </span>
      <button type="button" data-index="${index}" class="warning">Remove</button>
    `;
    editOpList.appendChild(li);
  });
}

loadEditTarget.addEventListener('click', () => {
  const code = editCodeInput.value.trim().toUpperCase();

  if (!code) {
    alert('Enter a result code.');
    return;
  }

  editTarget = { code };

  editTargetInfo.textContent = `Loaded target code: ${code}`;
});

document.getElementById('addRotateOp').addEventListener('click', () => {
  const pages = document.getElementById('rotatePages').value.trim();
  const angle = Number.parseInt(document.getElementById('rotateAngle').value, 10);

  if (!pages) {
    alert('Enter pages.');
    return;
  }

  editOps.push({
    type: 'rotate',
    pages,
    angle
  });

  renderEditOps();
});

document.getElementById('addBlankPageOp').addEventListener('click', () => {
  const afterPage = Number.parseInt(document.getElementById('blankAfterPage').value, 10);

  if (!Number.isFinite(afterPage) || afterPage < 0) {
    alert('Enter a valid page number.');
    return;
  }

  editOps.push({
    type: 'insert_blank',
    after_page: afterPage
  });

  renderEditOps();
});

editOpList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-index]');
  if (!button) return;

  const index = Number.parseInt(button.dataset.index, 10);
  editOps.splice(index, 1);
  renderEditOps();
});

clearEditOps.addEventListener('click', () => {
  editOps = [];
  renderEditOps();
});

applyEditOps.addEventListener('click', () => {
  if (!editTarget) {
    alert('Load a target PDF first.');
    return;
  }

  if (editOps.length === 0) {
    alert('Add at least one edit operation.');
    return;
  }

  alert('Edit backend is not implemented yet.');
});