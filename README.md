# CREDIT FOR THE IDEA [Savio martin](https://x.com/saviomartin7/status/2070531441415602469)
# Login with ChatGPT

Add a **"Login with ChatGPT"** button to your site. Users log in with their
personal ChatGPT account (Free, Go, Plus, or Pro) and run prompts on it — you
never hold an OpenAI API key, and you aren't billed for their usage.

Uses the **device-code flow**, so it works on a hosted server (VPS / Vercel) —
no redirect URI to register, no localhost requirement.

---

## ⚠️ Read this first — important caveats

This reuses the **OpenAI Codex** OAuth client and talks to the same backend the
Codex CLI uses. Understand the tradeoffs before shipping:

- **Each user must enable device-code authorization once.** In their ChatGPT
  account: **Settings → Security & Login → enable device code authorization for
  Codex**. Without it, their code won't be accepted. This is on the user, not
  something your app can toggle.
- **Not a public/supported API.** The client ID and backend belong to OpenAI's
  Codex tooling. There's no official program letting third-party apps consume a
  user's ChatGPT subscription. You're using a first-party credential off-label.
- **Can break or get accounts limited.** Endpoints are undocumented and may
  change; driving usage this way may violate OpenAI's terms, putting users'
  accounts and the shared client ID at risk.
- **Fine for experiments / demos. Don't build a business on it.** For production,
  use the official [OpenAI API](https://platform.openai.com) with your own key,
  or have each user bring their own key.

---

## How the device-code login works

```
Browser                      Your server                 OpenAI
  │  click login                 │                           │
  ├─────────────────────────────▶│  POST /device/start       │
  │                              │  ── request user code ───▶ │
  │  show code "A2EV-DD3F2" ◀────┤◀── { code, deviceAuthId } ─│
  │                              │                           │
  │  user opens auth.openai.com/codex/device, enters code,   │
  │  approves in their ChatGPT account                       │
  │                              │                           │
  │  poll every Ns ─────────────▶│  POST /device/poll ──────▶ │
  │                              │  (pending… pending…)       │
  │                              │  ◀── authorization_code ── │
  │                              │  exchange ───────────────▶ │
  │  { access, accountId } ◀─────┤◀── tokens; refresh→cookie  │
  │                              │                           │
  │  prompt ────────────────────▶│  POST /chat ─────────────▶ │
  │  streamed reply ◀────────────┤◀── stream ─────────────────│
```

- The **access token** stays in browser memory; the **refresh token** lives only
  in an httpOnly cookie on your server.
- No redirect URI is involved, which is why this runs on a hosted URL.

## File map

```
lib/codex-oauth.ts                    constants, PKCE, token ops, device-code start/poll
lib/auth-context.tsx                  client: device login + polling, auto-refresh, logout
app/page.tsx                          login button → code/link UI → streaming chat
app/api/codex/device/start/route.ts   POST -> get a user code
app/api/codex/device/poll/route.ts    POST -> poll; on success sets refresh cookie
app/api/codex/refresh/route.ts        POST -> rotate refresh, return access token
app/api/codex/logout/route.ts         POST -> clear refresh cookie
app/api/codex/chat/route.ts           POST -> run a prompt on the user's account (streaming)
app/api/codex/debug/route.ts          GET  -> inspect generated auth values
app/api/codex/login + exchange + auth/callback   legacy browser-redirect flow (localhost only)
```

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 → **Login with ChatGPT** → you'll get a code → open
the ChatGPT device page → approve → chat.

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

1. Push to GitHub, import in Vercel (Next.js auto-detected).
2. No env vars required for the device-code flow.
3. The device-code login works on the live URL — that's the whole point of this
   flow.

Or any Node host / VPS: `npm run build && npm start`.

## Multi-user note

The session is a single httpOnly refresh cookie per browser — fine for personal
use and demos. For real multi-user accounts, store each user's refresh token in
a database keyed to an opaque session id held in the cookie.

## License

MIT — see [LICENSE](./LICENSE). Provided as-is, no warranty. Your use of OpenAI
services through this code is your responsibility and subject to OpenAI's terms.
