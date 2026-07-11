<!-- version: 1.0.0 -->
# Profile Provenance Protocol

`profile.md` is read back as ground truth at every session start. A wrong or stale inference written there — a mischaracterized pattern, a relationship read wrong, a belief the client has since moved past — steers future sessions from a picture that no longer fits, quietly, forever. The context library already solved this for the world around the client: a synthesis is a hypothesis with a date on it. This ports that discipline to the client's own standing picture — lightly. The profile is client-readable and stays readable prose; it does not sprout the context library's flag machinery.

Three pieces: date-stamped writes, a session-start review ritual, and a client-initiated command.

## 1. Date-stamped writes

Every profile addition or material revision carries a date. Format: a trailing italic `*(YYYY-MM-DD)*` on the bullet or paragraph — unobtrusive, reads naturally to the client.

> - Keeps circling back to whether he's "doing enough" at work, even after the promotion *(2026-07-11)*

Rules, applied during the session-end profile update:

- **New content** → today's date.
- **Material revision** of existing content → replace its date with today's.
- **Confirmed in a live session** — the client said something that re-validates a standing claim → refresh its date. A refreshed date is a promise that the claim was true as of a live session; **never refresh a date you didn't actually re-confirm** (same discipline the context library's dates carry).
- **Never bulk-refresh.** Untouched content keeps its old date — that staleness *is* the signal the review ritual reads. Refreshing everything at once destroys it.

### What gets dated — and what doesn't

Date **current-state** content: `Current Focus`, `Notes`, and any current-state H2 that emerges (cognitive patterns, parts, body/nervous-system, change talk, and the like). These are claims about how things *are now*, and "now" goes stale.

**`Background` and formative-history sections are exempt — undated by design.** Formative history doesn't go stale the way a current-state read does: who someone was shaped by doesn't expire. Dating it would invite a pointless "is your childhood still true?" review. Leave it clean.

## 2. The review ritual

At session start, after the normal reads, check the profile's **current-state** content for staleness. The trigger — deliberately session-relative, not pure wall-clock, so an infrequent client isn't nagged every third visit:

> Any current-state item dated more than **~90 days** ago, **and** at least **~3 session files in `sessions/` dated after that item** — i.e. the client has actually been in three or more times since the claim was last confirmed and it still went untouched.

(Count from `sessions/` filenames — they are `YYYY-MM-DD.md`.)

**Undated legacy content** has no date to measure from, so treat the ~90-day clause as already satisfied — but the ~3-sessions clause still applies, measured against **total session history**: only offer once the record holds at least ~3 sessions. This is what keeps a brand-new client (or one you've only seen once or twice) from being asked to review notes there's barely been time to form. See *Migration*.

If the trigger is met **and the session opens neutrally**, offer — **once**, at a natural lull, in the seeding-offer's spirit:

> "A few things in my notes about you are from a while back. Want to take five minutes to check they still ring true?"

- **The person outranks the housekeeping.** Never open a heavy or emotionally-loaded session with this. If the client arrives with something pressing, stay with it and let the offer wait for a lull or a later session — the notes can wait, the person can't. This is the same rule the seeding offer carries.
- **If they engage** → walk the stale items conversationally, **one at a time, as questions not assertions**: "I've got that you're focused on X — is that still where it's at?" Update, delete, or leave per their answer; refresh the date on whatever they confirm. Hold each item as a hypothesis you're offering back for confirmation, never as a fact you're reporting.
- **If they decline** → write a dated marker into `profile.md` — an HTML comment, `<!-- profile review offered and declined: YYYY-MM-DD -->` — and don't re-offer for **~30 days**. Same *kind* of anti-nag marker as the seeding decline, but time-boxed rather than permanent: a profile goes stale again over time, so the offer should be able to return after a while, where seeding is a one-time event that never re-fires. They can still ask for the walk-through any time (see §3).

## 3. The command

`.therapy/commands.md` carries **"review my profile"** — the client-initiated version of the same walk-through, available any time regardless of the staleness trigger. It is also the on-demand migration path: each review naturally backfills dates as items get confirmed.

## Migration — legacy undated profiles

Existing profiles are entirely undated. **Do not fabricate dates.** An invented date is a false provenance claim — worse than none, because it launders a stale inference as freshly confirmed. This is the same content-integrity rule the whole framework runs on.

Undated current-state content is treated as **"stale, provenance unknown"** — exactly what the first review ritual is for. It satisfies the staleness (~90-day) clause of the trigger; the ~3-sessions gate still applies (measured against total session history — see §2), so the review only surfaces once there's a real record behind it. After one or two reviews, the profile converges to fully dated through confirmation alone, with nothing fabricated along the way.
