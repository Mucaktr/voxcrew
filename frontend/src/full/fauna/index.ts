// FREE fallback for full/fauna.ts (the full aggregator shadows this file; keep export names/types identical).

export const withFullFauna = (k: Readonly<Record<string, readonly (readonly [string, number])[]>>): Record<string, readonly (readonly [string, number])[]> => ({ ...k });
