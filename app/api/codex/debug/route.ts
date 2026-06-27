// FILE: app/api/codex/debug/route.ts
import { NextResponse } from "next/server";
import {
	buildAuthorizeUrl,
	getRedirectUri,
	generatePKCE,
	createState,
} from "@/lib/codex-oauth";

// GET /api/codex/debug -> shows exactly what the login route will send.
// Use this to verify the redirect_uri that must be registered on the OAuth app.
export async function GET() {
	try {
		const redirectUri = getRedirectUri();
		const { challenge } = await generatePKCE();
		const authorizeUrl = buildAuthorizeUrl({
			redirectUri,
			challenge,
			state: createState(),
		});
		return NextResponse.json({
			redirectUri,
			note: "This exact redirectUri must be registered on the OAuth client. The Codex client ID only allows localhost callbacks — non-localhost (e.g. *.vercel.app) will be rejected with authorize_hydra_invalid_request.",
			authorizeUrl,
		});
	} catch (err) {
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : "debug failed" },
			{ status: 500 },
		);
	}
}
