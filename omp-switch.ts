/**
 * omp-switch — hotkey-toggled "timed yolo" approval mode for oh-my-pi.
 *
 * Hotkey toggles between the session's current approval mode and a timed
 * variant: every tool call still shows the native approval prompt, but it
 * auto-approves (the selector picks the highlighted "Approve") after
 * OMP_SWITCH_SECONDS (default 5) unless you act. Pick "Deny" to block the call.
 * The `ask` tool is exempt — its questions wait for you indefinitely.
 *
 * Env:
 *   OMP_SWITCH_SECONDS  countdown seconds (default 5, min 1)
 *   OMP_SWITCH_KEY      shortcut (default "alt+y"; built-ins like ctrl+c are reserved)
 *   OMP_SWITCH_START=1  start with timed mode already on (headless/testing)
 *
 * Install: symlink into ~/.omp/agent/extensions/ (or run `omp -e omp-switch.ts`).
 */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const APPROVAL_MODES = ["always-ask", "write", "yolo"] as const;
type Mode = (typeof APPROVAL_MODES)[number];
/** Schema default of tools.approvalMode. */
const DEFAULT_MODE: Mode = "yolo";
const STATUS_KEY = "omp-switch";

/**
 * Native read-tier tools that pass through ungated in timed mode (fast, harmless).
 * bash/write/edit/eval/task/computer/MCP tools and anything unknown still prompt —
 * that is the point of the mode. `ask` is special-cased below (no timeout ever).
 */
const SKIP_TOOLS = new Set([
	"read", "glob", "grep", "find", "ls", "ast_grep", "ask", "checkpoint", "rewind",
	"todo", "wait", "yield", "think", "web_search", "recall", "reflect", "memory_edit", "jfind",
]);

/** Native-approval-prompt-style preview: command for bash, path for file tools, pattern for search. */
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

/**
 * Duck-typed handle for `tools.approvalMode`.
 *
 * Settings writes/reads are keyed by the setting's path segments, not handle
 * identity, so this works against the live `Settings.instance` without
 * importing the bundled cfg registry (which would be a second, slot-mismatched
 * copy of the key).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const approvalModeHandle: any = {
	id: "tools.approvalMode",
	segments: ["tools", "approvalMode"],
	definition: {},
	assertWritable(value: unknown) {
		if (typeof value !== "string" || !APPROVAL_MODES.includes(value as Mode)) {
			throw new Error(`Invalid approval mode: ${String(value)}`);
		}
	},
	get(settings: any) {
		return settings.rawValue(approvalModeHandle) ?? DEFAULT_MODE;
	},
};

function asMode(value: unknown): Mode {
	return APPROVAL_MODES.includes(value as Mode) ? (value as Mode) : DEFAULT_MODE;
}

export default function (pi: ExtensionAPI) {
	const seconds = Math.max(1, Math.floor(Number(process.env.OMP_SWITCH_SECONDS) || 5));
	const hotkey = (process.env.OMP_SWITCH_KEY || "alt+y").toLowerCase();
	const autoStart = process.env.OMP_SWITCH_START === "1";

	/** Native selector auto-picks the highlighted option when the timeout expires. */
	async function timedPrompt(ctx: ExtensionContext, toolName: string, detail: string): Promise<string | undefined> {
		return ctx.ui.select(`${toolName} — auto-approve in ${seconds}s\n${detail}`, ["Approve", "Deny"], {
			initialIndex: 0,
			timeout: seconds * 1000,
		});
	}

	function setOn(ctx: ExtensionContext): void {
		const settings = pi.pi.Settings.instance;
		saved = {
			value: asMode(settings.rawValue(approvalModeHandle)),
			// Capture provenance BEFORE writing our own override.
			provenance: settings.getProvenance(approvalModeHandle),
		};
		settings.writeValue(approvalModeHandle, "yolo", "override");
		ctx.ui.setStatus(STATUS_KEY, `timed yolo · ${seconds}s`);
		ctx.ui.notify(`Timed yolo ON — tool calls prompt, then auto-approve after ${seconds}s`);
	}

	function setOff(ctx: ExtensionContext): void {
		const settings = pi.pi.Settings.instance;
		// A pre-existing runtime override (e.g. --approval-mode) gets restored; otherwise clear ours.
		if (saved?.provenance === "runtime") settings.writeValue(approvalModeHandle, saved.value, "override");
		else settings.clearOverrideValue(approvalModeHandle);
		saved = undefined;
		ctx.ui.setStatus(STATUS_KEY, undefined);
		ctx.ui.notify("Approval mode restored");
	}

	let saved: { value: Mode; provenance: string } | undefined;

	pi.registerShortcut(hotkey as Parameters<typeof pi.registerShortcut>[0], {
		description: "Toggle timed yolo approval mode",
		handler(ctx) {
			if (saved) setOff(ctx);
			else setOn(ctx);
		},
	});

	if (autoStart) {
		pi.on("session_start", async (_event, ctx) => {
			if (!saved && ctx.mode === "tui") setOn(ctx);
		});
	}

	pi.on("tool_call", async (event, ctx) => {
		if (!saved || ctx.mode !== "tui") return;
		// `ask` prompts the user inside its own execute with no timeout — never gate it.
		// (Timeouts here are for approval only; questions must wait indefinitely.)
		// Read-tier tools skip the countdown entirely (fast, harmless); write/exec still prompt.
		if (SKIP_TOOLS.has(event.toolName) || event.toolName.startsWith("mcp__read")) return;
		const choice = await timedPrompt(ctx, event.toolName, preview(event.toolName, event.input));
		if (choice === "Deny") {
			return { block: true, reason: `Denied by user during timed approval: ${event.toolName}` };
		}
		// "Approve" (user) or undefined (timeout auto-picked the highlighted Approve) → let it run.
	});
}
