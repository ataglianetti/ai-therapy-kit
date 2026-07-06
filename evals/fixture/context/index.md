<!-- version: 1.0.0 -->
# Context Index

*This file routes to the subject-level context library. The therapist's protocol for reading, trusting, creating, and updating these files is defined in `CLAUDE.md`.*

---

## Entry format

```
- **Subject Name** (`subfolder/slug.md`) — short synthesis. **Active (YYYY-MM-DD)**
```

- The subject name and the relative path to the subject file are required.
- The synthesis is one line. Anything longer lives in the subject file itself.
- **Flags are markers**, written in bold at the end of the line. The format permits multiple flag names — `**Active (YYYY-MM-DD)**`, `**Core**`, `**Provisional (YYYY-MM-DD)**`, or others. Their semantics — what each flag means, when entries gain or lose a flag, how flagged entries should be handled at session start — are defined in `CLAUDE.md`. The date in `**Active (YYYY-MM-DD)**` and `**Provisional (YYYY-MM-DD)**` is a stable marker of when the flag was last refreshed or distilled; entries without a flag are inactive by default.

---

## People

*Recurring people in the client's life: partners, family, friends, ex-partners, colleagues, clinicians.*

<!-- Example (delete when you add real entries):
- **Example Friend** (`people/example-friend.md`) — close friend; recent move abroad. **Active (YYYY-MM-DD)**
-->

---

## Places

*Specific locations carrying significance: a home, a workplace, a city, a clinical setting, a meaningful venue.*

<!-- Example (delete when you add real entries):
- **The Home Office** (`places/home-office.md`) — workspace; site of work-life boundary tension. **Active (YYYY-MM-DD)**
-->

---

## Concepts

*Recurring patterns, core beliefs, formative memories, or therapeutic threads that surface across sessions.*

<!-- Example (delete when you add real entries):
- **The Perfectionism Pattern** (`concepts/perfectionism-pattern.md`) — "I need to do it perfectly or not at all"; surfaced in three sessions. **Core**
-->

---

## Events

*Time-specific occurrences with a date: appointments, meetings, difficult conversations, deadlines, social events. Files in `events/` use `YYYY-MM-DD-slug.md` so dates are visible at a glance.*

<!-- Example (delete when you add real entries):
- **Example Appointment (YYYY-MM-DD)** (`events/2026-01-15-example.md`) — YYYY-MM-DD at 14:00 local. **Active (YYYY-MM-DD)**
-->

---

## Subject file format

No rigid template. A subject file is whatever would help understand that subject next session — typically some mix of: who/what they are, history, current status, open threads, patterns observed, sensitivities, dates of significant developments.
