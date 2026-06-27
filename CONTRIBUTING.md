# Contributing

Thanks for your interest in `<LoginWithChatGPT />`. Contributions of all
sizes are welcome — bug fixes, features, docs, or just a good issue report.

## Getting started

```bash
git clone https://github.com/Xyntera/chatgpt-login-app
cd chatgpt-login-app
npm install
npm run dev          # http://localhost:3000
```

No environment variables are required for local dev. `NEXT_PUBLIC_APP_ORIGIN`
defaults to `http://localhost:3000` and is auto-detected on Vercel.

## Before you open a PR

- Run `npm run build` and make sure it compiles.
- Run `npx tsc --noEmit` — the project is strict TypeScript and should stay
  type-clean.
- Keep changes focused. One concern per PR is easier to review.
- Never commit secrets. There is no API key in this project by design (it uses
  your own ChatGPT OAuth session). If you add config, use `.env.local` (already
  gitignored) and document it in `.env.example`.

## Architecture (quick map)

- `app/page.tsx` — the UI (login + console).
- `lib/codex-oauth.ts` — OAuth/PKCE + token handling. The refresh token stays
  server-side in an httpOnly cookie; the browser only sees the short-lived
  access token.
- `lib/codex-models.ts` — account-aware model resolution. Asks the account
  which model slugs it's entitled to instead of hardcoding one.
- `app/api/codex/*` — server routes that proxy to the ChatGPT Codex backend.

## Good first issues

- **Browser-extension build** — the biggest open problem. Self-hosting on a
  datacenter IP (Vercel/VPS) can hit a Cloudflare challenge on the ChatGPT
  backend. A browser extension would make the upstream call from the user's own
  IP and session, sidestepping it entirely. See the discussion in issues.
- **Markdown rendering** for streamed output (currently plain text).
- **Copy-to-clipboard** button on responses.
- **Conversation history** (multi-turn) instead of single prompt/response.
- **Tests** — there's room for route-level and resolver tests.

## Reporting bugs

Open an issue with: what you expected, what happened, your plan tier
(Free/Go/Plus/Pro), and where you're hosting (local / Vercel / VPS). If it's a
model or Cloudflare error, paste the response from `GET /api/codex/models`.

## License

By contributing, you agree your work is licensed under the project's
[MIT License](./LICENSE).
