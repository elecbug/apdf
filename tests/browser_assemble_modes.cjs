const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const python = process.env.APDF_TEST_PYTHON || 'python3';
const directBase = process.argv[2] || 'http://127.0.0.1:8775';
const codeBase = process.argv[3] || 'http://127.0.0.1:8776';

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'apdf-assemble-modes-'));
  execFileSync(python, ['-c', `
from pathlib import Path
from reportlab.pdfgen import canvas
import sys
root = Path(sys.argv[1])
for name, count in [('first', 3), ('second', 2)]:
    c = canvas.Canvas(str(root / (name + '.pdf')), pagesize=(300, 400))
    for number in range(1, count + 1):
        c.drawString(20, 350, name + '-' + str(number)); c.showPage()
    c.save()
`, temp]);
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [mode, base] of [['direct', directBase], ['code', codeBase]]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      const errors = [], dialogs = [], requests = [];
      let downloads = 0;
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
      page.on('request', request => requests.push(request.url()));
      page.on('download', () => downloads++);
      await page.goto(base + '/assemble');
      await page.waitForFunction(() => document.querySelector('#statusLine').textContent.startsWith('Session:'));
      assert.equal(await page.locator('form.lookup').count(), mode === 'code' ? 1 : 0);
      assert.equal(await page.locator('#buildButton').innerText(), mode === 'code' ? 'Build & Get Result Code' : 'Build PDF');
      await page.locator('#pdfFiles').setInputFiles([path.join(temp, 'first.pdf'), path.join(temp, 'second.pdf')]);
      await page.waitForFunction(() => document.querySelectorAll('#sourceRows tr[data-source-id]').length === 2 && !document.querySelector('#pdfFiles').disabled);
      const rows = page.locator('#sourceRows tr[data-source-id]');
      const firstId = await rows.nth(0).getAttribute('data-source-id');
      await page.locator(`#start-${firstId}`).fill('2');
      await rows.nth(1).locator('button[data-action="up"]').click();

      // Both transports must surface errors and restore the source controls.
      await page.route('**/compose', async route => {
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Injected assembly failure.' }) });
      }, { times: 1 });
      await page.locator('#buildButton').click();
      await page.waitForFunction(() => document.querySelector('#statusLine').textContent === 'Build failed.' && !document.querySelector('#buildButton').disabled);
      assert.equal(dialogs.pop(), 'Injected assembly failure.');
      assert.equal(await rows.count(), 2);

      const buildRequests = requests.length;
      let resultData;
      if (mode === 'code') {
        await page.route('**/compose', async route => {
          const response = await route.fetch();
          resultData = await response.json();
          await route.fulfill({ response });
        }, { times: 1 });
      }
      const responsePending = page.waitForResponse(response => response.url() === base + '/compose');
      let downloadPending;
      if (mode === 'direct') downloadPending = page.waitForEvent('download');
      await page.locator('#buildButton').click();
      const response = await responsePending;
      assert.equal(response.status(), 200);
      if (mode === 'direct') {
        assert.match(response.headers()['content-type'], /^application\/pdf/);
        assert.equal(response.headers()['cache-control'], 'no-store');
        assert.equal(page.url(), base + '/assemble');
        await page.waitForFunction(() => document.querySelector('#statusLine').textContent === 'Built PDF. Download started.');
        assert(!requests.slice(buildRequests).some(url => /\/(job|download)\//.test(url)));
      } else {
        const data = resultData;
        assert.equal(data.mode, 'job');
        assert(!('download_url' in data));
        await page.waitForURL(base + data.url);
        assert.equal(downloads, 0, 'Result-code mode must not download automatically');
        assert.equal(await page.locator('.code').innerText(), data.code);
        const link = page.locator('a[href^="/download/"]').first();
        downloadPending = page.waitForEvent('download');
        await link.click();
      }
      const download = await downloadPending;
      const output = path.join(temp, mode + '.pdf');
      await download.saveAs(output);
      const texts = JSON.parse(execFileSync(python, ['-c', 'import json,sys; from pypdf import PdfReader; print(json.dumps([p.extract_text().strip() for p in PdfReader(sys.argv[1]).pages]))', output], { encoding: 'utf8' }));
      assert.deepEqual(texts, ['second-1', 'second-2', 'first-2', 'first-3']);
      await page.screenshot({ path: `docs/design/assemble-${mode}-mode.png`, fullPage: true });
      if (mode === 'code') {
        const jobUrl = page.url();
        const code = await page.locator('.code').innerText();
        await page.goto(base + '/assemble');
        await page.waitForFunction(() => document.querySelectorAll('#sourceRows tr[data-source-id]').length === 2 && !document.querySelector('#pdfFiles').disabled);
        await page.locator('form.lookup input[name="code"]').fill(code.toLowerCase());
        await page.locator('form.lookup button').click();
        await page.waitForURL(jobUrl);
        assert.equal(await page.locator('.code').innerText(), code);
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(dialogs, []);
      await context.close();
      console.log(`PASS ${mode}: mode-specific UI, build recovery, source order/ranges, correct PDF, ${mode === 'direct' ? 'direct download without codes or result requests' : 'result navigation without auto-download and code lookup'}`);
    }
  } finally { await browser.close(); await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
