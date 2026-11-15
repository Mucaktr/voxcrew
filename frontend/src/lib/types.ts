import type { FullSceneId } from "../full/scenes";
export type Species = "human" | "cat" | "dog" | "fox" | "bear" | "rabbit" | "panda" | "penguin";
export type HairStyle = "none" | "short" | "long" | "bun" | "curly" | "spiky" | "bob" | "ponytail" | "mohawk" | "bald";
export type Beard = "none" | "stubble" | "full" | "goatee" | "mustache";
export type Outfit = "tshirt" | "hoodie" | "suit" | "sweater" | "labcoat" | "dress" | "overalls" | "hawaii" | "shirt" | "blazer";
export type Glasses = "none" | "round" | "square" | "sun" | "star";
export type Hat = "none" | "cap" | "beanie" | "tophat" | "straw" | "headphones" | "beret" | "crown" | "party";

export interface Avatar {
  species: Species;
  skin: string;
  hair: HairStyle;
  hairColor: string;
  beard: Beard;
  outfit: Outfit;
  outfitColor: string;
  accent: string;
  glasses: Glasses;
  hat: Hat;
  // S44 — kahraman donanımı (isteğe bağlı; ücretsiz, kilitsiz). Çizim: voxel/parts.ts heroGear
  cape?: Cape;
  capeColor?: string;
  mask?: Mask;
  emblem?: Emblem;
  boots?: boolean;
  gloves?: boolean;
  /** parıltı rengi ya da "none" */
  aura?: string;
  hover?: boolean;
  /** COS-B — kozmetik mağaza kıyafeti (`store:<öğe>` kimliğinin öğe kısmı). İsteğe bağlı; çizim: voxel/cosmetics/registry.ts
   *  `wearOf` → parts.ts. Bugün yalnız kaydedilmeyen 3D denemede atanır (satış kapalı). */
  wear?: string;
  /** GIFTS-GENDER: giyim tarzı. Kayıtlı değer yalnız AÇIK seçimdir (m erkek, f kadın, n nötr); yoksa adan türetilir
   *  (lib/presentation.ts). `presentationAuto`: türetilmiş (store koyar, kaydederken atılır). */
  presentation?: "m" | "f" | "n";
  presentationAuto?: boolean;
}
export type Cape = "none" | "short" | "long";
export type Mask = "none" | "domino" | "visor" | "cowl";
export type Emblem = "none" | "ring" | "check" | "spark" | "wave" | "bubble" | "book" | "lock" | "chevron" | "gear" | "arrows";

// S37: openai_compat = adlandırılmış model API bağlantısı (LM Studio, Mistral, Claude API…); model "<uç nokta>::<model>" olabilir
export type Connection = "profile" | "ollama" | "codex" | "claude" | "openai_compat";
export type Mood = "idle" | "thinking" | "working" | "waiting" | "done" | "error" | "offline";

export interface AgentState {
  state: Mood | string;
  activity: string;
  run_id?: string | null;
  step_id?: string | null;
  tool?: string | null;
  since?: number;
}

export interface Handoff { id: number; from: string; to: string; run_id?: string; ts: number }

export interface RouteInfo {
  connector: string;
  connection: Connection;
  model?: string | null;
  provider?: string | null;
  profile?: string | null;
  label: string;
  warning?: string;
  /** S37: openai_compat rotasında uç nokta kimliği ve uzak (veri bilgisayardan çıkar) işareti */
  endpoint?: string;
  remote?: boolean;
}

export interface Agent {
  id: string;
  slug: string;
  name: string;
  role: string;
  persona: string;
  color: string;
  avatar: Avatar;
  hermes_profile?: string;
  runtime: "hermes" | "direct";
  connection: Connection;
  model: string;
  permissions: "read" | "write";
  memory_scope: "shared" | "private";
  memory_enabled: boolean;
  hidden: boolean;
  /** S40 yönetici/test modu demo ajanı (`admin.seed_demo`): yalnız test modunda dünyada görünür, "Test ajanı" rozetiyle */
  demo?: boolean;
  created_by: "hermes" | "studio";
  profile_model?: string;
  profile_provider?: string;
  has_codex_auth?: boolean;
  route: RouteInfo | null;
  route_error: string | null;
  /** başlangıç ajanı hazır beyin bulunamadan doğdu; `connection` yer tutucudur (lib/agentBrain.ts)*/
  needs_brain?: boolean;
  state: AgentState;
  // Faz 2 — Hermes yetenekleri (çalıştırma başına -s / -t / --reasoning)
  skills?: string[];
  toolsets?: string[];
  /** S27: ajan düzeyi araç politikası (ayar `tools.*` üstüne katmanlanır; yazma `/api/tools/agents/{slug}`) */
  tools?: { allow?: string[]; deny?: string[]; mcp?: string[]; auto_approve?: string[] };
  reasoning?: string | null;
  transport?: "auto" | "cli" | "api" | null;
  // Faz 2 — Ofis
  team?: string | null;
  title?: string | null;
  reports_to?: string | null;
  // Faz 3 — rütbe ve işe alım
  rank?: "ceo" | "deputy" | "director" | "manager" | "lead" | "senior" | "specialist" | "analyst" | "intern" | null;
  hired_by?: string | null;
  hired_in_run?: string | null;
  /** S44: kahraman paketinden işe alındıysa kahraman kimliği */
  hero?: string | null;
}

export interface ConnectionInfo {
  kind: "hermes" | "ollama" | "codex" | "claude";
  name: string;
  subtitle?: string;
  available: boolean;
  /** bağlantı modeli: kurulu mu (null = bilinmiyor) */
  installed?: boolean | null;
  version?: string | null;
  path?: string | null;
  detail?: string;
  warning?: string;
  error?: string;
  /** keşif zaman aşımına uğradı (geçici; "kurulu değil" demek değildir) */
  timeout?: boolean;
  logged_in?: boolean;
  default_model?: string | null;
  models?: number;
  loaded?: string[];
  profiles?: string[];
  last_use?: { ok: boolean; error: string | null; ts: number } | null;
}

export interface OllamaModel {
  name: string;
  family?: string;
  parameter_size?: string;
  quantization?: string;
  size_bytes?: number;
  context_max?: number;
  num_ctx?: number | null;
  capabilities: string[];
  local: boolean;
  free: boolean;
  /** Ollama bulut modeli (ollama.com)*/
  cloud?: boolean;
  /** uzak Ollama sunucusunun adresi (yerel sunucuda boş)*/
  host?: string;
  hermes_ready: boolean;
}

export interface ToolCall { name: string; input?: string; ok?: boolean | null; output?: string;
  /** yöneticinin önceki denemesinden tekrar kullanıldı (yeniden yürütülmedi)*/ replayed?: boolean; reused?: boolean }
export interface RecalledItem { id: string; type: string; label: string; agent?: string; via?: string; score?: number }

export interface StepRun {
  id: string;
  type: "agent" | "approval" | "delegate" | "orchestrate" | "handoff";
  title: string;
  agent?: string | null;
  depends_on: string[];
  message?: string;
  status: string;
  output: string;
  thought?: string;
  error?: string | null;
  route?: Partial<RouteInfo> | null;
  model?: string | null;
  tokens?: Record<string, number>;
  tools: ToolCall[];
  recalled: RecalledItem[];
  rounds: number;
  started_at?: string | null;
  finished_at?: string | null;
  memory?: Record<string, unknown> | null;
  awaiting_message?: string;
  artifacts?: { id?: string; name: string; size?: number; new?: boolean }[];
  prompt?: string | null;
  revise?: { target: string; until?: string; max_rounds?: number } | null;
  // Faz 3 (S6): devretme — dinamik adımlar ağacı
  parent?: string | null;       // üst (delegate) adım id'si
  depth?: number;
  assignee_hired?: boolean;
  role?: string | null;         // QA-M1: adım role bağlıysa Role.id (ajan çalışma anında çözülür)
  kind?: "subtask" | "hire" | "synthesis" | ApprovalCardKind | null;  // ayrıntılı devretme türleri: components/office/hierarchy.ts
  // Faz 6 (S23): yeniden deneme ve politika
  attempt?: number;
  /** en az bir model turu gönderen deneme sayısı ("N. deneme" etiketi bunu gösterir)*/
  tries?: number;
  /** PROC2-FIX P1: tavan adım sürerken aşıldı; sıradaki model turundan önce durdurulan denemenin korunan yarım çıktısı */
  /** koşu sınırının altındaki otomatik adım tavanını aştı (engellemeyen uyarı)*/
  runaway?: { spent: number; would_be: number; attempt?: number; at?: string } | null;
  /** CLI adımı öldürme penceresinde durduruldu, sıradaki isteği göndermiş OLABİLİR (harcama değil; ayrı not)*/
  unrecorded_possible?: { count: number; tokens_max: number; attempt?: number; at?: string } | null;
  /** adımın gerçek harcaması (bütün denemeleri)*/
  spent?: { tokens?: number; cost_usd?: number | null; minutes?: number } | null;
  partial?: { attempt: number; output: string; chars: number; truncated?: boolean; tool_count: number; tokens: number;
    tools?: { name?: string; ok?: boolean | null }[]; at?: string } | null;
  last_error?: string | null;
  policy?: StepPolicy | null;
  budget?: RunBudget | null;
  /** G4-REST: etkin adım jeton tavanı ve kaynağı (adım/akış bütçesi, ayar, öngörü × çarpan, düz varsayılan) */
  cap?: StepCap | null;
  /** bu adımın beyninde tavan nerede uygulanır (tur sınırında / yalnız adım bitince)*/
  enforcement?: CapEnforcement | null;
  usage?: RunUsage | null;
  /** Faz 6 (S26): dinamik onay kartı verisi (kind ask | effect | budget); `step.awaiting` olayında da gelir */
  ask?: StepAsk | null;
  /** on_fail=skip/continue ile "yumuşak" bitti: bağımlılar çalıştı */
  soft_fail?: boolean | null;
  /** başarısız/reddedilen ya da kısmen başarısız adımın hata sınıfı (locales/errorClass.ts)*/
  error_class?: string | null;
  /** A2A görev durumu eşlemesi (workflow/states.py) */
  a2a?: string;
  // Faz 2 (S2): gerçekte gönderilen, araç onayları, uyarılar — ayrıntılı türler lib/gateway.ts'te
  invocation?: import("./gateway").StepInvocation | null;
  pending_approval?: import("./gateway").ToolApprovalRequest | null;
  approvals?: import("./gateway").ToolApprovalRecord[];
  warning?: string | null;
  /** adım başı onay (spec), onay durumu ve kullanılan skill'ler*/
  approval?: "before" | "after" | "none" | null;
  gate?: StepGate | null;
  skills_used?: StepSkillUse[] | null;
}

/** Faz 6 — bütçe ve kullanım*/
export interface RunBudget { tokens?: number | null; cost_usd?: number | null; minutes?: number | null; steps?: number | null; on_exceeded?: "pause" | "stop" | "ask" }
export interface RunUsage { tokens?: number; cost_usd?: number | null; minutes?: number; steps?: number; cost_basis?: CostBasis; replayed?: Partial<RunUsage>;
  /** gerçek harcama (güncel + durdurulan/yeniden oynatılan denemeler); tavan, kart ve günlük bunu sayar*/
  spent?: { tokens?: number; cost_usd?: number | null; minutes?: number }; spent_tokens?: number;
  /** kullanıcı durdurmasında öldürülen uçuştaki turun tahmini (harcamaya dahil, işaretli)*/
  estimated_unrecorded?: { tokens?: number; cost_usd?: number } }
/** tavan nerede uygulanır — tur sınırında (sıradaki model turundan önce) ya da yalnız adım bitince*/
export type CapEnforcement = "turn" | "step_end";
/** beyin başına tek tablo*/
export interface BrainRow { key: "claude" | "api" | "codex" | "profile" | "local" | string; typical: number; cap: number; enforcement: CapEnforcement }
/** Maliyetin kaynağı: ölçülmüş (sağlayıcı bildirdi) · tahmini (fiyat tablosu) · yerel (ücretsiz) · karışık · bilinmiyor */
export type CostBasis = "measured" | "estimated" | "local" | "subscription" | "mixed" | "unknown";
/** Faz 6 — koşu durumları (S23 §6); `Run.status` geriye uyum için string kalır */
export type RunStatus = "running" | "paused" | "interrupted" | "done" | "failed" | "cancelled";
/** Faz 6 — dinamik onay kartı türleri (S23 §6): on_fail kararı · belirsiz etki · bütçe aşımı */
export type ApprovalCardKind = "ask" | "effect" | "budget" | "gate" | "manifest";
/** Faz 6 — dış etki günlüğü kaydı*/
export interface RunEffect {
  id: string; step: string; kind: "tool" | "file" | "hire" | "message" | "workdir" | string; idempotency_key: string;
  status: "pending" | "applied" | "unknown" | "acknowledged"; detail?: string; at?: string; attempt?: number;
}
/** Faz 6 — onay kartı verisi (`step.ask`); karar mevcut /decision ile (on_fail notu: retry | skip | route:<bağlantı>[:<model>]) */
export type StepAsk =
  | { kind: "on_fail"; step: string; error?: string; attempt?: number; connection?: string; degraded?: boolean; choices?: string[]; hint?: string }
  | { kind: "unknown_effect"; step: string; effects: RunEffect[]; choices?: string[] }
  | { kind: "budget"; step: string; scope: "run" | "step" | "daily" | "kept"; metric: "tokens" | "cost_usd" | "minutes" | "steps"; used: number; limit: number;
      ratio?: number | null; proposal?: RunBudget | null; choices?: string[];
      /** PROC-FIX `rerun` = adım tur ortasında kaldı, onay onu baştan çalıştırır; `kept_output` = biten çıktı korundu;
       * `expected` = beklenen maliyet (öngörü ya da son denemenin gerçek maliyeti); `used_now` = gerçek kullanılan;
       * `overran_step` = (scope kept) kendi tavanını aşan, çıktısı korunan adım*/
      rerun?: boolean; kept_output?: boolean; expected?: { tokens?: number; cost_usd?: number; minutes?: number };
      used_now?: number | null; overran_step?: string | null;
      /** `projected` = kullanılan sınırın altında, sıradaki işin tahmini sığmıyor (rezervasyon); biten adım
       * sayısı; aşımda korunan bitmiş plan turları; kart açıkken elle konan tavan*/
      projected?: boolean; finished_steps?: number; kept_rounds?: string[]; manual_cap?: number | null;
      /** PROC2-FIX: `local` = beklenen maliyet yerel beyinden (0 $); `kept_partial` = adım sürerken durdurulan denemenin
       *  korunan yarım çıktısı (yeniden çalışmada isteme eklenir) */
      local?: boolean | null; kept_partial?: { attempt?: number; chars?: number; tool_count?: number; tools_stopped?: number; tokens?: number } | null;
      /** `enforcement` = bu adımın beyninde tavan nerede uygulanır; `absolute` = onaylanan sınır harcananı içeren
       * toplamdır; `next_turn_min` = sıradaki model turunun en az bağlamı (sınır henüz aşılmadan durulduysa)*/
      enforcement?: CapEnforcement | null; absolute?: boolean; next_turn_min?: number | null;
      /** onayda öteki kapsamın (koşu ↔ adım) sınırı da bu toplama yükselir (aynı iş ona takılmasın)*/
      co_raise?: { scope: "run" | "step"; tokens: number; spent?: number } | null;
      /** `continue` = API araç döngüsü kaldığı yerden sürer (yalnız kalan turlar); `full_attempt` = bir tam
       * denemenin tahmini (× 1,25); `approvals` = bu adımda onaylanan kart sayısı; 2'den sonra `primary` =
       * "accept_partial" (adımı durdur, kısmi çıktıyla devam) ve kart adımın toplam harcamasını ve işin katını gösterir;
       * `late_boundary` = tur sonu işareti gelmedi, durma yedek sınırda*/
      continue?: boolean | null; full_attempt?: { tokens?: number; remaining?: number; projected?: number } | null;
      approvals?: number; primary?: "approve" | "accept_partial"; step_spent?: number | null;
      job_multiple?: number | null; late_boundary?: boolean | null;
      /** kartın ölçtüğü iş (adım ya da orkestratörün plan turu); `plan_round` = plan turu kartı;
       * `pre_start` = adım başlamadan önceki kart (2 onay kuralına sayılır)*/
      subject?: string | null; plan_round?: string | null; pre_start?: boolean | null;
      /** koşu düzeyinde tek karar — aynı koşu tavanını paylaşan işler (durdurulan / çalışan / sırada);
       * `partial_cap` = "bitenlerle devam" seçilirse sonuçları birleştirmek için koşu sınırı; `co_raise_steps` = onayda
       * yükselen adım sınırları. `own_tools` = araçlarını kendisi çalıştıran beyin (Claude Code / Codex / Hermes)*/
      group?: string[] | null; group_stopped?: string[]; group_running?: string[]; group_waiting?: string[];
      group_synthesis?: string | null;
      group_spent?: number | null; partial_cap?: number | null; co_raise_steps?: Record<string, number> | null;
      own_tools?: string | null; synth_extra?: number | null;
      /** koşu genelinde tek karar — tüm sentezler, kullanıcıya görünen adlar, ağacın kalan işi (tek adım kartı);
       * `growth` = büyütülmüş öneri (önceki tam deneme de yetmedi); aşan adım(lar)ın adı;
       * `subject_title` = kartın ölçtüğü işin adı (ör. "Sentez · Şef")*/
      group_syntheses?: string[] | null; group_titles?: Record<string, string> | null;
      rest_extra?: number | null; rest_members?: string[] | null; growth?: number | null;
      subject_title?: string | null; overran_title?: string | null; overran_steps?: string[] | null;
      /** sınır otomatik koşu bütçesi; 3. koşu kartından itibaren "Bitene kadar devam et"
       * için önerilen mutlak tavan (not: `until_done:<jeton>`)*/
      auto_budget?: boolean | null; until_done_cap?: number | null;
      /** kart otomatik token ağının tek sorusu (kullanıcının süre / adım sınırı eylemi)*/
      net?: "pause" | "stop" | null;
      /** yazılan tavanın tabanı (harcanan + uçuştaki turlar); karar sonrası tabana çekildiyse `until_done_applied`.
       * önerinin dayanağı (`history` kalan işlerin tahmini, `live` gözlenen sapma, `spent` harcananın katı) ve
       * tavanla tutarlı beklenen maliyet*/
      until_done_floor?: number | null;
      /** tavanın birimi (para metrikli koşu kartında `cost_usd`; yoksa token)*/
      until_done_metric?: "tokens" | "cost_usd" | null;
      /** kullanıcının sınır eylemi yerine soruldu (sınır dolmadı, işlerin boyutu bilinmiyor)*/
      asked_instead_of?: "pause" | "stop" | null;
      until_done_applied?: { typed: number; floor: number; applied: number } | null;
      proposal_basis?: { kind: "history" | "live" | "spent"; multiple?: number | null; ratio?: number | null;
        misses?: number | null; expected?: number | null } | null }
  /** adım başı onay kartı: before = gönderilecek istem, after = tutulan çıktı*/
  /** G4-REST: koşu başladıktan sonra beyin/model, akış ya da skill değişti — devam için kullanıcı onayı */
  | { kind: "manifest_diff"; step: string; changes: ManifestChange[]; material?: boolean; sig?: string; choices?: string[] }
  | { kind: "step_approval"; step: string; phase: "before" | "after"; agent?: string | null; route?: string | null;
      model?: string | null; attempt?: number; chars?: number; prompt?: string; prompt_truncated?: boolean;
      system?: string | null; output?: string; output_truncated?: boolean; skills?: string[]; artifacts?: string[];
      choices?: string[] };
/** G4-REST: başlangıç manifestinden bir fark (alan, anahtar, eski → yeni; önemli = onay ister) */
export interface ManifestChange {
  field: "studio_version" | "prompt_layout_version" | "spec_version" | "workflow_sha" | "agent" | "skill" | "limits" | string;
  key?: string; attr?: string; from?: unknown; to?: unknown; material: boolean;
}
/** G4-REST: devamda manifest farkı ve onay durumu (pending = onay bekliyor · confirmed · rejected · warned = yalnız uyarı) */
export interface ManifestDiff {
  at?: string; reason?: string; changes: ManifestChange[]; material: boolean; sig?: string;
  status: "pending" | "confirmed" | "rejected" | "warned"; summary?: string; decided_at?: string;
}
/** G4-REST: etkin adım tavanı; `source` = step | workflow | setting | estimate | default | off | raised */
export interface StepCap {
  source: "step" | "workflow" | "setting" | "estimate" | "brain" | "default" | "off" | "raised" | string;
  tokens?: number | null; estimate?: number; factor?: number; floor?: number; ceiling?: number; samples?: number;
  /** PROC2-FIX P1: geçmiş yokken beyin başına QA ölçümüne dayanan varsayılan (`source: "brain"`) */
  brain?: string; typical?: number;
  from?: string | null; previous?: number | null;
}
/** adım başı onay durumu ve adımın istemine giren skill'ler (USED_SKILL kenarı)*/
export interface StepGate { phase: "before" | "after"; outcome: "pending" | "approved" | "rejected"; card?: string; note?: string | null }
export interface StepSkillUse {
  key: string; sha?: string | null; how: "always" | "catalog" | "selected" | "hermes_flag" | string;
  /** HERMES-SKILL-EDGE: yalnız `hermes_flag` — offered (-s ile verildi) | used (ajan skill_view ile açtı) */
  status?: "offered" | "used" | null; binding?: string | null; pinned_sha?: string | null;
}
/** Faz 6 — yeni SSE olay adları (S23 §6; hepsi run_events'e kalıcı) */
export type RunControlEventType =
  | "run.paused" | "run.resumed" | "run.forked" | "step.retried" | "step.retry_scheduled" | "connection.degraded"
  | "budget.warning" | "budget.exceeded" | "budget.updated" | "step.effect" | "step.dispatched";
/** Faz 6 — adım politikası*/
export interface StepPolicy { retries?: number; backoff?: "exp" | "fixed"; base_s?: number; timeout_min?: number; on_fail?: "fail" | "skip" | "continue" | "ask" }
/** Faz 6 — ajanlar arası mesaj*/
export interface Message {
  id: string; run_id?: string | null; step_id?: string | null; from_agent: string; to_agent: string;
  kind: "handoff" | "assign" | "ask" | "answer" | "note" | "system"; subject: string; body?: string; summary?: string;
  artifacts?: string[]; reply_to?: string | null; created_at: string; read_at?: string | null;
}
/** Faz 6 — zamanlayıcı*/
export interface Schedule {
  id: string; title: string; kind: "cron" | "interval" | "once" | "webhook" | "file_watch" | "heartbeat";
  spec: Record<string, unknown>; target: Record<string, unknown>; policy?: Record<string, unknown>; enabled: boolean;
  created_at: string; created_by?: string | null; last_run_at?: string | null; next_run_at?: string | null; last_status?: string | null;
}

export interface Run {
  id: string;
  title: string;
  kind: "task" | "workflow" | "delegation";
  workflow?: string;
  /** koşuyu kim başlattı: "ui" | "mcp:claude-code" | "mcp:codex" | "mcp:<istemci>" | "goal" (S6/S11) */
  origin?: string | null;
  /** devretme koşusu bir hedef için başlatıldıysa Goal.id (S10) */
  goal?: string | null;
  // Faz 6 (S23): dayanıklılık ve bütçe — status "paused" | "interrupted" de olabilir
  checkpoint?: Record<string, unknown> | null;
  forked_from?: string | null;
  resumed_at?: string | null;
  /** Faz 6 dalga 3: bellek ad alanı ("global" | "project:<anahtar>") ve kabul durumu (done ≠ accepted)*/
  project?: string | null;
  acceptance?: "pending" | "accepted" | "rejected" | null;
  attempts?: number;
  budget?: RunBudget | null;
  /** güvenli mod tavanının başlangıçta kırptığı metrikler (min(istenen, tavan))*/
  budget_clamp?: { by: string; metrics: Record<string, { requested: number | null; cap: number }> } | null;
  /** sınırsız başlayan koşunun otomatik koşu bütçesi (`source: user` = kullanıcı elle değiştirdi)*/
  budget_auto?: { source: "auto" | "user"; tokens: number; estimate: number; factor: number; basis?: string | null;
                  topped_up?: number | null; raised?: boolean;
                  /** kullanıcının para / süre sınırının yanında; başlangıç cephesinin payı (× 1,25)*/
                  with_user?: string[] | null; frontier?: number | null;
                  /** kullanıcının süre / adım sınırı duraklat / durdur; token ağı bir kez sorar*/
                  net?: "pause" | "stop" | null } | null;
  /** koşunun olası kaydedilmemiş istekleri (harcamaya sayılmaz)*/
  unrecorded_possible?: { requests: number; tokens_max: number } | null;
  /** G4-REST: devamda başlangıç manifestinden farklar (eski sunucuda yok) */
  manifest_diff?: ManifestDiff | null;
  usage?: RunUsage | null;
  /** canlı: son duraklatma nedeni (user | budget | …); soğuk okuma: devam edilebilir mi */
  pause_reason?: string | null;
  /** zarif duraklatma sürüyor (CLI adımları uçuştaki turlarını bitiriyor)*/
  pausing?: boolean;
  resumable?: boolean;
  /** canlı: dış etki günlüğü */
  effects?: RunEffect[];
  a2a?: string;
  schedule?: string | null;
  status: string;
  inputs: Record<string, unknown>;
  started_at?: string;
  finished_at?: string | null;
  duration_ms?: number;
  output?: string;
  error?: string | null;
  /** başarısız ya da kısmen başarısız koşunun hata sınıfı*/
  error_class?: string | null;
  tokens?: Record<string, number> | null;
  steps: StepRun[];
  live?: boolean;
  events?: StudioEvent[];
}

export interface WorkflowInput { name: string; label?: string; type?: string; default?: string; required?: boolean }
export interface WorkflowStep {
  id: string;
  type: "agent" | "approval" | "delegate" | "orchestrate" | "handoff";
  title?: string;
  agent?: string;
  prompt?: string;
  depends_on?: string[];
  connection?: string;
  model?: string;
  memory?: boolean;
  remember?: boolean;
  message?: string;
  revise?: { target: string; until?: string; max_rounds?: number } | null;
  /** QA-M1: ajan yerine rol (Role.id) */
  role?: string | null;
  // delegate adımı ayarları
  depth?: number;
  max_subtasks?: number;
  allow_hiring?: boolean;
  hiring_approval?: "ask" | "auto";
  hire_budget?: number;
  /** adım başı onay*/
  approval?: "before" | "after" | "none";
  /** PROC-FIX `review` = denetim adımı (teslim değil) · adımın web araması izni (Codex varsayılanı kapalı)*/
  kind?: "review" | null;
  web_search?: boolean | null;
}
/** sunucunun iş akışı uyarısı (zayıf yazar): `weak_local_writer` (≤ 9B) · `weak_local_writer_unknown` (boyut
 * bilinmiyor, küçük olabilir); `message` istek dilinde*/
export interface WorkflowWarning { code: "weak_local_writer" | "weak_local_writer_unknown" | string; step: string; model: string;
  size_b: number | null; message?: string }
export interface Workflow {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  inputs: WorkflowInput[];
  steps: WorkflowStep[];
  /** PROC-FIX teslim adımı (yoksa son ajan adımı). PROC2-FIX birden çok adım → sırayla, başlıklı birleşim*/
  deliverable?: string | string[] | null;
  error?: string;
}

export interface GraphNode { id: string; type: string; label: string; created_at?: string; props: Record<string, unknown> }
export interface GraphEdge { id: string; type: string; src: string; dst: string; weight: number; props: Record<string, unknown> }
export interface GraphStats { nodes: number; edges: number; by_type: Record<string, number> }

export interface OntologyDef {
  name: string;
  entities: { name: string; key: string; label: string; color: string; description: string;
    properties: { name: string; type: string; required: boolean; enum?: string[] | null }[] }[];
  relations: { name: string; from: string[]; to: string[]; description: string }[];
}

export interface StudioEvent {
  seq: number;
  type: string;
  ts: number;
  run_id?: string;
  step?: string;
  agent?: string;
  [k: string]: unknown;
}

export type SceneId =
  | "office" | "park" | "home" | "beach" | "cafe" | "camp"
  | "battlefield" | "sea" | "yacht" | "space" | "snow" | "mall" | "school"
  | "istanbul"
  | "londra"
  | "kapadokya"
  // EDITION1: tam sürüme özgü sahneler (free sürümde never)
  | FullSceneId;

export interface Settings {
  ollama_url: string;
  hermes_home: string;
  workdir: string;
  max_turns: number;
  step_timeout_min: number;
  concurrency: Record<string, number>;
  ollama: { num_ctx: number; temperature: number; think: boolean };
  codex_hermes_model: string;
  scene: SceneId;
  memory: { recall: boolean; extractor: string; extractor_model: string; budget_chars: number };
  scenes: SceneId[];
  /** Faz 3–4 (sunucu varsayılanları config.DEFAULTS'ta; eski sunucuda olmayabilir) */
  game?: { enabled: boolean; celebrations: boolean; sounds: boolean; show_world_badges: boolean };
  external?: {
    claude_code: { ingest_enabled: boolean; token: string; transcripts_enabled: boolean; store_prompts: boolean; otlp_enabled: boolean };
    codex: { ingest_enabled: boolean; transcripts_enabled: boolean; store_prompts: boolean };
  };
  clients?: { mcp: { enabled: boolean; allow_decisions: boolean } };
  /** Faz 5 */
  ui?: { language: "auto" | "tr" | "en" };
  agents?: { language: "ui" | "tr" | "en" };
  limits?: { max_agents: number; page_size: number; step_tokens?: number | string | null; step_tokens_explicit?: boolean };
  boost?: { enabled: boolean; profile: string } & Record<string, unknown>;
  skills?: { inject: boolean; max_chars: number };
}
