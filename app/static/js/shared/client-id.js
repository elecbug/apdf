export function generateClientId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }

  if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20)
    ].join('-');
  }

  return `apdf-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

let sessionClientId = null;

export function getOrCreateClientId() {
  try {
    const saved = localStorage.getItem('apdf_client_id');
    if (saved && /^[a-zA-Z0-9_-]{8,80}$/.test(saved)) {
      sessionClientId = saved;
      return saved;
    }
  } catch {
    // Keep a usable session even if the browser blocks persistent storage.
  }

  sessionClientId ||= generateClientId();
  try {
    localStorage.setItem('apdf_client_id', sessionClientId);
  } catch {
    // The in-memory ID remains stable for this page's lifetime.
  }
  return sessionClientId;
}
