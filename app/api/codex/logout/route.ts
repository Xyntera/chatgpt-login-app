// FILE: app/api/codex/logout/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { REFRESH_COOKIE } from "@/lib/codex-oauth";

// POST /api/codex/logout -> clears the refresh cookie
export async function POST() {
	const jar = await cookies();
	jar.delete(REFRESH_COOKIE);
	return NextResponse.json({ ok: true });
}
