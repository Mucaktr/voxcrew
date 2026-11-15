// UX-P2 — saf ajan beyni yardımcıları (içe aktarma yok; node --test doğrudan yükler).
//
// taze kurulumda hazır (algılanmış ve şu an kullanılabilir) beyin bulunamazsa başlangıç ajanı beyinsiz doğar
// (`needs_brain`). Sunucu bağlantı alanına ontoloji gereği bir yer tutucu yazar; arayüz onu "seçili" göstermez.
//
// "Hermes'e geçir" yalnız Hermes kurulu ve erişilebilirken bir eylemdir; değilse düğme devre dışı kalır ve nedeni
// ile Bağlantılar sayfasına bağlantı gösterilir (çıkmaz yok). Hermes isteğe bağlıdır (AGENTS kural 3).

/** Seçili bağlantı: beyinsiz ajanda null (yer tutucu "ollama" seçili görünmez). */
export function chosenConnection<C extends string>(a: { needs_brain?: boolean | null; connection: C }): C | null {
  return a.needs_brain ? null : a.connection;
}

export interface HermesSwitch {
  /** düğme etkin mi */
  enabled: boolean;
  /** devre dışıysa neden: "not_installed" (Hermes yok ya da algılanmadı) · "unreachable" (kurulu ama erişilemiyor) */
  reason: "not_installed" | "unreachable" | null;
}

/** Bağlantı listesinden "Hermes'e geçir" durumu (`kind: "hermes"` satırı; `available` = kurulu ve erişilebilir). */
export function hermesSwitch(conns: readonly { kind: string; available?: boolean; installed?: boolean | null }[]): HermesSwitch {
  const h = conns.find((c) => c.kind === "hermes");
  if (h?.available) return { enabled: true, reason: null };
  return { enabled: false, reason: h?.installed ? "unreachable" : "not_installed" };
}
