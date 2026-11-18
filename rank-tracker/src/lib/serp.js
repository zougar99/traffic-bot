/**
 * SERP layer.
 *
 * Providers
 *  - serper  : https://serper.dev  (Google organic + features)
 *  - serpapi : https://serpapi.com (Google; also bing/yahoo/duckduckgo engines)
 *  - mock    : deterministic local generator — used for tests and demos,
 *              never billed, clearly labelled in the UI.
 *
 * The layer always returns the same normalised shape, so the collector and the
 * analytics code never care which provider produced the data.
 */
import { config } from '../config.js'

export const ENGINES = ['google', 'bing', 'yahoo', 'duckduckgo']

export const FEATURE_KEYS = [
  'featured_snippet',
  'people_also_ask',
  'local_pack',
  'image_pack',
  'video_pack',
  'top_stories',
  'shopping',
  'knowledge_panel',
  'sitelinks',
  'faq_rich_result'
]

export function providerName() {
  const p = config.serp.provider
  if (p === 'auto') {
    if (config.serp.serperKey) return 'serper'
    if (config.serp.serpapiKey) return 'serpapi'
    return 'mock'
  }
  return p
}

async function fetchJson(url, init = {}, ms = config.serp.timeoutMs) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    const res = await fetch(url, { ...init, signal: ac.signal })
    const body = await res.text()
    if (!res.ok) {
      throw new Error(`provider ${res.status}: ${body.slice(0, 180)}`)
    }
    try {
      return JSON.parse(body)
    } catch {
      throw new Error('provider returned non-JSON')
    }
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ *
 * Serper
 * ------------------------------------------------------------------ */
async function serper(phrase, { country = 'us', language = 'en', depth = 100 } = {}) {
  const data = await fetchJson(
    'https://google.serper.dev/search',
    {
      method: 'POST',
      headers: {
        'X-API-KEY': config.serp.serperKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ q: phrase, gl: country, hl: language, num: depth })
    }
  )
  const results = (data.organic || []).map((r) => ({
    position: Number(r.position) || null,
    url: r.link || '',
    title: r.title || '',
    snippet: r.snippet || ''
  }))
  const features = new Set()
  if (data.answerBox) features.add('featured_snippet')
  if (Array.isArray(data.peopleAlsoAsk) && data.peopleAlsoAsk.length) features.add('people_also_ask')
  if (Array.isArray(data.relatedSearches) && data.relatedSearches.length) features.add('top_stories')
  if (data.knowledgeGraph) features.add('knowledge_panel')
  if (Array.isArray(data.topStories) && data.topStories.length) features.add('top_stories')
  if (Array.isArray(data.images) && data.images.length) features.add('image_pack')
  if (Array.isArray(data.videos) && data.videos.length) features.add('video_pack')
  if (Array.isArray(data.shopping) && data.shopping.length) features.add('shopping')
  if (data.localPack || Array.isArray(data.places) || Array.isArray(data.local)) features.add('local_pack')
  return { results, features: [...features], related: data.relatedSearches || [] }
}

/* ------------------------------------------------------------------ *
 * SerpAPI
 * ------------------------------------------------------------------ */
const SERPAPI_ENGINE = { google: 'google', bing: 'bing', yahoo: 'yahoo', duckduckgo: 'duckduckgo' }

async function serpapi(phrase, { engine = 'google', country = 'us', language = 'en' } = {}) {
  const params = new URLSearchParams({
    engine: SERPAPI_ENGINE[engine] || 'google',
    q: phrase,
    hl: language,
    gl: country,
    api_key: config.serp.serpapiKey,
    num: '100'
  })
  const data = await fetchJson(`https://serpapi.com/search.json?${params}`)
  if (data.error) throw new Error(String(data.error))

  const organic = data.organic_results || data.organic || []
  const results = organic.map((r, i) => ({
    position: Number(r.position) || i + 1,
    url: r.link || r.url || '',
    title: r.title || '',
    snippet: r.snippet || ''
  }))

  const features = new Set()
  if (data.answer_box) features.add('featured_snippet')
  if (data.related_questions) features.add('people_also_ask')
  if (data.local_results || data.local_map) features.add('local_pack')
  if (data.images_results) features.add('image_pack')
  if (data.inline_videos || data.video_results) features.add('video_pack')
  if (data.top_stories) features.add('top_stories')
  if (data.shopping_results) features.add('shopping')
  if (data.knowledge_graph) features.add('knowledge_panel')
  if (data.news_results) features.add('top_stories')
  return { results, features: [...features], related: (data.related_searches || []).map((r) => r.query) }
}

/* ------------------------------------------------------------------ *
 * Mock provider — deterministic, useful offline and in tests
 * ------------------------------------------------------------------ */
/** FNV-1a + an avalanche finaliser, so consecutive seeds spread properly
 *  (a raw FNV-1a on similar strings can land on the same residue and make a
 *  "unique pick" loop spin forever). */
function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h ^= h >>> 16
  h = Math.imul(h, 2246822507)
  h ^= h >>> 13
  h = Math.imul(h, 3266489909)
  h ^= h >>> 16
  return h >>> 0
}

function mock(phrase, { domain = '', seed = '', engine = 'google' } = {}) {
  const key = `${phrase}|${seed}|${domain}|${engine}`
  const h = hash(key)
  const pool = [
    'wikipedia.org',
    'forbes.com',
    'hubspot.com',
    'moz.com',
    'ahrefs.com',
    'semrush.com',
    'blog.hubspot.com',
    'searchenginejournal.com',
    'neilpatel.com',
    'yoast.com',
    'statista.com',
    'reddit.com'
  ]
  // deterministic shuffle of the fixed pool (Fisher–Yates with a seeded LCG)
  const poolCopy = [...pool]
  let lcg = h || 1
  const next = () => (lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0) / 4294967296
  for (let i = poolCopy.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[poolCopy[i], poolCopy[j]] = [poolCopy[j], poolCopy[i]]
  }

  const results = poolCopy.slice(0, 30).map((pick, index) => ({
    position: index + 1,
    url: `https://${pick}/${slug(phrase)}-${(h + index * 13) % 97}`,
    title: `${cap(phrase)} — result ${index + 1} (${pick})`,
    snippet: `Mock SERP entry for “${phrase}” from ${pick}.`
  }))
  if (domain) {
    // Mix the domain into the position so demo history drifts instead of
    // jumping between 1st and 38th place from one day to the next.
    const base = 1 + (hash(`pos|${phrase}|${domain}|${engine}`) % 38)
    const drift = (hash(`drift|${phrase}|${seed}|${domain}|${engine}`) % 7) - 3
    const target = Math.max(1, Math.min(100, base + drift))
    const exists = results.find((r) => r.position === target)
    const entry = {
      position: target,
      url: `https://${domain}/${slug(phrase)}`,
      title: `${cap(phrase)} | ${domain}`,
      snippet: `Your page for “${phrase}”.`
    }
    if (exists) Object.assign(exists, entry)
    else results.push(entry)
    results.sort((a, b) => a.position - b.position)
  }
  const features = []
  if (h % 3 === 0) features.push('featured_snippet')
  if (h % 4 !== 0) features.push('people_also_ask')
  if (h % 7 === 0) features.push('local_pack')
  if (h % 5 === 0) features.push('image_pack')
  if (h % 6 === 0) features.push('video_pack')
  return { results, features, related: [`${phrase} tools`, `${phrase} 2026`, `best ${phrase}`] }
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
}

function cap(text) {
  return String(text).charAt(0).toUpperCase() + String(text).slice(1)
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */
/**
 * @returns {Promise<{results: Array<{position:number,url:string,title:string,snippet:string}>,
 *                    features: string[], related: string[], provider: string}>}
 */
export async function search(phrase, opts = {}) {
  const provider = providerName()
  const engine = opts.engine || 'google'
  if (provider === 'serper') {
    if (engine !== 'google') {
      // Serper is Google-only; fall back to SerpAPI or mock for other engines
      if (config.serp.serpapiKey) {
        const out = await serpapi(phrase, { ...opts, engine })
        return { ...out, provider: 'serpapi' }
      }
      const out = mock(phrase, { ...opts, engine })
      return { ...out, provider: 'mock' }
    }
    const out = await serper(phrase, opts)
    return { ...out, provider: 'serper' }
  }
  if (provider === 'serpapi') {
    const out = await serpapi(phrase, { ...opts, engine })
    return { ...out, provider: 'serpapi' }
  }
  const out = mock(phrase, { ...opts, engine })
  return { ...out, provider: 'mock' }
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

/** Match a target domain against SERP results (exact host or subdomain). */
export function findRank(results, domain) {
  if (!domain) return null
  const want = String(domain).toLowerCase().replace(/^www\./, '')
  for (const r of results) {
    const host = hostOf(r.url)
    if (!host) continue
    if (host === want || host.endsWith('.' + want)) {
      return { position: r.position, url: r.url, title: r.title }
    }
  }
  return null
}

/** {domain: position} for every competitor present in the results. */
export function competitorRanks(results, competitors = []) {
  const map = {}
  for (const c of competitors) {
    const hit = findRank(results, c)
    if (hit) map[c] = hit.position
  }
  return map
}

/**
 * Detect cannibalisation: two different URLs of the same domain ranking for
 * the same keyword across engines / dates.
 */
export function detectCannibalization(rows) {
  const urls = new Set()
  for (const row of rows) {
    if (!row || !row.url) continue
    urls.add(normalizePath(row.url))
  }
  return urls.size > 1 ? [...urls] : []
}

function normalizePath(url) {
  try {
    const u = new URL(url)
    return u.origin.replace(/^https?:\/\//, '').replace(/^www\./, '') + u.pathname.replace(/\/$/, '')
  } catch {
    return String(url || '')
  }
}

/** Rough intent classification from the phrase (no AI call, deterministic). */
export function classifyIntent(phrase) {
  const p = String(phrase).toLowerCase()
  if (/\b(buy|price|pricing|cost|cheap|discount|coupon|deal|order|shop)\b/.test(p)) return 'transactional'
  if (/\b(near me|in \w+|local|city|downtown)\b/.test(p)) return 'local'
  if (/\b(login|sign in|official site|download)\b/.test(p)) return 'navigational'
  if (/^(how|what|why|when|where|who|which|does|is|are|can)\b/.test(p)) return 'informational'
  if (/\b(guide|tutorial|tips|examples|best|vs|review)\b/.test(p)) return 'informational'
  return 'unknown'
}
