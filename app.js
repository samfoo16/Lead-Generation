// ── Config ──
const ACTOR_ID = 'bebity~linkedin-leads-scraper';
const API_BASE  = 'https://api.apify.com/v2';

// ── State ──
let results       = [];
let runId         = null;
let datasetId     = null;
let pollingActive = false;
let pollHandle    = null;
let timerHandle   = null;
let startTime     = null;

// ── Init ──
document.addEventListener('DOMContentLoaded', loadApiKey);

// ── API Key Management ──
function loadApiKey() {
  const token = localStorage.getItem('apify_token');
  if (token) {
    document.getElementById('apiKey').value = token;
    setTokenSavedUI(true);
  }
}

function saveApiKey() {
  const token = document.getElementById('apiKey').value.trim();
  if (!token) {
    handleError('Please enter your Apify API token before saving.');
    return;
  }
  localStorage.setItem('apify_token', token);
  setTokenSavedUI(true);
}

function clearApiKey() {
  localStorage.removeItem('apify_token');
  document.getElementById('apiKey').value = '';
  setTokenSavedUI(false);
}

function setTokenSavedUI(saved) {
  document.getElementById('tokenBadge').classList.toggle('hidden', !saved);
  document.getElementById('clearKeyBtn').classList.toggle('hidden', !saved);
}

// ── Build Actor Input ──
function buildActorInput(sector, rolesRaw, location, max) {
  const jobTitles = rolesRaw.split(',').map(r => r.trim()).filter(Boolean);
  const keywords  = [sector, ...jobTitles].join(' ');
  const loc       = location.trim();

  let searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}&origin=GLOBAL_SEARCH_HEADER`;
  if (loc) searchUrl += `&location=${encodeURIComponent(loc)}`;

  // Fields are sent broadly so the actor picks up whichever keys it supports
  return {
    searchUrl,
    searchKeywords:     keywords,
    jobTitles,
    industry:           sector,
    ...(loc && { location: loc }),
    maxItems:           parseInt(max, 10),
    maxResults:         parseInt(max, 10),
    includeContactInfo: true,
    scrapeContacts:     true,
  };
}

// ── Start Run ──
async function startRun() {
  const apiKey  = getToken();
  const sector  = document.getElementById('sector').value.trim();
  const rolesRaw = document.getElementById('jobRoles').value.trim();
  const location = document.getElementById('location').value.trim();
  const max      = document.getElementById('maxResults').value;

  dismissError();

  if (!apiKey)   { handleError('Please save your Apify API token first.');                return; }
  if (!sector)   { handleError('Please fill in the Industry / Sector field.');            return; }
  if (!rolesRaw) { handleError('Please enter at least one Job Role.');                    return; }

  // Cancel any in-flight polling from a previous run
  stopPolling();

  setSearching(true);
  showProgress(true);
  hideResults();

  const input = buildActorInput(sector, rolesRaw, location, max);

  let runData;
  try {
    const resp = await fetch(`${API_BASE}/acts/${ACTOR_ID}/runs?token=${encodeURIComponent(apiKey)}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(input),
    });

    if (resp.status === 401) throw new Error('UNAUTHORIZED');
    if (resp.status === 429) throw new Error('RATE_LIMIT');
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body?.error?.message || `HTTP ${resp.status}`);
    }

    const json = await resp.json();
    runData = json.data;
  } catch (err) {
    setSearching(false);
    showProgress(false);
    handleError(friendlyError(err));
    return;
  }

  runId     = runData.id;
  datasetId = runData.defaultDatasetId;
  startTime = Date.now();
  pollingActive = true;

  document.getElementById('runIdDisplay').textContent = `Run: ${runId}`;
  startTimer();
  setProgressNote('Actor started — waiting for data…');

  pollHandle = setTimeout(pollStatus, 5000);
}

// ── Poll Status ──
async function pollStatus() {
  if (!pollingActive) return;

  const apiKey = getToken();

  try {
    const resp = await fetch(`${API_BASE}/actor-runs/${runId}?token=${encodeURIComponent(apiKey)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const json = await resp.json();
    const data = json.data;

    if (data.defaultDatasetId) datasetId = data.defaultDatasetId;

    updateStatusBadge(data.status);

    const TERMINAL = ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'];
    if (!TERMINAL.includes(data.status)) {
      setProgressNote(`Status: ${data.status} — rechecking in 5 s…`);
      pollHandle = setTimeout(pollStatus, 5000);
      return;
    }

    // Terminal
    stopPolling();
    setSearching(false);

    if (data.status === 'SUCCEEDED') {
      setProgressNote('Run complete — fetching results…');
      await fetchResults();
    } else {
      handleError(`Actor run ${data.status.toLowerCase()}. Check your Apify console. Run ID: ${runId}`);
      showProgress(false);
    }
  } catch {
    // Transient network error — keep polling
    pollHandle = setTimeout(pollStatus, 5000);
  }
}

// ── Fetch Results ──
async function fetchResults() {
  const apiKey = getToken();

  try {
    const resp = await fetch(
      `${API_BASE}/datasets/${datasetId}/items?token=${encodeURIComponent(apiKey)}&format=json&clean=true&limit=500`
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const items = await resp.json();
    results = items;
  } catch (err) {
    handleError('Could not fetch results: ' + err.message);
    showProgress(false);
    return;
  }

  showProgress(false);
  renderTable(results);
}

// ── Render Table ──
function renderTable(data) {
  const tbody   = document.getElementById('tableBody');
  const section = document.getElementById('resultsSection');
  const countEl = document.getElementById('resultCount');

  tbody.innerHTML = '';
  section.classList.remove('hidden');

  countEl.textContent   = `${data.length} lead${data.length !== 1 ? 's' : ''} found`;
  countEl.style.color   = data.length === 0 ? 'var(--warning)' : 'var(--text-dim)';

  if (data.length === 0) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    tr.innerHTML = '<td colspan="8">No leads found. Try broader keywords or increase Max Results.</td>';
    tbody.appendChild(tr);
    return;
  }

  data.forEach((item, idx) => {
    const name       = item.fullName || [item.firstName, item.lastName].filter(Boolean).join(' ') || '—';
    const title      = item.jobTitle || item.title || '—';
    const company    = item.company  || item.companyName || '—';
    const email      = item.email    || '';
    const phone      = item.phone    || item.phoneNumber || '';
    const rawUrl     = item.linkedInUrl || item.profileUrl || '';
    const linkedInUrl = isSafeUrl(rawUrl) ? rawUrl : '';
    const location   = item.location || item.city || '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="row-num">${idx + 1}</td>
      <td>${esc(name)}</td>
      <td>${esc(title)}</td>
      <td>${esc(company)}</td>
      <td>${email    ? `<a href="mailto:${esc(email)}">${esc(email)}</a>`                                : dash()}</td>
      <td>${phone    ? `<a href="tel:${esc(phone)}">${esc(phone)}</a>`                                   : dash()}</td>
      <td>${esc(location)}</td>
      <td>${linkedInUrl ? `<a href="${esc(linkedInUrl)}" target="_blank" rel="noopener noreferrer">↗ View</a>` : dash()}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Export CSV ──
function exportCSV() {
  if (!results.length) return;

  const headers = ['#', 'Full Name', 'Job Title', 'Company', 'Email', 'Phone', 'Location', 'LinkedIn URL'];
  const rows = results.map((item, idx) => [
    idx + 1,
    item.fullName || [item.firstName, item.lastName].filter(Boolean).join(' ') || '',
    item.jobTitle || item.title      || '',
    item.company  || item.companyName || '',
    item.email    || '',
    item.phone    || item.phoneNumber || '',
    item.location || item.city       || '',
    (item.linkedInUrl || item.profileUrl || ''),
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  const blob     = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url      = URL.createObjectURL(blob);
  const a        = document.createElement('a');
  const filename = `leads-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;

  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Copy Emails ──
async function copyEmails() {
  const emails = results.map(r => r.email).filter(Boolean);

  if (!emails.length) {
    handleError('No email addresses found in the current results.');
    return;
  }

  try {
    await navigator.clipboard.writeText(emails.join(', '));
    const btn = document.querySelector('.results-actions .btn--secondary');
    const orig = btn.textContent;
    btn.textContent     = '✓ Copied!';
    btn.style.color     = 'var(--success)';
    btn.style.borderColor = 'var(--success)';
    setTimeout(() => {
      btn.textContent     = orig;
      btn.style.color     = '';
      btn.style.borderColor = '';
    }, 2000);
  } catch {
    handleError('Clipboard access denied. Select emails manually from the table.');
  }
}

// ── UI State Helpers ──
function setSearching(active) {
  const btn     = document.getElementById('searchBtn');
  const label   = btn.querySelector('.btn-label');
  const icon    = btn.querySelector('.btn-icon');
  const spinner = document.getElementById('btnSpinner');

  btn.disabled = active;
  label.textContent = active ? 'Searching…' : 'Find Leads';
  icon.classList.toggle('hidden', active);
  spinner.classList.toggle('hidden', !active);
}

function showProgress(show) {
  document.getElementById('progressPanel').classList.toggle('hidden', !show);
  if (show) updateStatusBadge('RUNNING');
}

function hideResults() {
  document.getElementById('resultsSection').classList.add('hidden');
}

function setProgressNote(text) {
  document.getElementById('progressNote').textContent = text;
}

function updateStatusBadge(status) {
  const badge = document.getElementById('statusBadge');
  badge.className = 'status-badge';

  const STATUS_MAP = {
    'READY':     ['status-badge--ready',     '◌ QUEUED'],
    'RUNNING':   ['status-badge--running',   '● RUNNING'],
    'SUCCEEDED': ['status-badge--succeeded', '✓ DONE'],
    'FAILED':    ['status-badge--failed',    '✕ FAILED'],
    'ABORTED':   ['status-badge--failed',    '✕ ABORTED'],
    'TIMED-OUT': ['status-badge--failed',    '✕ TIMED OUT'],
  };

  const [cls, label] = STATUS_MAP[status] || ['status-badge--ready', status];
  badge.classList.add(cls);
  badge.textContent = label;
}

function startTimer() {
  clearInterval(timerHandle);
  timerHandle = setInterval(() => {
    if (!startTime) return;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    document.getElementById('elapsedTimer').textContent = `${m}:${s}`;

    if (elapsed > 300 && pollingActive) {
      setProgressNote('Still running — Apify may be waiting for proxy capacity. Hang tight…');
    }
  }, 1000);
}

function stopPolling() {
  pollingActive = false;
  clearTimeout(pollHandle);
  clearInterval(timerHandle);
  pollHandle  = null;
  timerHandle = null;
}

// ── Error Handling ──
function handleError(msg) {
  document.getElementById('errorMsg').textContent = msg;
  document.getElementById('errorBanner').classList.remove('hidden');
}

function dismissError() {
  document.getElementById('errorBanner').classList.add('hidden');
}

function friendlyError(err) {
  const msg = err.message || '';
  if (msg === 'UNAUTHORIZED' || msg.includes('401'))          return 'Invalid API token — check your Apify account.';
  if (msg === 'RATE_LIMIT'   || msg.includes('429'))          return 'Rate limit hit. Wait 60 seconds and try again.';
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return 'Network error — check your connection.';
  return `Error: ${msg}`;
}

// ── Utilities ──
function getToken() {
  return localStorage.getItem('apify_token') || document.getElementById('apiKey').value.trim();
}

// Prevent XSS by escaping HTML in values rendered into the DOM
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only allow http/https URLs as hrefs to block javascript: injection
function isSafeUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function dash() {
  return '<span style="color:var(--text-muted)">—</span>';
}
