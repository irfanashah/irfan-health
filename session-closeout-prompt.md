# Claude Code — Session Closeout Routine

> Reusable. Paste into Claude Code at the end of a session or a completed slice build, run from the `irfan-health` repo root. Run it before you `/clear` so the project state is fully externalised to disk first.

---

Close out this session. Do the following in order. Don't skip steps; if a step has nothing to do, say so explicitly and move on.

## ⚠️ Step 0 — ONE-TIME (do this FIRST, then delete this Step 0 block)

Before staging anything, add the folder `Dexcom /` (note: capital D, trailing space) to `.gitignore` so the Dexcom Clarity CSVs in it — which contain PHI (name, DOB, glucose) — are **never committed**. Confirm `git status` no longer lists that folder. Everything else accumulated this session (the `slice-*` specs, `clarity-to-nightscout-loader.py`, `nightscout-setup-guide_*.md`, `session-*` prompts, `.claude/commands`, and the `CLAUDE.md` / `PROJECT-STATE.md` doc updates) is safe to commit. Once `Dexcom /` is gitignored, remove this Step 0 block from this file — it's a one-time task.

## 1. Confirm the build is green (only if code changed this session)

If any `.ts`/`.tsx`/config files changed, run `npm run build` and confirm it passes clean. If it fails, STOP — show me the error and do not commit. If only docs/markdown changed, skip this step and say so.

## 2. Update CLAUDE.md (the authoritative live build record)

Reconcile CLAUDE.md against what actually changed this session:
- **Done / Pending / Next concrete action** — move items between sections to match reality.
- **Decisions made** — append any new decision taken this session (and the why).
- **Gotchas** — append any new gotcha hit, keeping the numbering scheme. Per-source API gotchas go in their own block.
- Do not duplicate my global preferences; they live in `~/.claude/CLAUDE.md`.

If nothing material changed, leave CLAUDE.md untouched and say so.

## 3. Update PROJECT-STATE.md (the concise in-repo snapshot)

`PROJECT-STATE.md` lives at the repo root and is the short, current-state snapshot — NOT a second copy of CLAUDE.md. CLAUDE.md is the deep record (full decisions, all gotchas, detailed slice entries); PROJECT-STATE.md is the one-page "where do things stand right now" that Cowork mirrors into its memory.

**If `PROJECT-STATE.md` does not exist yet, create it** using exactly this structure:

```markdown
# Project State — Irfan's Health Platform

_Last updated: YYYY-MM-DD (session: <one-line description of what this session did>)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
<1–3 lines: what just shipped / what state the project is in this moment.>

## Slice ledger
<one line per slice, ✅ done / → next / ⬜ not started — terse.>

## Data state
<per-source row counts / reconciliation status / pending verifications.>

## Next action
<the single next concrete thing to do, specific enough to start from cold.>

## Open items (non-blocking)
<short bullets; carry forward until resolved, then delete.>
```

**If it already exists**, update each section to match the current reality. Keep it tight — if a section grows past ~8 lines, you're putting CLAUDE.md-level detail in the wrong file; trim it.

Bump the `Last updated` line to today's date with a one-line session description.

## 4. Commit

Stage everything and commit. Follow the existing message convention in this repo:
- Code: `Slice N (x/y): <what>` or `<area>: <what>`
- Docs only: `Docs: <what>`
- If the session spanned code + docs, lead with the code change and mention the doc closeout.

One commit for the session unless the work genuinely splits into independent logical changes.

## 5. Do NOT push — hand it back to me

Do not `git push`. A push to `main` triggers a production Vercel deploy and that's my call. After committing, print:
- the commit hash + message,
- a one-paragraph summary of what changed this session,
- the exact current contents of `PROJECT-STATE.md` (so I can paste the snapshot to Cowork to sync memory),
- the `git push` command, ready for me to run when I decide to deploy.

---

## Resuming after `/clear`

Use the dedicated resume routine — paste the contents of `session-resume-prompt.md` (repo root) as the first message in the fresh context.
