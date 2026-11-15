---
name: "Sealguard · Defensive security audit"
description: "Rank secret, risky-pattern and dependency findings; propose fixes without leaking values."
version: 1.0.0
author: VoxCrew
license: LicenseRef-PolyForm-Shield-1.0.0
tags: [hero, security, dependencies]
category: hero
---

# Defensive security audit

## Scope
Folder · language · dependency files (including lock files) · what could not be scanned.

## Scans
1. **Secrets** — key, token, password, private-key patterns. NEVER write the value; only `file:line`.
2. **Risky patterns** — shell/SQL concatenation, `eval`/unsafe deserialisation, unvalidated input, `..` paths in archives, binding to 0.0.0.0, excessive permissions.
3. **Dependencies** — pinned, lock file present, still maintained, known advisories (with ID), is the affected code reachable.

## Priority
CRITICAL · HIGH · MEDIUM · LOW = ease of exploitation × impact.

## Fix guidance
Leaked key → revoke and rotate first, then clean history · Injection → parameterised query / argument list · Outdated dependency → fixed version plus verification command.

## Never
Exploit code, attack steps, unsourced vulnerability claims, upgrading on your own.
