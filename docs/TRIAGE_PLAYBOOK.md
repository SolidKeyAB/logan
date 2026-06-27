# Log / File Triage Playbook

The high-yield, low-token patterns I (the AI) fall back on when analysing a file
from a plain terminal — **no LOGAN needed**. Every command here *counts or
aggregates* so only small output comes back; none of them dump the whole file.

> **Fastest path:** run [`scripts/log-preflight.sh <file> > briefing.md`](../scripts/log-preflight.sh),
> paste `briefing.md` to the AI, then just say the symptom. That one script runs
> sections 1–8 below for you and cuts the discovery round-trips.

The loop is always the same — **orient → hypothesize → narrow → read → conclude** —
but the *commands* change with the file format, the symptom, and what each step reveals.

---

## 1. Orient (shape & format)

| Goal | Command |
|------|---------|
| Size / line count | `wc -lc file` |
| Eyeball format | `head -5 file` · `tail -5 file` |
| Longest line (truncation/blob hint) | `awk '{ if(length>m){m=length} } END{print m}' file` |
| Is it JSON-lines? | `head -1 file \| jq . >/dev/null 2>&1 && echo JSON` |

**Format decides the toolset:** JSON → `jq`; CSV → `awk -F,`; key=value → `grep -oE`;
syslog/logcat → split on the fixed columns; XML → `xmllint`/`grep`.

## 2. Levels (how bad, what mix)

```sh
grep -ioE 'FATAL|ERROR|WARN|INFO|DEBUG' file | sort | uniq -c | sort -rn
```

## 3. Errors with jump points (line numbers!)

```sh
grep -niE 'error|fatal|exception|panic|segfault|traceback|fail|crash|OOM' file | head
```
`-n` is the key flag — it gives line numbers so you (or the viewer) can jump straight there.

## 4. Collapse the noise (find loops / repeats)

```sh
# strip timestamps, collapse numbers → near-duplicate lines group together
sed -E 's/^[0-9TZ:.+ -]{8,}//; s/[0-9]+/#/g' file | sort | uniq -c | sort -rn | head
```
This is the single most useful pattern — it turns 50k lines into "these 8 messages repeat."

## 5. Components / subsystems

```sh
grep -oE '\[[A-Za-z0-9_.:/-]+\]' file | sort | uniq -c | sort -rn | head   # [Tag] style
```

## 6. Time span & gaps (hangs / silences)

```sh
grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9:]{8}' file | sed -n '1p;$p'   # first & last ts
```
No timestamps? Time analysis is off the table — fall back to line order.

## 7. Field / value trends (the "slow" / "wrong value" angle)

```sh
# min / max / avg of a numeric field over the whole file
grep -oE 'latency=[0-9]+' file | grep -oE '[0-9]+' \
  | awk '{n++;s+=$1; if($1>mx)mx=$1; if(mn==""||$1<mn)mn=$1} END{print "n="n" min="mn" max="mx" avg="s/n}'
```
```sh
# JSON: pull one field across all records
jq -r '.latency' file | sort -n | tail   # biggest values
```

## 8. Read context — only where you need it

```sh
sed -n '8040,8060p' file        # a specific window
grep -n -B3 -A10 'pool exhausted' file   # around a suspect message
```
This is the *only* step that pulls raw text — and only a few lines of it.

---

## Symptom → first move

| Symptom | First thing I run |
|---------|-------------------|
| 💥 Crashed | §3 errors + last line before EOF (`tail`) + `grep -A20 traceback` |
| 🐢 Slow | §7 on a latency field → find the spike, then §8 around it |
| 🧊 Froze | §6 time gaps → biggest silence, then §8 around it |
| 🌩️ Error storm | §2 + §5 → which component owns the errors |
| 🚫 Won't start | §3 over the **first** N lines (`head -200 \| grep -niE init\|fail`) |
| 🔌 Connection drops | `grep -niE 'disconnect\|reconnect\|timeout\|reset'` |
| 🎲 Intermittent | §4 to find what repeats around each failure |
| ❓ Wrong value | §7 + diff the field's value before/after the bad moment |

## Why it's never *just* a script

Steps 2–8 get re-ordered and re-tuned every run based on §1 (format) and on what the
previous command revealed — if errors cluster at one timestamp I zoom there; if one
component owns them I filter to it. The fixed checklist gets you 80% of the way fast;
the reasoning (deciding which step matters *for this file*) is the part that adapts.
