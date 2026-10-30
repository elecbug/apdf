const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.APDF_PLAYWRIGHT_MODULE || 'playwright');

const base = process.argv[2] || 'http://127.0.0.1:8000';

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    if (process.env.APDF_TEST_PDFJS) {
      for (const file of ['pdf.mjs', 'pdf.worker.mjs']) {
        await context.route('**/static/pdfjs/' + file, route => route.fulfill({
          path: path.join(process.env.APDF_TEST_PDFJS, 'build', file), contentType: 'text/javascript',
        }));
      }
    }
    const page = await context.newPage();
    const errors = [];
    let confirmations = 0;
    let allowLeaving = false;
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => {
      assert.equal(dialog.type(), 'beforeunload');
      confirmations += 1;
      if (allowLeaving) {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    });
    await page.goto(base + '/edit', { waitUntil: 'networkidle' });
    await page.locator('[data-tool="shape"]').click();
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(confirmations, 0);
    console.log('PASS empty Edit page reloads without a leave confirmation');

    await page.locator('#editPdfFile').setInputFiles(path.join(__dirname, '../tools/test.pdf'));
    await page.waitForFunction(() => document.querySelector('#previewPageCount').textContent === '/ 4' && !document.querySelector('#editPdfFile').disabled);
    await page.locator('[data-tool="shape"]').click();
    const reloading = page.waitForEvent('dialog');
    await page.evaluate(() => { window.location.reload(); });
    await reloading;
    await page.waitForFunction(() => document.querySelector('#previewPageCount').textContent === '/ 4');
    assert.equal(confirmations, 1);
    assert(new URL(page.url()).pathname === '/edit');
    console.log('PASS reload prompts, and cancel preserves the loaded PDF');

    const navigating = page.waitForEvent('dialog');
    await page.evaluate(() => { window.location.assign('/assemble'); });
    await navigating;
    assert.equal(confirmations, 2);
    assert(new URL(page.url()).pathname === '/edit');
    assert.equal(await page.locator('#previewPageCount').textContent(), '/ 4');
    console.log('PASS navigation prompts, and cancel keeps the Edit document');

    allowLeaving = true;
    const navigated = page.waitForURL('**/assemble');
    await page.evaluate(() => { window.location.assign('/assemble'); });
    await navigated;
    assert.equal(confirmations, 3);
    assert.deepEqual(errors, []);
    console.log('PASS confirming the leave warning allows navigation');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
