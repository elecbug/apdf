function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function setActiveTool(elements, toolName) {
  elements.editToolButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.tool === toolName);
  });

  elements.toolPanels.forEach((panel) => {
    panel.classList.remove('active');
  });

  const panel = document.getElementById(`toolPanel${capitalize(toolName)}`);
  if (panel) {
    panel.classList.add('active');
  }
}
