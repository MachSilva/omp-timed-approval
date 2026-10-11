# omp-timed-approval

Hotkey-toggled countdown for [oh-my-pi](https://github.com/can1357/oh-my-pi) approval prompts.

The extension does **not** touch approval rules or modes — `tools.approvalMode` keeps
deciding *which* tool calls prompt you. When enabled, it only changes what happens when a
prompt shows: it counts down and auto-approves unless you act.

```
╭─ Approval required ──────────────────────────────────────╮
│  bash: git push origin main                              │
│  ❯ Approve                                               │
│    Deny                                                  │
╰────────────────────────────────────────── auto in (4s) ──╯
```

## Behavior

| Mode (yours)     | With timed approval ON                                     |
| ---------------- | ---------------------------------------------------------- |
| `always-ask`     | reads run instantly; write/exec prompt → auto-approve in Ns |
| `write`          | writes run instantly; exec prompts → auto-approve in Ns     |
| `yolo`           | nothing prompts; extension is idle                          |

- The countdown **resets on any keypress**; expiry auto-picks the highlighted **Approve**;
  choosing **Deny** blocks the call, and per-tool policies (`tools.approval.<tool>: deny`)
  still deny — the extension never bypasses them.
- Hotkey (default **alt+y**) toggles it per session; the status line shows
  `timed approval · Ns` while active. Sessions always start with it off.

## Install

```bash
omp plugin install github:<you>/omp-timed-approval
# or, after npm publish:
omp plugin install omp-timed-approval
```

Or the single file, no npm:

```bash
mkdir -p ~/.omp/agent/extensions
curl -o ~/.omp/agent/extensions/timed-approval.ts \
  https://raw.githubusercontent.com/<you>/omp-timed-approval/main/timed-approval.ts
```

## Configuration

| Env                          | Default  | Meaning                             |
| ---------------------------- | -------- | ----------------------------------- |
| `OMP_TIMED_APPROVAL_SECONDS` | `5`      | Countdown seconds (min 1)           |
| `OMP_TIMED_APPROVAL_KEY`     | `alt+y`  | Hotkey (omp built-ins are reserved) |
| `OMP_TIMED_APPROVAL_START=1` | off      | Start the session already enabled   |

## Requirements

oh-my-pi (pi-coding-agent) with extension support — tested on v18.8.7.

## License

MIT
