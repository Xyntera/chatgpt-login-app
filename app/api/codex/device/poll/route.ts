// FILE: app/api/codex/device/poll/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { pollDeviceAuth, REFRESH_COOKIE } from "@/lib/codex-oauth";

export const runtime = "nodejs";

// POST /api/codex/device/poll  { deviceAuthId, userCode }
// -> { status: "pending" | "slow_down" } while waiting
// -> { status: "complete", access, expires, accountId } when approved (sets refresh cookie)
// -> { status: "failed", error } on failure
export async function POST(req: NextRequest) {
	let body: { deviceAuthId?: string; userCode?: string };
	try {
		body = await req.json();
	} catch {
		return NextResponse.json({ status: "failed", error: "Invalid JSON" }, { status: 400 });
	}

	const { deviceAuthId, userCode } = body;
	if (!deviceAuthId || !userCode) {
		return NextResponse.json(
			{ status: "failed", error: "Missing deviceAuthId or userCode" },
			{ status: 400 },
		);
	}

	let result;
	try {
		result = await pollDeviceAuth(deviceAuthId, userCode);
	} catch (err) {
		return NextResponse.json(
			{ status: "failed", error: err instanceof Error ? err.message : "Poll error" },
			{ status: 502 },
		);
	}

	if (result.status === "complete") {
		const creds = result.credentials;
		const jar = await cookies();
		jar.set(REFRESH_COOKIE, creds.refresh, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			path: "/",
			maxAge: 60 * 60 * 24 * 30,
		});
		return NextResponse.json({
			status: "complete",
			access: creds.access,
			expires: creds.expires,
			accountId: creds.accountId,
		});
	}

	if (result.status === "failed") {
		return NextResponse.json({ status: "failed", error: result.message });
	}

	// pending or slow_down
	return NextResponse.json({ status: result.status });
}
