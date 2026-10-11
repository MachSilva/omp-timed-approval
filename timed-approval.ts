/**
 * omp-timed-approval — hotkey-cycled approval states for oh-my-pi.
 *
 * alt+y cycles: user mode → timed approval → yolo → user mode.
 *
 * - user mode: your `tools.approvalMode` as configured; prompts wait for you.
 * - timed approval: the session runs under yolo (native gate silenced), but this
 *   extension gates write/exec-tier tool calls itself with a countdown prompt:
 *   auto-picks "Approve" on expiry (any keypress resets it); "Deny" blocks the
 *   call. Read-tier tools run instantly.
 * - yolo: plain yolo override, no prompts at all.
 *
 * The previous approval mode (and any pre-existing `--approval-mode` override)
 * is restored exactly when cycling out of yolo/timed. Per-tool policies
 * (`tools.approval.<tool>: deny`) still deny even in yolo/timed — a tool with a
 * `prompt` policy gets this extension's countdown prompt instead of two prompts.
 * The `ask` tool prompts inside its own execute with no timeout and is never
 * gated here — questions always wait for you.
 *
 * Env:
 *   OMP_TIMED_APPROVAL_SECONDS  countdown seconds (default 5, min 1)
 *   OMP_TIMED_APPROVAL_KEY      shortcut (default "alt+y"; built-ins are reserved)
 *   OMP_TIMED_APPROVAL_START=1  start the session in timed state
 *
 * Install: `omp plugin install <this repo>` (package.json carries the omp manifest).
 */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const STATUS_KEY = "timed-approval";

type CycleState = "user" | "timed" | "yolo";

/** Read-tier native tools that run instantly in timed state (fast, harmless). */
const SKIP_TOOLS = new Set([
	"read", "glob", "grep", "find", "ls", "ast_grep", "ask", "checkpoint", "rewind",
	"todo", "wait", "yield", "think", "web_search", "recall", "reflect", "memory_edit", "jfind",
]);

/**
 * Duck-typed handle for `tools.approvalMode`.
 * Settings writes are keyed by the setting's path segments, not handle identity,
 * so this reaches the live `Settings.instance` without importing the bundled cfg
 * registry (a second registry copy would mismatch valueCache slots).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const approvalModeHandle: any = {
	id: "tools.approvalMode",
	segments: ["tools", "approvalMode"],
	definition: {},
	assertWritable(value: unknown) {
		if (value !== undefined && !["always-ask", "write", "yolo"].includes(String(value))) {
			throw new Error(`Invalid approval mode: ${String(value)}`);
		}
	},
	get(settings: any) {
		return settings.rawValue(approvalModeHandle) ?? "yolo";
	},
};

/** Approval-prompt-style preview: command for bash, path for file tools, pattern for search. */
function preview(toolName: string, input: unknown): string {
	const rec = (input ?? {}) as Record<string, unknown>;
	const str = (key: string): string => (typeof rec[key] === "string" ? (rec[key] as string) : "");
	let s: string | undefined;
	switch (toolName) {
		case "bash": s = `$ ${str("command")}`; break;
		case "read": case "edit": case "ast_edit": case "apply_patch": case "write": case "memory_edit":
			s = str("path") || str("note");
			if (toolName === "write" && typeof rec.content === "string" && rec.content.length > 0) {
				s = `${s} (${rec.content.length} bytes)`;
			}
			break;
		case "glob": s = `${str("pattern")} under ${str("path") || "."}`; break;
		case "grep": s = `${str("pattern")} in ${str("path") || "."}`; break;
		case "task": s = `${str("name") || str("agent")}: ${str("task") || str("description")}`; break;
		case "eval": case "computer": s = str("code") || str("command"); break;
		default: s = undefined;
	}
	if (s === undefined || s.trim() === "") s = JSON.stringify(input) ?? "";
	return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

export default function (pi: ExtensionAPI) {
	const seconds = Math.max(1, Math.floor(Number(process.env.OMP_TIMED_APPROVAL_SECONDS) || 5));
	const hotkey = (process.env.OMP_TIMED_APPROVAL_KEY || "alt+y").toLowerCase();
	let state: CycleState = "user";
	/** Approval mode snapshot taken when first leaving user state; restored when leaving yolo/timed. */
	let savedMode: { value: unknown; provenance: string } | undefined;

	function snapshotMode(): void {
		if (savedMode) return;
		const settings = pi.pi.Settings.instance;
		savedMode = {
			value: settings.rawValue(approvalModeHandle),
			// Capture provenance BEFORE writing our own override.
			provenance: settings.getProvenance(approvalModeHandle),
		};
	}

	function restoreMode(): void {
		if (!savedMode) return;
		const settings = pi.pi.Settings.instance;
		// A pre-existing runtime override (e.g. --approval-mode) gets restored; otherwise clear ours.
		if (savedMode.provenance === "runtime") settings.writeValue(approvalModeHandle, savedMode.value, "override");
		else settings.clearOverrideValue(approvalModeHandle);
		savedMode = undefined;
	}

	function apply(ctx: ExtensionContext, next: CycleState): void {
		if (next === "user") {
			restoreMode();
			ctx.ui.setStatus(STATUS_KEY, undefined);
			ctx.ui.notify("Approval: your configured mode (prompts wait for you)");
		} else {
			snapshotMode();
			pi.pi.Settings.instance.writeValue(approvalModeHandle, "yolo", "override");
			if (next === "timed") {
				ctx.ui.setStatus(STATUS_KEY, `timed approval · ${seconds}s`);
				ctx.ui.notify(`Timed approval — write/exec calls prompt, then auto-approve after ${seconds}s`);
			} else {
				ctx.ui.setStatus(STATUS_KEY, "yolo");
				ctx.ui.notify("Yolo — tool calls run without prompts");
			}
		}
		state = next;
	}

	pi.on("session_start", async (_event, ctx) => {
		if (process.env.OMP_TIMED_APPROVAL_START === "1" && ctx.mode === "tui" && state === "user") {
			apply(ctx, "timed");
		}
	});

	pi.registerShortcut(hotkey as Parameters<typeof pi.registerShortcut>[0], {
		description: "Cycle approval: user mode → timed approve → yolo",
		handler(ctx) {
			apply(ctx, state === "user" ? "timed" : state === "timed" ? "yolo" : "user");
		},
	});

	pi.on("tool_call", async (event, ctx) => {
		if (state !== "timed" || ctx.mode !== "tui") return;
		if (SKIP_TOOLS.has(event.toolName)) return;
		// Selector auto-picks the highlighted option when the timeout expires;
		// any keypress resets the countdown. Deny blocks the call for the model to see.
		const choice = await ctx.ui.select(
			`${event.toolName} — auto-approve in ${seconds}s\n${preview(event.toolName, event.input)}`,
			["Approve", "Deny"],
			{ initialIndex: 0, timeout: seconds * 1000 },
		);
		if (choice === "Deny") {
			return { block: true, reason: `Denied by user during timed approval: ${event.toolName}` };
		}
	});
}
