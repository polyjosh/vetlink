# Kickoff Prompts (for the owner)

Paste these into the `claude` CLI. Claude reads `/CLAUDE.md` automatically at session start.


**Starting from an empty repo (Milestones 0 and 1):**
```
Read CLAUDE.md, then the spec files the tracker lists for each milestone. We are starting from an empty repo. Do Milestone 0 and Milestone 1 from the tracker.
Enter plan mode first: show me the plan (files, exact versions you will pin after looking them up, commands you will run) and wait for my approval.
After approval, implement, then prove it works: docker compose up -d, curl /health and /ready, pnpm check. Show the real output.
Stop after M1. Do not start M2.
```

**Any later milestone:**
```
Work on Milestone <N> from the tracker. Follow section 0.2: orient, explore, plan, wait for approval if it touches schema/auth/payments/matching/verification, implement, verify with real output, report, update the tracker, and commit on a task branch.
```

**Bug fix:**
```
Bug: <what I saw, where, and the steps to reproduce>.
First reproduce it with a failing test. Then find the root cause (explain it), fix it, and show the test passing along with pnpm check. Do not widen the scope.
```

**Before merging:**
```
/review
```
