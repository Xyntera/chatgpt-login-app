/**
 * OpenAI Codex (ChatGPT OAuth) — Next.js browser flow.
 *
 * Split: constants + PKCE are browser-safe; token exchange/refresh are
 * server-only (called from route handlers). The refresh token never leaves
 * the server — it lives in an httpOnly cookie.
 */

export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE_URL = "https://auth.openai.com";
export const AUTHORIZE_URL = `${AUTH_BASE_URL}/oauth/authorize`;
const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;
export const SCOPE = "openid profile email offline_access";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

// The Codex backend the CLI talks to. The ChatGPT-login token is accepted here.
// NOTE: this is NOT a public, documented API. See README for the caveats.
export const CHATGPT_BACKEND_URL = "https://chatgpt.com/backend-api/codex/responses";
export const CHATGPT_MODELS_URL = "https://chatgpt.com/backend-api/codex/models";
export const ORIGINATOR = "codex_cli_rs";
// The real Codex CLI sends these so the backend accepts the request. Without a
// CLI-looking User-Agent, chatgpt.com/backend-api returns a 403 HTML block page
// (especially from datacenter IPs). Bump the version to match a recent CLI.
export const CODEX_CLI_VERSION = "0.111.0";
export const CODEX_USER_AGENT = `codex_cli_rs/${CODEX_CLI_VERSION} (Linux; x86_64) reqwest`;

export const REFRESH_COOKIE = "codex_refresh";
export const PKCE_COOKIE = "codex_pkce";
export const STATE_COOKIE = "codex_state";

export type OAuthToken = { access: string; refresh: string; expires: number };
export type OAuthCredentials = OAuthToken & { accountId: string };

// ---------- PKCE (browser-safe, uses Web Crypto) ----------

function base64UrlEncode(bytes: Uint8Array): string {
	let str = "";
	for (const b of bytes) str += String.fromCharCode(b);
	return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
	const verifierBytes = new Uint8Array(32);
	crypto.getRandomValues(verifierBytes);
	const verifier = base64UrlEncode(verifierBytes);
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	const challenge = base64UrlEncode(new Uint8Array(digest));
	return { verifier, challenge };
}

export function createState(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return base64UrlEncode(bytes);
}

export function buildAuthorizeUrl(params: {
	redirectUri: string;
	challenge: string;
	state: string;
	originator?: string;
}): string {
	const url = new URL(AUTHORIZE_URL);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", CLIENT_ID);
	url.searchParams.set("redirect_uri", params.redirectUri);
	url.searchParams.set("scope", SCOPE);
	url.searchParams.set("code_challenge", params.challenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", params.state);
	url.searchParams.set("id_token_add_organizations", "true");
	url.searchParams.set("codex_cli_simplified_flow", "true");
	url.searchParams.set("originator", params.originator ?? ORIGINATOR);
	return url.toString();
}

// ---------- server-only token operations ----------

type JwtPayload = {
	[JWT_CLAIM_PATH]?: { chatgpt_account_id?: string };
	[key: string]: unknown;
};

function decodeJwt(token: string): JwtPayload | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		const payload = parts[1] ?? "";
		const decoded = Buffer.from(payload, "base64").toString("utf-8");
		return JSON.parse(decoded) as JwtPayload;
	} catch {
		return null;
	}
}

function getAccountId(accessToken: string): string | null {
	const auth = decodeJwt(accessToken)?.[JWT_CLAIM_PATH];
	const id = auth?.chatgpt_account_id;
	return typeof id === "string" && id.length > 0 ? id : null;
}

async function readTokenResponse(res: Response, op: "exchange" | "refresh"): Promise<OAuthToken> {
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`OpenAI Codex token ${op} failed (${res.status}): ${text || res.statusText}`);
	}
	const json = (await res.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
	} | null;
	if (!json?.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
		throw new Error(`OpenAI Codex token ${op} response missing fields`);
	}
	return {
		access: json.access_token,
		refresh: json.refresh_token,
		expires: Date.now() + json.expires_in * 1000,
	};
}

function credentialsFromToken(token: OAuthToken): OAuthCredentials {
	const accountId = getAccountId(token.access);
	if (!accountId) throw new Error("Failed to extract accountId from token");
	return { ...token, accountId };
}

export async function exchangeAuthorizationCode(
	code: string,
	verifier: string,
	redirectUri: string,
): Promise<OAuthCredentials> {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			code_verifier: verifier,
			redirect_uri: redirectUri,
		}),
	});
	return credentialsFromToken(await readTokenResponse(res, "exchange"));
}

export async function refreshAccessToken(refreshToken: string): Promise<OAuthCredentials> {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: CLIENT_ID,
		}),
	});
	return credentialsFromToken(await readTokenResponse(res, "refresh"));
}

export function getOrigin(): string {
	// Explicit override wins.
	const explicit = process.env.NEXT_PUBLIC_APP_ORIGIN?.replace(/\/$/, "");
	if (explicit) return explicit;
	// Vercel injects this automatically on every deployment.
	const vercel = process.env.VERCEL_URL;
	if (vercel) return `https://${vercel}`;
	throw new Error("Set NEXT_PUBLIC_APP_ORIGIN (or deploy on Vercel).");
}

export function getRedirectUri(): string {
	return `${getOrigin()}/auth/callback`;
}

// ---------- server-only: get a usable session from the refresh cookie ----------

import { cookies } from "next/headers";

/**
 * Reads the refresh cookie, exchanges it for a fresh access token, rotates the
 * stored refresh token, and returns the access token + accountId. Returns null
 * if there is no valid session. Call this from any route that needs to act on
 * behalf of the logged-in user (e.g. the chat route).
 */
export async function getSessionFromCookie(): Promise<OAuthCredentials | null> {
	const jar = await cookies();
	const refresh = jar.get(REFRESH_COOKIE)?.value;
	if (!refresh) return null;

	let creds: OAuthCredentials;
	try {
		creds = await refreshAccessToken(refresh);
	} catch {
		jar.delete(REFRESH_COOKIE);
		return null;
	}

	// rotate the stored refresh token
	jar.set(REFRESH_COOKIE, creds.refresh, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		maxAge: 60 * 60 * 24 * 30,
	});

	return creds;
}

// ---------- device-code flow (works on a hosted server — no redirect URI) ----------

const DEVICE_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`;
export const DEVICE_VERIFICATION_URI = `${AUTH_BASE_URL}/codex/device`;
const DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`;

export type DeviceAuthStart = {
	deviceAuthId: string;
	userCode: string;
	intervalSeconds: number;
};

/** Step 1: ask OpenAI for a user code to show the user. */
export async function startDeviceAuth(): Promise<DeviceAuthStart> {
	const res = await fetch(DEVICE_USER_CODE_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ client_id: CLIENT_ID }),
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(
			`Device code request failed (${res.status})${body ? `: ${body}` : ""}`,
		);
	}
	const json = (await res.json()) as {
		device_auth_id?: string;
		user_code?: string;
		interval?: number | string;
	} | null;
	const interval =
		typeof json?.interval === "string" ? Number(json.interval) : json?.interval;
	if (!json?.device_auth_id || !json.user_code || typeof interval !== "number") {
		throw new Error(`Invalid device code response: ${JSON.stringify(json)}`);
	}
	return {
		deviceAuthId: json.device_auth_id,
		userCode: json.user_code,
		intervalSeconds: interval,
	};
}

export type DevicePollResult =
	| { status: "pending" }
	| { status: "slow_down" }
	| { status: "complete"; credentials: OAuthCredentials }
	| { status: "failed"; message: string };

/** Step 2: poll once. The client calls this on an interval until complete/failed. */
export async function pollDeviceAuth(
	deviceAuthId: string,
	userCode: string,
): Promise<DevicePollResult> {
	const res = await fetch(DEVICE_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
	});

	if (res.ok) {
		const json = (await res.json()) as {
			authorization_code?: string;
			code_verifier?: string;
		} | null;
		if (!json?.authorization_code || !json.code_verifier) {
			return { status: "failed", message: "Invalid device token response" };
		}
		// Exchange the authorization code for real tokens.
		const token = await exchangeDeviceCode(
			json.authorization_code,
			json.code_verifier,
		);
		return { status: "complete", credentials: credentialsFromToken(token) };
	}

	if (res.status === 403 || res.status === 404) return { status: "pending" };

	const body = await res.text().catch(() => "");
	let errorCode: unknown;
	try {
		const j = JSON.parse(body) as { error?: string | { code?: string } } | null;
		const e = j?.error;
		errorCode = typeof e === "object" ? e?.code : e;
	} catch {
		// non-JSON
	}
	if (errorCode === "deviceauth_authorization_pending") return { status: "pending" };
	if (errorCode === "slow_down") return { status: "slow_down" };
	return {
		status: "failed",
		message: `Device auth failed (${res.status})${body ? `: ${body}` : ""}`,
	};
}

async function exchangeDeviceCode(
	code: string,
	verifier: string,
): Promise<OAuthToken> {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			code_verifier: verifier,
			redirect_uri: DEVICE_REDIRECT_URI,
		}),
	});
	return readTokenResponse(res, "exchange");
}
