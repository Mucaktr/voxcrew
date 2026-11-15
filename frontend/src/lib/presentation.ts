/**
 * GIFTS-GENDER — ad → giyim tarzı (sunum). `backend/studio/office/presentation.py` ile AYNI tablo (`frontend/scripts/gifts_gender.test.mjs`
 * ikisini karşılaştırır). `m` erkek, `f` kadın, `n` nötr. Kayıtlı veriye dokunulmaz: `avatar.presentation` yalnız AÇIK seçimdir;
 * yoksa görünüm ADDAN türetilir (`presentAvatar`; store her ajan yüklenişinde uygular, kaydederken türetilen alan atılır).
 * Saf veri ve saf işlev (three/React yok).
 *
 * Kurallar: erkek → erkek giyimi (sakal serbest); kadın → kadın giyimi (etek/elbise serbest, sakal yok). Kostüm politikası aynen
 * geçerlidir: siyasi/ideolojik simge, LGBT/onur simgesi ve gökkuşağı bandı yok.
 */
import type { Avatar, Beard, HairStyle, Outfit } from "./types";

export type Presentation = "m" | "f" | "n";
export const PRESENTATIONS: readonly Presentation[] = ["m", "f", "n"];

const MALE =
  "mert can ozan efe aras atlas alp kerem emre kaan burak berk tuna kuzey mehmet ahmet mustafa ali ayhan hasan "
  + "huseyin ibrahim ismail yusuf omer murat serkan selim tolga umut onur oguz cem baris cagri eren furkan gokhan "
  + "hakan halil kadir kemal levent metin necati orhan ramazan sinan taner tarik volkan yigit zafer arda batu bora "
  + "doruk ege kutay mirac polat sarp talha tamer ulas utku yavuz john james robert michael william david richard "
  + "thomas daniel matthew mark paul peter george jack liam noah oliver lucas ethan adam alex max leo hugo luca "
  + "marco carlos diego juan pedro jose";
const FEMALE =
  "ece zeynep elif aylin nil lara duru mina ipek defne selin naz ada ayse fatma emine hatice merve esra busra "
  + "gizem cansu derya dilara damla ebru feyza gamze gul gulsen hande irem kubra melek melis meltem nazli nehir nur "
  + "pinar rabia seda sena sibel simge tugba yasemin yildiz zehra asya azra beren buse ceren ela idil ilayda irmak "
  + "lale maya mira nisa ozge sila sude tuba yelda mary patricia jennifer linda elizabeth barbara susan jessica "
  + "sarah karen emma olivia sophia isabella mia charlotte amelia anna laura julia maria sofia lucia carmen";
const NEUTRAL =
  "yagmur toprak su deniz bulut ruzgar derin ozgur umit gokce";

const FOLD: Record<string, string> = { "ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g", "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c", "â": "a", "î": "i", "û": "u" };
/** ASCII'ye katla + küçük harf (Türkçe İ/ı dahil). */
export function foldName(name: string): string {
  return Array.from(String(name ?? "").normalize("NFKC")).map((c) => FOLD[c] ?? c).join("").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function buildTable(): Readonly<Record<string, Presentation>> {
  const out: Record<string, Presentation> = {};
  const put = (words: string, key: Presentation) => {
    for (const w of words.split(/\s+/).filter(Boolean)) out[w] = (out[w] ?? key) === key ? key : "n"; // iki listede geçen ad uniseks
  };
  put(MALE, "m"); put(FEMALE, "f"); put(NEUTRAL, "n");
  return Object.freeze(out);
}
export const NAME_PRESENTATION: Readonly<Record<string, Presentation>> = buildTable();
export const NAME_LISTS = { MALE, FEMALE, NEUTRAL } as const;

/** Adın ilk sözcüğüne göre `m`/`f`/`n`; bilinmeyen ya da insan-dışı ad ("Ajan 3") `n`. */
export function presentationOfName(name: string | null | undefined): Presentation {
  if (!name) return "n";
  const first = foldName(name).trim().split(/[\s_.-]+/)[0] ?? "";
  return NAME_PRESENTATION[first] ?? "n";
}

export const isPresentation = (v: unknown): v is Presentation => v === "m" || v === "f" || v === "n";

/** Açık seçim (türetilmemiş `avatar.presentation`) kazanır; yoksa addan türetilir. */
export function resolvePresentation(a: Pick<Avatar, "presentation" | "presentationAuto"> | null | undefined, name?: string | null): Presentation {
  if (a && isPresentation(a.presentation) && !a.presentationAuto) return a.presentation;
  return presentationOfName(name);
}

/** Sunuma göre ücretsiz saç/sakal/kıyafet havuzları (backend `presentation.py` HAIR_BY/BEARD_BY/OUTFIT_BY ile aynı). */
export const HAIR_BY: Record<Presentation, readonly HairStyle[]> = {
  m: ["short", "short", "spiky", "curly", "bald", "bun"], f: ["long", "bob", "bun", "ponytail", "curly", "short"],
  n: ["short", "long", "bun", "curly", "spiky", "bob", "ponytail", "bald"],
};
export const BEARD_BY: Record<Presentation, readonly Beard[]> = {
  m: ["none", "none", "stubble", "goatee", "full", "mustache"], f: ["none"], n: ["none", "none", "stubble", "goatee", "full", "mustache"],
};
export const OUTFIT_BY: Record<Presentation, readonly Outfit[]> = {
  m: ["tshirt", "hoodie", "sweater", "overalls", "shirt", "blazer"],
  f: ["tshirt", "hoodie", "sweater", "shirt", "blazer"], // kadın: çizici bunlara etek kesimi giydirir (parts.ts)
  n: ["tshirt", "hoodie", "sweater", "overalls", "shirt", "blazer"],
};
/** Kadın kesimi etek giyen kıyafetler (elbise zaten eteklidir; tulum/kapüşonlu pantolon kalır). */
export const SKIRT_OUTFITS: ReadonlySet<Outfit> = new Set<Outfit>(["tshirt", "shirt", "blazer", "sweater"]);

/**
 * Görünümü sunuma uydurur (yalnız insan): erkek → elbise yerine gömlek; kadın → sakalsız, kel yerine küt saç. Sonuç `presentation`
 * alanını taşır; türetildiyse `presentationAuto: true` (kaydederken atılır, `stripDerived`). Değişen bir şey yoksa AYNI nesne.
 */
export function presentAvatar<T extends Partial<Avatar>>(a: T | null | undefined, name?: string | null): T | null | undefined {
  if (!a || (a.species && a.species !== "human")) return a;
  const explicit = isPresentation(a.presentation) && !a.presentationAuto;
  const p = explicit ? (a.presentation as Presentation) : presentationOfName(name);
  const next: Partial<Avatar> = { ...a };
  if (p === "m" && a.outfit === "dress") next.outfit = "shirt";
  if (p === "f") {
    if (a.beard && a.beard !== "none") next.beard = "none";
    if (a.hair === "bald") next.hair = "bob";
  }
  const want: Partial<Avatar> = explicit ? {} : p === "n" ? {} : { presentation: p, presentationAuto: true };
  if (p === "n" && !explicit) { delete next.presentation; delete next.presentationAuto; }
  Object.assign(next, want);
  const same = (Object.keys(next) as (keyof Avatar)[]).every((k) => next[k] === a[k]) && Object.keys(a).every((k) => k in next);
  return same ? a : (next as T);
}

/** Kaydetmeden önce: türetilen (otomatik) alanları at; açık seçim kalır. */
export function stripDerived<T extends Partial<Avatar>>(a: T): T {
  if (!a || !a.presentationAuto) return a;
  const { presentation: _p, presentationAuto: _a, ...rest } = a;
  return rest as T;
}
