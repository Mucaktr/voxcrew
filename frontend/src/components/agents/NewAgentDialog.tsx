// Ekip S12: "Yeni ajan" penceresi. Mevcut oluşturma yolunu (POST /api/agents → api.createAgent) kullanır;
// ad, unvan, rütbe, ekip, yönetici ve beyin seçimiyle ajanı oluşturup tam profiline götürür.
// S34: ilk seçim "Karakter: İnsan / Hayvan" (varsayılan İnsan) + ücretsiz hazır insan görünümleri.
import { Dices, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { byName, RANK_LABEL, RANKS, rankConflict, rankLabel, type Rank } from "../../lib/agents";
import { useT } from "../../lib/i18n";
import { useOffice } from "../../lib/office";
import { notifyBenched, usePlan } from "../../lib/plan";
import { useStudio } from "../../lib/store";
import type { Agent, Avatar, Connection } from "../../lib/types";
import { agentsMsg as m } from "../../locales/agents";
import { HUMAN_LOOKS, randomAnimal, randomHuman } from "../../voxel/avatar";
import { presentAvatar, presentationOfName, type Presentation } from "../../lib/presentation";
import { Note } from "../hermes/common";
import { PixelFace } from "../PixelFace";
import { Button, Field, Modal, Segmented, Spinner } from "../ui";

type Kind = "human" | "animal";
const randomOf = (k: Kind, p: Presentation): Avatar => (k === "human" ? randomHuman(p) : randomAnimal());

interface BrainOption { value: string; label: string; avail: boolean }

export function NewAgentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT(m);
  // koltuklar doluysa oluşturmadan ÖNCE söyle (ajan yedekte doğar, profil değil kadro açılır)
  const seatsFull = usePlan((s) => {
    const free = s.snapshot?.seats.free;
    return typeof free === "number" && free <= 0;
  });
  useEffect(() => {
    if (open) void usePlan.getState().refresh();  // koltuk sayısı güncel olsun (ajan oluşturma/kadro değişimi sonrası)
  }, [open]);
  const agents = useStudio((s) => s.agents);
  const conns = useStudio((s) => s.connections);
  const upsert = useStudio((s) => s.upsertAgent);
  const teams = useOffice((s) => s.teams);
  const navigate = useNavigate();

  const brains = useMemo<BrainOption[]>(() => {
    const c = (k: string) => conns.find((x) => x.kind === k);
    const hermes = c("hermes");
    const profiles = hermes ? ["default", ...(hermes.profiles ?? []).filter((p) => p !== "default")] : [];
    return [
      { value: "direct:ollama", label: t("brain_ollama"), avail: !!c("ollama")?.available },
      { value: "direct:codex", label: "GPT Codex", avail: !!c("codex")?.available },
      { value: "direct:claude", label: "Claude Code", avail: !!c("claude")?.available },
      ...profiles.map((p) => ({ value: `hermes:${p}`, label: t("brain_hermes", { profile: p }), avail: !!hermes?.available })),
    ];
  }, [conns, t]);

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [role, setRole] = useState("");
  const [rank, setRank] = useState<Rank | "">("");
  const [team, setTeam] = useState("");
  const [boss, setBoss] = useState("");
  const [brain, setBrain] = useState("");
  const [kind, setKind] = useState<Kind>("human");
  const [avatar, setAvatar] = useState<Avatar>(() => ({ ...HUMAN_LOOKS[0] }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // GIFTS-GENDER: ad erkek/kadın adıysa hazır görünümler ve rastgele seçim ona uyar (kayıtta adan türetilir)
  const pres = presentationOfName(name);
  const looks = HUMAN_LOOKS; // addan tahmin edilen sunum hazır görünümleri daraltmaz (8 → 5 olmasın)

  useEffect(() => {
    if (!open) return;
    setName(t("new_default_name", { n: agents.length + 1 }));
    setTitle(""); setRole(""); setRank(""); setTeam(""); setBoss(""); setError(null);
    setBrain(brains.find((b) => b.avail)?.value ?? brains[0]?.value ?? "direct:ollama");
    setKind("human");
    setAvatar({ ...HUMAN_LOOKS[agents.length % HUMAN_LOOKS.length] });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const bossOptions = useMemo(() => agents.filter((a) => !a.hidden).sort(byName), [agents]);
  const manager = agents.find((a) => a.slug === boss);
  const chosen = brains.find((b) => b.value === brain);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const [runtime, target] = brain.split(":");
    const data: Partial<Agent> = {
      name: name.trim(), role: role.trim(), avatar,
      ...(runtime === "hermes"
        ? { runtime: "hermes", hermes_profile: target, connection: "profile" as Connection }
        : { runtime: "direct", connection: (target || "ollama") as Connection }),
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(rank ? { rank } : {}),
      ...(team ? { team } : {}),
      ...(boss ? { reports_to: boss } : {}),
    };
    try {
      const a = await api.createAgent(data);
      upsert(a);
      if (team) void useOffice.getState().refresh();
      onClose();
      if ((a as Agent & { benched?: boolean }).benched) {
        // koltuklar dolu → ajan yedekte doğdu; kadro paneli ve sınır kartı (önce ücretsiz çözüm) gösterilir
        void notifyBenched(a.name);
        navigate("/ajanlar#kadro");
        return;
      }
      navigate(`/ajanlar/${encodeURIComponent(a.slug)}?tab=kimlik`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("new_agent")} width={640}
      footer={<>
        {!busy && !name.trim() && <span className="mr-auto text-xs text-ink-2 font-semibold self-center" role="status">{t("need_name")}</span>}
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button variant="primary" icon={busy ? <Spinner size={14} /> : <UserPlus size={16} />} disabled={busy || !name.trim()} disabledReason={t("need_name")} onClick={create}>
          {busy ? t("creating") : seatsFull ? t("create_bench") : t("create_open")}
        </Button>
      </>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <div className="flex flex-wrap items-center gap-3">
          <PixelFace avatar={presentAvatar(avatar, name) ?? avatar} size={64} />
          <div className="min-w-0 flex-1 basis-48 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span id="new-agent-kind" className="text-xs font-semibold text-ink-2">{t("kind_label")}</span>
              <div aria-labelledby="new-agent-kind" role="group">
                <Segmented<Kind> value={kind} onChange={(k) => { setKind(k); setAvatar(k === "human" ? { ...HUMAN_LOOKS[0] } : randomAnimal()); }}
                  options={[{ value: "human", label: t("kind_human") }, { value: "animal", label: t("kind_animal") }]} />
              </div>
            </div>
            <div className="text-sm text-ink-2">{t("new_intro")}</div>
            {seatsFull && <p className="text-sm text-ink-2" role="status">{t("create_bench_note")}</p>}
          </div>
          <Button size="sm" icon={<Dices size={15} />} onClick={() => setAvatar(randomOf(kind, pres))}>{t("other_avatar")}</Button>
        </div>
        {kind === "human" && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-ink-2">{t("looks_label")}</span>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
              {looks.map((l, i) => (
                <button key={i} type="button" aria-label={t("look_aria", { n: i + 1 })}
                  aria-pressed={JSON.stringify(l) === JSON.stringify(avatar)}
                  className="card-select flex items-center justify-center p-1" onClick={() => setAvatar({ ...l })}>
                  <PixelFace avatar={l} size={36} />
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("name")}>
            <input className="input" value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label={t("title")} hint={t("title_hint")}>
            <input className="input" value={title} maxLength={60} placeholder={t("new_title_placeholder")} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
        <Field label={t("new_role")} hint={t("new_role_hint")}>
          <textarea className="textarea" rows={2} value={role} placeholder={t("new_role_placeholder")}
            onChange={(e) => setRole(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("rank")}>
            <select className="select" value={rank} onChange={(e) => setRank(e.target.value as Rank | "")}>
              <option value="">{t("rank_none")}</option>
              {RANKS.map((r) => <option key={r} value={r}>{RANK_LABEL[r]}</option>)}
            </select>
          </Field>
          <Field label={t("team")}>
            <select className="select" value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">{t("f_team_none")}</option>
              {teams.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}
            </select>
          </Field>
          <Field label={t("manager")}>
            <select className="select" value={boss} onChange={(e) => setBoss(e.target.value)}>
              <option value="">{t("manager_you")}</option>
              {bossOptions.map((a) => (
                <option key={a.slug} value={a.slug}>{a.name}{a.rank ? ` — ${rankLabel(a.rank)}` : a.title ? ` — ${a.title}` : ""}</option>
              ))}
            </select>
          </Field>
        </div>
        {manager && rankConflict(rank, manager.rank) && (
          <Note tone="warn">{t("rank_conflict", { name: manager.name, rank: rankLabel(manager.rank) })}</Note>
        )}
        <Field label={t("brain")} hint={t("brain_hint")}>
          <select className="select" value={brain} onChange={(e) => setBrain(e.target.value)}>
            {brains.map((b) => <option key={b.value} value={b.value}>{b.label}{b.avail ? "" : t("unreachable_suffix")}</option>)}
          </select>
        </Field>
        {chosen && !chosen.avail && <Note tone="warn">{t("brain_unreachable")}</Note>}
        {error && <div role="alert" className="chip tone-bad !rounded-lg !whitespace-normal !items-start font-medium p-3 text-sm">{error}</div>}
      </form>
    </Modal>
  );
}
