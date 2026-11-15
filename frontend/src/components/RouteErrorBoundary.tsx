// UXF-A — rota hata sınırı. Tembel bir sayfa parçası (ör. ağ/sunucu düşerken `RunsPage-*.js`) yüklenemezse ya da sayfa
// çizerken hata verirse hata kökten yukarı çıkıp tüm uygulamayı sökmesin: yan menü ve kabuk görünür kalır, `<main>` içinde
// açık bir TR/EN ileti, "Tekrar dene" (parçayı yeniden ister; lib/lazyRoute.ts taze lazy kurar) ve "Sayfayı yenile" çıkar.
//  - Tür: çevrimdışı/sunucu kapalı ("offline"), yeni derlemeden sonra eski parça yok (404 → "stale": yenile önerilir) ya da
//    sayfa içi hata ("error"). Teknik ileti "Teknik ayrıntı" altında.
//  - Ağ dönünce (`online`) ya da sekme yeniden görünür olunca yeniden yükleme önerilir (duyurulur; odak çalınmaz).
//  - Rota değişince (`resetKey`) sınır kendiliğinden sıfırlanır. `quiet`: kabuk dışı katmanlar (çekmece, sihirbaz) için
//    hiçbir şey çizmez — o katman yüklenemezse uygulama yine ayakta kalır.
import { CloudOff, RefreshCcw, RotateCw, TriangleAlert } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { probeChunk, resetLazyRoutes, type ChunkFailure } from "../lib/lazyRoute";
import { useT } from "../lib/i18n";
import { routeErrorMsg as M } from "../locales/routeError";
import { Button, Panel } from "./ui";

interface Props { children: ReactNode; resetKey?: unknown; quiet?: boolean }
interface State { error: unknown; kind: ChunkFailure | null; back: boolean; tries: number }

const INITIAL: State = { error: null, kind: null, back: false, tries: 0 };

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = INITIAL;
  private alive = true;

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error ?? new Error("unknown"), kind: null, back: false };
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    void probeChunk(error).then((kind) => { if (this.alive && this.state.error === error) this.setState({ kind }); });
  }

  componentDidMount(): void {
    this.alive = true;
    if (typeof window === "undefined") return;
    window.addEventListener("online", this.onBack);
    document.addEventListener("visibilitychange", this.onVisible);
  }

  componentWillUnmount(): void {
    this.alive = false;
    if (typeof window === "undefined") return;
    window.removeEventListener("online", this.onBack);
    document.removeEventListener("visibilitychange", this.onVisible);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && !Object.is(prev.resetKey, this.props.resetKey)) { resetLazyRoutes(); this.setState(INITIAL); }
  }

  /** Ağ döndü: hata kartı açıksa yeniden yükleme önerilir (kendiliğinden yüklemez; kullanıcı seçer). */
  onBack = (): void => {
    if (this.state.error && (this.state.kind === null || this.state.kind === "offline")) this.setState({ back: true });
  };
  onVisible = (): void => {
    if (document.visibilityState === "visible" && (typeof navigator === "undefined" || navigator.onLine)) this.onBack();
  };

  retry = (): void => {
    resetLazyRoutes();
    this.setState((s) => ({ ...INITIAL, tries: s.tries + 1 }));
  };

  render(): ReactNode {
    const { error, kind, back, tries } = this.state;
    if (!error) return this.props.children;
    if (this.props.quiet) return null;
    return <RouteErrorCard error={error} kind={kind} back={back} tries={tries} onRetry={this.retry} />;
  }
}

/** Kabuk içindeki hata kartı (`<main>` içinde; yan menü dokunulmaz). */
export function RouteErrorCard({ error, kind, back, tries, onRetry, onReload = () => window.location.reload() }: {
  error: unknown; kind: ChunkFailure | null; back: boolean; tries: number; onRetry: () => void; onReload?: () => void;
}) {
  const t = useT(M);
  const stale = kind === "stale";
  const text = t(stale ? "stale" : kind === "error" ? "error" : "offline");
  const detail = error instanceof Error ? error.message : String(error);
  return (
    <div className="p-3 sm:p-5 max-w-[720px] mx-auto" data-route-error={kind ?? "pending"}>
      <Panel>
        <div role="alert" className="flex flex-col items-center text-center gap-3 py-6 px-2">
          <span className="grid place-items-center h-12 w-12 rounded-xl border-2 border-line bg-warn-soft text-warn">
            {stale ? <RotateCw size={24} aria-hidden /> : kind === "error" ? <TriangleAlert size={24} aria-hidden /> : <CloudOff size={24} aria-hidden />}
          </span>
          <h1 className="t-h3">{t("title")}</h1>
          <p className="text-sm text-ink-2 max-w-prose">{text}</p>
          <p role="status" aria-live="polite" className="text-sm font-semibold text-ok empty:hidden">{back ? t("back_online") : ""}</p>
          {tries > 0 && !back && <p className="text-xs text-muted">{t("still", { n: tries })}</p>}
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant={stale ? "default" : "primary"} icon={<RefreshCcw size={15} />} onClick={onRetry}>{t("retry")}</Button>
            <Button variant={stale ? "primary" : "ghost"} icon={<RotateCw size={15} />} onClick={onReload}>{t("reload")}</Button>
          </div>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">{t("details")}</summary>
            <p className="mt-1 font-mono break-all">{detail}</p>
          </details>
        </div>
      </Panel>
    </div>
  );
}
