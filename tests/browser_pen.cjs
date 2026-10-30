const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { chromium } = require(process.env.APDF_PLAYWRIGHT_MODULE || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:8000';

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'apdf-pen-'));
  execFileSync(process.env.APDF_TEST_PYTHON || 'python3', ['-c', `
from pathlib import Path
import sys
from pypdf import PdfWriter
from pypdf.generic import RectangleObject
w=PdfWriter()
for rotation in (0,90,180,270):
    p=w.add_blank_page(400,600)
    p.cropbox=RectangleObject((40,80,340,500))
    p.rotate(rotation)
w.write(Path(sys.argv[1])/'pen.pdf')
`, temp]);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
    if (process.env.APDF_TEST_PDFJS) {
      for (const file of ['pdf.mjs', 'pdf.worker.mjs']) {
        await context.route('**/static/pdfjs/' + file, route => route.fulfill({ path: path.join(process.env.APDF_TEST_PDFJS, 'build', file), contentType: 'text/javascript' }));
      }
    }
    const page = await context.newPage();
    const errors = [], dialogs = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    await page.goto(base + '/edit', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('.edit-tool-button').count(), 11);
    assert.equal(await page.locator('#penTexture option').count(), 4);
    assert(await page.locator('#applyPenDrawing').isDisabled());
    await page.locator('#editPdfFile').setInputFiles(path.join(temp, 'pen.pdf'));
    await page.waitForFunction(() => document.querySelector('#previewPageCount').textContent === '/ 4' && !document.querySelector('#editPdfFile').disabled);
    await page.locator('[data-tool="pen"]').click();
    await page.locator('#previewZoomSelect').selectOption('1');
    await page.waitForFunction(() => document.querySelector('#pdfCanvas').width === 300);
    const canvas = page.locator('#pdfCanvas');
    let width = 300, height = 420;

    async function style(color = '#ff0000', size = '8', alpha = '1', texture = 'ink') {
      await page.locator('#penColor').fill(color);
      await page.locator('#penWidth').fill(size);
      await page.locator('#penOpacity').fill(alpha);
      await page.locator('#penTexture').selectOption(texture);
    }
    async function draw(points) {
      await canvas.scrollIntoViewIfNeeded();
      const rect = await canvas.boundingBox();
      const screen = ([x, y]) => [rect.x + rect.width * x / width, rect.y + rect.height * (1 - y / height)];
      await page.mouse.move(...screen(points[0]));
      await page.mouse.down();
      for (const point of points.slice(1)) await page.mouse.move(...screen(point), { steps: 8 });
      await page.mouse.up();
      await page.waitForFunction(() => /pending stroke/.test(document.querySelector('#penStatus').textContent));
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    async function pixels(preview = true, x = 30, y = 80, boxWidth = 250, boxHeight = 80) {
      return canvas.evaluate((pdf, args) => {
        const composed = document.createElement('canvas');
        composed.width = pdf.width; composed.height = pdf.height;
        const c = composed.getContext('2d');
        c.drawImage(pdf, 0, 0);
        if (args.preview) c.drawImage(document.querySelector('.pen-preview-overlay'), 0, 0);
        return Array.from(c.getImageData(Math.floor(args.x / args.width * pdf.width), Math.floor((1 - (args.y + args.boxHeight) / args.height) * pdf.height), Math.max(1, Math.floor(args.boxWidth / args.width * pdf.width)), Math.max(1, Math.floor(args.boxHeight / args.height * pdf.height))).data);
      }, { preview, x, y, boxWidth, boxHeight, width, height });
    }
    async function red(preview = true, x = 100, y = 120) {
      const pixel = await pixels(preview, x, y, 1, 1);
      assert(pixel[0] > 240 && pixel[1] < 20 && pixel[2] < 20, 'Expected red ink, got ' + pixel);
    }
    async function blank(preview = true) {
      const pixel = await pixels(preview, 100, 120, 1, 1);
      assert(pixel.slice(0, 3).every(value => value > 245), 'Expected blank PDF, got ' + pixel);
    }
    async function apply() {
      await page.locator('#applyPenDrawing').click();
      await page.waitForFunction(() => document.querySelector('#editStatusLine').textContent.startsWith('Applied edit.') && !document.querySelector('#editPdfFile').disabled);
      assert(await page.locator('.pen-preview-overlay').evaluate(el => el.hidden));
    }
    async function undoPdf() {
      await page.locator('#undoEditApply').click();
      await page.waitForFunction(() => document.querySelector('#editStatusLine').textContent.startsWith('Undone.') && !document.querySelector('#editPdfFile').disabled);
    }
    async function next(number) {
      await page.locator(number > 1 ? '#nextPageButton' : '#prevPageButton').click();
      await page.waitForFunction(value => document.querySelector('#previewPageInput').value === String(value), number);
      [width, height] = number % 2 ? [300, 420] : [420, 300];
    }

    const fingerprints = new Set();
    for (const texture of ['ink', 'pencil', 'marker', 'dry_brush']) {
      await style('#ff0000', '12', '0.6', texture);
      await draw([[40, 120], [80, 130], [120, 100], [180, 140], [260, 120]]);
      const expected = await pixels();
      fingerprints.add(createHash('sha256').update(Buffer.from(expected)).digest('hex'));
      await style('#0000ff', '20', '1', 'ink');
      assert.deepEqual(await pixels(), expected, 'Changing settings restyled a previous stroke');
      await apply();
      const actual = await pixels(false);
      const error = actual.reduce((sum, value, index) => sum + Math.abs(value - expected[index]), 0) / actual.length;
      assert(error < 5, `${texture} preview/PDF average pixel error: ${error}`);
      console.log(`PASS ${texture} preview matches its vector PDF output (average error ${error.toFixed(2)})`);
      await undoPdf();
      await blank(false);
    }
    assert.equal(fingerprints.size, 4);
    assert.equal(await page.locator('.pdf-drag-region-overlay').count(), 0);

    await style();
    await draw([[40, 120], [260, 120]]);
    await page.locator('#previewZoomSelect').selectOption('1.5');
    await page.waitForFunction(() => document.querySelector('#pdfCanvas').width === 450 && document.querySelector('.pen-preview-overlay').width === 450);
    await red();
    await page.locator('#previewZoomSelect').selectOption('1');
    await page.waitForFunction(() => document.querySelector('#pdfCanvas').width === 300 && document.querySelector('.pen-preview-overlay').width === 300);
    await page.locator('[data-tool="shape"]').click();
    await red();
    for (const [id, value] of Object.entries({ X: '10', Y: '10', Width: '40', Height: '40' })) await page.locator('#shapeOverlay' + id).fill(value);
    await page.locator('#addShapeOverlayOp').click();
    assert.match(dialogs.pop(), /pending pen strokes/);
    await page.locator('[data-tool="pen"]').click();
    await next(2);
    await blank();
    await style('#0000ff');
    await draw([[40, 120], [260, 120]]);
    assert.match(await page.locator('#penStatus').textContent(), /2 pending stroke.*2 page/);
    await page.locator('#undoPenStroke').click();
    assert.match(await page.locator('#penStatus').textContent(), /1 pending stroke/);
    await page.locator('#undoEditApply').click();
    assert(await page.locator('#applyPenDrawing').isDisabled());
    assert(await page.locator('#undoEditApply').isDisabled());
    console.log('PASS pending strokes survive zoom/tools/pages and both stroke Undo controls work');

    await style();
    await draw([[40, 120], [260, 120]]);
    await next(1);
    await draw([[40, 120], [260, 120]]);
    await apply();
    await red(false);
    await next(2);
    await red(false);
    await undoPdf();
    [width, height] = [300, 420];
    assert.equal(await page.locator('#previewPageInput').inputValue(), '1');
    await blank(false);
    console.log('PASS one Apply commits all pending pages, including rotated/CropBox pages, and one Undo restores them');

    await draw([[40, 120], [260, 120]]);
    await page.locator('#editPdfFile').setInputFiles(path.join(temp, 'pen.pdf'));
    assert.match(dialogs.pop(), /pending pen strokes/);
    await page.route('**/edit/apply', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Injected drawing failure' }) }));
    await page.locator('#applyPenDrawing').click();
    await page.waitForFunction(() => !document.querySelector('#applyPenDrawing').disabled && document.querySelector('#editStatusLine').textContent === 'Injected drawing failure');
    assert.match(dialogs.pop(), /Injected drawing failure/);
    await red();
    await page.unroute('**/edit/apply');
    await apply();
    await undoPdf();
    console.log('PASS pending drawing survives failed applies and prevents accidental file replacement');

    await draw([[100, 120]]);
    await red();
    await apply();
    await red(false);
    await undoPdf();
    await draw([[1, 120], [-30, 120]]);
    await apply();
    await undoPdf();
    console.log('PASS pen taps render dots and strokes leaving the canvas are clamped safely');

    await canvas.evaluate(pdf => {
      const rect = pdf.getBoundingClientRect();
      const event = (type, x) => new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, pointerId: 99, pointerType: 'touch', button: 0, clientX: rect.left + x, clientY: rect.top + rect.height - 120 });
      pdf.dispatchEvent(event('pointerdown', 40));
      pdf.dispatchEvent(event('pointermove', 160));
      pdf.dispatchEvent(event('pointerup', 260));
    });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await red();
    assert.equal(await canvas.evaluate(el => getComputedStyle(el).touchAction), 'none');
    await page.locator('#clearPenDrawing').click();
    await canvas.evaluate(pdf => {
      const r = pdf.getBoundingClientRect();
      for (const type of ['pointerdown', 'pointercancel']) pdf.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, pointerId: 100, button: 0, clientX: r.left + 50, clientY: r.top + 50 }));
    });
    assert(await page.locator('#applyPenDrawing').isDisabled());
    console.log('PASS touch/stylus pointer input and canceled gestures preserve pen state');

    await style('#ff0000', '0');
    await canvas.click({ position: { x: 50, y: 50 } });
    assert.match(dialogs.pop(), /pen width/);
    assert(await page.locator('#applyPenDrawing').isDisabled());
    await style('#ff0000', '8', '1.1');
    await canvas.click({ position: { x: 50, y: 50 } });
    assert.match(dialogs.pop(), /pen alpha/);
    await style();
    console.log('PASS invalid width/alpha do not create strokes');

    await draw([[40, 120], [260, 120]]);
    const downloading = page.waitForEvent('download');
    await page.locator('#downloadEditedPdf').click();
    const download = await downloading;
    assert(download.url().startsWith('blob:'));
    assert.equal(await download.failure(), null);
    assert(await page.locator('#applyPenDrawing').isDisabled());
    await red(false);
    console.log('PASS Download PDF applies pending drawing before saving the local PDF');

    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await canvas.evaluate(el => getComputedStyle(el).touchAction), 'none');
    assert.deepEqual(errors, []);
    console.log('PASS mobile layout has no overflow or browser errors');
  } finally {
    await browser.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
