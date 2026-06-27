// FILE: app/api/codex/exchange/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
	exchangeAuthorizationCode,
	getRedirectUri,
	PKCE_COOKIE,
	STATE_COOKIE,
	REFRESH_COOKIE,
} from "@/lib/codex-oauth";

// POST /api/codex/exchange  { code, state }
export async function POST(req: NextRequest) {
	const jar = await cookies();
	const expectedState = jar.get(STATE_COOKIE)?.value;
	const verifier = jar.get(PKCE_COOKIE)?.value;

	// one-time use
	jar.delete(STATE_COOKIE);
	jar.delete(PKCE_COOKIE);

	let body: { code?: string; state?: string };
	try {
		body = await req.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const { code, state } = body;
	if (!code) return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
	if (!verifier) return NextResponse.json({ error: "Missing PKCE verifier" }, { status: 400 });
	if (!state || !expectedState || state !== expectedState) {
		return NextResponse.json({ error: "State mismatch" }, { status: 400 });
	}

	let creds;
	try {
		creds = await exchangeAuthorizationCode(code, verifier, getRedirectUri());
	} catch (err) {
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : "Token exchange failed" },
			{ status: 502 },
		);
	}

	// Refresh token stays server-side, httpOnly. Browser only gets the short-lived access token.
	jar.set(REFRESH_COOKIE, creds.refresh, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		maxAge: 60 * 60 * 24 * 30,
	});

	return NextResponse.json({
		access: creds.access,
		expires: creds.expires,
		accountId: creds.accountId,
	});
}