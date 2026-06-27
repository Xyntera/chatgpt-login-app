// FILE: app/api/codex/refresh/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { refreshAccessToken, REFRESH_COOKIE } from "@/lib/codex-oauth";

// POST /api/codex/refresh  -> { access, expires, accountId }
export async function POST() {
	const jar = await cookies();
	const refresh = jar.get(REFRESH_COOKIE)?.value;
	if (!refresh) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

	let creds;
	try {
		creds = await refreshAccessToken(refresh);
	} catch (err) {
		jar.delete(REFRESH_COOKIE);
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : "Refresh failed" },
			{ status: 401 },
		);
	}

	// rotate the stored refresh token
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