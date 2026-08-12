# Getting Started

This guide walks you through setting up your AI therapist from scratch. No technical experience needed.

---

## Step 1: Get Claude Code

Claude Code is what lets your AI therapist read your profile, remember past sessions, and save notes. You need it before you can set up your therapist.

### Option A: Claude Pro ($20/month, simplest)

1. Go to [claude.ai](https://claude.ai) and sign up for Claude Pro
2. Download Claude Code from [claude.ai/code](https://claude.ai/code)
3. Run the installer
4. Open **Terminal** (Mac) or **PowerShell** (Windows)
5. Type `claude` and press Enter
6. Sign in with your Claude account when prompted

Done! Move to Step 2.

### Option B: Pay-per-use (no subscription)

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an account and add a payment method
3. Click **API Keys** → **Create new key**
4. Copy the key (it starts with `sk-ant-`)
5. Download Claude Code from [claude.ai/code](https://claude.ai/code)
6. Run the installer
7. Open **Terminal** (Mac) or **PowerShell** (Windows)
8. Type `claude` and paste your API key when prompted

Typical cost: $5-20/month depending on how often you chat.

---

## Step 2: Run Setup

You have two ways to install. Pick whichever feels right.

### Conversational setup (recommended)

Open Terminal (Mac) or PowerShell (Windows) and clone the repo:

```
git clone https://github.com/ataglianetti/inner-dialogue.git
cd inner-dialogue
claude
```

**Don't have git?** Go to the [GitHub page](https://github.com/ataglianetti/inner-dialogue), click the green "Code" button, choose "Download ZIP", and extract it somewhere you'll remember. Then `cd` into that folder and run `claude`.

Claude walks you through setup by asking a few questions:

1. **Therapist name** — What to call your AI therapist (e.g., Sage, Willow, Quinn)
2. **Communication style** — Choose from 8 styles (Warm, Direct, Coach, and more)
3. **Therapeutic approaches** — Choose from 13 evidence-based approaches (CBT, ACT, DBT Skills, IFS, and more)
4. **Storage location** — Where to save your session files
5. **Import history** (optional) — Bring in notes from ChatGPT or other tools

### Direct CLI setup (for power users)

Skip the conversational flow and install directly from npm:

```
npx inner-dialogue install \
  --name Sage --path ~/Sage \
  --persona warm-4o --structure moderate \
  --modalities cbt,ifs
```

Available `--persona` values: `warm-4o`, `direct-challenging`, `warm-supportive`, `coach`, `grounded-real`, `contemplative`, `philosophical`, `creative`.

Available `--structure` values: `structured`, `moderate`, `freeform`.

Available `--modalities` values (comma-separated): `cbt`, `act`, `cft`, `dbt-skills`, `emdr`, `ifs`, `lifespan-integration`, `motivational-interviewing`, `narrative`, `polyvagal`, `psychodynamic`, `sfbt`, `somatic-experiencing`, `ideal-parent-figure`.

Running `npx inner-dialogue install` without flags drops into an interactive prompt with the same options.

### Importing Existing Notes

If you've been using ChatGPT or other tools for therapy-like conversations, you can import that history.

#### Supported Formats

- **ChatGPT exports** — ZIP file from Settings → Data Controls → Export
- **Markdown files** — Any `.md` files (journal entries, notes, previous AI conversations)
- **Text files** — Plain `.txt` files
- **PDF files** — Will be read and processed

#### During Setup

1. When asked about importing, say yes
2. Provide the file path(s) to your export files
3. Your therapist processes the files during your first session

#### What Happens to Imported Files

Your therapist does two things with imported content:

1. **Builds your profile** — Key patterns, background, recurring themes, and important context get extracted into `profile.md`. This is read every session.

2. **Creates session history** — Conversations are converted to session files (`sessions/YYYY-MM-DD.md`) with their original dates. These become part of your session history.

#### How It Works Over Time

- Your profile (patterns, background) is always referenced
- Recent sessions are read at startup for continuity
- Older imported sessions naturally fade as new sessions accumulate
- Nothing is deleted—older context can still be referenced when relevant

This mirrors how memory works: core patterns stay present, recent details are fresh, older specifics are available but not top-of-mind.

#### Adding Context Later

After setup, you can still add to your history:
- Add notes directly to `profile.md` for persistent context
- Drop new files in `sessions/` with appropriate dates
- Tell your therapist "I want to add some background" and share it in conversation

---

## Step 3: Start a Session

At the end of setup, Claude will ask if you want to start your first session. Say yes!

### Future Sessions

**Easiest way:** Open the Claude AI app (Pro plan), navigate to your therapy folder, and start a session.

**Or use Terminal:**
```
cd ~/Sage && claude
```
(Replace `Sage` with your therapist's name/folder)

### During a Session

Just talk naturally. Say hello, share what's on your mind. Your AI therapist will:
- Welcome you or pick up where you left off
- Remember everything from previous sessions
- Save notes when you're done

To end a session, say goodbye or just close the window.

---

## Viewing Your Notes

Your sessions are saved as regular text files. You can open them with any text editor (TextEdit, Notepad, etc.).

For a nicer reading experience, try [Obsidian](https://obsidian.md) (free):
1. Download Obsidian
2. Open your therapy folder as a "vault"
3. Browse sessions, search across notes, see connections between topics

---

## Troubleshooting

**"command not found: claude"**
Make sure you installed Claude Code and restarted your terminal.

**Claude doesn't seem like a therapist**
Make sure you're in your therapy folder before running `claude`. Check that `CLAUDE.md` exists in that folder.

**Setup didn't start automatically**
Make sure you're in the `inner-dialogue` folder (not your therapy folder) when first running `claude`.

---

## Updating Your Therapist

Inner Dialogue periodically receives updates — improved safety protocols, refined therapeutic techniques, bug fixes. Here's how to get them:

### Check for Updates

You have two ways. Either works.

**During a session:** Say "update my therapist" or "check for updates." Your therapist runs the updater for you, surfaces what will change, and asks for approval.

**Direct from terminal:**

```
npx inner-dialogue update --path ~/Sage
```

(Replace `~/Sage` with the path to your therapy folder.) Add `--dry-run` to preview without writing.

### What the Updater Does

- Pulls the latest framework files from the npm package
- Compares them against the SHA-256 hashes recorded at install time
- Updates files that match their installed hash (safe to overwrite)
- **Skips files you've customized** and tells you which ones — your edits are preserved
- Snapshots `.therapy/` to `.therapy.bak-<timestamp>/` before any write, so any update is reversible

### What Gets Updated

| Component | Updated? | Notes |
|-----------|----------|-------|
| Safety protocols | Yes (recommended) | Crisis resources, safety guidelines |
| Modality library | Yes | New techniques and refinements |
| Session structures | Yes | Session flow improvements |
| Your `profile.md` | **Never** | Your personal data is untouched |
| Your `sessions/` | **Never** | Your session history is untouched |
| Your `CLAUDE.md` | **Never** | Your therapist's persona stays the same |
| Files you customized | Skipped with a warning | Use `--force` to overwrite (backup runs first regardless) |

### Validating Your Folder

If something seems off:

```
npx inner-dialogue doctor --path ~/Sage
```

Checks that `profile.md` still has the expected sections, `version.json` is valid, and all framework files are present.

### Safety Protocol Updates

**Always accept safety protocol updates.** These contain crisis resources and guidelines that should never be stale.

---

## Migrating from an Older Version

If you set up your therapist before version 2.2.0, see [MIGRATING.md](../MIGRATING.md) for the one-time migration to the hash-aware updater. The short version:

```bash
npx inner-dialogue@latest update --path ~/YourFolder --force --dry-run   # preview
npx inner-dialogue@latest update --path ~/YourFolder --force             # apply
```

Your profile and sessions are never touched. The migration only refreshes framework files and generates a fresh hash registry so future `update` runs work normally.

If your folder predates v1.0.0 (no `.therapy/` subdirectory at all), MIGRATING.md covers that case too.

---

## Customizing After Setup

You can change your therapist's configuration anytime—just ask during a session. Your therapist knows where to find the source files.

### Switch Communication Style

Say: **"switch persona"**

Choose from 8 styles including Warm 4o-Style, Direct & Challenging, Warm & Supportive, Coach, Grounded & Real, Contemplative & Spacious, Philosophical & Existential, and Creative & Playful.

This changes how your therapist communicates without affecting their memory of you.

### Add or Remove Therapeutic Approaches

Say: **"add modality"** or **"remove modality"**

Choose from 14 evidence-based approaches: CBT, ACT, CFT, DBT Skills, EMDR, IFS, Lifespan Integration, Motivational Interviewing, Narrative Therapy, Polyvagal-Informed Work, Psychodynamic, SFBT, Somatic Experiencing, and Ideal Parent Figure.

### Change Session Structure

Say: **"change session structure"**

Switch between Structured, Moderate, or Freeform session styles.

### Self-Contained After Setup

After setup completes, your therapist folder is fully self-contained. You can safely delete the inner-dialogue repo if you cloned it — all customization options are stored in your therapist's `.therapy/library/` folder, and updates come from the npm package via `npx inner-dialogue update`.

---

## More Questions?

See the [FAQ in the README](../README.md#faq) for common questions about cost, privacy, and customization.
