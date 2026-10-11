# omp-switch

Hotkey-toggled **timed yolo** approval mode for [oh-my-pi](https://github.com/can1357/oh-my-pi).

Press the hotkey and the session flips to a mode where every tool call still shows the
native approval prompt — but it counts down and auto-approves unless you act. Press it
again and your original approval mode is restored exactly.

```
╭─ bash — auto-approve in 5s (4s) ─────────────────────────╮
│  $ git push origin main                                  │
│  ❯ Approve                                               │
│    Deny                                                  │
╰──────────────────────────────────────────────────────────╯
```

## Behavior

- **Hotkey (default `alt+y`) toggles on/off.** Toggle-off restores the previous
  `tools.approvalMode` layer exactly — including a pre-existing `--approval-mode` override.
- **On:** read-tier tools (`read`, `glob`, `grep`, `find`, `todo`, `web_search`, …) run
  instantly; write/exec-tier calls (`bash`, `write`, `edit`, `eval`, `task`, MCP tools, …)
  get the countdown prompt. Timeout auto-picks the highlighted **Approve**; any keypress
  resets the countdown; **Deny** blocks the call and the model sees the denial.
- **`ask` is exempt** — questions from the ask tool wait for you indefinitely, as they should.
- Status line shows `timed yolo · Ns` while active.
- Per-session state; always starts off.

## Install

Option A — plugin package (this repo):

```bash
omp plugin install github:<you>/omp-switch
# or after npm publish:
omp plugin install omp-switch
```

Option B — single file, no npm:

```bash
mkdir -p ~/.omp/agent/extensions
curl -o ~/.omp/agent/extensions/omp-switch.ts \
  https://raw.githubusercontent.com/<you>/omp-switch/main/omp-switch.ts
```

## Configuration

| Env                   | Default   | Meaning                             |
| --------------------- | --------- | ----------------------------------- |
| `OMP_SWITCH_SECONDS`  | `5`       | Countdown seconds (min 1)           |
| `OMP_SWITCH_KEY`      | `alt+y`   | Hotkey (omp built-ins are reserved) |
| `OMP_SWITCH_START=1`  | off       | Start the session with timed mode on |

## Requirements

oh-my-pi (pi-coding-agent) with extension support — tested on v18.8.7.

## License

MIT
