"use client";

import { useEffect, useState } from "react";

type Status = "working" | "done" | "error";

export default function CodexCallbackPage() {
	const [status, setStatus] = useState<Status>("working");
	const [message, setMessage] = useState("Completing OpenAI authentication…");
	const [accountId, setAccountId] = useState<string | null>(null);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const code = params.get("code");
		const state = params.get("state");
		const oauthError = params.get("error");

		if (oauthError) {
			setStatus("error");
			setMessage(`Authorization failed: ${oauthError}`);
			return;
		}
		if (!code || !state) {
			setStatus("error");
			setMessage("Missing authorization code or state in callback URL.");
			return;
		}

		(async () => {
			try {
				const res = await fetch("/api/codex/exchange", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ code, state }),
				});
				const data = await res.json();
				if (!res.ok) throw new Error(data.error ?? `Exchange failed (${res.status})`);

				setAccountId(data.accountId);
				setStatus("done");
				setMessage("OpenAI authentication completed. You can close this window.");

				// Strip the code/state from the URL bar.
				window.history.replaceState({}, "", "/auth/callback");
			} catch (err) {
				setStatus("error");
				setMessage(err instanceof Error ? err.message : "Unexpected error during exchange.");
			}
		})();
	}, []);

	return (
		<main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 480, margin: "10vh auto", padding: 24 }}>
			<h1 style={{ fontSize: 20, marginBottom: 12 }}>
				{status === "working" ? "Signing in…" : status === "done" ? "Signed in" : "Sign-in error"}
			</h1>
			<p style={{ color: status === "error" ? "#b00020" : "#333" }}>{message}</p>
			{accountId && <p style={{ color: "#666", fontSize: 13 }}>Account: {accountId}</p>}
		</main>
	);
}
