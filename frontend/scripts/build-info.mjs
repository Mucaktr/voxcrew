// STALE-DIST — derleme kimliği: `vite build` sonunda `dist/build-info.json` yazılır (vite.config.ts eklentisi).
// Sunucu (backend/studio/buildinfo.py) bunu kaynakla karşılaştırır; arayüz eskiyse açılışta uyarır ve arayüzde bant gösterir.
//
//   { schema, commit, dirty, built_at, source_hash }
//
// - commit: derlemedeki git HEAD (git yoksa / depo değilse null)
// - dirty: frontend/src ya da package-lock.json'da işlenmemiş değişiklik var mı (git yoksa null)
// - source_hash: frontend/src altındaki dosyalar + package-lock.json için sha256 (algoritma Python tarafıyla birebir aynı:
//   studio.buildinfo.source_hash). Yol yazılmaz.
//
// Bağımlılık yok (yalnız node: modülleri). Elle: node scripts/build-info.mjs [çıktı-klasörü]   (varsayılan: dist)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FRONTEND_DIR = fileURLToPath(new URL("..", import.meta.url));
export const BUILD_INFO_FILE = "build-info.json";
export const BUILD_INFO_SCHEMA = 1;

/** `src/` altındaki düzenli dosyalar (nokta ile başlayanlar hariç), POSIX göreli yollarla; sembolik bağ izlenmez. */
function listFiles(dir, rel) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...listFiles(join(dir, e.name), r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

/** Kaynak özeti: UTF-8 bayt sırasıyla dizilmiş her dosya için `"<yol>\0<sha256hex>\n"`; sonuç `sha256:<hex>`. */
export function sourceHash(frontendDir = FRONTEND_DIR) {
  const files = listFiles(join(frontendDir, "src"), "src");
  try { readFileSync(join(frontendDir, "package-lock.json")); files.push("package-lock.json"); } catch { /* yok */ }
  files.sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
  const h = createHash("sha256");
  for (const rel of files) {
    const digest = createHash("sha256").update(readFileSync(join(frontendDir, ...rel.split("/")))).digest("hex");
    h.update(`${rel}\0${digest}\n`, "utf8");
  }
  return `sha256:${h.digest("hex")}`;
}

function git(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000, windowsHide: true }).trim();
  } catch {
    return null;
  }
}

/** Derleme kimliği nesnesi (git yoksa commit/dirty null; derleme yine de sürer). */
export function buildInfo(frontendDir = FRONTEND_DIR, now = new Date()) {
  const repo = resolve(frontendDir, "..");
  // yalnız bu deponun kendi git'i: üst klasördeki ilgisiz bir depo commit'i yanlış kimlik vermesin
  const head = existsSync(join(repo, ".git")) ? git(["rev-parse", "HEAD"], repo) : null;
  const commit = head && /^[0-9a-f]{7,64}$/.test(head) ? head : null;
  let dirty = null;
  if (commit) {
    const status = git(["status", "--porcelain", "--", "frontend/src", "frontend/package-lock.json"], repo);
    dirty = status === null ? null : status.length > 0;
  }
  return { schema: BUILD_INFO_SCHEMA, commit, dirty, built_at: now.toISOString(), source_hash: sourceHash(frontendDir) };
}

export function writeBuildInfo(outDir, frontendDir = FRONTEND_DIR) {
  const info = buildInfo(frontendDir);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, BUILD_INFO_FILE), `${JSON.stringify(info, null, 2)}\n`, "utf8");
  return info;
}

/** Vite eklentisi: yalnız `vite build`; paket diske yazıldıktan sonra çalışır (başarısız derlemede yazılmaz). */
export function buildInfoPlugin() {
  let outDir = null;
  return {
    name: "voxcrew-build-info",
    apply: "build",
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    writeBundle() {
      const info = writeBuildInfo(outDir);
      const commit = info.commit ? info.commit.slice(0, 12) : "git yok";
      console.log(`build-info.json yazıldı (${commit}${info.dirty ? ", işlenmemiş değişiklik var" : ""})`);
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] || join(FRONTEND_DIR, "dist"));
  const info = writeBuildInfo(out);
  console.log(JSON.stringify(info));
}
