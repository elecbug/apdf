// Run against a disposable APDF server; see tools/README.md.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.APDF_PLAYWRIGHT_MODULE || 'playwright');

const base = process.argv[2] || 'http://127.0.0.1:8000';
const root = path.resolve(__dirname, '..');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'apdf-browser-'));
  execFileSync(process.env.APDF_TEST_PYTHON || 'python3', ['-c', `
import sys
from pathlib import Path
from pypdf import PdfWriter
from pypdf.generic import RectangleObject
from PIL import Image
root = Path(sys.argv[1])
w = PdfWriter()
p = w.add_blank_page(400, 600)
p.cropbox = RectangleObject((40, 80, 340, 500))
p.rotate(90)
w.write(root / 'rotated.pdf')
w = PdfWriter()
w.add_blank_page(2000, 1000)
w.write(root / 'wide.pdf')
Image.new('RGB', (40, 20), 'red').save(root / 'red.png')
`, temp]);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    // Wrap the actual PDF.js engine to introduce deterministic delays/errors.
    const pdfjsRoot = process.env.APDF_TEST_PDFJS;
    const realModule = pdfjsRoot
      ? await fs.readFile(path.join(pdfjsRoot, 'build/pdf.mjs'), 'utf8')
      : await (await fetch(base + '/static/pdfjs/pdf.mjs')).text();
    await context.route('**/static/pdfjs/test-real.mjs', route => route.fulfill({ body: realModule, contentType: 'text/javascript' }));
    if (pdfjsRoot) {
      await context.route('**/static/pdfjs/pdf.worker.mjs', route => route.fulfill({ path: path.join(pdfjsRoot, 'build/pdf.worker.mjs'), contentType: 'text/javascript' }));
    }
    await context.route('**/static/pdfjs/pdf.mjs', route => route.fulfill({ contentType: 'text/javascript', body: `
      import * as engine from '/static/pdfjs/test-real.mjs';
      export const GlobalWorkerOptions = engine.GlobalWorkerOptions;
      const wrapped = new WeakSet();
      export function getDocument(options) {
        const task = engine.getDocument(options);
        task.promise.then(doc => {
          const getPage = doc.getPage.bind(doc);
          doc.getPage = async number => {
            if (window.__delayPages) await new Promise(resolve => setTimeout(resolve, number === 2 ? 150 : 15));
            const page = await getPage(number);
            if (!wrapped.has(page)) {
              wrapped.add(page);
              const render = page.render.bind(page);
              page.render = options => {
                if (window.__failNextRender) { window.__failNextRender = false; throw new Error('Injected render failure'); }
                return render(options);
              };
            }
            return page;
          };
        });
        return task;
      }
    ` }));
    const page = await context.newPage();
    const errors = [];
    const dialogs = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    await page.goto(base + '/edit', { waitUntil: 'networkidle' });
    await page.locator('#editPdfFile').setInputFiles(path.join(root, 'tools/test.pdf'));
    await page.waitForFunction(() => document.querySelector('#previewPageCount').textContent === '/ 4' && !document.querySelector('#editPdfFile').disabled);

    await page.locator('#previewPageInput').fill('');
    await page.locator('#previewPageInput').dispatchEvent('change');
    assert.equal(await page.locator('#previewPageInput').inputValue(), '1');
    await page.locator('#blankPageNumber').fill('99');
    await page.locator('#addBlankPageOp').click();
    assert.match(dialogs.pop(), /valid page number/);
    assert.equal(await page.locator('#previewPageCount').textContent(), '/ 4');
    await page.locator('#blankPageNumber').fill('1');
    console.log('PASS invalid page input never edits another page');

    await page.evaluate(() => {
      window.__delayPages = true;
      document.querySelector('#nextPageButton').click();
      document.querySelector('#nextPageButton').click();
      document.querySelector('#zoomInButton').click();
      document.querySelector('#zoomInButton').click();
    });
    await page.waitForFunction(() => document.querySelector('#previewPageInput').value === '3');
    await pause(250);
    assert.equal(await page.locator('#previewPageInput').inputValue(), '3');
    assert.deepEqual(errors, []);
    console.log('PASS rapid page/zoom changes finish on the latest request');

    const originalInfo = await page.locator('#previewInfo').textContent();
    await page.evaluate(() => { window.__failNextRender = true; });
    await page.locator('#editPdfFile').setInputFiles(path.join(temp, 'rotated.pdf'));
    await page.waitForFunction(() => document.querySelector('#editStatusLine').textContent.includes('Failed to load PDF') && !document.querySelector('#editPdfFile').disabled);
    assert.equal(await page.locator('#previewInfo').textContent(), originalInfo);
    assert.equal(await page.locator('#previewPageCount').textContent(), '/ 4');
    assert.match(dialogs.pop(), /Injected render failure/);
    console.log('PASS a render failure preserves the previous PDF and preview');

    let releaseApply;
    const applyGate = new Promise(resolve => { releaseApply = resolve; });
    await page.route('**/edit/apply', async route => { await applyGate; await route.continue(); });
    await page.locator('#addBlankPageOp').click();
    await page.waitForFunction(() => document.querySelector('#editPdfFile').disabled);
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['unrelated'], 'unrelated.pdf', { type: 'application/pdf' }));
      document.querySelector('#editPdfDropZone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    assert.equal(await page.locator('#previewInfo').textContent(), originalInfo);
    assert.equal(await page.locator('#editStatusLine').textContent(), 'Applying edit...');
    releaseApply();
    await page.waitForFunction(() => document.querySelector('#previewPageCount').textContent === '/ 5' && !document.querySelector('#undoEditApply').disabled);
    console.log('PASS a dropped PDF cannot replace a document during an edit');

    await page.route('**/download/**', route => route.abort());
    const downloaded = page.waitForEvent('download');
    await page.locator('#downloadEditedPdf').click();
    const download = await downloaded;
    assert(download.url().startsWith('blob:'));
    assert.equal(await download.failure(), null);
    await page.locator('#undoEditApply').click();
    await page.waitForFunction(() => document.querySelector('#previewPageCount').textContent === '/ 4' && !document.querySelector('#editPdfFile').disabled);
    assert.equal(await page.locator('#previewPageInput').inputValue(), '3');
    console.log('PASS local download survives unavailable job URLs and Undo restores page 3');

    await page.locator('#editPdfFile').setInputFiles(path.join(temp, 'rotated.pdf'));
    await page.waitForFunction(() => document.querySelector('#previewPageCount').textContent === '/ 1' && !document.querySelector('#editPdfFile').disabled);
    await page.locator('[data-tool="text"]').click();
    await page.locator('#previewZoomSelect').selectOption('fit-width');
    await page.waitForFunction(() => document.querySelector('#pdfCanvas').width < 1000);
    await pause(100);
    const canvas = page.locator('#pdfCanvas');
    await canvas.scrollIntoViewIfNeeded();
    await canvas.click({ position: await canvas.evaluate(el => ({ x: el.getBoundingClientRect().width / 2, y: el.getBoundingClientRect().height / 2 })) });
    assert(Math.abs(Number(await page.locator('#textOverlayX').inputValue()) - 210) < 1);
    assert(Math.abs(Number(await page.locator('#textOverlayY').inputValue()) - 150) < 1);
    console.log('PASS rotated/cropped preview coordinates use the visible bottom-left origin');

    await page.unroute('**/download/**');
    await page.locator('[data-tool="imageOverlay"]').click();
    await page.locator('#imageOverlayFile').setInputFiles(path.join(temp, 'red.png'));
    for (const [id, value] of Object.entries({ imageOverlayX: '50', imageOverlayY: '60', imageOverlayWidth: '40', imageOverlayHeight: '20' })) {
      await page.locator('#' + id).fill(value);
    }
    await page.locator('#addImageOverlayOp').click();
    await page.waitForFunction(() => document.querySelector('#editStatusLine').textContent.startsWith('Applied edit.') && !document.querySelector('#editPdfFile').disabled);
    const pixel = await canvas.evaluate(el => Array.from(el.getContext('2d').getImageData(Math.floor(el.width * 70 / 420), Math.floor(el.height * (1 - 70 / 300)), 1, 1).data));
    assert(pixel[0] > 200 && pixel[1] < 50 && pixel[2] < 50, `Expected red image at visible (70,70), found ${pixel}`);
    console.log('PASS image overlay is rendered at the selected visible position after rotation/cropping');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#editPdfFile').setInputFiles(path.join(temp, 'wide.pdf'));
    await page.waitForFunction(() => document.querySelector('#previewInfo').textContent.startsWith('wide.pdf') && !document.querySelector('#editPdfFile').disabled);
    assert(await canvas.evaluate(el => el.width <= el.parentElement.clientWidth));
    assert.deepEqual(errors, []);
    console.log('PASS fit-width fits wide PDFs on a mobile viewport');

    const assemble = await context.newPage();
    await assemble.addInitScript(() => {
      for (const name of ['getItem', 'setItem', 'removeItem']) {
        Storage.prototype[name] = () => { throw new DOMException('Blocked', 'SecurityError'); };
      }
    });
    assemble.on('pageerror', error => errors.push(error.message));
    await assemble.goto(base + '/assemble', { waitUntil: 'networkidle' });
    let releaseUpload;
    let uploadCount = 0;
    const uploadGate = new Promise(resolve => { releaseUpload = resolve; });
    await assemble.route('**/api/clients/*/sources', async route => {
      if (route.request().method() === 'POST') {
        uploadCount += 1;
        await uploadGate;
      }
      await route.continue();
    });
    await assemble.locator('#pdfFiles').setInputFiles(path.join(root, 'tools/test.pdf'));
    await assemble.waitForFunction(() => document.querySelector('#pdfFiles').disabled);
    assert(await assemble.locator('#clearSources').isDisabled());
    assert(await assemble.locator('#buildButton').isDisabled());
    assert(await assemble.locator('#sourceRows').evaluate(el => el.inert));
    await assemble.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['unrelated'], 'second.pdf', { type: 'application/pdf' }));
      document.querySelector('#sourceDropZone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    releaseUpload();
    await assemble.waitForFunction(() => document.querySelectorAll('#sourceRows tr[data-source-id]').length === 1 && !document.querySelector('#pdfFiles').disabled);
    assert.equal(uploadCount, 1);
    console.log('PASS source upload serializes concurrent drop/clear/build actions');
    const count = await assemble.locator('#sourceRows tr[data-source-id]').count();
    assert.equal(count, 1);
    await assemble.locator('#clearSources').click();
    await assemble.waitForFunction(() => document.querySelectorAll('#sourceRows tr[data-source-id]').length === 0 && !document.querySelector('#pdfFiles').disabled);
    assert.deepEqual(errors, []);
    console.log('PASS source upload/clear work with browser storage blocked');
  } finally {
    await browser.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
