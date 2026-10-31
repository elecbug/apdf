const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium, _electron } = require('playwright');
const desktop = process.env.APDF_TEST_DESKTOP === '1';
const base = desktop ? 'apdf://app' : (process.argv[2] || 'http://127.0.0.1:4173');

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'apdf-local-'));
  execFileSync(process.env.APDF_TEST_PYTHON || 'python3', ['-c', `
import sys
from pathlib import Path
from reportlab.pdfgen import canvas
from PIL import Image
root = Path(sys.argv[1])
for name, count in [('source-a', 3), ('source-b', 2)]:
    c = canvas.Canvas(str(root / (name + '.pdf')), pagesize=(300, 420))
    for number in range(1, count + 1):
        c.drawString(25, 390, name + '-' + str(number)); c.showPage()
    c.save()
Image.new('RGB', (40, 20), 'red').save(root/'red.png')
`, temp]);
  let electron;
  async function launchDesktop() {
    const flags = process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu'] : [];
    if (process.env.APDF_TEST_NO_SANDBOX === '1') flags.push('--no-sandbox');
    const executablePath = process.env.APDF_DESKTOP_EXECUTABLE;
    const instance = await _electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? flags : [...flags, path.resolve('desktop/.build/app')],
      env: { ...process.env, APDF_DESKTOP_DATA_DIR: path.join(temp, 'profile') },
      timeout: 30000,
    });
    await instance.evaluate(({ dialog }) => {
      globalThis.apdfTestPrompts = 0;
      globalThis.apdfTestLeaveChoice = 1;
      dialog.showMessageBoxSync = () => { globalThis.apdfTestPrompts++; return globalThis.apdfTestLeaveChoice; };
    });
    return instance;
  }
  if (desktop) electron = await launchDesktop();
  const browser = desktop ? {
    async newContext() { return electron.context(); },
    async close() {
      await electron.evaluate(() => { globalThis.apdfTestLeaveChoice = 1; }).catch(() => {});
      await electron.close();
    },
  } : await chromium.launch({ headless: true });
  try {
    let context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    let page = desktop ? await electron.firstWindow() : await context.newPage();
    const errors = [], network = [], alerts = [];
    let leaveWarnings = 0;
    if (desktop) {
      await context.exposeBinding('apdfTestAlert', (_source, message) => alerts.push(message));
      await context.addInitScript(() => { window.alert = message => { void window.apdfTestAlert(String(message)); }; });
      await page.evaluate(() => { window.alert = message => { void window.apdfTestAlert(String(message)); }; });
    }
    context.on('request', request => {
      const url = request.url();
      if (url.startsWith('http')) network.push({ url, method: request.method() });
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => {
      if (dialog.type() === 'beforeunload') { leaveWarnings += 1; if (!desktop) await dialog.accept(); }
      else { alerts.push(dialog.message()); await dialog.dismiss().catch(error => { if (!desktop) throw error; }); }
    });
    if (!desktop) await page.goto(base);
    await page.waitForSelector('#editPdfFile', { timeout: 60000 });
    await page.waitForFunction(desktop => document.querySelector('.offline-status').textContent === (desktop ? 'Offline desktop app · Everything is included' : 'Ready for offline use'), desktop, { timeout: 60000 });
    if (desktop) {
      assert.deepEqual(await page.evaluate(() => [typeof require, typeof process]), ['undefined', 'undefined']);
      assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox), true);
    }
    assert.equal(await page.locator('.edit-tool-button').count(), 11);
    assert.equal(await page.locator('.edit-tool-button img').evaluateAll(images => images.filter(img => !img.complete || !img.naturalWidth).length), 0);
    // No server is reachable after this point, including from the Python worker.
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('#editPdfFile', { timeout: 60000 });
    await page.locator('#editPdfFile').setInputFiles(path.join(temp, 'source-a.pdf'));
    await page.waitForFunction(() => document.querySelector('#previewPageCount').textContent === '/ 3' && !document.querySelector('#editPdfFile').disabled);
    async function tool(name) { await page.locator(`[data-tool="${name}"]`).click(); }
    async function apply(button) {
      await page.locator(button).click();
      await page.waitForFunction(() => document.querySelector('#editStatusLine').textContent.startsWith('Applied edit.') && !document.querySelector('#editPdfFile').disabled, null, { timeout: 30000 }).catch(async error => { console.error(await page.locator('#editStatusLine').innerText()); throw error; });
    }
    async function pdfInfo(filename) {
      return page.evaluate(async ({ bytes, base }) => {
        const pdfjs = await import(base + '/vendor/pdfjs/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = base + '/vendor/pdfjs/pdf.worker.mjs';
        const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false });
        const doc = await task.promise;
        const pages = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          pages.push({ text: (await page.getTextContent()).items.map(item => item.str).join(' '), rotation: page.rotate });
        }
        await task.destroy();
        return pages;
      }, { bytes: [...await fs.readFile(filename)], base });
    }
    async function download(button, name) {
      if (desktop) {
        const filename = path.join(temp, name);
        await electron.evaluate(({ session }, filename) => {
          globalThis.apdfTestDownloads ||= {};
          session.fromPartition('persist:apdf-local').once('will-download', (_event, item) => {
            item.setSavePath(filename);
            item.once('done', (_event, state) => { globalThis.apdfTestDownloads[filename] = state; });
          });
        }, filename);
        await page.locator(button).click();
        const deadline = Date.now() + 30000;
        let state;
        while (!state && Date.now() < deadline) {
          state = await electron.evaluate((_electron, filename) => globalThis.apdfTestDownloads?.[filename], filename);
          if (!state) await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.equal(state, 'completed');
        return filename;
      }
      const pending = page.waitForEvent('download');
      await page.locator(button).click();
      const result = await pending;
      const filename = path.join(temp, name);
      await result.saveAs(filename);
      return filename;
    }
    async function drag(x1, y1, x2, y2) {
      const canvas = page.locator('#pdfCanvas');
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + x1, box.y + y1);
      await page.mouse.down();
      await page.mouse.move(box.x + x2, box.y + y2, { steps: 18 });
      await page.mouse.up();
    }
    await tool('blank');
    await page.locator('#blankPosition').selectOption('end');
    await apply('#addBlankPageOp');
    assert.equal(await page.locator('#previewPageCount').innerText(), '/ 4');
    await tool('image');
    await page.locator('#insertImageFile').setInputFiles(path.join(temp, 'red.png'));
    await page.locator('#imagePosition').selectOption('end');
    await apply('#addImagePageOp');
    await tool('append');
    await page.locator('#appendPdfFile').setInputFiles(path.join(temp, 'source-b.pdf'));
    await page.locator('#appendPosition').selectOption('end');
    await apply('#addAppendPdfOp');
    assert.equal(await page.locator('#previewPageCount').innerText(), '/ 7');
    await tool('rotate');
    await page.locator('#rotatePages').fill('2');
    await page.locator('#rotateAngle').selectOption('90');
    await apply('#addRotateOp');
    await tool('pageNumbers');
    await apply('#addPageNumbersOp');
    await tool('delete');
    await page.locator('#deletePages').fill('4-5');
    await apply('#addDeletePagesOp');
    assert.equal(await page.locator('#previewPageCount').innerText(), '/ 5');
    await tool('move');
    await page.locator('#movePages').fill('5');
    await page.locator('#movePosition').selectOption('before');
    await apply('#addMovePagesOp');
    await tool('text');
    await page.locator('#textOverlayText').fill('한글 로컬 PDF');
    await page.locator('#textOverlayX').fill('30');
    await page.locator('#textOverlayY').fill('320');
    await apply('#addTextOverlayOp');
    await tool('imageOverlay');
    await page.locator('#imageOverlayFile').setInputFiles(path.join(temp, 'red.png'));
    await page.locator('#imageOverlayX').fill('30');
    await page.locator('#imageOverlayY').fill('20');
    await page.locator('#imageOverlayOpacity').fill('0.5');
    await apply('#addImageOverlayOp');
    await page.locator('#previewZoomSelect').selectOption('1');
    await page.waitForFunction(() => document.querySelector('#pdfCanvas').width === 300);
    await tool('shape');
    for (const shape of ['circle', 'rectangle', 'triangle', 'pentagon', 'star', 'rounded_rectangle']) {
      await page.locator('#shapeOverlayType').selectOption(shape);
      await drag(40, 130, 130, 220);
      assert(Number(await page.locator('#shapeOverlayWidth').inputValue()) > 80);
      await apply('#addShapeOverlayOp');
    }
    await page.locator('#shapeOverlayFillTransparent').check();
    await page.locator('#shapeOverlayStrokeOpacity').fill('0.3');
    await apply('#addShapeOverlayOp');
    await tool('pen');
    for (const texture of ['ink', 'pencil', 'marker', 'dry_brush']) {
      await page.locator('#penTexture').selectOption(texture);
      await page.locator('#penWidth').fill('7');
      await page.locator('#penOpacity').fill('0.6');
      await drag(40, 230, 180, 260);
      await page.waitForFunction(() => !document.querySelector('#applyPenDrawing').disabled);
      await apply('#applyPenDrawing');
    }
    await drag(40, 285, 200, 300);
    const edited = await download('#downloadEditedPdf', 'edited.pdf');
    assert(await page.locator('#applyPenDrawing').isDisabled(), 'Download must commit pending drawing');
    const editedPages = await pdfInfo(edited);
    assert.equal(editedPages.length, 5);
    assert(editedPages[0].text.includes('source-b-2'));
    assert(editedPages[0].text.includes('한글 로컬 PDF'));
    assert.equal(editedPages[2].rotation, 90);
    await page.locator('#undoEditApply').click();
    await page.waitForFunction(() => document.querySelector('#editStatusLine').textContent.startsWith('Undone.'));
    await fs.mkdir('docs/design', { recursive: true });
    await page.screenshot({ path: `docs/design/${desktop ? 'desktop' : 'local-app'}-edit.png`, fullPage: true });
    if (desktop) {
      await electron.evaluate(({ BrowserWindow }) => {
        globalThis.apdfTestLeaveChoice = 0;
        BrowserWindow.getAllWindows()[0].close();
      });
      assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
      assert.equal(await page.locator('#previewPageCount').innerText(), '/ 5');
      await electron.evaluate(() => { globalThis.apdfTestLeaveChoice = 1; });
    }
    // A real reload must invoke the existing native leave warning.
    await page.reload();
    await page.waitForSelector('#editPdfFile', { timeout: 60000 });
    if (desktop) assert.equal(await electron.evaluate(() => globalThis.apdfTestPrompts), 2);
    else assert.equal(leaveWarnings, 1);
    await page.locator('a[href="?view=assemble"]').click();
    await page.waitForSelector('#pdfFiles', { timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector('#pdfFiles').disabled);
    await page.locator('#pdfFiles').setInputFiles([path.join(temp, 'source-a.pdf'), path.join(temp, 'source-b.pdf')]);
    await page.waitForFunction(() => document.querySelectorAll('#sourceRows tr[data-source-id]').length === 2 && !document.querySelector('#pdfFiles').disabled);
    let rows = page.locator('#sourceRows tr[data-source-id]');
    const firstId = await rows.nth(0).getAttribute('data-source-id');
    await page.locator(`#start-${firstId}`).fill('2');
    await rows.nth(1).locator('button[data-action="up"]').click();
    await page.reload();
    await page.waitForSelector('#pdfFiles', { timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll('#sourceRows tr[data-source-id]').length === 2 && !document.querySelector('#pdfFiles').disabled);
    assert((await rows.nth(0).innerText()).includes('source-b.pdf'));
    assert.equal(await page.locator(`#start-${firstId}`).inputValue(), '2');
    // A bad PDF must roll back the entire new batch, preserving existing sources.
    await page.locator('#pdfFiles').setInputFiles([
      { name: 'valid.pdf', mimeType: 'application/pdf', buffer: await fs.readFile(path.join(temp, 'source-a.pdf')) },
      { name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') },
    ]);
    await page.waitForFunction(() => document.querySelector('#statusLine').textContent === 'Could not add PDFs.');
    assert.equal(await rows.count(), 2);
    assert.equal(alerts.length, 1);
    alerts.length = 0;
    const assembled = await download('#buildButton', 'assembled.pdf');
    const assembledPages = await pdfInfo(assembled);
    assert.deepEqual(assembledPages.map(page => page.text), ['source-b-1', 'source-b-2', 'source-a-2', 'source-a-3']);
    await page.screenshot({ path: `docs/design/${desktop ? 'desktop' : 'local-app'}-assemble.png`, fullPage: true });
    if (desktop) {
      const denied = await page.evaluate(async () => {
        try { await fetch('https://example.com/apdf-should-stay-offline'); return false; } catch { return true; }
      });
      assert(denied, 'External requests must be blocked');
      assert(new URL(await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href'), base).pathname.endsWith('.svg'));
      // Close the entire native process, then restore the same persistent profile.
      await electron.close();
      electron = await launchDesktop();
      context = electron.context();
      page = await electron.firstWindow();
      page.on('pageerror', error => errors.push(error.message));
      await context.setOffline(true);
      await page.waitForSelector('#editPdfFile', { timeout: 60000 });
      await page.locator('a[href="?view=assemble"]').click();
      await page.waitForFunction(() => document.querySelectorAll('#sourceRows tr[data-source-id]').length === 2 && !document.querySelector('#pdfFiles').disabled, null, { timeout: 60000 });
      rows = page.locator('#sourceRows tr[data-source-id]');
      assert((await rows.nth(0).innerText()).includes('source-b.pdf'));
      assert.equal(await page.locator(`#start-${firstId}`).inputValue(), '2');
    }
    await page.locator('#clearSources').click();
    await page.waitForFunction(() => document.querySelectorAll('#sourceRows tr[data-source-id]').length === 0);
    await page.reload();
    await page.waitForSelector('#pdfFiles', { timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector('#pdfFiles').disabled);
    assert.equal(await rows.count(), 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(alerts, []);
    assert(network.filter(request => !request.url.endsWith('/apdf-should-stay-offline')).every(request => new URL(request.url).origin === new URL(base).origin && request.method === 'GET'), JSON.stringify(network.filter(request => request.method !== 'GET')));
    assert(!network.some(request => /\/api\/|\/edit\/apply|\/compose/.test(request.url)));
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Mobile page must fit the viewport');
    console.log(`${desktop ? 'Desktop' : 'Local browser'} checks passed: 11 edit tools, 6 shapes, 4 brushes, Korean text, Undo/download, leave warning, persistent assembly/ranges${desktop ? ' across app restarts' : ''}, atomic source batches, offline reload, no uploads/external requests, mobile layout.`);
  } finally { await browser.close(); await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
