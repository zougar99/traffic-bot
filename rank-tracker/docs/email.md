# Email tools

Three separate things live in `src/lib/email.js`:

1. **list verification** — clean a CSV you already collected
2. **unsubscribe links** — signed, no database lookup, no login
3. **transactional send** — one webhook call, gated behind `confirmed: true`

There is no SMTP client and no bulk sender in this project. Sending happens
through *your* endpoint (Apps Script / Worker / n8n), which is where the rate
limits, opt-in records and provider terms are enforced. See the scope note at
the end.

---

## 1. Verify a list

Dashboard → **Tools → Email list**, or:

```bash
curl -s -X POST localhost:4170/api/email/verify \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer rt_xxx" \
  -d '{"list":"a@example.com\nb@mailinator.com\nbad", "checkDns": true}'
```

Pipeline, in order:

| Step | What it does | Verdict |
| --- | --- | --- |
| normalize | trims, lowercases, strips `Name <addr>` wrappers | — |
| syntax | RFC-ish regex, TLD sanity | `invalid` |
| dedupe | second occurrence | `duplicate` |
| role account | `info@`, `sales@`, `noreply@`… | `risky` |
| disposable | known throwaway domains | `risky` |
| DNS | MX record, fallback A record (cached) | `invalid` when missing |

Response:

```json
{
  "counts": { "valid": 1, "invalid": 1, "risky": 1, "duplicate": 1 },
  "total": 4,
  "quality": 25,
  "cleaned": ["a@example.com"],
  "sample": [ { "email": "a@example.com", "status": "valid", "reason": "" } ],
  "csv": "email,status,reason\na@example.com,valid,\n…"
}
```

- `quality` is `valid / total` as a percentage — the number to compare lists by.
- `cleaned` is ready to paste into your sender.
- DNS checks are cached per domain for the process lifetime; set
  `"checkDns": false` for a fast syntax-only pass on very large lists.
- Verification **never sends mail** and never contacts the mailbox.

## 2. Unsubscribe links

Every newsletter should carry a one-click opt-out that works without a login.

```js
import { unsubscribeUrl, verifyUnsubscribe } from './src/lib/email.js'

const link = unsubscribeUrl('me@example.com', { base: 'https://rank.example.com' })
// https://rank.example.com/unsubscribe?e=me%40example.com&t=HMAC

verifyUnsubscribe(email, token)   // → true | false
```

The token is `HMAC-SHA256(email, secret).slice(0,32)` where the secret is the
app's persisted session secret. Stateless, so it survives restarts and does not
need a table. Wire it to a route that flips a `subscribed` flag on your list,
then show a plain confirmation page.

Rotating `SESSION_SECRET` invalidates every outstanding link — regenerate them
when you rotate.

## 3. Sending (newsletter / alerts)

```bash
# preview html, no send
curl -s -X POST localhost:4170/api/email/preview -H 'content-type: application/json' \
  -H "Authorization: Bearer rt_xxx" -d '{"subject":"Weekly ranks","items":[…]}'

# send
curl -s -X POST localhost:4170/api/email/send -H 'content-type: application/json' \
  -H "Authorization: Bearer rt_xxx" \
  -d '{"to":"me@example.com","subject":"Weekly ranks","html":"…","confirmed":true}'
```

Guards:

- `confirmed: true` is mandatory. Without it the call returns
  `400 { error: "confirmation required" }` — a deliberate speed bump.
- No `EMAIL_WEBHOOK_URL` → `{ ok: false, skipped: true }`. Nothing is sent, the
  caller is told, the run keeps going.
- `EMAIL_WEBHOOK_TOKEN` is appended as `?token=…` so your endpoint can reject
  strangers.
- One recipient per call. There is no fan-out loop by design.

### Webhook contract

```
POST {EMAIL_WEBHOOK_URL}?token={EMAIL_WEBHOOK_TOKEN}
{ "to": "me@example.com", "subject": "…", "html": "…" }
→ 200 anything
```

Apps Script receiver (Gmail):

```javascript
const TOKEN = 'shared-secret';
function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.token !== TOKEN) return ContentService.createTextOutput('no');
  MailApp.sendEmail({ to: body.to, subject: body.subject, htmlBody: body.html });
  return ContentService.createTextOutput('ok');
}
```

Deploy as web app → execute as *me* → access *anyone* → copy the `/exec` URL.
Quotas apply (100 mails/day on free Gmail, 1500 on Workspace) — the per-call
design makes them easy to respect.

## 4. Alert emails

Rank alerts reuse the same webhook: set `EMAIL_ALERTS_ENABLED=true` and
`EMAIL_ALERT_TO=you@example.com`. Each change produces one short email; the run
summary reports `email: ok | skipped`.

---

## Scope

This module is for lists **you collected with consent** and for mail **to
yourself or your team**. It is not a cold-mailing tool: there is no bulk
import-to-send path, no spoofed sender, no rate-limit evasion, and the send
endpoint takes one recipient per call. If you need marketing email at scale,
use a provider with double opt-in, SPF/DKIM/DMARC and unsubscribe handling —
that is what they are for, and it is what keeps your domain out of spam folders.
