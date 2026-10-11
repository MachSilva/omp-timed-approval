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
	async function timedPrompt(ctx: ExtensionContext, toolName: string, input: unknown): Promise<string | undefined> {
		const text = JSON.stringify(input) ?? "";
		const preview = text.length > 200 ? `${text.slice(0, 200)}…` : text;
		return ctx.ui.select(`${toolName} — auto-approve in ${seconds}s\n${preview}`, ["Approve", "Deny"], {
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
		if (event.toolName === "ask") return;
		const choice = await timedPrompt(ctx, event.toolName, event.input);
		if (choice === "Deny") {
			return { block: true, reason: `Denied by user during timed approval: ${event.toolName}` };
		}
		// "Approve" (user) or undefined (timeout auto-picked the highlighted Approve) → let it run.
	});
}
