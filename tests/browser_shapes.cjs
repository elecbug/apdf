const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.APDF_PLAYWRIGHT_MODULE || 'playwright');

const base = process.argv[2] || 'http://127.0.0.1:8000';
const shapes = ['circle', 'rectangle', 'triangle', 'pentagon', 'star', 'rounded_rectangle'];

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'apdf-shapes-'));
  execFileSync(process.env.APDF_TEST_PYTHON || 'python3', ['-c', `
from pathlib import Path
import sys
from pypdf import PdfWriter
from pypdf.generic import RectangleObject
w = PdfWriter()
for rotation in (0, 90, 180, 270):
    p = w.add_blank_page(400, 600)
    p.cropbox = RectangleObject((40, 80, 340, 500))
    p.rotate(rotation)
w.write(Path(sys.argv[1]) / 'shapes.pdf')
`, temp]);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
    if (process.env.APDF_TEST_PDFJS) {
      for (const file of ['pdf.mjs', 'pdf.worker.mjs']) {
        await context.route('**/static/pdfjs/' + file, route => route.fulfill({
          path: path.join(process.env.APDF_TEST_PDFJS, 'build', file), contentType: 'text/javascript',
        }));
      }
    }
    const page = await context.newPage();
    const errors = [];
    const dialogs = [];
    let requests = 0;
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    page.on('request', request => { if (new URL(request.url()).pathname === '/edit/apply') requests += 1; });
    await page.goto(base + '/edit', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('.edit-tool-button').count(), 10);
    await page.locator('#editPdfFile').setInputFiles(path.join(temp, 'shapes.pdf'));
    await page.waitForFunction(() => document.querySelector('#previewPageCount').textContent === '/ 4' && !document.querySelector('#editPdfFile').disabled);
    await page.locator('[data-tool="shape"]').click();
    await page.locator('#previewZoomSelect').selectOption('1');
    const canvas = page.locator('#pdfCanvas');
    await page.waitForFunction(() => document.querySelector('#pdfCanvas').width === 300);
    let pageNumber = 1;
    let visibleWidth = 300;
    let visibleHeight = 420;

    async function dragBox(reverse = false) {
      await canvas.scrollIntoViewIfNeeded();
      const rect = await canvas.boundingBox();
      const start = { x: rect.x + rect.width * 40 / visibleWidth, y: rect.y + rect.height * (1 - 80 / visibleHeight) };
      const end = { x: rect.x + rect.width * 160 / visibleWidth, y: rect.y + rect.height * (1 - 170 / visibleHeight) };
      const [from, to] = reverse ? [end, start] : [start, end];
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up();
      for (const [id, expected] of Object.entries({ Page: pageNumber, X: 40, Y: 80, Width: 120, Height: 90 })) {
        assert(Math.abs(Number(await page.locator('#shapeOverlay' + id).inputValue()) - expected) < 0.2, 'Incorrect dragged ' + id);
      }
    }

    async function pixel(x, y) {
      return canvas.evaluate((el, point) => Array.from(el.getContext('2d').getImageData(
        Math.floor(el.width * point.x / point.width), Math.floor(el.height * (1 - point.y / point.height)), 1, 1,
      ).data), { x, y, width: visibleWidth, height: visibleHeight });
    }

    function near(actual, expected) {
      assert(actual.slice(0, 3).every((value, index) => Math.abs(value - expected[index]) <= 3), `Expected RGB ${expected}, got ${actual}`);
    }

    async function add() {
      await page.locator('#addShapeOverlayOp').click();
      await page.waitForFunction(() => document.querySelector('#editStatusLine').textContent.startsWith('Applied edit.') && !document.querySelector('#editPdfFile').disabled);
      assert.equal(await page.locator('#previewPageCount').textContent(), '/ 4');
    }

    async function undo() {
      await page.locator('#undoEditApply').click();
      await page.waitForFunction(() => document.querySelector('#editStatusLine').textContent.startsWith('Undone.') && !document.querySelector('#editPdfFile').disabled);
      near(await pixel(100, 125), [255, 255, 255]);
    }

    await dragBox();
    await dragBox(true);
    assert.equal(requests, 0);
    console.log('PASS forward/reverse dragging fills position and size without applying prematurely');

    await page.locator('#shapeOverlayFillColor').fill('#ff0000');
    await page.locator('#shapeOverlayFillOpacity').fill('1');
    await page.locator('#shapeOverlayStrokeColor').fill('#0000ff');
    await page.locator('#shapeOverlayStrokeWidth').fill('4');
    const renderings = new Set();
    for (const shape of shapes) {
      await page.locator('#shapeOverlayType').selectOption(shape);
      await add();
      near(await pixel(100, 125), [255, 0, 0]);
      renderings.add(await canvas.evaluate(el => el.toDataURL()));
      await undo();
    }
    assert.equal(renderings.size, 6);
    console.log('PASS all six shapes render distinct vector geometry and Undo restores the PDF');

    await page.locator('#shapeOverlayType').selectOption('rectangle');
    await page.locator('#shapeOverlayFillOpacity').fill('0.5');
    await page.locator('#shapeOverlayStrokeOpacity').fill('0.25');
    await add();
    near(await pixel(100, 125), [255, 128, 128]);
    near(await pixel(41, 125), [191, 191, 255]);
    near(await pixel(39, 125), [255, 255, 255]);
    await undo();
    console.log('PASS fill/border alpha blend independently and the border stays inside the box');

    await page.locator('#shapeOverlayFillTransparent').check();
    assert(await page.locator('#shapeOverlayFillColor').isDisabled());
    assert(await page.locator('#shapeOverlayFillOpacity').isDisabled());
    await page.locator('#shapeOverlayStrokeOpacity').fill('1');
    await add();
    near(await pixel(100, 125), [255, 255, 255]);
    near(await pixel(41, 125), [0, 0, 255]);
    await undo();

    await page.locator('#shapeOverlayFillTransparent').uncheck();
    await page.locator('#shapeOverlayFillOpacity').fill('1');
    await page.locator('#shapeOverlayStrokeTransparent').check();
    assert(await page.locator('#shapeOverlayStrokeWidth').isDisabled());
    await add();
    near(await pixel(100, 125), [255, 0, 0]);
    near(await pixel(41, 125), [255, 0, 0]);
    await undo();
    console.log('PASS transparent fill and transparent border work independently');

    await page.locator('#shapeOverlayFillOpacity').fill('0');
    await add();
    near(await pixel(100, 125), [255, 255, 255]);
    await undo();
    const beforeInvalid = requests;
    await page.locator('#shapeOverlayFillOpacity').fill('1.1');
    await page.locator('#addShapeOverlayOp').click();
    assert.match(dialogs.pop(), /fill alpha/);
    assert.equal(requests, beforeInvalid);
    await page.locator('#shapeOverlayFillOpacity').fill('1');
    console.log('PASS alpha zero is valid and invalid alpha is rejected before submission');

    for (pageNumber = 2; pageNumber <= 4; pageNumber += 1) {
      await page.locator('#nextPageButton').click();
      await page.waitForFunction(number => document.querySelector('#previewPageInput').value === String(number), pageNumber);
      [visibleWidth, visibleHeight] = pageNumber % 2 === 0 ? [420, 300] : [300, 420];
      await dragBox();
      await add();
      near(await pixel(100, 125), [255, 0, 0]);
      await undo();
    }
    console.log('PASS drag placement matches actual PDF output at 90/180/270 degrees with a CropBox');

    await page.locator('#shapeOverlayStrokeTransparent').uncheck();
    await page.locator('#shapeOverlayStrokeOpacity').fill('1');
    await page.locator('#shapeOverlayStrokeWidth').fill('4');
    await page.screenshot({ path: path.join(temp, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-tool="shape"]').click();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert(await page.locator('#shapeOverlayType').isVisible());
    assert.equal(await page.locator('#shapeOverlayType option').count(), 6);
    assert.deepEqual(errors, []);
    console.log('PASS Shapes controls fit the mobile page and there are no browser errors');
  } finally {
    await browser.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
