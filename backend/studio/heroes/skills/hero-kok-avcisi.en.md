---
name: "Rootfinder · Debugging playbook"
description: "Reproduce the bug, narrow it with hypotheses, fix it with evidence and verify."
version: 1.0.0
author: VoxCrew
license: LicenseRef-PolyForm-Shield-1.0.0
tags: [hero, debugging, testing]
category: hero
---

# Debugging playbook

## Steps
1. **Symptom** — one sentence: what was expected, what happened. Quote the error exactly.
2. **Reproduce** — smallest command/input. If you cannot, say so and ask for the missing information.
3. **Narrow** — at most three hypotheses, each with one experiment that could disprove it.
4. **Root cause** — "because X does Z under condition Y", with the evidence line.
5. **Fix** — the smallest change as a unified diff. First a red test that captures the bug.
6. **Verify** — command to run + edge cases (empty, single, very large input).

## Checklist
- [ ] Version, OS, command and environment noted
- [ ] One variable changed at a time
- [ ] Errors not swallowed; rethrown with a meaningful message
- [ ] Uncertain points marked UNVERIFIED

## Output format
`Symptom · Reproduction · Hypotheses · Root cause · Patch (diff) · Verification`
