# Claude Code — Session Resume Routine

> Paste this as the FIRST message in a fresh context after `/clear`. Run from the `irfan-health` repo root. It rebuilds full understanding from disk before any work starts.

---

You're resuming work on my personal health platform after a context clear. Assume you have NO memory of prior sessions — everything you need is on disk. Do not write code or change anything until you've completed the steps below and I've approved.

## 1. Rebuild context — read these in order, in full

1. `AGENTS.md` — load-bearing environment notice (this is Next.js 16, not your training defaults).
2. `CLAUDE.md` — the authoritative live build record: stack, all "Decisions made", the full gotchas list, and the Done / Pending / Next concrete action sections. This is the deep record — read it properly, don't skim.
3. `PROJECT-STATE.md` — the concise snapshot: Now, Slice ledger, Data state, Next action, Open items.
4. If the Next action involves an existing slice spec, read that spec at the repo root (`slice-N-*.md`). If the next slice has no spec written yet, note that — drafting it may be the first task.

## 2. Verify the docs against the actual repo — don't just trust them

- Run `git log --oneline -10` and `git status` — confirm what's actually committed and whether the working tree is clean (there may be uncommitted work, e.g. the seeded `PROJECT-STATE.md`).
- Spot-check that what the docs claim exists actually exists (adapters, routes, migrations relevant to the Next action).
- If the repo and the docs disagree: `CLAUDE.md` is the record of intent, but the code is ground truth — **FLAG the drift to me explicitly**, don't silently reconcile.

## 3. Brief me, then STOP

Before touching anything, give me a tight briefing:
- **Where we are** — what's shipped; current data/build state.
- **What's next** — the Next action, in your own words.
- **Your plan** — how you'll approach it, broken into steps. Include a verification step.
- **Anything that doesn't add up** — doc-vs-repo drift, open questions, missing inputs (creds, a spec that needs writing first, a decision I owe you).

Then wait for my go-ahead. Per my working rules: break complex work into steps, share the plan, get my approval, then execute. Ask clarifying questions one at a time. Do not start writing code until I confirm.
