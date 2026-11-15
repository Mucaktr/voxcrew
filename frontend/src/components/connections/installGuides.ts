// SETUP — eksik beyinler için adım adım kurulum rehberi VERİSİ (Codex, Claude Code, Hermes, Ollama × Windows/macOS/Linux).
// Saf veri + saf yardımcılar: içe aktarma YOK (node testi `integrations/mcp/test/install-guides.test.mjs` bu dosyayı
// esbuild ile doğrudan yükler). Komutlar ve adresler yalnızca resmî kaynaklardan; kaynak listesi ve erişim tarihi
// içinde. Emin olunmayan derin bağlantı yerine üreticinin belge sayfası verilir.
// Rehber hiçbir şeyi kendisi kurmaz: komut kopyalanır, istenirse BOŞ bir terminal açılır (kullanıcı yapıştırır).

export type GuideOS = "windows" | "macos" | "linux";
export type GuideKind = "codex" | "claude" | "hermes" | "ollama";
export type GuideShell = "powershell" | "cmd" | "sh";
/** free: ücretsiz, hesap yok · account: hesap gerekir (ücretsiz katman olabilir) · paid: ücretli plan ya da API hesabı ·
 *  provider: yazılım ücretsiz ama bir model sağlayıcısı gerekir */
export type GuideCost = "free" | "account" | "paid" | "provider";

export interface L { tr: string; en: string }
export interface GuideStep {
  title: L;
  body?: L;
  /** kopyalanacak tek satırlık resmî komut */
  command?: string;
  /** komutun çalışacağı kabuk ("Terminal aç" düğmesi bu kabuğu açar) */
  shell?: GuideShell;
  /** resmî indirme / belge adresi */
  url?: string;
  urlLabel?: L;
}
export interface GuideMethod { id: string; label: L; recommended?: boolean; steps: GuideStep[] }
export interface OsGuide { methods: GuideMethod[]; requirements?: L }
export interface GuideLogin {
  /** çalıştırılabilir dosyanın adı (PATH'teyse) */
  bin: string;
  /** ad ya da tam yoldan sonra gelen argümanlar ("" = yalnızca aç) */
  args: string;
  body: L;
  /** stüdyo bu komutu kendisi bir terminal penceresinde açabilir mi (POST /api/connections/{kind}/login) */
  terminal: boolean;
}
export interface InstallGuide {
  kind: GuideKind;
  name: string;
  what: L;
  cost: GuideCost;
  costText: L;
  docs: string;
  sources: { label: string; url: string }[];
  os: Record<GuideOS, OsGuide>;
  login: GuideLogin | null;
  after: L;
}

export const GUIDE_OSES: GuideOS[] = ["windows", "macos", "linux"];
export const GUIDE_KINDS: GuideKind[] = ["codex", "claude", "hermes", "ollama"];
export const SOURCES_CHECKED = "2026-10-18";

const step = (title: L, extra: Omit<GuideStep, "title"> = {}): GuideStep => ({ title, ...extra });
const PASTE: L = {
  tr: "Komutu kopyala, bir terminal aç (PowerShell / Terminal), yapıştır ve Enter'a bas.",
  en: "Copy the command, open a terminal (PowerShell / Terminal), paste it and press Enter.",
};
const COME_BACK: L = {
  tr: "Kurulum bitince buraya dön: kart birkaç saniye içinde kendiliğinden yeşile döner ya da “Tekrar kontrol et”e bas.",
  en: "When it's done, come back here: the card turns green within seconds, or press “Check again”.",
};

// ------------------------------------------------------------------ Codex
const CODEX_POSIX = "curl -fsSL https://chatgpt.com/codex/install.sh | sh";
const CODEX_WIN = 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"';
const CODEX_NPM = "npm install -g @openai/codex";
const codexNpm: GuideMethod = {
  id: "npm", label: { tr: "npm ile (Node.js kuruluysa)", en: "With npm (if Node.js is installed)" },
  steps: [step({ tr: "npm ile kur", en: "Install with npm" }, { command: CODEX_NPM, shell: "sh", body: PASTE })],
};

const CODEX: InstallGuide = {
  kind: "codex",
  name: "GPT Codex",
  what: {
    tr: "OpenAI'nin kodlama ajanı. VoxCrew, bilgisayardaki Codex komut satırı aracını (CLI) kullanır; Codex uygulaması da bu aracı kendi içinde getirir.",
    en: "OpenAI's coding agent. The studio uses the Codex command-line tool (CLI) on this computer; the Codex app also ships that tool inside it.",
  },
  cost: "account",
  costText: {
    tr: "ChatGPT hesabı gerekir. OpenAI'nin fiyat sayfasına göre Codex ücretsiz planda sınırlı modellerle, Go, Plus, Pro, Business, Edu ve Enterprise planlarında daha geniş kullanımla gelir. API anahtarıyla giriş standart API ücretleriyle faturalanır. Her görev planının kullanım hakkından düşer.",
    en: "Needs a ChatGPT account. According to OpenAI's pricing page, Codex comes with limited models on the free plan and wider use on Go, Plus, Pro, Business, Edu and Enterprise. Signing in with an API key is billed at standard API rates. Every task counts against your plan's usage.",
  },
  docs: "https://github.com/openai/codex",
  sources: [
    { label: "openai/codex README", url: "https://github.com/openai/codex" },
    { label: "Codex CLI docs", url: "https://learn.chatgpt.com/docs/codex/cli" },
    { label: "Codex pricing", url: "https://learn.chatgpt.com/docs/pricing" },
    { label: "Codex on Windows", url: "https://learn.chatgpt.com/docs/windows/windows-sandbox" },
  ],
  os: {
    windows: {
      requirements: { tr: "Windows 11 önerilir; Windows 10 (1809+) en iyi çabayla desteklenir. WSL gerekmez.", en: "Windows 11 recommended; Windows 10 (1809+) is best effort. WSL is not required." },
      methods: [
        {
          id: "app", recommended: true, label: { tr: "Codex uygulaması (en kolay)", en: "Codex app (easiest)" },
          steps: [
            step({ tr: "Uygulamayı Microsoft Store'dan kur", en: "Install the app from the Microsoft Store" },
              { url: "https://get.microsoft.com/installer/download/9PLM9XGG6VKS?cid=website_cta_psi", urlLabel: { tr: "Microsoft Store", en: "Microsoft Store" } }),
            step({ tr: "Ya da winget ile", en: "Or with winget" }, { command: "winget install --id 9PLM9XGG6VKS -s msstore", shell: "powershell" }),
            step({ tr: "Uygulamayı bir kez aç ve ChatGPT hesabınla giriş yap", en: "Open the app once and sign in with your ChatGPT account" },
              { body: { tr: "Uygulama komut satırı aracını ilk açılışta yerleştirir; VoxCrew onu PATH'te olmasa da kendisi bulur.", en: "The app unpacks its command-line tool on first launch; the studio finds it even when it is not on PATH." } }),
          ],
        },
        {
          id: "cli", label: { tr: "Yalnızca komut satırı aracı", en: "Command-line tool only" },
          steps: [step({ tr: "Resmî yükleyiciyi PowerShell'de çalıştır", en: "Run the official installer in PowerShell" }, { command: CODEX_WIN, shell: "powershell", body: PASTE })],
        },
        { ...codexNpm, steps: [{ ...codexNpm.steps[0], shell: "powershell" }] },
      ],
    },
    macos: {
      methods: [
        {
          id: "app", recommended: true, label: { tr: "Codex uygulaması (en kolay)", en: "Codex app (easiest)" },
          steps: [
            step({ tr: "Uygulamayı indir ve Uygulamalar klasörüne taşı", en: "Download the app and move it to Applications" },
              { url: "https://persistent.oaistatic.com/codex-app-prod/Codex.dmg", urlLabel: { tr: "Codex.dmg (Apple Silicon)", en: "Codex.dmg (Apple Silicon)" } }),
            step({ tr: "Uygulamayı bir kez aç ve ChatGPT hesabınla giriş yap", en: "Open the app once and sign in with your ChatGPT account" }),
          ],
        },
        {
          id: "cli", label: { tr: "Yalnızca komut satırı aracı", en: "Command-line tool only" },
          steps: [step({ tr: "Resmî yükleyiciyi Terminal'de çalıştır", en: "Run the official installer in Terminal" }, { command: CODEX_POSIX, shell: "sh", body: PASTE })],
        },
        {
          id: "brew", label: { tr: "Homebrew ile", en: "With Homebrew" },
          steps: [step({ tr: "Homebrew ile kur", en: "Install with Homebrew" }, { command: "brew install --cask codex", shell: "sh" })],
        },
        codexNpm,
      ],
    },
    linux: {
      methods: [
        {
          id: "cli", recommended: true, label: { tr: "Resmî yükleyici", en: "Official installer" },
          steps: [step({ tr: "Resmî yükleyiciyi terminalde çalıştır", en: "Run the official installer in a terminal" }, { command: CODEX_POSIX, shell: "sh", body: PASTE })],
        },
        codexNpm,
      ],
    },
  },
  login: {
    bin: "codex", args: "login", terminal: true,
    body: {
      tr: "Tarayıcı açılır, “Sign in with ChatGPT” ile giriş yaparsın. Kartta “Oturum” zaten işaretliyse bu adım gerekmez.",
      en: "A browser opens; sign in with “Sign in with ChatGPT”. If the card already shows “Signed in”, skip this step.",
    },
  },
  after: COME_BACK,
};

// ------------------------------------------------------------------ Claude Code
const CLAUDE_POSIX = "curl -fsSL https://claude.ai/install.sh | bash";
const CLAUDE: InstallGuide = {
  kind: "claude",
  name: "Claude Code",
  what: {
    tr: "Anthropic'in terminalde çalışan kodlama ajanı. VoxCrew bilgisayardaki `claude` aracını kullanır.",
    en: "Anthropic's coding agent that runs in the terminal. The studio uses the `claude` tool on this computer.",
  },
  cost: "paid",
  costText: {
    tr: "Ücretli bir Claude planı (Pro, Max, Team ya da Enterprise) veya Claude Console (API) hesabı gerekir; ücretsiz claude.ai planı Claude Code'u kapsamaz. Her görev planının kullanımından ya da API bakiyesinden düşer.",
    en: "Needs a paid Claude plan (Pro, Max, Team or Enterprise) or a Claude Console (API) account; the free claude.ai plan does not include Claude Code. Every task counts against your plan's usage or API balance.",
  },
  docs: "https://code.claude.com/docs/en/setup",
  sources: [
    { label: "Claude Code setup", url: "https://code.claude.com/docs/en/setup" },
    { label: "Claude Code authentication", url: "https://code.claude.com/docs/en/authentication" },
  ],
  os: {
    windows: {
      requirements: {
        tr: "Windows 10 (1809+) ya da Windows Server 2019+, 4 GB+ bellek; yönetici izni gerekmez. Git for Windows isteğe bağlı ama önerilir.",
        en: "Windows 10 (1809+) or Windows Server 2019+, 4 GB+ RAM; no admin rights needed. Git for Windows is optional but recommended.",
      },
      methods: [
        {
          id: "native", recommended: true, label: { tr: "Resmî yükleyici (PowerShell)", en: "Official installer (PowerShell)" },
          steps: [step({ tr: "PowerShell'de çalıştır", en: "Run in PowerShell" }, { command: "irm https://claude.ai/install.ps1 | iex", shell: "powershell", body: PASTE })],
        },
        {
          id: "cmd", label: { tr: "Komut İstemi (CMD)", en: "Command Prompt (CMD)" },
          steps: [step({ tr: "CMD'de çalıştır", en: "Run in CMD" }, { command: "curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd", shell: "cmd" })],
        },
        {
          id: "winget", label: { tr: "WinGet ile", en: "With WinGet" },
          steps: [step({ tr: "WinGet ile kur (kendiliğinden güncellenmez)", en: "Install with WinGet (no auto-update)" }, { command: "winget install Anthropic.ClaudeCode", shell: "powershell" })],
        },
      ],
    },
    macos: {
      requirements: { tr: "macOS 13.0+ ve 4 GB+ bellek.", en: "macOS 13.0+ and 4 GB+ RAM." },
      methods: [
        {
          id: "native", recommended: true, label: { tr: "Resmî yükleyici", en: "Official installer" },
          steps: [step({ tr: "Terminal'de çalıştır", en: "Run in Terminal" }, { command: CLAUDE_POSIX, shell: "sh", body: PASTE })],
        },
        {
          id: "brew", label: { tr: "Homebrew ile", en: "With Homebrew" },
          steps: [step({ tr: "Homebrew ile kur (kendiliğinden güncellenmez)", en: "Install with Homebrew (no auto-update)" }, { command: "brew install --cask claude-code", shell: "sh" })],
        },
      ],
    },
    linux: {
      requirements: { tr: "Ubuntu 20.04+, Debian 10+ ya da Alpine 3.19+; 4 GB+ bellek.", en: "Ubuntu 20.04+, Debian 10+ or Alpine 3.19+; 4 GB+ RAM." },
      methods: [
        {
          id: "native", recommended: true, label: { tr: "Resmî yükleyici", en: "Official installer" },
          steps: [step({ tr: "Terminalde çalıştır", en: "Run in a terminal" }, { command: CLAUDE_POSIX, shell: "sh", body: PASTE })],
        },
      ],
    },
  },
  login: {
    bin: "claude", args: "", terminal: true,
    body: {
      tr: "`claude` açılınca tarayıcıda giriş yaparsın (“Login successful”). Sonra oturumu yenilemek için Claude içinde `/login` yazabilirsin.",
      en: "When `claude` starts, you sign in in the browser (“Login successful”). Later you can type `/login` inside Claude to sign in again.",
    },
  },
  after: COME_BACK,
};

// ------------------------------------------------------------------ Hermes
const HERMES_POSIX = "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash";
const HERMES_DOCS = "https://hermes-agent.nousresearch.com/docs/getting-started/installation";
const HERMES: InstallGuide = {
  kind: "hermes",
  name: "Hermes Agent",
  what: {
    tr: "Nous Research'ün açık kaynak ajan çalışma zamanı: profiller, araçlar ve bellek. İsteğe bağlıdır; ajanlar Ollama, Codex ya da Claude Code ile Hermes olmadan da çalışır.",
    en: "Nous Research's open-source agent runtime: profiles, tools and memory. Optional; agents also run without it on Ollama, Codex or Claude Code.",
  },
  cost: "provider",
  costText: {
    tr: "Yazılım ücretsizdir (MIT lisansı) ama bir model sağlayıcısı ister: yerel Ollama (ücretsiz), kendi API anahtarın ya da ücretli Nous Portal aboneliği. Araç kullanımı için en az 64K bağlamlı bir model gerekir.",
    en: "The software is free (MIT license) but needs a model provider: local Ollama (free), your own API key, or a paid Nous Portal subscription. Tool use needs a model with at least 64K context.",
  },
  docs: HERMES_DOCS,
  sources: [
    { label: "Hermes installation", url: HERMES_DOCS },
    { label: "Hermes platform support", url: "https://hermes-agent.nousresearch.com/docs/getting-started/platform-support" },
    { label: "Hermes providers", url: "https://hermes-agent.nousresearch.com/docs/integrations/providers" },
    { label: "NousResearch/hermes-agent", url: "https://github.com/NousResearch/hermes-agent" },
  ],
  os: {
    windows: {
      requirements: { tr: "Windows 10/11 (x64, arm64) yerel olarak desteklenir; WSL gerekmez. Git yoksa yükleyici kurabilir.", en: "Windows 10/11 (x64, arm64) is supported natively; WSL is not needed. The installer can set up Git if it is missing." },
      methods: [
        {
          id: "cli", recommended: true, label: { tr: "Resmî yükleyici (PowerShell)", en: "Official installer (PowerShell)" },
          steps: [
            step({ tr: "PowerShell'de çalıştır", en: "Run in PowerShell" }, { command: "iex (irm https://hermes-agent.nousresearch.com/install.ps1)", shell: "powershell", body: PASTE }),
            step({ tr: "Yeni bir terminal aç", en: "Open a new terminal" }, { body: { tr: "Yükleyicinin eklediği `hermes` komutu yeni pencerede tanınır.", en: "The `hermes` command added by the installer is recognised in a new window." } }),
          ],
        },
        {
          id: "desktop", label: { tr: "Masaüstü uygulaması", en: "Desktop app" },
          steps: [step({ tr: "Masaüstü uygulamasını resmî siteden indir (Windows 11 22H2+)", en: "Download the desktop app from the official site (Windows 11 22H2+)" },
            { url: "https://hermes-agent.nousresearch.com/", urlLabel: { tr: "hermes-agent.nousresearch.com", en: "hermes-agent.nousresearch.com" } })],
        },
      ],
    },
    macos: {
      requirements: { tr: "Apple Silicon tam desteklenir; Intel Mac sınırlı. Homebrew ve PyPI kurulumları desteklenmez.", en: "Apple Silicon is fully supported; Intel Macs are limited. Homebrew and PyPI installs are not supported." },
      methods: [
        {
          id: "cli", recommended: true, label: { tr: "Resmî yükleyici", en: "Official installer" },
          steps: [
            step({ tr: "Terminal'de çalıştır", en: "Run in Terminal" }, { command: HERMES_POSIX, shell: "sh", body: PASTE }),
            step({ tr: "Kabuğu yenile", en: "Reload your shell" }, { command: "source ~/.zshrc", shell: "sh" }),
          ],
        },
      ],
    },
    linux: {
      requirements: { tr: "git, curl ve tar gerekir; glibc dağıtımlarında libatomic1.", en: "Needs git, curl and tar; libatomic1 on glibc distributions." },
      methods: [
        {
          id: "cli", recommended: true, label: { tr: "Resmî yükleyici", en: "Official installer" },
          steps: [
            step({ tr: "Terminalde çalıştır", en: "Run in a terminal" }, { command: HERMES_POSIX, shell: "sh", body: PASTE }),
            step({ tr: "Kabuğu yenile", en: "Reload your shell" }, { command: "source ~/.bashrc", shell: "sh" }),
          ],
        },
      ],
    },
  },
  login: {
    bin: "hermes", args: "setup", terminal: false,
    body: {
      tr: "Kurulum sihirbazı model sağlayıcısını sorar. Ücretsiz yol: “Custom endpoint” ve adres http://localhost:11434/v1 (Ollama, anahtar yok). Yalnızca modeli değiştirmek için `hermes model`.",
      en: "The setup wizard asks for a model provider. Free route: “Custom endpoint” with http://localhost:11434/v1 (Ollama, no key). To change only the model: `hermes model`.",
    },
  },
  after: {
    tr: "VoxCrew Hermes'i ~/.hermes (Windows'ta %LOCALAPPDATA%\\hermes de) altında arar. Bulamazsa kartta “Klasör seç” çıkar; yalnızca VoxCrew ayarı değişir.",
    en: "The studio looks for Hermes under ~/.hermes (on Windows also %LOCALAPPDATA%\\hermes). If it isn't found, the card offers “Pick folder”; only the studio setting changes.",
  },
};

// ------------------------------------------------------------------ Ollama
const OLLAMA_POSIX = "curl -fsSL https://ollama.com/install.sh | sh";
const OLLAMA: InstallGuide = {
  kind: "ollama",
  name: "Ollama",
  what: {
    tr: "Açık modelleri bu bilgisayarda çalıştırır. İstemlerin bilgisayardan çıkmaz; internet yalnızca model indirirken gerekir.",
    en: "Runs open models on this computer. Your prompts stay on this computer; internet is only needed to download models.",
  },
  cost: "free",
  costText: {
    tr: "Ücretsiz; yerel modeller için hesap gerekmez. Yalnızca isteğe bağlı Ollama bulut modelleri için `ollama signin` ile giriş gerekir. Modeller disk (birkaç GB) ve bellek kullanır.",
    en: "Free; no account is needed for local models. Only the optional Ollama cloud models need `ollama signin`. Models use disk (a few GB) and memory.",
  },
  docs: "https://ollama.com/download",
  sources: [
    { label: "Ollama download", url: "https://ollama.com/download" },
    { label: "Ollama on Windows", url: "https://docs.ollama.com/windows" },
    { label: "Ollama on macOS", url: "https://docs.ollama.com/macos" },
    { label: "Ollama on Linux", url: "https://docs.ollama.com/linux" },
  ],
  os: {
    windows: {
      requirements: { tr: "Windows 10 22H2+ (Home ya da Pro); yönetici izni gerekmez, yaklaşık 4 GB disk + modeller.", en: "Windows 10 22H2+ (Home or Pro); no admin rights, about 4 GB disk plus models." },
      methods: [
        {
          id: "installer", recommended: true, label: { tr: "Yükleyici (en kolay)", en: "Installer (easiest)" },
          steps: [
            step({ tr: "OllamaSetup.exe'yi indir ve çalıştır", en: "Download and run OllamaSetup.exe" },
              { url: "https://ollama.com/download/OllamaSetup.exe", urlLabel: { tr: "OllamaSetup.exe", en: "OllamaSetup.exe" } }),
            step({ tr: "Ollama uygulamasını aç", en: "Open the Ollama app" }, { body: { tr: "Uygulama arka planda çalışır; VoxCrew onu kendiliğinden görür.", en: "The app runs in the background; the studio sees it by itself." } }),
          ],
        },
        {
          id: "ps", label: { tr: "PowerShell ile", en: "With PowerShell" },
          steps: [step({ tr: "PowerShell'de çalıştır", en: "Run in PowerShell" }, { command: "irm https://ollama.com/install.ps1 | iex", shell: "powershell", body: PASTE })],
        },
      ],
    },
    macos: {
      requirements: { tr: "macOS 14 Sonoma+; Apple Silicon'da GPU hızlandırma, Intel'de yalnız CPU.", en: "macOS 14 Sonoma+; GPU acceleration on Apple Silicon, CPU only on Intel." },
      methods: [
        {
          id: "app", recommended: true, label: { tr: "Uygulama (en kolay)", en: "App (easiest)" },
          steps: [
            step({ tr: "Ollama.dmg'yi indir ve Uygulamalar'a taşı", en: "Download Ollama.dmg and move it to Applications" },
              { url: "https://ollama.com/download/Ollama.dmg", urlLabel: { tr: "Ollama.dmg", en: "Ollama.dmg" } }),
            step({ tr: "Ollama uygulamasını aç", en: "Open the Ollama app" }),
          ],
        },
        {
          id: "script", label: { tr: "Terminal ile", en: "With Terminal" },
          steps: [step({ tr: "Terminal'de çalıştır", en: "Run in Terminal" }, { command: OLLAMA_POSIX, shell: "sh", body: PASTE })],
        },
      ],
    },
    linux: {
      methods: [
        {
          id: "script", recommended: true, label: { tr: "Resmî yükleyici", en: "Official installer" },
          steps: [step({ tr: "Terminalde çalıştır", en: "Run in a terminal" }, { command: OLLAMA_POSIX, shell: "sh", body: PASTE })],
        },
      ],
    },
  },
  login: null,
  after: {
    tr: "Ollama çalışınca kart yeşile döner; sonra VoxCrew donanımına uygun bir model indirmeyi önerir (onayınla).",
    en: "Once Ollama runs, the card turns green; then the studio suggests a model that fits your hardware (with your OK).",
  },
};

export const INSTALL_GUIDES: Record<GuideKind, InstallGuide> = { codex: CODEX, claude: CLAUDE, hermes: HERMES, ollama: OLLAMA };

export function isGuideKind(k: unknown): k is GuideKind {
  return typeof k === "string" && (GUIDE_KINDS as string[]).includes(k);
}

/** Tarayıcının işletim sistemi (stüdyo yerel çalıştığı için arayüz ile araçlar aynı bilgisayardadır). */
export function detectGuideOS(platform: string, userAgent = ""): GuideOS {
  const s = `${platform} ${userAgent}`.toLowerCase();
  if (s.includes("win")) return "windows";
  if (s.includes("mac") || s.includes("darwin") || s.includes("iphone") || s.includes("ipad")) return "macos";
  return "linux";
}

/** Giriş / kurulum sonrası komutu: araç PATH'te değilse TAM YOLLA (PowerShell'de `&` çağrı işleciyle). */
export function loginCommand(login: GuideLogin, os: GuideOS, installPath?: string | null, onPath?: boolean | null): string {
  const tail = login.args ? ` ${login.args}` : "";
  if (installPath && onPath === false) {
    return os === "windows" ? `& "${installPath}"${tail}` : `"${installPath}"${tail}`;
  }
  return `${login.bin}${tail}`;
}

export function pick(l: L, locale: string): string {
  return locale === "en" ? l.en : l.tr;
}
