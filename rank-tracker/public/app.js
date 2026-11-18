/* ============================================================
   Rank Tracker Pro — dashboard (vanilla JS, ES modules)
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))

const state = {
  user: null,
  sites: [],
  siteId: null,
  summary: {},
  positions: [],
  days: 30,
  filter: '',
  view: 'overview'
}

/* ---------------- http ---------------- */
async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'content-type': 'application/json' } : {},
    ...options
  })
  if (res.status === 401) {
    location.href = '/login'
    throw new Error('unauthenticated')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

const get = (path) => api(path)
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) })
const patch = (path, body) => api(path, { method: 'PATCH', body: JSON.stringify(body || {}) })
const del = (path) => api(path, { method: 'DELETE' })

/* ---------------- ui helpers ---------------- */
let toastTimer
function toast(message, kind = 'ok') {
  const el = $('#toast')
  el.textContent = message
  el.className = 'toast is-on' + (kind === 'err' ? ' toast--err' : '')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (el.className = 'toast'), 2600)
}

function esc(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function posClass(p) {
  if (p == null) return 'pos--none'
  if (p === 1) return 'pos--1'
  if (p === 2) return 'pos--2'
  if (p === 3) return 'pos--3'
  if (p <= 10) return 'pos--4'
  return ''
}

function deltaHtml(delta) {
  if (delta == null) return '<span class="delta delta--flat">—</span>'
  if (delta > 0) return `<span class="delta delta--up">▲ ${delta}</span>`
  if (delta < 0) return `<span class="delta delta--down">▼ ${Math.abs(delta)}</span>`
  return '<span class="delta delta--flat">•</span>'
}

function emptyState(text) {
  return `<div class="empty">${esc(text)}</div>`
}

function fmtDate(value) {
  if (!value) return '—'
  const iso = String(value).replace(' ', 'T') + (String(value).length <= 19 ? 'Z' : '')
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/* ---------------- navigation ---------------- */
function setView(view) {
  state.view = view
  $$('.view').forEach((v) => (v.hidden = v.dataset.view !== view))
  $$('.nav-item').forEach((n) => n.classList.toggle('is-active', n.dataset.nav === view))
  $('#app').dataset.menu = 'closed'
  location.hash = view === 'overview' ? '' : view
  if (view === 'positions') loadPositions()
  if (view === 'keywords') loadKeywords()
  if (view === 'competitors') loadCompetitors()
  if (view === 'alerts') loadAlerts()
  if (view === 'activity') loadActivity()
  if (view === 'settings') loadSettings()
}

$$('.nav-item').forEach((btn) =>
  btn.addEventListener('click', () => setView(btn.dataset.nav))
)
$$('[data-goto]').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault()
    setView(a.dataset.goto)
  })
)

$('#menuBtn')?.addEventListener('click', () => {
  const app = $('#app')
  app.dataset.menu = app.dataset.menu === 'open' ? 'closed' : 'open'
})

/* ---------------- sites ---------------- */
async function loadMe() {
  const me = await get('/api/me')
  if (!me.user) {
    location.href = '/login'
    return
  }
  state.user = me.user
  $('#userName').textContent = me.user.name || me.user.email
  $('#userEmail').textContent = me.user.email
  $('#userInitial').textContent = (me.user.name || me.user.email).charAt(0).toUpperCase()
  $('#apiKey').value = me.user.apiKey || ''
  $('#setName').value = me.user.name || ''
  $('#setTz').value = me.user.timezone || 'UTC'
}

async function loadSites() {
  const { sites } = await get('/api/sites')
  state.sites = sites
  const select = $('#siteSelect')
  if (!sites.length) {
    select.innerHTML = '<option value="">— no site yet —</option>'
    state.siteId = null
    return
  }
  select.innerHTML = sites
    .map((s) => `<option value="${s.id}">${esc(s.label || s.domain)} (${esc(s.domain)})</option>`)
    .join('')
  if (!state.siteId || !sites.some((s) => String(s.id) === String(state.siteId))) {
    state.siteId = sites[0].id
  }
  select.value = String(state.siteId)
}

$('#siteSelect')?.addEventListener('change', (e) => {
  state.siteId = Number(e.target.value) || null
  refreshAll()
})

$('#addSiteBtn')?.addEventListener('click', () => {
  $('#siteForm').reset()
  $('#siteCountry').value = 'us'
  $('#siteLanguage').value = 'en'
  $('#siteDialog').showModal()
})

$('#siteCancel')?.addEventListener('click', () => $('#siteDialog').close())

$('#siteForm')?.addEventListener('submit', async (e) => {
  e.preventDefault()
  try {
    const body = {
      domain: $('#siteDomain').value,
      label: $('#siteLabel').value,
      country: $('#siteCountry').value || 'us',
      language: $('#siteLanguage').value || 'en'
    }
    const { site } = await post('/api/sites', body)
    $('#siteDialog').close()
    toast('Site added')
    state.siteId = site.id
    await loadSites()
    refreshAll()
  } catch (err) {
    toast(err.message, 'err')
  }
})

/* ---------------- overview ---------------- */
async function loadOverview() {
  const ov = await get('/api/overview' + (state.siteId ? `?site=${encodeURIComponent(state.siteId)}` : ''))
  state.summary = ov.summary

  $('#kpiKeywords').textContent = ov.summary.keywords
  $('#kpiSites').textContent = `${ov.summary.sites} site${ov.summary.sites === 1 ? '' : 's'}`
  $('#kpiTop10').textContent = ov.summary.top10
  $('#kpiAvg').textContent = ov.summary.avgPosition == null ? '—' : ov.summary.avgPosition
  $('#kpiAlerts').textContent = ov.summary.unreadAlerts
  $('#kpiAlertsHint').textContent = ov.summary.unreadAlerts ? 'need review' : 'all clear'

  const badge = $('#alertBadge')
  badge.hidden = !ov.summary.unreadAlerts
  badge.textContent = ov.summary.unreadAlerts

  $('#latestAlerts').innerHTML = ov.alerts.length
    ? ov.alerts.map(alertItem).join('')
    : emptyState('No alerts yet — run a check to start tracking.')

  if (!state.siteId) {
    $('#movers').innerHTML = emptyState('Add a site first.')
    $('#sov').innerHTML = emptyState('No data yet.')
    $('#features').innerHTML = emptyState('No SERP features recorded.')
    $('#cannibal').innerHTML = emptyState('Nothing to compare yet.')
    return
  }

  const [pos] = await Promise.all([get(`/api/sites/${state.siteId}/positions?days=30`)])
  state.positions = pos.positions

  const movers = pos.positions
    .filter((p) => p.delta != null && p.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 8)

  $('#movers').innerHTML = movers.length
    ? movers
        .map(
          (m) => `<div class="item">
            <span class="pos ${posClass(m.position)}">${m.position ?? '—'}</span>
            <div class="item__main"><b>${esc(m.phrase)}</b><small>${esc(m.engine)}</small></div>
            <div class="item__side">${deltaHtml(m.delta)}</div>
          </div>`
        )
        .join('')
    : emptyState('No movement in the last 30 days.')

  const rows = pos.share || []
  $('#sov').innerHTML = rows.length
    ? rows
        .slice(0, 7)
        .map(
          (r) => `<div class="bar">
            <div class="bar__top"><span>${esc(r.domain)}${r.you ? ' <b class="tag">you</b>' : ''}</span><b>${r.visibility}%</b></div>
            <div class="bar__track"><div class="bar__fill ${r.you ? 'bar__fill--me' : ''}" style="width:${Math.max(4, Math.min(100, r.visibility))}%"></div></div>
          </div>`
        )
        .join('')
    : emptyState('Add competitors to compare visibility.')

  $('#features').innerHTML = pos.features.length
    ? pos.features
        .map((f) => `<span class="chip">${esc(f.feature.replace(/_/g, ' '))} <b>${f.count}</b></span>`)
        .join('')
    : emptyState('No SERP features recorded yet.')

  $('#cannibal').innerHTML = pos.cannibalization.length
    ? pos.cannibalization
        .slice(0, 5)
        .map(
          (c) => `<div class="item">
            <div class="item__main"><b>${esc(c.phrase)}</b><small>${c.urls.map((u) => esc(u.url.replace(/^https?:\/\//, ''))).join(' · ')}</small></div>
          </div>`
        )
        .join('')
    : emptyState('No cannibalisation detected.')
}

function alertItem(a) {
  return `<div class="item">
    <span class="pos ${a.severity === 'critical' ? 'pos--none' : a.severity === 'warning' ? 'pos--4' : 'pos--2'}">${a.kind === 'drop' || a.kind === 'lost' ? '▼' : a.kind === 'gain' || a.kind === 'new' ? '▲' : '!'}</span>
    <div class="item__main"><b>${esc(a.title)}</b><small>${esc(a.body)}</small></div>
    <div class="item__side"><span class="hint">${fmtDate(a.created_at)}</span></div>
  </div>`
}

/* ---------------- positions ---------------- */
async function loadPositions() {
  if (!state.siteId) return
  const data = await get(`/api/sites/${state.siteId}/positions?days=${state.days}`)
  state.positions = data.positions
  renderPositions()
}

function renderPositions() {
  const filter = state.filter.toLowerCase()
  const rows = state.positions.filter((p) => !filter || p.phrase.toLowerCase().includes(filter))
  const body = $('#posTable tbody')
  body.innerHTML = rows.length
    ? rows
        .map(
          (p) => `<tr>
            <td><b>${esc(p.phrase)}</b></td>
            <td><span class="tag">${esc(p.intent)}</span></td>
            <td>${esc(p.engine)}</td>
            <td class="num"><span class="pos ${posClass(p.position)}">${p.position ?? '—'}</span></td>
            <td class="num">${deltaHtml(p.delta)}</td>
            <td class="url">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.url.replace(/^https?:\/\//, ''))}</a>` : '—'}</td>
            <td><span class="hint">${esc(p.date)}</span></td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="7">${emptyState('No readings yet — press “Run check”.')}</td></tr>`
}

$('#posFilter')?.addEventListener('input', (e) => {
  state.filter = e.target.value
  renderPositions()
})

$('#posDays')?.addEventListener('change', (e) => {
  state.days = Number(e.target.value) || 30
  loadPositions()
})

$('#exportCsv')?.addEventListener('click', () => {
  const rows = [['keyword', 'intent', 'engine', 'position', 'delta', 'url', 'date']]
  for (const p of state.positions) {
    rows.push([p.phrase, p.intent, p.engine, p.position ?? '', p.delta ?? '', p.url || '', p.date])
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `rankings-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
  toast('CSV exported')
})

/* ---------------- keywords ---------------- */
async function loadKeywords() {
  if (!state.siteId) {
    $('#kwList').innerHTML = emptyState('Add a site first.')
    return
  }
  const { keywords } = await get(`/api/sites/${state.siteId}/keywords`)
  $('#kwList').innerHTML = keywords.length
    ? keywords
        .map(
          (k) => `<div class="item">
            <div class="item__main"><b>${esc(k.phrase)}</b><small>${esc(k.engine_list || k.engines)} · ${esc(k.cluster || 'general')} · ${esc(k.intent)}</small></div>
            <div class="item__side">
              <button class="icon-btn" data-kw-toggle="${k.id}" data-active="${k.active}" title="${k.active ? 'Pause' : 'Resume'}">${k.active ? '⏸' : '▶'}</button>
              <button class="icon-btn" data-kw-del="${k.id}" title="Delete">✕</button>
            </div>
          </div>`
        )
        .join('')
    : emptyState('No keywords yet.')
}

$('#kwForm')?.addEventListener('submit', async (e) => {
  e.preventDefault()
  if (!state.siteId) return toast('Add a site first', 'err')
  const phrases = $('#kwInput').value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!phrases.length) return toast('Type at least one keyword', 'err')
  const engines = $$('#enginePicker input:checked').map((i) => i.value)
  if (!engines.length) return toast('Pick at least one engine', 'err')
  try {
    const res = await post(`/api/sites/${state.siteId}/keywords`, { phrases, engines })
    $('#kwInput').value = ''
    toast(`Added ${res.added} keyword(s)`)
    loadKeywords()
    loadOverview()
  } catch (err) {
    toast(err.message, 'err')
  }
})

$('#kwList')?.addEventListener('click', async (e) => {
  const toggle = e.target.closest('[data-kw-toggle]')
  if (toggle) {
    await patch(`/api/keywords/${toggle.dataset.kwToggle}`, { active: toggle.dataset.active !== '1' })
    return loadKeywords()
  }
  const remove = e.target.closest('[data-kw-del]')
  if (remove) {
    if (!confirm('Delete this keyword and its history?')) return
    await del(`/api/keywords/${remove.dataset.kwDel}`)
    toast('Keyword deleted')
    return loadKeywords()
  }
})

$('#clusterBtn')?.addEventListener('click', async () => {
  if (!state.siteId) return toast('Add a site first', 'err')
  try {
    const res = await post(`/api/sites/${state.siteId}/cluster`)
    toast(`Clustered ${res.updated} keyword(s)`)
    loadKeywords()
  } catch (err) {
    toast(err.message, 'err')
  }
})

/* ---------------- competitors ---------------- */
async function loadCompetitors() {
  if (!state.siteId) return
  const data = await get(`/api/sites/${state.siteId}/competitors`)
  $('#compList').innerHTML = data.competitors.length
    ? data.competitors
        .map((c) => `<span class="chip">${esc(c.domain)} <button data-comp-del="${c.id}" title="Remove">×</button></span>`)
        .join('')
    : emptyState('No competitors yet.')

  $('#compBars').innerHTML = data.overview.length
    ? data.overview
        .map(
          (r) => `<div class="bar">
            <div class="bar__top"><span>${esc(r.domain)}</span><b>${r.visibility}%</b></div>
            <div class="bar__track"><div class="bar__fill" style="width:${Math.max(4, Math.min(100, r.visibility))}%"></div></div>
          </div>`
        )
        .join('')
    : emptyState('Add competitors to compare.')
}

$('#compForm')?.addEventListener('submit', async (e) => {
  e.preventDefault()
  if (!state.siteId) return toast('Add a site first', 'err')
  try {
    await post(`/api/sites/${state.siteId}/competitors`, { domain: $('#compInput').value })
    $('#compInput').value = ''
    toast('Competitor added')
    loadCompetitors()
  } catch (err) {
    toast(err.message, 'err')
  }
})

$('#compList')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-comp-del]')
  if (!btn) return
  await del(`/api/competitors/${btn.dataset.compDel}`)
  loadCompetitors()
})

/* ---------------- alerts ---------------- */
async function loadAlerts() {
  const { alerts } = await get('/api/alerts')
  $('#alertList').innerHTML = alerts.length
    ? alerts.map(alertItem).join('')
    : emptyState('No alerts. Run a check to generate some.')
}

$('#markRead')?.addEventListener('click', async () => {
  await post('/api/alerts/read', {})
  toast('Marked as read')
  loadAlerts()
  loadOverview()
})

$('#testDelivery')?.addEventListener('click', async () => {
  try {
    const res = await post('/api/alerts/test', {})
    toast(`email: ${res.email} · telegram: ${res.telegram}`)
  } catch (err) {
    toast(err.message, 'err')
  }
})

/* ---------------- brief ---------------- */
$('#briefForm')?.addEventListener('submit', async (e) => {
  e.preventDefault()
  const phrase = $('#briefInput').value.trim()
  if (!phrase) return
  const engine = $('#briefEngine').value
  const out = $('#briefOut')
  out.innerHTML = emptyState('Generating…')
  try {
    const { brief } = await get(`/api/brief?phrase=${encodeURIComponent(phrase)}&engine=${engine}`)
    out.innerHTML = `
      <div class="card">
        <div class="card__head"><h2>${esc(brief.suggestedTitle)}</h2><span class="tag">${esc(brief.intent)}</span></div>
        <p class="hint">${esc(brief.suggestedMeta)}</p>
        <div class="card__head" style="margin-top:16px"><h2>Headings</h2></div>
        <div class="list list--tight">${brief.headings.map((h) => `<div class="item"><div class="item__main"><b>${esc(h)}</b></div></div>`).join('')}</div>
        <div class="card__head" style="margin-top:16px"><h2>SERP features</h2></div>
        <div class="chips">${brief.serpFeatures.map((f) => `<span class="chip">${esc(f.replace(/_/g, ' '))}</span>`).join('') || '<span class="hint">none</span>'}</div>
      </div>
      <div class="card">
        <div class="card__head"><h2>People also ask</h2><span class="hint">${esc(brief.provider)}</span></div>
        <div class="list list--tight">${(brief.questions.length ? brief.questions : brief.related).map((q) => `<div class="item"><div class="item__main"><b>${esc(q)}</b></div></div>`).join('') || emptyState('none')}</div>
        <div class="card__head" style="margin-top:16px"><h2>Top results</h2></div>
        <div class="list list--tight">${brief.competitors
          .map((c) => `<div class="item"><span class="pos">${c.position}</span><div class="item__main"><b>${esc(c.title)}</b><small>${esc(c.url.replace(/^https?:\/\//, ''))}</small></div></div>`)
          .join('')}</div>
      </div>`
  } catch (err) {
    out.innerHTML = emptyState(err.message)
  }
})

/* ---------------- activity ---------------- */
async function loadActivity() {
  const data = await get('/api/activity')
  $('#runsTable tbody').innerHTML = data.runs.length
    ? data.runs
        .map(
          (r) => `<tr>
            <td>#${r.id}</td><td>${esc(r.trigger)}</td>
            <td class="num">${r.ok_count}</td><td class="num">${r.error_count}</td>
            <td><span class="status status--${r.status === 'done' ? 'ok' : r.status === 'running' ? 'running' : 'failed'}">${esc(r.status)}</span></td>
            <td><span class="hint">${fmtDate(r.started_at)}</span></td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="6">${emptyState('No runs yet.')}</td></tr>`

  $('#delivTable tbody').innerHTML = data.deliveries.length
    ? data.deliveries
        .map(
          (d) => `<tr>
            <td>${esc(d.channel)}</td>
            <td><span class="status status--${d.status === 'ok' ? 'ok' : 'failed'}">${esc(d.status)}</span></td>
            <td class="url">${esc(d.detail || '—')}</td>
            <td><span class="hint">${fmtDate(d.created_at)}</span></td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="4">${emptyState('No deliveries yet.')}</td></tr>`

  $('#auditTable tbody').innerHTML = data.audit.length
    ? data.audit
        .map(
          (a) => `<tr><td>${esc(a.action)}</td><td>${esc(a.target)}</td><td>${esc(a.ip)}</td><td><span class="hint">${fmtDate(a.created_at)}</span></td></tr>`
        )
        .join('')
    : `<tr><td colspan="4">${emptyState('No activity.')}</td></tr>`
}

/* ---------------- settings ---------------- */
async function loadSettings() {
  const data = await get('/api/activity')
  const channels = new Map()
  for (const d of data.deliveries) {
    if (!channels.has(d.channel)) channels.set(d.channel, d)
  }
  const known = ['telegram', 'sheets', 'email']
  $('#integrationList').innerHTML = known
    .map((name) => {
      const last = channels.get(name)
      const status = !last ? 'never used' : last.status === 'ok' ? 'last delivery ok' : 'last delivery failed'
      const cls = !last ? '' : last.status === 'ok' ? 'pill--ok' : ''
      return `<div class="item"><div class="item__main"><b>${name}</b><small>${esc(status)}</small></div><span class="pill ${cls}">${last ? esc(last.status) : '—'}</span></div>`
    })
    .join('')
}

$('#profileForm')?.addEventListener('submit', async (e) => {
  e.preventDefault()
  try {
    await patch('/api/me', { name: $('#setName').value, timezone: $('#setTz').value })
    toast('Profile saved')
    loadMe()
  } catch (err) {
    toast(err.message, 'err')
  }
})

$('#pwForm')?.addEventListener('submit', async (e) => {
  e.preventDefault()
  try {
    await post('/api/password', { currentPassword: $('#pwCurrent').value, newPassword: $('#pwNew').value })
    $('#pwForm').reset()
    toast('Password changed')
  } catch (err) {
    toast(err.message, 'err')
  }
})

$('#copyKey')?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#apiKey').value)
    toast('API key copied')
  } catch {
    toast('Copy failed', 'err')
  }
})

$('#rotateKey')?.addEventListener('click', async () => {
  if (!confirm('Rotate the API key? Existing scripts will stop working.')) return
  try {
    const { user } = await patch('/api/me', { rotateApiKey: true })
    $('#apiKey').value = user.apiKey
    toast('Key rotated')
  } catch (err) {
    toast(err.message, 'err')
  }
})

/* ---------------- run check ---------------- */
$('#collectBtn')?.addEventListener('click', async () => {
  if (!state.siteId) return toast('Add a site first', 'err')
  const btn = $('#collectBtn')
  const original = btn.innerHTML
  btn.disabled = true
  btn.innerHTML = 'Running…'
  try {
    const res = await post(`/api/sites/${state.siteId}/collect`, {})
    toast(`${res.ok} readings · ${res.errors} errors · ${res.alerts} alerts`)
    await refreshAll()
  } catch (err) {
    toast(err.message, 'err')
  } finally {
    btn.disabled = false
    btn.innerHTML = original
  }
})

$('#logoutBtn')?.addEventListener('click', async () => {
  await post('/api/logout', {})
  location.href = '/login'
})

/* ---------------- boot ---------------- */
async function refreshAll() {
  await loadOverview()
  if (state.view === 'positions') await loadPositions()
  if (state.view === 'keywords') await loadKeywords()
  if (state.view === 'competitors') await loadCompetitors()
}

async function boot() {
  try {
    await loadMe()
    await loadSites()
    const health = await get('/api/health')
    const pill = $('#providerPill')
    pill.textContent = `provider: ${health.provider}`
    if (health.provider === 'mock') pill.classList.add('pill--muted')
    await loadOverview()
    const hash = location.hash.replace('#', '')
    if (hash) setView(hash)
    else setView('overview')
  } catch (err) {
    console.error(err)
    toast(err.message, 'err')
  }
}

boot()
