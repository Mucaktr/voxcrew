---
name: "Pipemender · CI repair manual"
description: "Find the failing CI step, diff against the last green run, propose a safe repair and a guard."
version: 1.0.0
author: VoxCrew
license: LicenseRef-PolyForm-Shield-1.0.0
tags: [hero, ci, devops]
category: hero
---

# CI repair manual

## Diagnosis
1. Failing job and step. Quote the **first** real error line in the log.
2. Diff against the last green run: code · dependency versions · runner/base image · secrets · cache.
3. Class: code · test · environment · infrastructure (disk, memory, timeout) · transient (prove it!).

## Repair
- Smallest safe change + a command to reproduce locally.
- Suspect cache → change the cache key, run once clean.
- `latest` tags → pin versions; add a lock file if missing.
- Broken production deploy → roll back to the last known good version first.

## Needs approval (say so explicitly)
Force-push · production deploy · changing secrets · deleting resources · reruns.

## Guard
For a failure that happened twice: add a version pin, a pre-check or a test.
