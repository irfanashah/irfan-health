# Design brief — "Baselines & Drift" panel

*A plain-language, user-first brief for designing one panel of a personal health dashboard. This describes who it's for, what it's really trying to do for them, and what good feels like — not how to build it. Explore freely; the "must-haves" and "please don't" lists at the end are the only hard edges.*

---

## Who this is for

One person. A 46-year-old man who had a heart attack a couple of months ago — a serious one (a fully blocked artery), treated with two stent procedures. He's now on a handful of daily heart medications, recovering well, and rebuilding his life around it: he's also a new father and a busy executive, so he's tired, time-poor, and checking this on the move.

He is not a doctor, but he's smart and technically capable. He built this dashboard for himself. He wears a recovery band, takes his blood pressure at home, has a continuous glucose monitor, weighs in, and tracks his blood oxygen overnight. All of that data flows into one place. This panel is the part that's supposed to make sense of it.

He is calm by nature and copes well — but he's also someone whose body recently failed him without much warning. So the emotional backdrop matters: he's not anxious, but he is *watchful*. He wants to feel in control of his recovery, not surveilled by it.

## What this panel is really for

Here's the one question it answers:

> **"Is my body quietly drifting away from what's normal *for me* — in a way I should pay attention to, or mention to my cardiologist?"**

That's the whole job. Not "are my numbers good or bad" against a textbook — against *his own normal*. A resting heart rate of 54 might be perfectly normal for him and alarming for someone else. What matters is whether *his* numbers are slowly moving in a direction that he'd never notice day-to-day because the change is gradual.

Most days, the honest answer is **"you're steady."** And that's not a boring non-answer — for someone recovering from a heart attack, "nothing has changed, you're holding at your normal" is genuinely reassuring and worth saying clearly. Occasionally the answer is **"this one thing has been creeping for a couple of weeks — worth a look."** Rarely, it's **"this dropped below a safe line — flag it."**

So the panel lives in a very specific emotional register: **calm, ambient, trustworthy.** It is the slow-weather report on his body, not a fire alarm.

## What "drift" means, in plain words

Everyone has a personal normal range for each health signal. This panel learns *his* normal for each one from his own recent history — roughly the last four weeks — rather than from population averages. Then it watches for **sustained, gradual moves away from that normal in the direction that would matter clinically.**

The key word is *sustained*. A single high blood-pressure reading after a stressful meeting isn't drift. Seven mornings in a row running noticeably above his usual — that's drift. The panel is deliberately slow and conservative: it would rather stay quiet than cry wolf.

Two reference points feed this:
- A **rolling recent normal** (the last ~4 weeks), which moves with him.
- Eventually, a **frozen "this is me at my healthy baseline" snapshot** that he'll set himself once he's through cardiac rehab and his medications have settled — a fixed "this is the good version of me" to compare against. (He hasn't set this yet; until he does, the panel should gracefully say it's still learning his post-recovery normal.)

## Critically — what this is NOT

**This is not the emergency path.** If he has chest pain, breathlessness, or dizziness, there's a completely separate, prominent red-flag flow elsewhere in the app that tells him to seek care. This panel must never be mistaken for that. It deals in slow patterns over weeks, not acute events in the moment.

**This is not medical advice or a diagnosis.** It's an *interpretable signal* — something thoughtful to notice and bring to his cardiologist (Dr. Jose), never a verdict on cause. The language must always stay associational ("has been running higher," "linked with"), never causal ("caused by," "because of"). It should be honest about uncertainty: when there isn't enough data yet, say so plainly rather than fake a confident read.

## The signals it watches (10)

Resting heart rate · heart-rate variability · systolic blood pressure · diastolic blood pressure · fasting glucose · glucose variability · time-in-range (glucose) · weight · overnight blood-oxygen average · overnight blood-oxygen minimum.

Each one has a "concerning direction" — e.g. blood pressure creeping *up* is the worry; blood oxygen drifting *down* is the worry. For a few signals, a move the good way is a genuine win worth acknowledging. One subtlety: a falling resting heart rate is *not* celebrated for him, because on his heart medications it can mean over-medication rather than fitness — so "good drift" isn't universal.

## The states a signal can be in (rename the jargon — these are the concepts)

- **Steady** — holding at his normal. The common, reassuring case.
- **Worth a look / drifting** — a sustained move in the concerning direction.
- **An improvement** — a sustained move the good way, for signals where that's meaningful.
- **Still settling in** — not enough data yet to know his normal. (Lots of signals will sit here early on — design for this state, don't treat it as an edge case.)
- **No recent data** — the source has gone quiet (e.g. the glucose sensor came off days ago).
- **Below a safe line** — a separate, overriding flag: if heart rate, blood pressure, or oxygen drops below a low safety bound (provisional numbers, being confirmed with his cardiologist), surface that regardless of drift. This takes precedence — a "good improvement" never hides a low-side safety warning.

## What he needs to get in one glance

1. **Am I okay overall, right now?** — answerable in under two seconds without reading every signal.
2. **If not, what one or two things should I actually look at?** — the thing that matters shouldn't be buried in a uniform list of everything.
3. **Reassurance when steady** — "nothing's drifting" should feel like a clear, calm statement, not an absence.
4. **Depth on demand** — the underlying statistics (how far from normal, over what window, how many days, how much data) should be available when he wants to dig in or prep for an appointment, but never crowding the calm default view.

## Tone & voice
Calm, plain, human, honest. Never alarmist; never falsely reassuring. Short sentences. No medical jargon in the default view (no "z-scores," "standard deviations," "MAD"). Associational, never causal. When unsure, say so. Think "a trusted, level-headed friend who happens to understand the data" — not a hospital monitor and not a wellness app cheerleader.

## Visual context
This panel sits inside a larger personal health dashboard with a calm, dark aesthetic. The accent colour is a soft teal; amber and red are used sparingly for attention and concern; purple appears elsewhere for recovery/sleep. It should feel native to that dashboard and, above all, calm. It's currently a full-width panel.

## Must-haves (the hard edges)
- A genuinely glanceable overall read — the "am I okay?" answer, up top, in plain language.
- Clear visual hierarchy by importance: what needs attention is prominent; what's steady is quiet; what's still-settling/no-data doesn't eat the same space as a live signal.
- Plain language by default; statistics available but tucked away.
- Honest about data sufficiency — never imply confidence the data doesn't support.
- A clear separation in feel from the acute/emergency path.
- A calm, reassuring resting state (because most days, nothing is drifting).

## Please don't
- Don't make it feel like an ICU monitor or a stock ticker.
- Don't put raw statistics (z-scores, deviations, counts) in the default view.
- Don't render every signal as an identical row so the one that matters gets lost.
- Don't alarm. Don't use red unless something genuinely crosses a safety line.
- Don't let a "good news" signal visually override a low-side safety warning.
- Don't imply causation or give medical advice.

---

*One sentence to hold onto: most days this should quietly tell a recovering heart patient "you're steady, carry on" — and on the rare day something's drifting, it should calmly point at the one thing worth raising with his cardiologist.*
