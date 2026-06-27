// FILE: app/api/codex/device/start/route.ts
import { NextResponse } from "next/server";
import { startDeviceAuth, DEVICE_VERIFICATION_URI } from "@/lib/codex-oauth";

export const runtime = "nodejs";

// POST /api/codex/device/start -> { deviceAuthId, userCode, intervalSeconds, verificationUri }
export async function POST() {
	try {
		const device = await startDeviceAuth();
		return NextResponse.json({
			...device,
			verificationUri: DEVICE_VERIFICATION_URI,
		});
	} catch (err) {
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : "Failed to start device auth" },
			{ status: 502 },
		);
	}
}
