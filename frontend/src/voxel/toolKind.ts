/** Araç adından (web, shell, …) dünyadaki iş istasyonu türüne eşleme. scenes.ts yeniden dışa aktarır. */
export type ToolKind = "web" | "read" | "shell" | "plan" | "write";

export function toolKind(name?: string | null): ToolKind | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (/web|search|fetch|brows|http|url|extract/.test(n)) return "web";
  if (/shell|bash|terminal|exec|command|process|python|code_run/.test(n)) return "shell";
  if (/todo|plan|delegat|subagent|task|kanban|schedul|cron/.test(n)) return "plan";
  if (/write|edit|patch|dosya|create|save/.test(n)) return "write";
  if (/read|view|skill|glob|grep|list|file|session|memory|recall/.test(n)) return "read";
  return "write";
}
