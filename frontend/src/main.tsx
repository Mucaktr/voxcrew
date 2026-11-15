// Fontlar paketle birlikte yerel olarak sunulur (ağdan font yok). Türkçe için latin + latin-ext
// alt kümeleri Fontsource'un unicode-range kurallarıyla otomatik yüklenir.
import "@fontsource-variable/inter/opsz.css"; // arayüz ve gövde: wght 100–900 + opsz 14–32
import "@fontsource-variable/inter/opsz-italic.css"; // Markdown vurguları için gerçek italik
import "@fontsource-variable/bricolage-grotesque/opsz.css"; // başlıklar: wght 200–800 + opsz
import "@fontsource-variable/jetbrains-mono/wght.css"; // kod, kimlik, log
import "@fontsource-variable/pixelify-sans/wght.css"; // yalnızca logo ve 3B dünya etiketleri
import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { installUserPresence } from "./lib/presence";

// Kullanıcıya ait uçlara giden isteklere arayüz jetonu eklenir; ilk istekten önce kurulur
installUserPresence();

try {
  const theme = localStorage.getItem("hs-theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch { /* depolama kapalı olabilir */ }

// Tarayıcı çubuğu rengi (theme-color) seçili temanın zeminini izlesin.
function syncThemeColor() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (bg) document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", bg));
}
syncThemeColor();
new MutationObserver(syncThemeColor).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", syncThemeColor);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
