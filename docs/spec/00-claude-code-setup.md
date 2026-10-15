# Claude Code Project Configuration

> Part of the VetLink spec. Process rules, commands, guardrails, and the progress tracker are in `/CLAUDE.md`. Section numbers (for example 8.5 or 13) are stable across all spec files; find the file for a section with the map in `/CLAUDE.md` section 0.1 or `docs/spec/README.md`.

Create these files in **Milestone 0**, commit the shared ones, and verify syntax against the current Claude Code docs (rule syntax evolves).


**`.claude/settings.json`** (shared, committed): permissive for safe dev commands, strict on dangerous ones.
```json
{
  "permissions": {
    "allow": [
      "Bash(pnpm:*)",
      "Bash(docker compose up:*)",
      "Bash(docker compose down)",
      "Bash(docker compose logs:*)",
      "Bash(docker compose ps)",
      "Bash(docker compose run --rm migrate)",
      "Bash(git status)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git checkout -b:*)",
      "Bash(curl http://localhost:*)"
    ],
    "deny": [
      "Bash(docker compose down -v:*)",
      "Bash(docker volume rm:*)",
      "Bash(rm -rf:*)",
      "Bash(git push:*)",
      "Bash(git reset --hard:*)",
      "Read(./.env)",
      "Read(./.env.*)"
    ]
  }
}
```
Keep `.claude/settings.local.json` for personal overrides (gitignored).

**`.claude/commands/task.md`**: `/task <what to do>`
```markdown
---
description: Start a planned task using the CLAUDE.md protocol
argument-hint: [milestone number or task description]
---
Task: $ARGUMENTS

Follow CLAUDE.md section 0.2.
1. Read the tracker (0.8) and the spec sections relevant to this task.
2. Explore the existing code. Do not write code yet.
3. Present a plan: files to change, schema/API changes, tests, risks, open questions.
4. Wait for my approval before implementing if the task touches schema, auth, payments, matching, vet verification, or more than ~8 files.
```

**`.claude/commands/verify.md`**: `/verify`
```markdown
---
description: Run the full check and report honestly
---
Run `pnpm check`. Show the real output. If anything fails, diagnose and fix it, then re-run until green. Report what you ran, what passed, and anything you could not verify (devices, webhooks, real M-Pesa).
```

**`.claude/commands/review.md`**: `/review`
```markdown
---
description: Review the current diff against the VetLink spec
---
Review the uncommitted changes and the current branch diff. Check against CLAUDE.md:
- server-side authorization on every route, and ownership checks
- booking state changes only via the transition function
- payment idempotency, no trusting the client for success or price
- no PII, OTPs, or tokens in logs; phone numbers masked
- sw and en strings added together; no hardcoded text
- channel parity impact (USSD, SMS, app, web) and role gating
- migrations forward-only; tests cover retries, duplicates, timeouts, races
Report findings by severity with file and line references. Do not change code unless I ask.
```

**`.claude/commands/update-tracker.md`**: `/update-tracker`
```markdown
---
description: Update the progress tracker and decision log in CLAUDE.md
---
Update CLAUDE.md section 0.8 (tick completed items, note the date and branch) and section 0.10 (log any decisions made this session with the reason). Change nothing else in the file. Show me the diff.
```
