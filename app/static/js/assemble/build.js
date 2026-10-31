export async function requestAssembly(payload) {
  const response = await fetch('/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const contentType = response.headers.get('content-type') || '';
  if (response.ok && contentType.split(';')[0].trim() === 'application/pdf') {
    return { file: new File([await response.blob()], 'assembled.pdf', { type: 'application/pdf' }) };
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok !== true) {
    throw new Error(data.detail || data.error || `Failed to build PDF (HTTP ${response.status}).`);
  }
  return data;
}
