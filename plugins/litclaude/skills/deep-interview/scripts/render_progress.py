#!/usr/bin/env python3
"""Colorized TUI renderer for the deep-interview skill.

Prints ANSI-colored progress surfaces — the kickoff banner, the per-round
ambiguity meter, and the clarity breakdown + readiness gates — to stdout.

Why a script instead of inline text: the assistant's markdown reply channel
does not render ANSI escape codes (they show up as literal garbage), but the
terminal output of a Bash command does. So run this via Bash whenever you want
the pretty colorized TUI; the plain markdown blocks in SKILL.md remain the
always-works fallback.

Degrades gracefully: pass --color never, or set NO_COLOR=1, to emit plain text
(safe for logs and pipes). Uses 256-color codes for broad terminal support.

Examples
--------
  render_progress.py banner --profile Standard --context greenfield \
      --idea "add dark mode to settings" --threshold 20 --max-rounds 12 --ambiguity 100

  render_progress.py meter --round 3 --max-rounds 12 \
      --stage "1: Intent-first" --focus Scope --ambiguity 52 --threshold 20

  render_progress.py breakdown --threshold 20 --prev 60 --ambiguity 52 --next Scope \
      --scores "Intent=0.80,Outcome=0.60,Scope=0.40,Constraints=0.70,Success=0.30" \
      --gates "nongoals=1,boundaries=0,pressure=1"
"""
import argparse
import os
import sys

# 256-color palette
RED, AMBER, GREEN, GRAY, CYAN, WHITE = 203, 214, 78, 244, 80, 252
_use_color = True


def c(code, s, bold=False):
    if not _use_color:
        return s
    pre = "\033[1m" if bold else ""
    return f"{pre}\033[38;5;{code}m{s}\033[0m"


def amb_color(amb, threshold):
    """Red far from target, amber approaching, green at/under target."""
    if amb <= threshold:
        return GREEN
    if amb <= 2 * threshold:
        return AMBER
    return RED


def meter_bar(amb, threshold, width=22):
    """Draining ambiguity meter: filled cells = remaining ambiguity, a tick
    marks the target. Goal is to drain the filled edge at/under the tick."""
    filled = round(width * amb / 100)
    tick = round(width * threshold / 100)
    col = amb_color(amb, threshold)
    cells = []
    for i in range(width):
        if i < filled:
            cells.append(c(col, "█"))
        elif i == tick:
            cells.append(c(GREEN if amb <= threshold else CYAN, "┊"))
        else:
            cells.append(c(GRAY, "░"))
    return "".join(cells)


def dim_bar(score, width=10):
    filled = round(width * score)
    col = GREEN if score >= 0.7 else AMBER if score >= 0.4 else RED
    return c(col, "█" * filled) + c(GRAY, "░" * (width - filled))


def banner(a):
    bar = c(CYAN, "│")
    edge_t = c(CYAN, "╭─")
    edge_b = c(CYAN, "╰" + "─" * 50)
    idea = a.idea if len(a.idea) <= 52 else a.idea[:49] + "..."
    lines = [
        f" {edge_t} {c(WHITE, '🎯 Deep Interview', bold=True)} {c(CYAN, '─' * 30)}",
        f" {bar}  {c(GRAY, 'Profile ')}  {c(WHITE, a.profile)} · {a.context}",
        f" {bar}  {c(GRAY, 'Goal    ')}  turn \"{idea}\" into an execution-ready spec",
        f" {bar}  {c(GRAY, 'Target  ')}  ambiguity {c(GREEN, f'≤ {a.threshold}%')}   ·   Budget  up to {a.max_rounds} rounds",
        f" {bar}  {c(GRAY, 'Start   ')}  ambiguity {c(amb_color(a.ambiguity, a.threshold), f'{a.ambiguity}%')}   ·   one question / round, intent before detail",
        f" {edge_b}",
    ]
    print("\n".join(lines))


def meter(a):
    head = (
        f"{c(GRAY, 'Round')} {c(WHITE, f'{a.round}/{a.max_rounds}', bold=True)}"
        f"  {c(GRAY, '·')}  {c(GRAY, 'Stage')} {a.stage}"
        f"  {c(GRAY, '·')}  {c(GRAY, 'Focus:')} {c(CYAN, a.focus)}"
    )
    bar = meter_bar(a.ambiguity, a.threshold)
    line = (
        f"{c(GRAY, 'Ambiguity')} {c(amb_color(a.ambiguity, a.threshold), f'{a.ambiguity:>3}%', bold=True)} "
        f"[{bar}] {c(GRAY, f'target ≤ {a.threshold}%')}"
    )
    print(head)
    print(line)


def breakdown(a):
    print(c(WHITE, "Clarity", bold=True))
    scores = {}
    for pair in a.scores.split(","):
        if not pair.strip():
            continue
        k, v = pair.split("=")
        scores[k.strip()] = float(v)
    weakest = min(scores, key=scores.get) if scores else None
    for name, score in scores.items():
        mark = c(CYAN, "  ← weakest") if name == weakest else ""
        print(f"  {name:<12}{dim_bar(score)}  {c(WHITE, f'{score:.2f}')}{mark}")

    print()
    print(c(WHITE, "Readiness gates", bold=True))
    gate_labels = {
        "nongoals": "Non-goals explicit",
        "boundaries": "Decision Boundaries",
        "pressure": "Pressure pass done",
    }
    gates, open_gates = {}, []
    for pair in a.gates.split(","):
        if not pair.strip():
            continue
        k, v = pair.split("=")
        gates[k.strip()] = v.strip() in ("1", "true", "yes")
    cells = []
    for key, label in gate_labels.items():
        met = gates.get(key, False)
        cells.append(c(GREEN, f"✅ {label}") if met else c(GRAY, f"⬜ {label}"))
        if not met:
            open_gates.append(label)
    print("  " + "      ".join(cells))
    if open_gates:
        print(c(AMBER, f"        → blocked by: {', '.join(open_gates)}"))
    elif a.ambiguity <= a.threshold:
        print(c(GREEN, "        → all gates met — ready to crystallize"))

    print()
    delta = c(GREEN, "↓") if a.ambiguity < a.prev else c(GRAY, "·")
    print(
        f"{c(GRAY, 'Ambiguity')} {a.prev}% {delta} {c(amb_color(a.ambiguity, a.threshold), f'{a.ambiguity}%', bold=True)}"
        f"   {c(GRAY, '·')}   {c(GRAY, 'Next:')} {c(CYAN, a.next)}"
    )


def main():
    global _use_color
    p = argparse.ArgumentParser(description="deep-interview TUI renderer")
    p.add_argument("--color", choices=["auto", "always", "never"], default="auto")
    sub = p.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("banner")
    b.add_argument("--profile", required=True)
    b.add_argument("--context", default="greenfield")
    b.add_argument("--idea", default="")
    b.add_argument("--threshold", type=int, required=True)
    b.add_argument("--max-rounds", type=int, required=True)
    b.add_argument("--ambiguity", type=int, default=100)
    b.set_defaults(fn=banner)

    m = sub.add_parser("meter")
    m.add_argument("--round", type=int, required=True)
    m.add_argument("--max-rounds", type=int, required=True)
    m.add_argument("--stage", default="")
    m.add_argument("--focus", default="")
    m.add_argument("--ambiguity", type=int, required=True)
    m.add_argument("--threshold", type=int, required=True)
    m.set_defaults(fn=meter)

    d = sub.add_parser("breakdown")
    d.add_argument("--scores", required=True, help="Name=0.80,Name=0.60,...")
    d.add_argument("--gates", default="nongoals=0,boundaries=0,pressure=0")
    d.add_argument("--threshold", type=int, required=True)
    d.add_argument("--prev", type=int, default=100)
    d.add_argument("--ambiguity", type=int, required=True)
    d.add_argument("--next", default="")
    d.set_defaults(fn=breakdown)

    a = p.parse_args()
    if a.color == "never" or (a.color == "auto" and os.environ.get("NO_COLOR")):
        _use_color = False
    a.fn(a)


if __name__ == "__main__":
    main()
