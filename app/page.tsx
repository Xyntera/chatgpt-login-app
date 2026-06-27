"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth, type DeviceInfo } from "@/lib/auth-context";

const EFFORTS = [
	{ value: "minimal", label: "Minimal" },
	{ value: "low", label: "Low" },
	{ value: "medium", label: "Medium" },
	{ value: "high", label: "High" },
];

export default function HomePage() {
	const { session, loading, startDeviceLogin, cancelDeviceLogin, logout } = useAuth();

	// login state
	const [device, setDevice] = useState<DeviceInfo | null>(null);
	const [loggingIn, setLoggingIn] = useState(false);
	const [loginError, setLoginError] = useState<string | null>(null);

	// chat state
	const [input, setInput] = useState("Write a haiku about the ocean.");
	const [output, setOutput] = useState("");
	const [effort, setEffort] = useState("low");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const outRef = useRef<HTMLDivElement>(null);
	const taRef = useRef<HTMLTextAreaElement>(null);

	// auto-grow the prompt editor to its content
	useEffect(() => {
		const ta = taRef.current;
		if (!ta) return;
		ta.style.height = "auto";
		ta.style.height = `${ta.scrollHeight}px`;
	}, [input, session]);

	async function handleLogin() {
		setLoginError(null);
		setDevice(null);
		setLoggingIn(true);
		try {
			await startDeviceLogin((info) => setDevice(info));
		} catch (err) {
			setLoginError(err instanceof Error ? err.message : "Login failed");
		} finally {
			setLoggingIn(false);
			setDevice(null);
		}
	}

	function handleCancel() {
		cancelDeviceLogin();
		setLoggingIn(false);
		setDevice(null);
	}

	async function send() {
		const prompt = input.trim();
		if (!prompt || busy) return;
		setError(null);
		setOutput("");
		setBusy(true);

		try {
			const res = await fetch("/api/codex/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ prompt, effort }),
			});
			if (!res.ok || !res.body) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.error ?? `Request failed (${res.status})`);
			}
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				const chunk = decoder.decode(value, { stream: true });
				setOutput((prev) => prev + chunk);
				outRef.current?.scrollTo(0, outRef.current.scrollHeight);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Something went wrong");
		} finally {
			setBusy(false);
		}
	}

	if (loading) {
		return (
			<main className="screen-center">
				<Spinner />
			</main>
		);
	}

	if (!session) {
		return (
			<main className="auth-screen">
				<div className="auth-card">
					<Logo />
					<h1 className="auth-title">
						<span className="bracket">&lt;</span>LoginWithChatGPT<span className="bracket"> /&gt;</span>
					</h1>
					<p className="auth-sub">
						Run prompts on your own ChatGPT account. The model is chosen
						automatically for your plan — Free, Go, Plus, or Pro.
					</p>

					{!loggingIn && (
						<button onClick={handleLogin} className="btn-primary">
							<Mark /> Continue with ChatGPT
						</button>
					)}

					{loggingIn && (
						<div className="device-box">
							{!device ? (
								<div className="device-starting">
									<Spinner small /> Starting…
								</div>
							) : (
								<>
									<p className="device-label">Enter this code in the opened tab</p>
									<div className="device-code">{device.userCode}</div>
									<a
										href={device.verificationUri}
										target="_blank"
										rel="noreferrer"
										className="btn-primary btn-block"
									>
										Open ChatGPT
									</a>
									<p className="device-hint">
										First time? In ChatGPT enable <b>device code authorization</b>{" "}
										for Codex under Settings → Security &amp; Login.
									</p>
									<div className="device-waiting">
										<Spinner small /> Waiting for authorization…
									</div>
									<button onClick={handleCancel} className="btn-link">
										Cancel
									</button>
								</>
							)}
						</div>
					)}

					{loginError && <p className="auth-error">{loginError}</p>}
				</div>
			</main>
		);
	}

	return (
		<main className="app">
			<section className="hero">
				<h1 className="hero-title">
					<span className="bracket">&lt;</span>LoginWithChatGPT<span className="bracket"> /&gt;</span>
				</h1>
				<p className="hero-copy">
					Add a Login with ChatGPT button to your site. Let people sign in with
					their personal ChatGPT account and run prompts on it.
				</p>
				<p className="hero-copy">
					You never pay OpenAI for usage. Works on any plan: Free, Go, Plus, or
					Pro — the right model is selected automatically.
				</p>
				<a className="btn-ghost" href="https://x.com/glaqzz" target="_blank" rel="noreferrer">
					Follow on X
				</a>
			</section>

			<section className="console">
				<header className="console-head">
					<div className="account">
						<span className="avatar">{initial(session.accountId)}</span>
						<span className="account-id">{shortId(session.accountId)}</span>
					</div>
					<button onClick={() => logout()} className="btn-disconnect">
						<LogoutIcon /> Disconnect
					</button>
				</header>

				<div className="editor">
					<pre className="editor-gutter" aria-hidden="true">
						<code>
							<span className="tk-key">const</span> codex ={" "}
							<span className="tk-key">new</span> <span className="tk-fn">Codex</span>();{"\n\n"}
							<span className="tk-key">const</span> res ={" "}
							<span className="tk-key">await</span> codex.responses.<span className="tk-fn">create</span>({"({"}
							{"\n  "}model: <span className="tk-str">"auto"</span>,
							{"\n  "}input:{" "}
						</code>
					</pre>
					<textarea
						ref={taRef}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
								e.preventDefault();
								send();
							}
						}}
						placeholder="Write a prompt…"
						spellCheck={false}
						rows={1}
						className="editor-input"
					/>
					<pre className="editor-foot" aria-hidden="true">
						<code>{"\n});"}</code>
					</pre>
				</div>

				<div className="controls">
					<div className="effort">
						<span className="effort-label">Effort</span>
						<div className="segmented">
							{EFFORTS.map((e) => (
								<button
									key={e.value}
									className={`seg ${effort === e.value ? "seg-on" : ""}`}
									onClick={() => setEffort(e.value)}
									disabled={busy}
								>
									{e.label}
								</button>
							))}
						</div>
					</div>
					<button onClick={send} disabled={busy} className="btn-send">
						{busy ? (
							<><Spinner small /> Streaming…</>
						) : (
							<>Run <kbd>⌘</kbd><kbd>↵</kbd></>
						)}
					</button>
				</div>

				<div className="output-wrap">
					<div className="output-head">
						<span>Output</span>
						{busy && <Spinner small />}
					</div>
					<div ref={outRef} className="output">
						{error ? (
							<span className="output-error">{error}</span>
						) : output ? (
							<>
								{output}
								{busy && <span className="caret" />}
							</>
						) : busy ? (
							<span className="output-empty">Thinking…</span>
						) : (
							<span className="output-empty">Run a prompt to see the response stream in here.</span>
						)}
					</div>
				</div>
			</section>
		</main>
	);
}

/* ---------- helpers ---------- */

function shortId(id: string) {
	if (id.length <= 16) return id;
	return `${id.slice(0, 8)}…${id.slice(-4)}`;
}
function initial(id: string) {
	return id.replace(/[^a-z0-9]/gi, "").charAt(0).toUpperCase() || "•";
}

function Spinner({ small }: { small?: boolean }) {
	const s = small ? 14 : 22;
	return (
		<span
			className="spinner"
			style={{ width: s, height: s, borderWidth: small ? 1.5 : 2 }}
		/>
	);
}

function Mark() {
	return (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6 6 0 0 0 4.98 4.18a5.98 5.98 0 0 0-3.99 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 24a6.05 6.05 0 0 0 5.77-4.2 5.98 5.98 0 0 0 3.99-2.9 6.05 6.05 0 0 0-.74-7.08Zm-9.02 12.6a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.78.78 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.49 4.5ZM3.6 18.3a4.47 4.47 0 0 1-.54-3.01l.14.08 4.78 2.76a.78.78 0 0 0 .78 0l5.84-3.37v2.33a.07.07 0 0 1-.03.06l-4.83 2.79a4.5 4.5 0 0 1-6.14-1.64ZM2.34 7.9a4.48 4.48 0 0 1 2.35-1.97v5.68a.78.78 0 0 0 .39.68l5.83 3.36-2.02 1.17a.07.07 0 0 1-.07 0l-4.83-2.8A4.5 4.5 0 0 1 2.34 7.9Zm16.6 3.86-5.84-3.4 2.02-1.16a.07.07 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.67a.78.78 0 0 0-.4-.66Zm2.01-3.02-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.42 9.24V6.9a.07.07 0 0 1 .03-.06l4.83-2.78a4.5 4.5 0 0 1 6.68 4.66ZM8.32 12.86 6.3 11.7a.07.07 0 0 1-.04-.06V6.07a4.5 4.5 0 0 1 7.37-3.45l-.14.08L8.7 5.46a.78.78 0 0 0-.39.68l-.01 6.72Zm1.1-2.36L12 8.99l2.6 1.5v3l-2.6 1.5-2.6-1.5v-3Z" />
		</svg>
	);
}

function Logo() {
	return (
		<div className="auth-logo">
			<Mark />
		</div>
	);
}

function LogoutIcon() {
	return (
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
			<polyline points="16 17 21 12 16 7" />
			<line x1="21" y1="12" x2="9" y2="12" />
		</svg>
	);
}
