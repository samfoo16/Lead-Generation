// Velvet Tiger Leads — Playwright functional tests
// Runs against http://localhost:3000

const { chromium } = require('playwright');

const BASE_URL    = process.env.TEST_BASE_URL || 'http://localhost:3000';
const APIFY_TOKEN = process.env.APIFY_TOKEN;   // set in your shell before running
const TIMEOUT     = 120_000; // 2 min — Apify runs can be slow

let browser, page;
const results = [];

function pass(name) {
  results.push({ name, status: 'PASS' });
  console.log(`  ✓  ${name}`);
}

function fail(name, err) {
  results.push({ name, status: 'FAIL', error: String(err) });
  console.error(`  ✕  ${name}`);
  console.error(`     ${err}`);
}

async function test(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (err) {
    fail(name, err);
  }
}

function expect(value, label) {
  if (!value) throw new Error(`Expected truthy: ${label}`);
}

// ── Setup ──────────────────────────────────────────────────────────────────

async function setup() {
  browser = await chromium.launch({ headless: false, slowMo: 60 });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    // Grant clipboard permissions
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  page = await ctx.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
}

// ── Tests ──────────────────────────────────────────────────────────────────

async function runTests() {
  // 1. Page structure
  await test('Page title is correct', async () => {
    const title = await page.title();
    expect(title === 'Velvet Tiger Leads', `got: "${title}"`);
  });

  await test('Config bar is visible', async () => {
    const bar = await page.locator('.config-bar').isVisible();
    expect(bar, 'config-bar not visible');
  });

  await test('Brand name renders', async () => {
    const name = await page.locator('.brand-name').textContent();
    expect(name.includes('Velvet Tiger'), `got: "${name}"`);
  });

  await test('Section title renders with italic "Targets"', async () => {
    const em = await page.locator('.section-title em').textContent();
    expect(em.trim() === 'Targets', `got: "${em}"`);
  });

  await test('All 4 form inputs are present', async () => {
    const count = await page.locator('.form-input').count();
    expect(count === 4, `got ${count} inputs`);
  });

  await test('Search button is present and enabled', async () => {
    const btn     = page.locator('#searchBtn');
    const visible = await btn.isVisible();
    const enabled = await btn.isEnabled();
    expect(visible && enabled, `visible=${visible} enabled=${enabled}`);
  });

  await test('Progress panel is hidden on load', async () => {
    const hidden = await page.locator('#progressPanel').isHidden();
    expect(hidden, 'progress panel should be hidden on load');
  });

  await test('Results section is hidden on load', async () => {
    const hidden = await page.locator('#resultsSection').isHidden();
    expect(hidden, 'results section should be hidden on load');
  });

  await test('Error banner is hidden on load', async () => {
    const hidden = await page.locator('#errorBanner').isHidden();
    expect(hidden, 'error banner should be hidden on load');
  });

  // 2. Token management
  await test('Token badge hidden before save', async () => {
    const hidden = await page.locator('#tokenBadge').isHidden();
    expect(hidden, 'token badge should be hidden before save');
  });

  await test('Can type API token into input', async () => {
    await page.locator('#apiKey').fill(APIFY_TOKEN);
    const val = await page.locator('#apiKey').inputValue();
    expect(val === APIFY_TOKEN, `got: "${val}"`);
  });

  await test('Save button shows token-saved state', async () => {
    await page.locator('#saveKeyBtn').click();
    await page.waitForTimeout(300);
    const badgeVisible  = await page.locator('#tokenBadge').isVisible();
    const clearVisible  = await page.locator('#clearKeyBtn').isVisible();
    expect(badgeVisible, 'token badge should be visible after save');
    expect(clearVisible, 'clear button should be visible after save');
  });

  await test('Token persists in localStorage', async () => {
    const stored = await page.evaluate(() => localStorage.getItem('apify_token'));
    expect(stored === APIFY_TOKEN, `stored: "${stored}"`);
  });

  // 3. Validation — empty fields should show error
  await test('Search with empty sector shows error', async () => {
    await page.locator('#sector').fill('');
    await page.locator('#jobRoles').fill('CTO');
    await page.locator('#searchBtn').click();
    await page.waitForTimeout(400);
    const bannerVisible = await page.locator('#errorBanner').isVisible();
    expect(bannerVisible, 'error banner should appear for empty sector');
    await page.locator('.error-close').click();
  });

  await test('Search with empty roles shows error', async () => {
    await page.locator('#sector').fill('fintech');
    await page.locator('#jobRoles').fill('');
    await page.locator('#searchBtn').click();
    await page.waitForTimeout(400);
    const bannerVisible = await page.locator('#errorBanner').isVisible();
    expect(bannerVisible, 'error banner should appear for empty roles');
    await page.locator('.error-close').click();
  });

  await test('Error banner can be dismissed', async () => {
    const hidden = await page.locator('#errorBanner').isHidden();
    expect(hidden, 'error banner should be hidden after dismiss');
  });

  // 4. Full Apify run
  await test('Fill search form', async () => {
    await page.locator('#sector').fill('SaaS');
    await page.locator('#jobRoles').fill('CEO, CTO');
    await page.locator('#location').fill('Singapore');
    await page.locator('#maxResults').fill('5');
    const sector = await page.locator('#sector').inputValue();
    expect(sector === 'SaaS', `sector: "${sector}"`);
  });

  await test('Clicking Find Leads shows progress panel and disables button', async () => {
    await page.locator('#searchBtn').click();
    await page.waitForTimeout(600);
    const progressVisible = await page.locator('#progressPanel').isVisible();
    const btnDisabled     = await page.locator('#searchBtn').isDisabled();
    const labelText       = await page.locator('#searchBtn .btn-label').textContent();
    expect(progressVisible,          'progress panel should be visible');
    expect(btnDisabled,              'search button should be disabled while running');
    expect(labelText.includes('Searching'), `label: "${labelText}"`);
  });

  await test('Status badge shows RUNNING', async () => {
    const badge = await page.locator('#statusBadge').textContent();
    expect(badge.includes('RUNNING'), `badge: "${badge}"`);
  });

  await test('Elapsed timer is ticking', async () => {
    await page.waitForTimeout(1500); // let at least one tick fire
    const t1 = await page.locator('#elapsedTimer').textContent();
    await page.waitForTimeout(2000);
    const t2 = await page.locator('#elapsedTimer').textContent();
    expect(t1 !== t2, `timer not ticking: ${t1} → ${t2}`);
  });

  await test('Run ID is displayed', async () => {
    const runId = await page.locator('#runIdDisplay').textContent();
    expect(runId.trim().length > 0, `runId empty: "${runId}"`);
  });

  // Wait for the Apify run to complete (up to 2 min)
  await test('Apify run completes and results appear', async () => {
    await page.waitForSelector('#resultsSection:not(.hidden)', { timeout: TIMEOUT });
    const visible = await page.locator('#resultsSection').isVisible();
    expect(visible, 'results section not visible after run');
  });

  await test('Result count is shown', async () => {
    const count = await page.locator('#resultCount').textContent();
    expect(count.trim().length > 0, `result count empty: "${count}"`);
    console.log(`       → ${count.trim()}`);
  });

  await test('Progress panel is hidden after run', async () => {
    const hidden = await page.locator('#progressPanel').isHidden();
    expect(hidden, 'progress panel should be hidden after run completes');
  });

  await test('Search button re-enabled after run', async () => {
    const enabled = await page.locator('#searchBtn').isEnabled();
    expect(enabled, 'search button should be re-enabled after run');
  });

  await test('Table has at least one data row', async () => {
    const rows = await page.locator('#tableBody tr').count();
    expect(rows > 0, `table has ${rows} rows`);
    console.log(`       → ${rows} row(s) in table`);
  });

  await test('Table columns are correct (8 cols)', async () => {
    const cols = await page.locator('.leads-table thead th').count();
    expect(cols === 8, `expected 8 cols, got ${cols}`);
  });

  // 5. Export & copy
  await test('Export CSV button is visible', async () => {
    const visible = await page.locator('button:has-text("Export CSV")').isVisible();
    expect(visible, 'Export CSV button not visible');
  });

  await test('Export CSV triggers a download', async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }),
      page.locator('button:has-text("Export CSV")').click(),
    ]);
    const filename = download.suggestedFilename();
    expect(filename.startsWith('leads-') && filename.endsWith('.csv'), `filename: "${filename}"`);
    console.log(`       → downloaded: ${filename}`);
  });

  await test('Copy Emails button exists', async () => {
    const visible = await page.locator('.results-actions .btn--secondary').isVisible();
    expect(visible, 'Copy Emails button not visible');
  });

  await test('Copy Emails shows confirmation feedback', async () => {
    await page.locator('.results-actions .btn--secondary').click();
    await page.waitForTimeout(400);
    const btnText = await page.locator('.results-actions .btn--secondary').textContent();
    // Either shows "✓ Copied!" or error if no emails — both are valid outcomes
    const responded = btnText.includes('Copied') || await page.locator('#errorBanner').isVisible();
    expect(responded, `button text: "${btnText}"`);
  });

  // 6. Clear token
  await test('Revoke token clears saved state', async () => {
    await page.locator('#clearKeyBtn').click();
    await page.waitForTimeout(300);
    const badgeHidden = await page.locator('#tokenBadge').isHidden();
    const stored      = await page.evaluate(() => localStorage.getItem('apify_token'));
    expect(badgeHidden, 'token badge should hide after revoke');
    expect(stored === null, `token still in localStorage: "${stored}"`);
  });
}

// ── Run ────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\nVelvet Tiger Leads — Playwright Test Suite');
  console.log('===========================================');

  try {
    await setup();
    await runTests();
  } catch (err) {
    console.error('Fatal setup error:', err);
  } finally {
    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;

    console.log('\n─── Summary ───────────────────────────────');
    if (failed > 0) {
      console.log('\nFailed tests:');
      results.filter(r => r.status === 'FAIL').forEach(r => {
        console.log(`  ✕ ${r.name}`);
        console.log(`    ${r.error}`);
      });
    }
    console.log(`\n  Passed: ${passed}  Failed: ${failed}  Total: ${results.length}`);
    console.log('───────────────────────────────────────────\n');

    await browser?.close();
    process.exit(failed > 0 ? 1 : 0);
  }
})();
