# Deploying to Vercel

This app uses the Codex **device-code login flow**, which works on a hosted
server (no localhost redirect URI needed). So it can run on Vercel.

## Steps

### Option A — Vercel dashboard (easiest)
1. Push this `chatgpt-login-app` folder to a GitHub repo.
2. Go to https://vercel.com/new and import that repo.
3. Framework preset: **Next.js** (auto-detected).
4. Root directory: set to `chatgpt-login-app` if the repo root contains it.
5. Environment variables: **none required.** `VERCEL_URL` is auto-detected.
   - (Optional) If you use a custom domain, set
     `NEXT_PUBLIC_APP_ORIGIN=https://yourdomain.com` (no trailing slash).
6. Click **Deploy**.

### Option B — Vercel CLI
```bash
npm i -g vercel
cd chatgpt-login-app
vercel            # first run: links/creates the project
vercel --prod     # production deploy
```

## After deploy
- Open your `https://<project>.vercel.app` URL.
- Click login → you'll get a device code → open the verification link →
  approve in your ChatGPT account → return and it polls until logged in.
- Send a prompt.

## IMPORTANT: the IP-block caveat
ChatGPT's `backend-api` (which this app calls with your login token) filters
requests from datacenter IPs. The CLI-style headers in this build help, but
**Vercel's serverless IPs may still be blocked**, returning:

- a 403 HTML page from `/api/codex/models`, or
- a 400 "model not supported" from `/api/codex/chat`.

If that happens, it is NOT a code bug — it's the IP. Options:
1. Run from a residential IP (your own machine) instead of cloud hosting.
2. Route the outbound `backend-api` calls through a residential/ISP proxy
   (set an HTTPS proxy and have the fetch use it).
3. Use a real OpenAI API key — the officially supported, stable path.

This app talks to a private, undocumented endpoint using a ChatGPT login
token. OpenAI can change or block it at any time.
