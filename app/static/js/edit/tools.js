function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function getToolTitle(button, fallback) {
  return button?.dataset.toolTitle || fallback || 'Tool';
}

function getToolDescription(button) {
  return button?.dataset.toolDescription || 'Select a tool to configure an edit operation.';
}

function setHoverDescription(elements, button) {
  if (!elements.toolHoverDescription || !button) {
    return;
  }

  const title = getToolTitle(button);
  const description = getToolDescription(button);
  elements.toolHoverDescription.textContent = `${title}: ${description}`;
}

function resetHoverDescription(elements) {
  if (!elements.toolHoverDescription) {
    return;
  }

  const activeButton = Array.from(elements.editToolButtons).find((button) => (
    button.classList.contains('active')
  ));

  if (activeButton) {
    setHoverDescription(elements, activeButton);
    return;
  }

  elements.toolHoverDescription.textContent = 'Hover over a tool to see what it does.';
}

export function setActiveTool(elements, toolName) {
  let activeButton = null;

  elements.editToolButtons.forEach((button) => {
    const isActive = button.dataset.tool === toolName;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');

    if (isActive) {
      activeButton = button;
    }
  });

  elements.toolPanels.forEach((panel) => {
    panel.classList.remove('active');
  });

  const panel = document.getElementById(`toolPanel${capitalize(toolName)}`);
  if (panel) {
    panel.classList.add('active');
  }

  if (activeButton) {
    if (elements.activeToolTitle) {
      elements.activeToolTitle.textContent = getToolTitle(activeButton, capitalize(toolName));
    }

    if (elements.activeToolDescription) {
      elements.activeToolDescription.textContent = getToolDescription(activeButton);
    }

    setHoverDescription(elements, activeButton);
  }
}

export function bindToolHoverDescriptions(elements) {
  elements.editToolButtons.forEach((button) => {
    button.setAttribute('role', 'tab');
    button.setAttribute('title', getToolDescription(button));

    button.addEventListener('mouseenter', () => {
      setHoverDescription(elements, button);
    });

    button.addEventListener('focus', () => {
      setHoverDescription(elements, button);
    });

    button.addEventListener('mouseleave', () => {
      resetHoverDescription(elements);
    });

    button.addEventListener('blur', () => {
      resetHoverDescription(elements);
    });
  });

  resetHoverDescription(elements);
}
