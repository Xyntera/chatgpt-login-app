/**
 * Account-aware model resolution, ported from EvanZhouDev/openai-oauth.
 *
 * The ChatGPT Codex backend only accepts the model slugs the *account* is
 * entitled to. Rather than guessing (gpt-5 vs gpt-5-codex vs ...), we ask the
 * account via /models?client_version=<v> and use exactly what it returns.
 *
 * `configuredModels` (the equivalent of the CLI's `--models`) overrides the
 * account discovery; otherwise account-aware is the default.
 */

import {
	CHATGPT_MODELS_URL,
	CODEX_CLI_VERSION,
	CODEX_USER_AGENT,
	ORIGINATOR,
} from "@/lib/codex-oauth";

const MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

type ModelCatalogEntry = { slug?: unknown };
type ModelCatalogResponse = {
	models?: ModelCatalogEntry[];
	error?: { message?: unknown };
	detail?: unknown;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const uniqueStrings = (values: string[]): string[] => {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const v of values) {
		if (!seen.has(v)) {
			seen.add(v);
			out.push(v);
		}
	}
	return out;
};

const toUpstreamErrorMessage = (bodyText: string): string => {
	if (!bodyText) return "Failed to load models from Codex.";
	try {
		const parsed = JSON.parse(bodyText) as ModelCatalogResponse;
		if (typeof parsed.detail === "string" && parsed.detail.length > 0) {
			return parsed.detail;
		}
		if (isRecord(parsed.error) && typeof parsed.error.message === "string") {
			return parsed.error.message;
		}
	} catch {
		// fall through
	}
	return bodyText;
};

type Session = { access: string; accountId: string };

// Known-good default candidates. Used only when model discovery is blocked
// (e.g. Cloudflare challenge from a datacenter IP). The chat route tries these
// in order and tolerates per-model rejection, so a wrong one is skipped.
const FALLBACK_MODELS = ["gpt-5-codex", "gpt-5", "codex-mini-latest"];

const isCloudflareChallenge = (status: number, body: string): boolean =>
	status === 403 ||
	status === 503 ||
	/_cf_chl_opt|cf-chl|challenge-platform|Enable JavaScript and cookies|Just a moment/i.test(
		body,
	);

// Per-account in-memory cache (keyed by accountId).
const cache = new Map<string, { models: string[]; expiresAt: number }>();

/**
 * Fetch the slugs this account is allowed to use. Mirrors
 * fetchAvailableModels() in the reference implementation, including the
 * required `client_version` query param.
 *
 * Returns null (rather than throwing) when discovery is blocked by a
 * Cloudflare challenge, so the caller can fall back instead of failing.
 */
async function fetchAvailableModels(session: Session): Promise<string[] | null> {
	const url = `${CHATGPT_MODELS_URL}?client_version=${encodeURIComponent(
		CODEX_CLI_VERSION,
	)}`;

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

	const bodyText = await res.text();

	// Cloudflare blocked discovery — signal the caller to use fallbacks.
	if (!res.ok && isCloudflareChallenge(res.status, bodyText)) {
		return null;
	}

	if (!res.ok) {
		// A real API error (bad token, etc). If it smells like HTML, surface a
		// clearer message than a wall of markup.
		if (/^\s*</.test(bodyText)) {
			return null;
		}
		throw new Error(toUpstreamErrorMessage(bodyText));
	}

	let parsed: ModelCatalogResponse;
	try {
		parsed = JSON.parse(bodyText) as ModelCatalogResponse;
	} catch {
		// Non-JSON 200 (almost always an interstitial) — fall back.
		return null;
	}

	if (!Array.isArray(parsed.models)) {
		return null;
	}

	const models = uniqueStrings(
		parsed.models
			.map((m) => m.slug)
			.filter((s): s is string => typeof s === "string" && s.length > 0),
	);

	if (models.length === 0) {
		return null;
	}

	return models;
}

/**
 * Resolve the ordered list of models to try for this request.
 * - If configuredModels is provided (the `--models` override), use it verbatim.
 * - Otherwise discover the account's allowed models and use them as-is.
 *   No codex/gpt-5 filtering — the account's list is authoritative.
 * - If discovery is blocked (Cloudflare), fall back to known-good defaults so
 *   chat still works; the chat route skips any that the account rejects.
 */
export async function resolveModels(
	session: Session,
	configuredModels?: string[],
): Promise<string[]> {
	if (Array.isArray(configuredModels) && configuredModels.length > 0) {
		return uniqueStrings(configuredModels);
	}

	const now = Date.now();
	const cached = cache.get(session.accountId);
	if (cached && now < cached.expiresAt) {
		return [...cached.models];
	}

	const discovered = await fetchAvailableModels(session);
	const models = discovered ?? FALLBACK_MODELS;

	cache.set(session.accountId, {
		models,
		// Cache a successful discovery for the full TTL; cache a fallback only
		// briefly so we retry discovery soon (the challenge may clear).
		expiresAt: Date.now() + (discovered ? MODELS_CACHE_TTL_MS : 30_000),
	});
	return [...models];
}
