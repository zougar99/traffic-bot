# Anti-spam shield

Front-line defence for the contact forms, comment boxes and signup fields **on
your own site**. Everything is in `src/lib/shield.js` and it has no
dependencies.

Three layers, cheapest first:

1. **rate limit** — per IP, sliding window
2. **scoring** — every submission gets 0–100 and a verdict
3. **reputation + blocklist** — repeated bad actors are remembered

---

## 1. Scoring

```bash
curl -s -X POST localhost:4170/api/shield/score \
  -H 'content-type: application/json' -H "Authorization: Bearer rt_xxx" \
  -d '{"submission":{
        "name":"x","email":"bad",
        "comment":"BUY CHEAP PILLS http://bit.ly/a http://bit.ly/b casino",
        "elapsedMs":200,"honeypot":"filled"
      }}'
```

```json
{
  "result": {
    "score": 100,
    "verdict": "block",
    "reasons": [
      "honeypot filled",
      "submitted faster than a human can type",
      "3 links in one comment",
      "URL shortener",
      "spam keywords: casino, pills",
      "invalid email"
    ]
  }
}
```

| Signal | Weight | Notes |
| --- | --- | --- |
| honeypot filled | +60 | hidden field a human never sees |
| submitted < 1 s | +25 | form filled impossibly fast |
| link density | +8/link, cap 30 | `> 2` links is already suspicious |
| URL shortener | +15 | `bit.ly`, `t.co`, `tinyurl`… |
| spam vocabulary | +10/hit, cap 30 | pharma, casino, crypto, “seo services” |
| invalid email syntax | +20 | |
| duplicate content hash | +25 | same text seen before |
| bad IP reputation | +score | see below |

Verdicts: `allow` (< 30), `review` (30–69), `block` (≥ 70).

Tune it by editing the threshold table at the top of `scoreSubmission()` — the
weights are plain numbers, and `reasons[]` always explains the decision, which
makes false positives easy to diagnose.

The score is advisory: the endpoint returns it and *you* decide. A common setup
is `block` → 403, `review` → store as pending with a `noindex`, `allow` → post.

## 2. Rate limiting

```js
import { rateLimit } from './src/lib/shield.js'

const gate = rateLimit(`submit:${ip}`, { limit: 5, windowMs: 60_000 })
if (!gate.allowed) return res.writeHead(429, {
  'retry-after': Math.ceil(gate.resetInMs / 1000)
})
```

- sliding window, in-memory, per key (`ip`, `ip:route`, `user:action`…)
- `{ allowed, remaining, resetInMs }`
- key it by whatever you like — IP for anonymous forms, user id for
  authenticated actions
- the same helper drives the login endpoint, so credential stuffing hits a wall

In-memory means a restart clears the counters; that is fine for a single
process. Behind a load balancer, key on the `X-Forwarded-For` value your proxy
sets (never trust a client-supplied header directly).

## 3. Reputation and blocklist

```js
import { bumpReputation, reputationOf, blocklist } from './src/lib/shield.js'

bumpReputation(ip, +1)     // a spam hit
bumpReputation(ip, -1)     // a clean submission
reputationOf(ip)           // 0–100
blocklist()                // recent blocked IPs + count
```

Reputation starts at 50. `+1` subtracts 10 (floor 0), `-1` adds 3 (cap 100).
The score contribution is `max(0, (50 - reputation) / 2)`, so a known-bad IP
starts halfway to `block` before any other signal. Entries age out after 24 h
of inactivity; the blocklist returns the current top offenders with their hit
counts:

```bash
curl -s localhost:4170/api/shield/blocklist -H "Authorization: Bearer rt_xxx"
```

`resetBuckets()` clears everything — useful in tests, dangerous in production.

---

## Wiring it into a form

```javascript
import { rateLimit, scoreSubmission, contentHash, bumpReputation } from './shield.js'

export async function handleComment(req, res) {
  const ip = req.socket.remoteAddress || 'unknown'

  const gate = rateLimit(`comment:${ip}`, { limit: 5, windowMs: 60_000 })
  if (!gate.allowed) return res.writeHead(429).end()

  const body = await readJson(req)
  const verdict = scoreSubmission(
    {
      name: body.name,
      email: body.email,
      comment: body.comment,
      honeypot: body.website,          // hidden input
      elapsedMs: Date.now() - Number(body.startedAt || 0),
      ip
    },
    { seenHashes: new Set() }          // swap for a real store
  )

  if (verdict.verdict === 'block') {
    bumpReputation(ip, +1)
    return res.writeHead(403, { 'content-type': 'application/json' })
      .end(JSON.stringify({ error: 'rejected' }))   // keep the reason server-side
  }

  if (verdict.verdict === 'review') await store.pending(body, verdict.score)
  else await store.published(body)

  bumpReputation(ip, -1)
  res.writeHead(201).end()
}
```

Two habits that matter:

- **never echo `reasons` to the client** — it teaches bots which signal fired
- **start permissive, tighten later**: log scores for a week, then set the block
  threshold just above the legitimate traffic distribution

## Client-side helpers

Cheap and effective, no JS required for the first two:

```html
<form>
  <input name="email" required>
  <input name="comment" required>
  <!-- honeypot: hidden from humans, visible to naive bots -->
  <div style="position:absolute;left:-9999px" aria-hidden="true">
    <input name="website" tabindex="-1" autocomplete="off">
  </div>
  <input type="hidden" name="startedAt" id="startedAt">
  <button type="submit">Send</button>
</form>
<script>document.getElementById('startedAt').value = Date.now()</script>
```

`elapsedMs` then measures real typing time. Anything under a second is a bot.

---

## Scope

This module defends **your** endpoints. It does not identify visitors across
sites, does not fingerprint devices, and does not feed a shared blacklist — the
reputation store is local. That is deliberate: cross-site tracking is what
ad-tech is for, and it is not needed to stop form spam.
