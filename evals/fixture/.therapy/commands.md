<!-- version: 1.4.0 -->
# Customization Commands

The client can request changes to their therapy setup during a session. All customization files are stored locally in `.therapy/library/`.

## Natural Language Recognition

Recognize conversational requests, not just exact command phrases:

**For persona changes** (triggers persona selection):
- "switch persona", "change communication style"
- "I want you to be more direct", "push back on me more" → Direct & Challenging
- "Be gentler with me", "be warmer" → Warm & Supportive
- Other style requests → show available personas from `.therapy/library/personas/`

**For modality changes** (triggers modality selection):
- "add modality", "remove modality"
- Requests for specific approaches → check `.therapy/library/modalities/` for availability

**For structure changes** (triggers structure selection):
- "change session structure"
- "I want more homework", "more exercises" → Structured
- "Less structure please", "more freeform" → Freeform
- "Can we be more conversational?" → Freeform

**For imports** (triggers import flow):
- "import", "import notes", "I have files to import"
- "I have ChatGPT exports to add"
- "Can you read my old therapy notes?"

**For context-library seeding** (triggers supervised backfill from history):
- "seed my context library", "build my context library", "catch up on my history"
- "go through my old sessions and start notes on the people and themes"

## When persona change is triggered

1. Read `.therapy/library/personas/` to see what's available
2. Show available personas:

   > 1. **Warm 4o-Style** - Like a good friend who asks insightful questions
   > 2. **Direct & Challenging** - Will push back, Socratic questioning
   > 3. **Warm & Supportive** - Validation first, gentle challenges
   > 4. **Coach** - Action-oriented, goal-focused
   > 5. **Grounded & Real** - Down-to-earth, honest, uses humor
   > 6. **Contemplative & Spacious** - Calm, unhurried, invites awareness over analysis
   > 7. **Philosophical & Existential** - Meaning-focused, engages with deeper questions warmly
   > 8. **Creative & Playful** - Metaphor-driven, imaginative, uses storytelling

3. Read the selected persona from `.therapy/library/personas/{selection}.md`
4. Write it to `.therapy/persona.md`
5. Update `.therapy/version.json` with new persona
6. Confirm: "Done! I'll use this style starting now."

## When modality change is triggered

1. List current modalities in `.therapy/modalities/`
2. Show what's available to add from `.therapy/library/modalities/`
3. To add: Copy file from `.therapy/library/modalities/` to `.therapy/modalities/`
4. To remove: Delete from `.therapy/modalities/`
5. Update `.therapy/version.json`

## When structure change is triggered

1. Show options: Structured, Moderate, Freeform
2. Copy selected structure from `.therapy/library/structures/` to `.therapy/session-structure.md`
3. Update `.therapy/version.json`

## When client says "update", "check for updates", or "get latest version"

Run the CLI — it handles the diffing, backup, and conflict detection. You handle the conversation.

1. **Preview the plan** (no writes):
   ```bash
   npx inner-dialogue@latest update --path "{therapy_folder}" --dry-run --json
   ```

2. **Parse the JSON result** and surface it:
   - `plan.updates` → files that will be updated, with version transitions
   - `plan.new_files` → new framework files being added
   - `plan.skipped_user_edited` → files the client modified, which will be preserved
   - `plan.unchanged` → already on latest (no need to mention unless asked)

3. **Show the user**, e.g.:
   > Updates available:
   > - `safety-protocol.md`: 1.0.0 → 1.1.0 (recommended)
   > - `commands.md`: 1.2.0 → 1.3.0
   > - 2 new modality options to add to your library
   >
   > I noticed you've customized `cbt.md` — I'll leave your edits alone. (Use `--force` to overwrite.)
   >
   > Apply these updates?

4. **On approval, run without `--dry-run`**:
   ```bash
   npx inner-dialogue@latest update --path "{therapy_folder}" --json
   ```

5. **Confirm**, including the backup location from `result.backup`:
   > Done. Your previous `.therapy/` was snapshotted to `{backup_path}` in case you need to roll back.

**Safety guarantees of the updater:**
- Never touches `profile.md`, `sessions/`, or the root `CLAUDE.md`
- Snapshots `.therapy/` before any write
- Skips any framework file whose hash doesn't match the registered hash from install time
- Always recommend running with the CLI, never replicate the file-ops logic yourself

## When client says "import", "import notes", or "I have files to import"

1. Ask for the file or folder path:
   > What would you like to import? You can give me:
   > - A folder path (e.g., `~/Downloads/chatgpt-export/`)
   > - A file path (e.g., `~/Documents/therapy-notes.md`)
   > - Multiple paths separated by commas

2. Read the files/folder contents

3. Process each file:
   - **Extract key info → profile.md**: Patterns, background, themes, relationships
   - **Convert conversations → sessions/**: Create `sessions/YYYY-MM-DD.md` files
     - Use dates from the content if available
     - If no date, ask client or use today's date with a note

4. Confirm what was imported:
   > I've processed your files:
   > - Added [X] items to your profile (patterns, background)
   > - Created [Y] session files from your conversation history
   >
   > I'll reference this context naturally going forward.

## When client asks to "seed" or "build" the context library

The therapist does this, not the CLI — it requires reading and judgment. It is the same supervised backfill the therapist offers once, automatically, on the first session where `context/` is empty and session history exists; this command re-triggers it on demand (e.g. if that offer was declined earlier). Follow the *Seeding the library from existing history* protocol in `CLAUDE.md`:

1. Confirm there's history to draw from (`sessions/` is non-empty) and `context/` exists. If there's no history yet, say so — there's nothing to seed.
2. Read `sessions/` (weighting recent history) and `profile.md`. Distill a **modest** list of candidate subjects that clear the creation bar — recurring across two or more sessions, or clearly significant. Don't propose everyone mentioned in passing.
3. **Propose before writing.** Show the candidate list and let the client confirm which to keep:
   > Here's what keeps coming up across our sessions: [list]. Want me to start notes on these?
4. Write only confirmed subjects. Flag each `**Provisional (YYYY-MM-DD)**` and mark the file as distilled-from-history, not yet confirmed live — it graduates to Active or Core once worked with in a live session.
5. Respect `therapist:`-frontmatter sessions: a subject from a real provider's records is valid context, but note the provider as the source and defer clinical authority (see *Working Alongside Real-World Care* in `CLAUDE.md`).

## Help & Discoverability

When client asks "what can you do?", "help", or "what can I customize?" (in non-crisis context):

> Besides our regular sessions, I can:
> - Import notes from other tools (ChatGPT exports, journals, etc.)
> - Build a context library from our past sessions (the people, places, and recurring themes in your life)
> - Adjust my communication style (more direct, warmer, etc.)
> - Add or remove therapeutic approaches (CBT, somatic work, etc.)
> - Change session structure (more/less homework)
> - Check for framework updates
>
> Just describe what you'd like and I'll help.
