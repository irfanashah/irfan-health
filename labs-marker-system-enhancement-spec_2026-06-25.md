# Labs — Marker System Maturation (auto-canonicals + AI-proposed ranges + flags) — Build Spec

**Version:** 1.0
**Date:** 2026-06-25
**Status:** Follow-on to Slice 6 + the large-file fix. Matures the labs marker layer from "curated cardiac list, everything else unmapped, ranges only when the lab prints them" to "**every marker becomes a trendable canonical, with a reference range and a flag — AI-proposed where the source omits them, user-confirmed at commit.**" Reuses the LLM-extract + human-review architecture; the AI proposes, the human confirms, the system remembers.
**Confirmed decisions (Irfan):** (1) unmapped markers → auto-create + link a canonical; (2) where the source has no reference range, the **AI researches/proposes** a standard range as part of confirm+commit; (3) flags handled the same way — AI-proposed from the range, confirmed at commit.

> **Sacred guardrail, unchanged:** the measured **result value** is NEVER invented/altered — it comes verbatim from the report (text layer or vision). What the AI *proposes* in this enhancement is reference-range + flag **context** (population/clinical constants, clearly labelled "proposed standard"), NOT patient measurements. The prompt must keep these two jobs explicitly separate.

---

## Part 1 — Auto-create canonicals for unmapped markers
Today: markers outside `markers.ts` land as `marker_slug='unmapped'` → can't be trended (all collapse together). Fix: every marker gets a real, stable canonical slug.
- During review, an unmapped marker gets an **LLM-suggested slug** (from the raw name, semantically — "NEUTROPHILS %" → `neutrophils_pct`). The canonical dropdown gains **"+ create / use this slug"** and shows similar existing slugs so the user can **merge** ("Neutrophil %" → existing `neutrophils_pct`) rather than fork.
- On commit, the confirmed `raw_marker_name → marker_slug` persists to **`lab_marker_aliases`** (existing) → every future report auto-maps deterministically. The slug becomes a first-class trendable marker (appears in the `/labs` "any marker with ≥2 draws" picker).
- Auto-created markers have no unit conversion or key-marker status (fine — they trend in reported units). They can later be promoted into `markers.ts` with a conversion / key flag if wanted, but that's optional and not required for trending.
- `'unmapped'` only remains if the user explicitly skips a row.

## Part 2 — AI-proposed reference ranges (where the source omits them)
Precedence for each marker's range, in order:
1. **Lab-reported range** (extracted from the report) — authoritative for that draw. Always wins.
2. **Remembered standard range** — if we've confirmed a standard range for this canonical before, reuse it deterministically (no AI call).
3. **AI-proposed standard range** — for a marker with no reported and no remembered range, the LLM proposes the standard adult reference range (sex-aware — Irfan is male; single-user, so use male ranges where sex-specific, e.g. hemoglobin/hematocrit), **flagged as "proposed · standard, not from this report."**
- **Review:** proposed ranges render in the editable ref-low/ref-high fields with a clear **provenance badge** (e.g. "from report" vs "proposed standard") so a proposal is never mistaken for the lab's own. User edits/confirms.
- **Commit:** the final range is written to `lab_values` (`ref_low`/`ref_high`/`ref_unit`). Newly-confirmed **standard** ranges persist to a new **`lab_marker_ref_ranges`** store (per canonical slug + sex) so repeats are deterministic and the AI is only asked for genuinely-new markers — the same learn-as-you-go pattern as aliases. (Recommended; the lighter alternative is to re-ask the AI every time — less consistent, more cost. I recommend persisting.)
- **Provenance stored:** add a small `ref_source` (`'reported' | 'standard'`) column to `lab_values` so a confirmed-standard range is distinguishable from a lab-reported one in the trend band + any future export. (Small migration; flag if you'd rather infer.)
- Honesty: AI-proposed ranges are population standards, provisional, not lab/assay-exact — labelled as such in the UI; they drive the trend's normal band + flagging, never a diagnosis.

## Part 3 — Flags (H / L / HH / LL / N)
Meaning: **H** high · **L** low · **HH** critically high (panic) · **LL** critically low · **N** normal (in range). Empty in the discharge-summary extraction because it prints no flags/ranges.
- **Lab-printed flag present** → use it verbatim (authoritative; e.g. the Fakeeh sodium "L").
- **No printed flag, but a range exists** (reported, remembered, or proposed-confirmed) → **compute H / L / N** from value vs range. Proposed at review, user confirms.
- **HH / LL (critical)** → only from an explicit lab flag, or a curated/AI-proposed **critical threshold** for key markers (e.g. potassium, sodium, hemoglobin) — confirmed at review. Don't infer "critical" from "just further out."
- Store the final flag in `lab_values.flag` (the schema's H/L/HH/LL/N constraint already allows it).

## Schema changes
- **`lab_marker_ref_ranges`** (NEW, small): `id`, `marker_slug`, `sex` (nullable — `'M'`/`'F'`/null=any), `ref_low`, `ref_high`, `ref_unit`, `critical_low` (nullable), `critical_high` (nullable), `created_at`; unique on `(marker_slug, sex)`. The remembered standard-range store (learn-as-you-go). RLS `authenticated_full_access`.
- **`lab_values.ref_source`** (NEW column, `text`, `'reported'|'standard'`, nullable) — range provenance. Small migration.
- `lab_marker_aliases` (exists) — reused for Part 1.
- `lab_panels`/`lab_values` otherwise unchanged.

## LLM prompt / extract changes (`prompt.ts` / `extract.ts`)
- Keep the measured-value guardrail front and centre: extract result values verbatim, never invent/alter.
- Add, as a SEPARATE labelled task: for each marker, suggest a canonical slug (Part 1) and — only when the report gives no reference range — propose a standard adult reference range + (for key markers) critical thresholds, **explicitly marked as proposed standards, not report data**. The structured output gains `suggested_marker_slug`, `proposed_ref_low/high/unit`, `range_source: 'reported'|'proposed'`, and `proposed_flag`.
- The deterministic lookups (alias table, remembered ref-range store) are applied in code BEFORE/over the LLM proposals so confirmed knowledge wins and the AI is only relied on for the genuinely-new.

## Review UI changes (`LabsClient`)
- Canonical dropdown: "+ create / merge" for unmapped markers (Part 1).
- Ref-low/high fields: pre-filled with reported OR proposed values, each row carrying a **provenance badge** ("from report" / "proposed standard"); editable.
- Flag dropdown: pre-filled (lab-printed or computed/proposed); editable; provenance shown.
- Nothing commits until confirm (unchanged).

## Commit changes (`commitPanel`)
- Persist confirmed canonical aliases (existing) + confirmed standard ranges → `lab_marker_ref_ranges` + `ref_source` on each `lab_value` + the confirmed flag.

## Out of scope
- Promoting auto-created markers into the curated `markers.ts` (with conversions / key-marker status) — manual, optional, later.
- Lab markers feeding the drift engine — still a later follow-on.
- Doctor-record export.

## Implementation steps
1. Migration: `lab_marker_ref_ranges` + `lab_values.ref_source` column.
2. `markers.ts` / a ranges module: the remembered-range lookup (`lab_marker_ref_ranges`) + flag-from-range computation + critical-threshold handling.
3. `prompt.ts`/`extract.ts`: add slug suggestion + proposed-range/flag fields (clearly separated from value extraction); apply alias + remembered-range lookups in code first.
4. `LabsClient`: canonical create/merge, range fields with provenance badges, flag pre-fill — all editable.
5. `commitPanel`: persist aliases + ranges + ref_source + flag.
6. `/labs` trends: use the stored range (reported or standard) for the normal band; show provenance.
7. `npm run build` clean.

## Acceptance criteria
- [ ] Unmapped markers get an AI-suggested canonical, confirmable/mergeable in review, persisted to `lab_marker_aliases` → trendable (no dead-end "unmapped" unless skipped)
- [ ] Ranges: lab-reported wins; else remembered standard; else AI-proposed — all confirmable in review with a provenance badge; confirmed standards persist to `lab_marker_ref_ranges`; `ref_source` stored
- [ ] Flags: lab-printed used; else H/L/N computed from the range; HH/LL only from explicit flag or curated/confirmed critical thresholds; confirmable
- [ ] Measured **values** never invented/altered — the guardrail holds; proposed ranges/flags clearly labelled as standards, not report data
- [ ] Migration adds `lab_marker_ref_ranges` + `ref_source`; `npm run build` clean

---

*End of spec. The AI proposes (canonical, range, flag), the human confirms at commit, the system remembers — same pattern as the marker aliases. Proposed ranges are population standards (provisional), never patient measurements; the result value stays sacred.*
