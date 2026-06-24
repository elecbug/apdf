export function downloadFromUrl(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'edited.pdf';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function downloadFileObject(file, filename) {
  const objectUrl = URL.createObjectURL(file);

  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename || file.name || 'edited.pdf';
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(objectUrl);
}
