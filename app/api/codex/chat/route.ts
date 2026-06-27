// FILE: app/api/codex/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
	getSessionFromCookie,
	CHATGPT_BACKEND_URL,
	ORIGINATOR,
	CODEX_USER_AGENT,
	CODEX_CLI_VERSION,
} from "@/lib/codex-oauth";
import { resolveModels } from "@/lib/codex-models";

export const runtime = "nodejs";

// POST /api/codex/chat  { prompt, model? }
// Streams back plain text deltas (Server-Sent Events from the upstream are
// parsed and re-emitted as a clean text stream).
export async function POST(req: NextRequest) {
	const session = await getSessionFromCookie();
	if (!session) {
		return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
	}

	let body: { prompt?: string; effort?: string; model?: string; models?: string[] };
	try {
		body = await req.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const prompt = body.prompt?.trim();
	if (!prompt) {
		return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
	}

	// On a ChatGPT account the Codex backend only accepts certain model ids, and
	// which ones are valid varies by account. We try a list of known candidates
	// in order and use the first the backend accepts. An explicit body.model
	// jumps the queue. body.effort still controls reasoning effort.
	const allowedEfforts = ["minimal", "low", "medium", "high"];
	const effort = allowedEfforts.includes(body.effort ?? "")
		? (body.effort as string)
		: "low";

	// Account-aware model resolution (ported from EvanZhouDev/openai-oauth):
	// ask the account which slugs it's entitled to and try them in order.
	// An explicit body.model jumps the queue; body.models acts like --models
	// (an override list). Otherwise the account's own list is authoritative —
	// no codex/gpt-5 guessing, which is what caused the "'gpt-5' not supported"
	// rejection.
	const configuredModels = body.model
		? [body.model]
		: Array.isArray(body.models) && body.models.length > 0
			? body.models
			: undefined;

	let candidates: string[];
	try {
		candidates = await resolveModels(session, configuredModels);
	} catch (err) {
		return NextResponse.json(
			{
				error: `Could not resolve models for this account: ${
					err instanceof Error ? err.message : "unknown error"
				}`,
			},
			{ status: 502 },
		);
	}

	function buildPayload(
		model: string,
		effortOverride?: string,
	): Record<string, unknown> {
		const isReasoning = /^(gpt-5|o[0-9]|codex)/.test(model);
		const p: Record<string, unknown> = {
			model,
			instructions: "You are a helpful assistant.",
			input: [
				{
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: prompt }],
				},
			],
			tools: [],
			tool_choice: "auto",
			parallel_tool_calls: false,
			store: false,
			stream: true,
			include: [],
		};
		const eff = effortOverride ?? effort;
		// effortOverride === "" means: omit reasoning entirely (lowest-tier fallback)
		if (isReasoning && eff !== "") p.reasoning = { effort: eff, summary: "auto" };
		return p;
	}

	let upstream: Response | null = null;
	let lastDetail = "";
	let lastStatus = 0;
	const tried: string[] = [];

	for (const model of candidates) {
		tried.push(model);

		// Try the requested effort first, then degrade for lower tiers that
		// reject medium/high (or reasoning entirely). "" = omit reasoning.
		const effortChain =
			effort === "minimal" || effort === "low"
				? [effort, ""]
				: [effort, "low", "minimal", ""];

		let modelAccepted = false;
		let modelLevelReject = false;

		for (const effortTry of effortChain) {
			const res = await fetch(CHATGPT_BACKEND_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${session.access}`,
					"chatgpt-account-id": session.accountId,
					originator: ORIGINATOR,
					"User-Agent": CODEX_USER_AGENT,
					"x-codex-version": CODEX_CLI_VERSION,
					"OpenAI-Beta": "responses=experimental",
					session_id: crypto.randomUUID(),
					Accept: "text/event-stream",
				},
				body: JSON.stringify(buildPayload(model, effortTry)),
			});

			if (res.ok && res.body) {
				upstream = res;
				modelAccepted = true;
				break;
			}

			lastStatus = res.status;
			lastDetail = await res.text().catch(() => "");

			// 401 = auth problem; nothing here will fix it.
			if (res.status === 401) {
				return NextResponse.json(
					{ error: `Authentication failed (401): ${lastDetail.slice(0, 400)}` },
					{ status: 401 },
				);
			}

			// Effort/reasoning-specific rejection -> try the next, lower effort.
			const effortRejected =
				(res.status === 400 || res.status === 403) &&
				/effort|reasoning|summary/i.test(lastDetail);
			if (effortRejected) continue;

			// Model-specific rejection -> stop degrading effort, try next model.
			modelLevelReject =
				(res.status === 400 &&
					/not supported|does not exist|unknown model|invalid model|unsupported model|not available/i.test(
						lastDetail,
					)) ||
				(res.status === 403 &&
					/model|not supported|not available|access|entitle|plan/i.test(
						lastDetail,
					));
			break;
		}

		if (modelAccepted) break;
		if (!modelLevelReject) break; // different error — stop and report it
	}

	if (!upstream || !upstream.body) {
		return NextResponse.json(
			{
				error: `Upstream error (${lastStatus}): ${lastDetail.slice(0, 800) || "no model accepted"}`,
				triedModels: tried,
			},
			{ status: 502 },
		);
	}

	// Parse the upstream SSE stream and re-emit only the text deltas.
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const reader = upstream.body.getReader();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let buffer = "";
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });

					// SSE events are separated by blank lines.
					const events = buffer.split("\n\n");
					buffer = events.pop() ?? "";

					for (const evt of events) {
						for (const line of evt.split("\n")) {
							if (!line.startsWith("data:")) continue;
							const data = line.slice(5).trim();
							if (!data || data === "[DONE]") continue;
							try {
								const json = JSON.parse(data);
								// Text deltas come through as response.output_text.delta
								if (
									json.type === "response.output_text.delta" &&
									typeof json.delta === "string"
								) {
									controller.enqueue(encoder.encode(json.delta));
								}
							} catch {
								// ignore keep-alives / non-JSON lines
							}
						}
					}
				}
			} catch (err) {
				controller.enqueue(
					encoder.encode(
						`\n[stream error: ${
							err instanceof Error ? err.message : "unknown"
						}]`,
					),
				);
			} finally {
				controller.close();
			}
		},
		cancel() {
			reader.cancel().catch(() => {});
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
		},
	});
}
