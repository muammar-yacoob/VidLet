"use client";

// Spark AI Kit -- drop-in AI wand for any input/textarea.
// Requires: /api/ai route (GET -> { available }, POST { message } -> { reply })

import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import {
	type InputHTMLAttributes,
	type ReactNode,
	type TextareaHTMLAttributes,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import "./spark-ai.css";

// ── Config & Constants ───────────────────────────────────────────────────────

const SPARK_BASE = "https://sparkbrain.app";
export let _baseUrl = SPARK_BASE;
let _apiKey: string | null = null;

/** Mutable cache state shared across modules */
export const _cache = {
	cached: null as boolean | null,
	inflight: null as Promise<boolean> | null,
	ver: 0,
};

export const configure = (opts: { baseUrl?: string; apiKey?: string }) => {
	if (opts.baseUrl !== undefined) _baseUrl = opts.baseUrl;
	if (opts.apiKey && opts.apiKey !== _apiKey) _apiKey = opts.apiKey;
	const available = !!_apiKey || opts.baseUrl === "";
	if (available && _cache.cached !== true) {
		_cache.cached = true;
		_cache.inflight = null;
		_cache.ver++;
	}
};

export const _headers = () => ({
	"Content-Type": "application/json",
	...(_apiKey && { "X-Api-Key": _apiKey }),
});

// ── Types ────────────────────────────────────────────────────────────────────

export type AiPrompt = string | ((value: string) => string);
export interface AiAction {
	label: string;
	prompt: AiPrompt;
	icon?: React.ComponentType<{ size?: number; className?: string }>;
}

// ── useAi ────────────────────────────────────────────────────────────────────

export interface AiError {
	error: string;
	status?: number;
}

const resolve = (p: AiPrompt, v: string) =>
	typeof p === "function" ? p(v) : p;

export function useAi() {
	const [available, setAvailable] = useState<boolean | null>(
		() => _cache.cached,
	);
	const [loading, setLoading] = useState(false);
	const inflight = useRef(0);
	const ctrls = useRef(new Set<AbortController>());

	useEffect(() => {
		// Sync from cache (fixes #5 - no setState during render)
		if (_cache.cached !== null) return void setAvailable(_cache.cached);
		const v = _cache.ver;
		_cache.inflight ??= fetch(`${_baseUrl}/api/ai/ask`, { headers: _headers() })
			.then((r) => r.json())
			.then((d) => {
				if (v === _cache.ver) _cache.cached = !!d.available;
				return _cache.cached ?? false;
			})
			.catch(() => {
				if (v === _cache.ver) _cache.cached = false;
				return false;
			});
		_cache.inflight.then(setAvailable);
	}, []);

	const ask = useCallback(
		async (msg: string, kit = false): Promise<{ reply: string } | AiError> => {
			const ac = new AbortController();
			ctrls.current.add(ac);
			inflight.current++;
			setLoading(true);
			try {
				const r = await fetch(`${_baseUrl}/api/ai/ask`, {
					method: "POST",
					headers: _headers(),
					body: JSON.stringify({ message: msg, ...(kit && { kit: true }) }),
					signal: ac.signal,
				});
				const d = await r.json();
				if (r.ok) return { reply: d.reply ?? "" };
				return { error: d.error ?? "Request failed", status: r.status };
			} catch (e: unknown) {
				if (e instanceof DOMException && e.name === "AbortError")
					return { error: "aborted", status: 0 };
				return { error: "Network error" };
			} finally {
				ctrls.current.delete(ac);
				if (--inflight.current === 0) setLoading(false);
			}
		},
		[],
	);

	/** Call a structured backend action (rephrase, infer-limits, revise-features, structured-output). */
	const action = useCallback(
		async <T = unknown>(
			name: string,
			params: Record<string, unknown>,
		): Promise<{ type: "text" | "json"; result: T } | AiError> => {
			const ac = new AbortController();
			ctrls.current.add(ac);
			inflight.current++;
			setLoading(true);
			try {
				const r = await fetch(`${_baseUrl}/api/ai/action`, {
					method: "POST",
					headers: _headers(),
					body: JSON.stringify({ action: name, ...params }),
					signal: ac.signal,
				});
				if (!r.ok) {
					const d = await r.json().catch(() => null);
					return { error: d?.error ?? "Request failed", status: r.status };
				}
				return await r.json();
			} catch (e: unknown) {
				if (e instanceof DOMException && e.name === "AbortError")
					return { error: "aborted", status: 0 };
				return { error: "Network error" };
			} finally {
				ctrls.current.delete(ac);
				if (--inflight.current === 0) setLoading(false);
			}
		},
		[],
	);

	const cancel = useCallback(() => {
		for (const ac of ctrls.current) ac.abort();
		ctrls.current.clear();
		inflight.current = 0;
		setLoading(false);
	}, []);

	return { available, loading, ask, action, cancel };
}

// ── Internal: Shared UI primitives ──────────────────────────────────────────

type TipState = "hidden" | "in" | "out";

export function useTip() {
	const [s, setS] = useState<TipState>("hidden");
	const t = useRef<ReturnType<typeof setTimeout>>(undefined);
	return {
		s,
		show: () => {
			clearTimeout(t.current);
			setS("in");
		},
		hide: () => {
			setS("out");
			t.current = setTimeout(() => setS("hidden"), 300);
		},
		cleanup: () => clearTimeout(t.current),
	};
}

export const Tip = ({
	state,
	children,
}: {
	state: TipState;
	children: ReactNode;
}) =>
	state === "hidden" ? null : (
		<div
			data-ai-tip={state}
			style={{
				position: "absolute",
				bottom: "100%",
				left: "50%",
				transform: "translateX(-50%)",
				marginBottom: "6px",
				zIndex: 9999,
				pointerEvents: "none",
				whiteSpace: "nowrap",
				background: "rgba(0, 0, 0, 0.6)",
				borderRadius: "3px",
				padding: "2px 5px",
			}}
		>
			{children}
		</div>
	);

/** Reusable sparkle button -- the purple/amber icon used by all wands */
export const WandBtn = ({
	onClick,
	disabled,
	loading,
	color = "purple",
	title,
	onMouseEnter,
	onMouseLeave,
	children,
}: {
	onClick: () => void;
	disabled?: boolean;
	loading?: boolean;
	color?: "purple" | "amber";
	title?: string;
	onMouseEnter?: () => void;
	onMouseLeave?: () => void;
	children?: ReactNode;
}) => (
	<button
		type="button"
		onClick={onClick}
		onMouseEnter={onMouseEnter}
		onMouseLeave={onMouseLeave}
		disabled={disabled}
		data-ai-wand=""
		title={title}
		className="group flex items-center justify-center gap-px rounded transition-colors disabled:pointer-events-none"
	>
		{loading ? (
			<Loader2
				suppressHydrationWarning
				className="h-3.5 w-3.5 animate-spin text-purple-400"
			/>
		) : (
			<Sparkles
				suppressHydrationWarning
				size={14}
				className={`h-3.5 w-3.5 ${color === "amber" ? "text-amber-400/60 group-hover:text-amber-300" : "text-purple-400/60 group-hover:text-purple-300"} transition-colors`}
			/>
		)}
		{children}
	</button>
);

/** Small dismiss button */
export const DismissBtn = ({ onClick }: { onClick: () => void }) => (
	<button
		type="button"
		onClick={onClick}
		className="text-[10px] text-gray-600 hover:text-gray-400 leading-none"
		style={{
			background: "none",
			border: "none",
			padding: 0,
			cursor: "pointer",
		}}
	>
		{"\u2715"}
	</button>
);

// ── Internal: Actions Menu ───────────────────────────────────────────────────

function ActionsMenu({
	actions,
	value,
	onAction,
	onClose,
}: {
	actions: AiAction[];
	value: string;
	onAction: (p: string) => void;
	onClose: () => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const h = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) onClose();
		};
		document.addEventListener("mousedown", h);
		return () => document.removeEventListener("mousedown", h);
	}, [onClose]);

	return (
		<div
			ref={ref}
			className="absolute bottom-full mb-1.5 right-0 z-[9999] bg-gray-900 border border-white/10 rounded-lg shadow-xl py-1 min-w-[148px]"
		>
			{actions.map(({ label, prompt, icon }) => {
				const I = icon ?? Sparkles;
				return (
					<button
						key={label}
						type="button"
						onClick={() => {
							onAction(resolve(prompt, value));
							onClose();
						}}
						className="w-full text-left px-3 py-1.5 text-[12px] text-gray-300 hover:bg-white/5 hover:text-white flex items-center gap-2 transition-colors"
					>
						<I size={11} className="text-purple-400 shrink-0" />
						{label}
					</button>
				);
			})}
		</div>
	);
}

// ── AiWand ───────────────────────────────────────────────────────────────────

export interface AiWandProps {
	tooltip: string;
	prompt: AiPrompt;
	value?: string;
	onResult?: (text: string) => void;
	actions?: AiAction[];
	className?: string;
	cacheSize?: number;
}

export function AiWand({
	tooltip,
	prompt,
	value = "",
	onResult,
	actions,
	className = "",
	cacheSize = 0,
}: AiWandProps) {
	const { available, loading, ask } = useAi();
	const tip = useTip();
	const [error, setError] = useState<string | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const cache = useRef<string[]>([]);
	const cacheIdx = useRef(0);
	const hasActions = !!actions?.length;
	useEffect(() => tip.cleanup, [tip]);

	if (available === null) return null;

	const fire = async (p: string) => {
		setError(null);
		const r = await ask(p, true);
		if ("error" in r) {
			if (r.error !== "aborted") setError(r.error || "AI request failed");
		} else if (r.reply) {
			if (cacheSize > 0) cache.current.push(r.reply);
			onResult?.(r.reply);
		}
	};

	const click = () => {
		if (!available)
			return void window.open("https://sparkbrain.app/", "_blank", "noopener");
		if (loading) return;
		if (hasActions) return void setMenuOpen((o) => !o);
		if (cacheSize > 0 && cache.current.length >= cacheSize) {
			const idx = cacheIdx.current % cache.current.length;
			cacheIdx.current = idx + 1;
			onResult?.(cache.current[idx]);
			return;
		}
		fire(resolve(prompt, value));
	};

	const tipBody = error ? (
		<span className="text-[10px] text-red-400">{error}</span>
	) : !available ? (
		<>
			<span className="ai-spark-link text-[11px]">{"\u2726"} Spark AI</span>
			<p className="text-[10px] text-gray-500 mt-0.5">
				Add <code className="text-gray-400">SPARK_AI_API_KEY</code> to unlock
			</p>
		</>
	) : (
		<span className="text-[10px] text-gray-300">{tooltip}</span>
	);

	return (
		<div className={`relative inline-flex items-center ${className}`}>
			{(error || tip.s !== "hidden") && !menuOpen && (
				<Tip state={error ? "in" : tip.s}>{tipBody}</Tip>
			)}
			{menuOpen && hasActions && (
				<ActionsMenu
					actions={actions!}
					value={value}
					onAction={fire}
					onClose={() => setMenuOpen(false)}
				/>
			)}
			<button
				type="button"
				onClick={click}
				onMouseEnter={tip.show}
				onMouseLeave={tip.hide}
				disabled={loading}
				className="group flex items-center justify-center gap-px rounded transition-colors disabled:pointer-events-none"
				data-ai-wand=""
			>
				{loading ? (
					<Loader2
						suppressHydrationWarning
						className="h-3.5 w-3.5 animate-spin text-purple-400"
					/>
				) : (
					<>
						<Sparkles
							suppressHydrationWarning
							size={14}
							className={`h-3.5 w-3.5 text-purple-400/60 ${available ? "group-hover:text-purple-300" : ""} transition-colors`}
						/>
						{hasActions && (
							<ChevronDown
								size={8}
								className="text-purple-400/40 group-hover:text-purple-300/60 transition-colors"
							/>
						)}
					</>
				)}
			</button>
		</div>
	);
}

// ── AiInput / AiTextarea ─────────────────────────────────────────────────────

interface AiFieldBase {
	value: string;
	onChange: (v: string) => void;
	prompt: AiPrompt;
	actions?: AiAction[];
	wandTooltip?: string;
}

const FieldWrap = ({
	children,
	wand,
	top,
}: {
	children: ReactNode;
	wand: ReactNode;
	top?: boolean;
}) => (
	<div className="ai-field-wrap">
		{children}
		<span className={`ai-field-wand${top ? " ai-field-wand--top" : ""}`}>
			{wand}
		</span>
	</div>
);

const makeWand = (p: AiFieldBase) => (
	<AiWand
		tooltip={p.wandTooltip ?? "AI: improve"}
		prompt={p.prompt}
		value={p.value}
		onResult={p.onChange}
		actions={p.actions}
	/>
);

export type AiInputProps = AiFieldBase &
	Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">;

export const AiInput = ({
	value,
	onChange,
	prompt,
	actions,
	wandTooltip,
	className = "",
	...rest
}: AiInputProps) => (
	<FieldWrap wand={makeWand({ value, onChange, prompt, actions, wandTooltip })}>
		<input
			{...rest}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			className={`ai-field-input ${className}`}
		/>
	</FieldWrap>
);

export type AiTextareaProps = AiFieldBase &
	Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value">;

export const AiTextarea = ({
	value,
	onChange,
	prompt,
	actions,
	wandTooltip,
	className = "",
	...rest
}: AiTextareaProps) => (
	<FieldWrap
		top
		wand={makeWand({ value, onChange, prompt, actions, wandTooltip })}
	>
		<textarea
			{...rest}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			className={`ai-field-input ai-field-textarea ${className}`}
		/>
	</FieldWrap>
);
