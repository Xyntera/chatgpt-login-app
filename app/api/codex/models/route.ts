// FILE: app/api/codex/models/route.ts
import { NextResponse } from "next/server";
import { getSessionFromCookie, CHATGPT_MODELS_URL, ORIGINATOR, CODEX_USER_AGENT, CODEX_CLI_VERSION } from "@/lib/codex-oauth";

export const runtime = "nodejs";

// GET /api/codex/models -> { models: string[] } that THIS account is allowed to use.
export async function GET() {
	const session = await getSessionFromCookie();
	if (!session) {
		return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
	}

	try {
		const url = `${CHATGPT_MODELS_URL}?client_version=${encodeURIComponent(CODEX_CLI_VERSION)}`;
		const res = await fetch(url, {
			headers: {
				Authorization: `Bearer ${session.access}`,
				"chatgpt-account-id": session.accountId,
				originator: ORIGINATOR,
				"User-Agent": CODEX_USER_AGENT,
				"x-codex-version": CODEX_CLI_VERSION,
				"OpenAI-Beta": "responses=experimental",
				Accept: "application/json",
			},
		});
		const text = await res.text();
		const looksLikeChallenge =
			/_cf_chl_opt|challenge-platform|Enable JavaScript and cookies|Just a moment/i.test(text);
		if (!res.ok) {
			return NextResponse.json(
				{
					error: looksLikeChallenge
						? `Cloudflare challenge (${res.status}) — the model endpoint was blocked. This usually happens from cloud/datacenter IPs. Chat still works via fallback models.`
						: `Models lookup failed (${res.status})`,
					detail: text.slice(0, 300),
				},
				{ status: 502 },
			);
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return NextResponse.json({ error: "Unexpected models response", raw: text.slice(0, 500) });
		}

		// The shape isn't documented; surface both a best-effort list and the raw
		// payload so we can see exactly what the account exposes.
		const obj = parsed as { models?: unknown; categories?: unknown };
		const list: string[] = [];
		const arr = Array.isArray(obj.models) ? obj.models : Array.isArray(parsed) ? parsed : [];
		for (const m of arr as unknown[]) {
			if (typeof m === "string") list.push(m);
			else if (m && typeof m === "object" && "slug" in m && typeof (m as { slug: unknown }).slug === "string") {
				list.push((m as { slug: string }).slug);
			} else if (m && typeof m === "object" && "id" in m && typeof (m as { id: unknown }).id === "string") {
				list.push((m as { id: string }).id);
			}
		}

		return NextResponse.json({ models: list, raw: parsed });
	} catch (err) {
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : "Models lookup error" },
			{ status: 502 },
		);
	}
}
