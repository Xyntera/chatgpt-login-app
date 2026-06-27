// FILE: app/api/codex/login/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
	generatePKCE,
	createState,
	buildAuthorizeUrl,
	getRedirectUri,
	PKCE_COOKIE,
	STATE_COOKIE,
} from "@/lib/codex-oauth";

// GET /api/codex/login  -> 302 to OpenAI authorize
export async function GET() {
	const { verifier, challenge } = await generatePKCE();
	const state = createState();
	const redirectUri = getRedirectUri();

	const jar = await cookies();
	const secure = process.env.NODE_ENV === "production";
	const opts = {
		httpOnly: true as const,
		secure,
		sameSite: "lax" as const,
		path: "/",
		maxAge: 600, // 10 min — only needs to survive the round-trip
	};
	jar.set(PKCE_COOKIE, verifier, opts);
	jar.set(STATE_COOKIE, state, opts);

	const url = buildAuthorizeUrl({ redirectUri, challenge, state });
	return NextResponse.redirect(url);
}