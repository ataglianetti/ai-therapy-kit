# Inner Dialogue

A private, persistent AI therapist that lives on your computer.

Your sessions stay local. Your AI remembers everything. Works with Claude, GPT, or any AI.

**[Get Started](docs/GETTING-STARTED.md)** | **[Changelog](CHANGELOG.md)**

---

## Why This Exists

If you've used ChatGPT or Claude for emotional support, you've probably hit these problems:

- **Sessions disappear.** Start a new chat, lose all context.
- **Privacy concerns.** Your deepest thoughts on someone else's servers.
- **Platform lock-in.** Build a relationship with one AI, then it changes or goes away.
- **Inconsistent quality.** Sometimes helpful, sometimes generic.

This toolkit solves all of them.

---

## What You Get

**Your AI remembers** — Sessions and insights accumulate in files on your computer. Your AI therapist remembers everything, forever.

**Real privacy** — All files stay on your machine. Optional password protection for shared computers.

**Portable** — Works with Claude, ChatGPT, or any AI that can read files. Switch anytime without losing your history.

**Evidence-based** — Built-in therapeutic approaches (CBT, ACT, DBT, and more). Real frameworks, not just conversation.

**Customizable** — Choose your therapist's name and communication style. Make it yours.

---

## Get Started

Setup takes about 10 minutes. You need a Mac or Windows computer and [Claude Code](https://claude.ai/code) (included with Claude Pro, or pay-per-use via the Anthropic API).

### Install

**Conversational** (recommended for most people):

```bash
git clone https://github.com/ataglianetti/inner-dialogue.git
cd inner-dialogue
claude
```

Claude walks you through setup, gathers your preferences, and installs the framework.

**Direct CLI** (for power users / scripting):

```bash
npx inner-dialogue install \
  --name Sage --path ~/Sage \
  --persona warm-4o --structure moderate \
  --modalities cbt,ifs
```

Run `npx inner-dialogue install` without flags for an interactive prompt.

### Start a session

Open the Claude AI app (Pro plan) and navigate to your therapy folder, or from terminal: `cd ~/Sage && claude`.

### Update without losing your data

```bash
npx inner-dialogue update --path ~/Sage
```

The updater hashes every framework file at install time. If you've customized one, it's skipped and your edits are preserved. Each run snapshots `.therapy/` to `.therapy.bak-<timestamp>/` before any write. Your `profile.md`, `sessions/`, and root `CLAUDE.md` are never touched.

Add `--dry-run` to preview without writing. Add `--force` to overwrite files you've customized (backup runs first regardless).

You can also say "update my therapist" during a session — Claude runs the updater for you and surfaces what will change.

### Validate your folder

```bash
npx inner-dialogue doctor --path ~/Sage
```

Checks `profile.md` structure, version registry, and framework files. Useful if something seems off.

**Full step-by-step guide:** [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)

**Existing user from before 2.2.0?** See [MIGRATING.md](MIGRATING.md) for the one-time migration to the hash-aware updater.

---

## Features

### Communication Styles

During setup, you choose how your AI therapist communicates:

| Style | Description |
|-------|-------------|
| **Warm 4o-Style** | Like a good friend who asks insightful questions |
| **Direct & Challenging** | Will push back, asks probing questions |
| **Warm & Supportive** | Gentle, validating, and nurturing |
| **Coach** | Action-oriented, goal-focused, accountability |
| **Grounded & Real** | Down-to-earth, honest, uses humor |
| **Contemplative & Spacious** | Calm, unhurried, invites awareness over analysis |
| **Philosophical & Existential** | Meaning-focused, engages with deeper questions warmly |
| **Creative & Playful** | Metaphor-driven, imaginative, uses storytelling |

### Therapeutic Approaches

Your AI therapist uses evidence-based approaches — choose any combination during setup:

| Approach | Description |
|----------|-------------|
| **CBT** | Identify and challenge unhelpful thought patterns |
| **ACT** | Values-based action, mindful acceptance |
| **CFT** | Self-compassion, shame work, emotion system rebalancing |
| **DBT Skills** | Emotional regulation, distress tolerance |
| **IFS** | Parts work, Self-leadership, internal system mapping |
| **Lifespan Integration** | Body-based trauma integration |
| **Motivational Interviewing** | Ambivalence exploration, change talk, autonomy |
| **Narrative Therapy** | Externalization, re-authoring, preferred stories |
| **Polyvagal-Informed Work** | Nervous system states, safety, vagal toning |
| **Psychodynamic** | Understanding patterns from the past |
| **SFBT** | Solution-focused, strengths-based, future-oriented |
| **Somatic Experiencing** | Nervous system awareness and regulation |
| **Ideal Parent Figure (IPF)** | Attachment repair, earned security, corrective parental imagery |

### How Sessions Work

Your AI therapist:
- Remembers everything from previous sessions
- Takes notes at the end of each conversation
- Updates your profile as new insights emerge
- Follows up on anything you committed to try

**Profile structure grows with you.** New profiles start with a minimal seed (`Background`, `Current Focus`, `Notes`). Your therapist adds and reorganizes sections as themes emerge across sessions, and organizes structure around your active modalities — IFS work surfaces a `Parts` section, somatic work surfaces `Body & Nervous System`, narrative work surfaces `Preferred Stories`, and so on. The profile reflects the actual shape of the work, not an arbitrary a priori taxonomy.

**Notes about your current life carry a date.** Entries about what you're working on now get a small `(YYYY-MM-DD)` stamp marking when they were last confirmed — so a read that's drifted out of date can be checked with you rather than assumed still true. When something has sat unconfirmed for a while, your therapist may offer, once and at a natural moment, to walk through the stale items and see what still fits (you can also just ask: "review my profile"). Background and history stay undated — they don't go stale the way current-state notes do. Nothing here is ever backfilled with a made-up date; a date means it was actually confirmed with you.

### Your Files

Everything is stored as simple text files you can read anytime:

```
your-therapist-folder/
├── CLAUDE.md           # Your therapist's personality
├── profile.md          # Your ongoing profile
├── sessions/           # Session notes (YYYY-MM-DD.md)
│   └── ...
└── .therapy/           # Framework components (auto-updated)
    ├── version.json
    ├── safety-protocol.md
    ├── commands.md         # Customization commands
    ├── persona.md
    ├── session-structure.md
    ├── modalities/         # Your active modalities
    │   ├── cbt.md
    │   └── ...
    └── library/            # All available options
        ├── personas/
        ├── modalities/
        └── structures/
```

The `.therapy/` folder contains the therapeutic framework—safety protocols, modalities, and session structure. These can be updated independently without touching your personal data.

No special software needed to view your own notes.

### Importing Existing History

You can bring in notes from ChatGPT, journals, or other AI conversations during setup. Your therapist extracts key patterns into your profile and converts conversations into session history.

For details, see [Importing Existing Notes](docs/GETTING-STARTED.md#importing-existing-notes) in the Getting Started guide.

---

## Safety & Limitations

**This tool is for self-reflection and emotional support. It is not a replacement for professional mental health care.**

Your AI therapist:
- Cannot diagnose mental health conditions
- Cannot prescribe or advise on medication
- Will connect you to crisis resources if needed
- Will recommend professional help when appropriate

**If you're in crisis:**
- **988** — Suicide & Crisis Lifeline (call or text, US)
- **741741** — Crisis Text Line (text HOME)
- **911** — Immediate emergencies
- **[findahelpline.com](https://findahelpline.com)** — International

### Mechanical safety layer

Every install includes a small script that checks each message you send for explicit first-person crisis language — phrases like "I want to die." On a match, it quietly attaches the emergency resources above, plus a reminder to your AI therapist to follow the crisis protocol, to that message. Because it runs on every message, it works even deep into a long session, when instructions from the start of the conversation may no longer be in front of the AI.

Honest framing of what it is and isn't:

- **It's a keyword pattern-matcher, not crisis detection.** It can't understand context or assess how you're actually doing. That judgment stays with the AI, guided by the written safety protocol — which remains the primary safety layer. This script is a backstop.
- **It's scoped toward first-person language.** Talking about someone else ("my brother has been struggling"), processing grief, or discussing something from a book or the news is filtered out — though no keyword filter is perfect. That scoping is deliberate.
- **English only, for now.** Crisis language in other languages won't trigger it. The written safety protocol still applies regardless of language.
- **It fails open.** If the script ever hits an error, your session continues normally. A broken safety net never interrupts a conversation.

The `doctor` command checks that the script is present, unmodified, and registered. You're free to edit it, but we recommend you don't — the safety net is there for a reason. The hook requires Claude Code 2.1.139 or newer; `doctor` warns if your installed version is older.

---

## Privacy

**Your files stay on your computer.** Session notes, your profile, and therapeutic framework components are never uploaded anywhere by this toolkit.

**Your conversations do pass through AI servers.** When you chat, your messages are sent to whichever AI provider you're using (Anthropic, OpenAI, Google, etc.) for processing. This is how all AI tools work, including ChatGPT and Claude.ai.

The difference is what happens after:

| Platform | Data Retention | Used for Training? |
|----------|---------------|-------------------|
| **Claude Code (API key)** | 7 days, then deleted | No |
| **Claude Code (Pro/Max plan)** | 30 days (up to 5 years if you opt into training) | Only if you opt in |
| **Claude.ai** | 30 days (up to 5 years if you opt into training) | Only if you opt in |
| **ChatGPT** | Indefinitely unless you delete | Only if you opt in |
| **Local models** | Never leaves your machine | No |

API access (what Claude Code and similar tools use) is meaningfully more private than consumer chat apps. Your conversations aren't stored long-term and aren't used to train models.

For full details, see [Anthropic's privacy policy](https://privacy.claude.com/en/articles/10023548-how-long-do-you-store-my-data) and [OpenAI's data retention policy](https://help.openai.com/en/articles/8983778-chat-and-file-retention-policies-in-chatgpt).

**Want even more privacy?** See [SECURITY.md](SECURITY.md) for:
- Password-protected folders
- Running a fully local AI (nothing leaves your computer at all)

---

## Known Limitations

### AI Safety Filters

All major AIs (Claude, ChatGPT) have built-in safety filters that can affect therapy conversations:

**Topics where the AI may seem hesitant:**
- Sexual trauma and assault
- Abuse (especially detailed descriptions)
- Self-harm specifics
- Violent experiences

**What this looks like:**
- Generic responses instead of engaging deeply
- Redirecting the conversation
- Extra disclaimers or suggestions to seek professional help

**This is not the AI judging you.** It's hitting automatic filters it can't control.

**What helps:**
- Focus on feelings and impact rather than graphic details
- Rephrase: "I want to process how this affected me emotionally"
- Know that some trauma processing needs a human therapist who can hold space for the full story

---

## FAQ

**Can I use ChatGPT instead of Claude?**
Yes. Copy the contents of your CLAUDE.md file into ChatGPT's Custom Instructions or create a GPT with it. You won't get automatic session saving, but the therapeutic framework works the same.

**What if I'm already seeing a therapist?**
This tool works well as a supplement between sessions. Consider mentioning it to your therapist.

**Can I customize my AI therapist?**
Yes. You can edit the CLAUDE.md file directly to adjust the approach, style, or focus areas.

**How do I get updates?**
Just say "update my therapist" or "check for updates" during a session — under the hood your therapist runs `npx inner-dialogue update`, which hash-diffs framework files against the latest release, snapshots your `.therapy/` folder before any write, and skips any file you've customized. Your `profile.md`, `sessions/`, and root `CLAUDE.md` are never touched. You can also run the updater directly: `npx inner-dialogue update --path ~/your-therapist`.

**What if I need more than self-reflection?**
This is designed for everyday emotional support. For severe symptoms, trauma, or crisis situations, please work with a professional. Your AI therapist will also suggest this when appropriate.

---

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

Areas of interest:
- Additional modalities (with clinical grounding)
- Improved crisis detection
- Local LLM integration guides
- Translations

---

## License

MIT License. See [LICENSE](LICENSE).

## Support

This is a free, open-source project. If you find it helpful, consider supporting continued development:

- [Buy me a coffee](https://buymeacoffee.com/ataglianetti)
- [Sponsor on GitHub](https://github.com/sponsors/ataglianetti)

---

## Acknowledgments

Built with inspiration from the [r/therapyGPT](https://reddit.com/r/therapyGPT) community and their creative workarounds for AI therapy persistence.

This project incorporates principles from evidence-based therapeutic approaches including Cognitive Behavioral Therapy, Acceptance and Commitment Therapy, and Dialectical Behavior Therapy.

---

*Take care of yourself.* 💚
