import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

assert.ok(process.env.PLAYWRIGHT_MODULE, 'Set PLAYWRIGHT_MODULE to an existing playwright-core installation');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
const renderer = new URL('../overlay/apps/desktop/renderer/', import.meta.url);
const output = new URL('../.build/commission-qa/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [900, 520]) for (const kind of ['bd', 'developer']) {
    const page = await browser.newPage({ viewport: { width, height: 760 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://desktop.fixture/**', async route => {
      const name = new URL(route.request().url()).pathname.slice(1);
      assert.ok(['ipzsk-account.html', 'ipzsk-account.css', 'ipzsk-account.js'].includes(name));
      await route.fulfill({ body: await readFile(new URL(name, renderer)), contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript' });
    });
    await page.addInitScript(({ kind }) => {
      window.calls = [];
      window.failEarnings = false;
      window.ipzskAccount = { async request(request) {
        window.calls.push(request);
        if (request.type === 'state') return { ok: true, value: { signedIn: true, email: kind + '@fixture.invalid', canRemember: false } };
        if (request.type === 'billing') return { ok: true, value: { wallet: { available_points: '100', frozen_points: '0' }, usage: { page: 1, page_size: 20, count: 0, rows: [] } } };
        if (request.type === 'commissions') return window.failEarnings ? { ok: false, error: 'Fixture offline' } : { ok: true, value: {
          bd_active: kind === 'bd', referrals: 2, invitation_url: 'https://api.ipzsk.com/api/account/referral/' + 'a'.repeat(32),
          balance: { total_cny: kind === 'bd' ? '12' : '19.2', available_cny: '0', withdrawable_cny: '0', frozen: false },
          ledger: [{ kind, amount_cny: kind === 'bd' ? '12' : '19.2', created_at: '2026-10-10T00:00:00Z', available_at: '2026-11-09T00:00:00Z' }],
          payouts: [{ id: '00000000-0000-0000-0000-000000000001', state: 'approved', amount_cny: '100', created_at: '2026-10-09T00:00:00Z' }], conversions: [],
        } };
        if (request.type === 'earningsSite') return { ok: true, value: null };
        throw new Error('Unexpected IPC request');
      } };
    }, { kind });
    await page.goto('https://desktop.fixture/ipzsk-account.html');
    await page.locator('#earnings-total').filter({ hasText: kind === 'bd' ? '12.00' : '19.20' }).waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(), /上游费用|2\.5|成本|本金占比|分成算式/);
    assert.match(await page.locator('#invitation').inputValue(), /\/referral\/a{32}$/);
    await page.getByText('最近收益流水', { exact: true }).click();
    await page.getByText('提现与转余额记录', { exact: true }).click();
    assert.match(await page.locator('#earnings-rows').innerText(), kind === 'bd' ? /BD 收益.*12.00/s : /开发者收益.*19.20/s);
    assert.match(await page.locator('#earnings-operations').innerText(), /待人工转账/);
    assert.doesNotMatch(await page.locator('#earnings-rows').innerText(), /成本|本金|算式/);
    await page.locator('#earnings-site').click();
    assert.equal(await page.evaluate(() => window.calls.filter(row => row.type === 'earningsSite').length), 1);
    assert.equal(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)), 0);
    await page.screenshot({ path: resolve(output.pathname, kind + '-' + width + '.png'), fullPage: true });
    await page.evaluate(() => { window.failEarnings = true; });
    await page.locator('#refresh').click();
    await page.locator('#earnings-status').filter({ hasText: '读取失败' }).waitFor();
    assert.equal(await page.locator('#earnings-total').innerText(), kind === 'bd' ? '12.00' : '19.20');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: BD/developer account at 900/520px; own earnings, maturity, operations, wallet entry, stale/error state, no overflow or runtime errors');
} finally { await browser.close(); }
