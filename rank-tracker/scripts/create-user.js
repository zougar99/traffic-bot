#!/usr/bin/env node
/**
 * Create an account without the web UI (owner/editor/viewer).
 *
 *   npm run create-user -- --email a@b.com --password 'at-least-10-chars' --role editor --name "Alice"
 */
import { migrate, run } from '../src/db.js'
import { hashPassword, randomId } from '../src/lib/auth.js'
import * as repo from '../src/lib/repo.js'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (!cur.startsWith('--')) return acc
    const next = arr[i + 1]
    if (next && !next.startsWith('--')) acc.push([cur.slice(2), next])
    else acc.push([cur.slice(2), true])
    return acc
  }, [])
)

const email = String(args.email || '').toLowerCase().trim()
const password = String(args.password || '')
const role = ['owner', 'editor', 'viewer'].includes(args.role) ? args.role : 'editor'

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('usage: npm run create-user -- --email a@b.com --password "min-10-chars" [--role owner|editor|viewer]')
  process.exit(1)
}
if (password.length < 10) {
  console.error('password must be at least 10 characters')
  process.exit(1)
}

migrate()
if (repo.userByEmail(email)) {
  console.error('user already exists')
  process.exit(1)
}
run(
  'INSERT INTO users (email, name, password_hash, role, api_key) VALUES (?, ?, ?, ?, ?)',
  email,
  String(args.name || email.split('@')[0]),
  hashPassword(password),
  role,
  'rt_' + randomId(24)
)
console.log(`created ${role} ${email}`)
