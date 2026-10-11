/**
 * Basic QA for omp-timed-approval: pure preview() + the full 3-state cycle
 * driven through a fake Settings/ExtensionAPI. No omp runtime needed.
 * Run: bun test test/timed-approval.test.ts
 */
import { describe, expect, test } from "bun:test";
// @ts-expect-error — extension is plain ts, resolved relative to this test.
import factory, { preview } from "../timed-approval.ts";

describe("preview()", () => {
	test("bash shows the command", () => {
		expect(preview("bash", { command: "echo hi" })).toBe("$ echo hi");
	});
	test("read shows the path", () => {
		expect(preview("read", { path: "/etc/hosts" })).toBe("/etc/hosts");
	});
	test("write shows path + size", () => {
		expect(preview("write", { path: "x.ts", content: "abc" })).toBe("x.ts (3 bytes)");
	});
	test("truncates long strings", () => {
		const long = "x".repeat(300);
		const out = preview("bash", { command: long });
		expect(out.length).toBeLessThanOrEqual(201); // 200 chars + ellipsis
		expect(out.endsWith("…")).toBe(true);
	});
	test("falls back to JSON for unknown tools", () => {
		expect(preview("mystery", { a: 1 })).toBe('{"a":1}');
	});
	test("handles null/undefined input", () => {
		expect(preview("mystery", undefined)).toBe("");
	});
});

/** Minimal fake of the pi extension surface the factory uses. */
function makeFakePi() {
	const settings = {
		value: undefined as unknown,
		provenance: undefined as string | undefined,
		written: [] as unknown[],
		cleared: 0,
		rawValue() { return this.value; },
		getProvenance() { return this.provenance; },
		writeValue(_h: unknown, v: unknown) { this.written.push(v); this.value = v; },
		clearOverrideValue() { this.cleared++; this.value = undefined; },
	};
	const handlers: Record<string, Function[]> = {};
	let shortcut: { handler: (ctx: unknown) => void } | undefined;
	const pi = {
		pi: { Settings: { instance: settings } },
		on(name: string, fn: Function) { (handlers[name] ??= []).push(fn); },
		registerShortcut(_key: string, def: { handler: (ctx: unknown) => void }) { shortcut = def; },
	};
	const selects: { title: string; options: string[]; opts: unknown }[] = [];
	const f = {
		choice: "Approve" as string,
		selects,
		statuses: [] as (string | undefined)[],
		notes: [] as string[],
		settings,
		press: () => shortcut!.handler(ctx),
		emit: async (name: string, event: unknown) => {
			let last: unknown;
			for (const fn of handlers[name] ?? []) last = await fn(event, ctx);
			return last;
		},
	};
	const ctx = {
		mode: "tui",
		ui: {
			setStatus(_k: string, s: string | undefined) { f.statuses.push(s); },
			notify(n: string) { f.notes.push(n); },
			async select(title: string, options: string[], opts: unknown) {
				f.selects.push({ title, options, opts });
				return f.choice;
			},
		},
	};
	// @ts-expect-error — fakes are duck-typed, shape is what matters.
	factory(pi);
	return f;
}

describe("cycle", () => {
	test("starts in user state; shortcut cycles user → timed → yolo → user", async () => {
		const f = makeFakePi();
		f.press(); // → timed
		expect(f.settings.written).toEqual(["yolo"]);
		f.press(); // → yolo
		f.press(); // → user: restore = clear (no prior provenance)
		expect(f.settings.cleared).toBe(1);
		expect(f.statuses.at(-1)).toBeUndefined();
	});

	test("timed state gates bash with countdown selector", async () => {
		const f = makeFakePi();
		f.press(); // timed
		await f.emit("tool_call", { toolName: "bash", input: { command: "echo hi" } });
		expect(f.selects).toHaveLength(1);
		expect(f.selects[0].title).toContain("echo hi");
		expect((f.selects[0].opts as { timeout: number }).timeout).toBe(5000);
		expect(f.selects[0].options).toEqual(["Approve", "Deny"]);
	});

	test("read-tier tools skip the gate in timed state", async () => {
		const f = makeFakePi();
		f.press();
		await f.emit("tool_call", { toolName: "read", input: { path: "x" } });
		expect(f.selects).toHaveLength(0);
	});

	test("Deny blocks the call; Approve passes", async () => {
		const f = makeFakePi();
		f.press(); // timed
		f.choice = "Deny";
		expect(await f.emit("tool_call", { toolName: "bash", input: { command: "x" } }))
			.toEqual({ block: true, reason: "Denied by user during timed approval: bash" });
		f.choice = "Approve";
		expect(await f.emit("tool_call", { toolName: "bash", input: { command: "x" } }))
			.toBeUndefined();
	});

	test("user state never gates (restore leaves no hooks active)", async () => {
		const f = makeFakePi();
		f.press(); f.press(); f.press(); // timed → yolo → user
		await f.emit("tool_call", { toolName: "bash", input: { command: "x" } });
		expect(f.selects).toHaveLength(0);
	});

	test("snapshot preserves pre-existing runtime mode and restores it", async () => {
		const f = makeFakePi();
		f.settings.provenance = "runtime"; // e.g. --approval-mode always-ask
		f.settings.value = "always-ask";
		f.press(); // timed → writes yolo
		f.press(); f.press(); // → user
		// restore re-wrote the saved value (1 clear + later re-write) — no throw, value restored
		expect(f.settings.value).toBe("always-ask");
	});
});
