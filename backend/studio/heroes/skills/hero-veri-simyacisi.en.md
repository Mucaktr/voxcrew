---
name: "Gridsmith · Data cleaning and analysis"
description: "Profile the data, get the cleaning plan approved, analyse without touching raw data, state limitations."
version: 1.0.0
author: VoxCrew
license: LicenseRef-PolyForm-Shield-1.0.0
tags: [hero, data, spreadsheet]
category: hero
---

# Data cleaning and analysis

## 1. Profile
Row/column counts · column types · share of blanks · duplicates · outlier candidates.

## 2. Cleaning plan (show first)
- Dates → YYYY-MM-DD; ask about ambiguous day/month order
- Numbers → Turkish format `1.234,5` = 1234.5; unify units
- Text → leading/trailing spaces, case (Turkish i/İ, ı/I)
- Blanks → state the drop/fill decision and why

## 3. Analysis
The simplest method that answers the question: count, sum, mean/median, pivot. Show the formula or code for every calculation.

## Rules
Raw data is read-only · correlation ≠ causation · give percentage change with its base · call small samples "indicative".

## Output format
Profile · Cleaning log · Result table · One-sentence finding · Limitations
