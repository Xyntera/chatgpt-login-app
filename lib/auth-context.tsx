"use client";

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";

type Session = { access: string; expires: number; accountId: string };

export type DeviceInfo = {
	userCode: string;
	verificationUri: string;
};

type AuthContextValue = {
	session: Session | null;
	loading: boolean;
	startDeviceLogin: (onCode: (info: DeviceInfo) => void) => Promise<void>;
	cancelDeviceLogin: () => void;
	logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const REFRESH_SKEW = 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
	const [session, setSession] = useState<Session | null>(null);
	const [loading, setLoading] = useState(true);
	const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const cancelled = useRef(false);

	const refresh = useCallback(async (): Promise<Session | null> => {
		try {
			const res = await fetch("/api/codex/refresh", { method: "POST" });
			if (!res.ok) {
				setSession(null);
				return null;
			}
			const data = (await res.json()) as Session;
			setSession(data);
			return data;
		} catch {
			setSession(null);
			return null;
		}
	}, []);

	useEffect(() => {
		if (refreshTimer.current) clearTimeout(refreshTimer.current);
		if (!session) return;
		const delay = Math.max(0, session.expires - Date.now() - REFRESH_SKEW);
		refreshTimer.current = setTimeout(() => void refresh(), delay);
		return () => {
			if (refreshTimer.current) clearTimeout(refreshTimer.current);
		};
	}, [session, refresh]);

	useEffect(() => {
		(async () => {
			await refresh();
			setLoading(false);
		})();
	}, [refresh]);

	const cancelDeviceLogin = useCallback(() => {
		cancelled.current = true;
	}, []);

	const startDeviceLogin = useCallback(
		async (onCode: (info: DeviceInfo) => void): Promise<void> => {
			cancelled.current = false;

			const startRes = await fetch("/api/codex/device/start", { method: "POST" });
			const start = await startRes.json();
			if (!startRes.ok) {
				throw new Error(start.error ?? "Could not start login");
			}

			onCode({ userCode: start.userCode, verificationUri: start.verificationUri });

			let intervalMs = Math.max(2, start.intervalSeconds ?? 5) * 1000;
			const deadline = Date.now() + 15 * 60 * 1000;

			for (;;) {
				if (cancelled.current) throw new Error("Login cancelled");
				if (Date.now() > deadline) throw new Error("Login timed out");

				await new Promise((r) => setTimeout(r, intervalMs));
				if (cancelled.current) throw new Error("Login cancelled");

				const pollRes = await fetch("/api/codex/device/poll", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						deviceAuthId: start.deviceAuthId,
						userCode: start.userCode,
					}),
				});
				const poll = await pollRes.json();

				if (poll.status === "complete") {
					setSession({
						access: poll.access,
						expires: poll.expires,
						accountId: poll.accountId,
					});
					return;
				}
				if (poll.status === "failed") {
					throw new Error(poll.error ?? "Login failed");
				}
				if (poll.status === "slow_down") {
					intervalMs += 2000;
				}
			}
		},
		[],
	);

	const logout = useCallback(async () => {
		try {
			await fetch("/api/codex/logout", { method: "POST" });
		} catch {
			// ignore
		}
		setSession(null);
	}, []);

	return (
		<AuthContext.Provider
			value={{ session, loading, startDeviceLogin, cancelDeviceLogin, logout }}
		>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth(): AuthContextValue {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
	return ctx;
}
