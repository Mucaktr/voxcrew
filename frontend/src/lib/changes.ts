// Kullanıcı onaylı yapılandırma değişiklikleri (/api/changes) — teknik lider; S1 ve S2 kullanır.
import { currentLocale } from "./i18n";
import { bodyText } from "./api";

export interface ChangePlan {
  id: string;
  path: string;
  exists: boolean;
  kind: string;
  summary: string;
  diff: string[];
  no_change: boolean;
  expires_in_s: number;
}

export interface ChangeEntry {
  id: string;
  path: string;
  kind: string;
  summary: string;
  backup: string | null;
  ts: number;
  undone: boolean;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "X-Studio-Lang": currentLocale(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = bodyText(res.status, j); } catch { /* boş */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const changesApi = {
  history: (limit = 50) => call<ChangeEntry[]>("GET", `/api/changes?limit=${limit}`),
  apply: (planId: string) => call<ChangeEntry>("POST", `/api/changes/plans/${planId}/apply`, { confirm: true }),
  undo: (changeId: string) => call<ChangeEntry>("POST", `/api/changes/${changeId}/undo`, { confirm: true }),
};
