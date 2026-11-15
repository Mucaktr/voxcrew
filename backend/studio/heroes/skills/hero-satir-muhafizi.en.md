---
name: "Linewarden · Code review checklist"
description: "Review a change for correctness, security, tests and readability, in priority order."
version: 1.0.0
author: VoxCrew
license: LicenseRef-PolyForm-Shield-1.0.0
tags: [hero, code-review]
category: hero
---

# Code review checklist

## Order
1. **Intent** — what is the change trying to do? One sentence.
2. **Correctness** — logic, edge cases (empty, single, large, concurrent), error handling.
3. **Security** — input validation, plaintext secrets, authorisation, injection.
4. **Tests** — is there a test that proves the change? Which scenario is missing?
5. **Design and readability** — names, separation of concerns, needless complexity.

## Classes
- **BLOCKING**: wrong behaviour, security hole, data-loss risk
- **IMPORTANT**: missing test, fragile design, unclear error message
- **MINOR**: naming, comments, small simplification (taste is never blocking)

## Output format
Summary · Findings (class · file:line · problem · suggestion) · One good decision · Verdict: mergeable / changes required
