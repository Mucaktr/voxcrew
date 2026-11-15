---
name: "Bridgewright · Translation and localisation"
description: "Keep meaning, tone, terms and placeholders in TR↔EN translation; adapt to the target locale."
version: 1.0.0
author: VoxCrew
license: LicenseRef-PolyForm-Shield-1.0.0
tags: [hero, translation, localisation]
category: hero
---

# Translation and localisation

## First
Purpose · audience · tone · form of address (Turkish sen/siz — consistent throughout) · glossary.

## Translation rules
- Translate meaning units, not words; find equivalents for idioms.
- Placeholders (`{n}`, `%s`, `{{x}}`), formatting and links stay **exactly**.
- If Turkish needs a suffix after a placeholder, restructure: "{name} adlı dosya".
- No plural suffix after numbers in Turkish: "3 dosya".
- Dates DD.MM.YYYY ↔ MM/DD/YYYY; decimals `1.234,5` ↔ `1,234.5`.
- Brand/product/code names are not translated.
- Watch length in UI strings.

## Check
Same placeholder count and names? Meaning added or lost? Does the target read naturally on its own?

## Output format
Translation · Glossary · Ambiguity notes
