/**
 * Editorial calendar — turns keywords + intent into a dated content plan.
 * Rows: [week, date, topic, cluster, intent, format, notes]
 */
export function buildCalendar(keywords, { startDate = new Date(), perWeek = 2 } = {}) {
  const byCluster = new Map()
  for (const kw of keywords) {
    const cluster = kw.cluster || kw.intent || 'general'
    if (!byCluster.has(cluster)) byCluster.set(cluster, [])
    byCluster.get(cluster).push(kw)
  }

  const ordered = [...byCluster.entries()]
    .map(([cluster, items]) => ({ cluster, items: items.sort((a, b) => b.phrase.length - a.phrase.length) }))
    .sort((a, b) => b.items.length - a.items.length)

  const plan = []
  let week = 0
  let slot = 0
  const start = new Date(startDate)
  start.setHours(9, 0, 0, 0)

  for (const group of ordered) {
    for (const kw of group.items) {
      const date = new Date(start)
      date.setDate(date.getDate() + week * 7 + Math.floor(slot / perWeek))
      plan.push({
        date: date.toISOString().slice(0, 10),
        topic: kw.phrase,
        cluster: group.cluster,
        intent: kw.intent || 'unknown',
        format: formatFor(group.cluster, kw.intent),
        notes: notesFor(kw)
      })
      slot += 1
      if (slot % perWeek === 0) week += 1
    }
  }
  return plan.sort((a, b) => (a.date < b.date ? -1 : 1))
}

function formatFor(cluster, intent) {
  if (cluster === 'comparison') return 'Comparison page'
  if (cluster === 'reviews') return 'Review roundup'
  if (cluster === 'pricing') return 'Pricing page'
  if (cluster === 'how-to') return 'Step-by-step tutorial'
  if (cluster === 'tools') return 'Ranked listicle'
  if (cluster === 'local') return 'Local landing page'
  if (cluster === 'definitions') return 'Explainer'
  if (intent === 'transactional') return 'Commercial landing page'
  return 'Blog post'
}

function notesFor(kw) {
  const intent = kw.intent || 'unknown'
  const base = {
    informational: 'Answer the question in the first 120 words, add an FAQ block.',
    transactional: 'Lead with the offer, repeat the CTA above and below the fold.',
    local: 'Add an embedded map, opening hours and LocalBusiness schema.',
    navigational: 'Keep it short, clear brand hierarchy, one primary CTA.',
    unknown: 'Check the live SERP before writing — intent unclear.'
  }
  return base[intent] || base.unknown
}
