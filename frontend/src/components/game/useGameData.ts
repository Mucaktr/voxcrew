// Ekip S5 — sayfa verisi: ilk yükleme + game.* olaylarından sonra (yumuşatılmış) yeniden yükleme.
import { useCallback, useEffect, useRef, useState } from "react";
import { useGame } from "../../lib/game";

export function useGameData<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const pulse = useGame((s) => s.pulse);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loader = useRef(load);
  loader.current = load;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await loader.current();
      if (my === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (my === seq.current) setError(String((e as Error).message ?? e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pulse) return;
    const id = window.setTimeout(() => { void reload(); }, 700);
    return () => window.clearTimeout(id);
  }, [pulse, reload]);

  return { data, error, loading, reload, setData };
}
