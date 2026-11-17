import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

/**
 * Wie lange eine gelöste Zeile nach dem letzten Tipp im Baustein mindestens steht (LLH-1254,
 * `openspec/changes/archive/2026-10-19-k2gckqtq-material-loesen-ohne-sprung/design.md` D3).
 */
export const HOLD_MS = 4000;

/**
 * Ein selbst gelöster Posten. `pending`: die Quelle zeigt ihn noch (das Einheit-DTO gleicht ohne
 * Warten ab), trotzdem steht der Platzhalter, sonst wäre der Knopf noch einmal bedienbar. `gone`:
 * die Quelle zeigt ihn nicht mehr; taucht er wieder auf (Rückgängig, ein anderer ordnet zu),
 * gewinnt die echte Zeile (design.md D4).
 */
interface Geloest<T> {
  p: T;
  /** Stelle in der zuletzt gezeichneten Folge. */
  index: number;
  phase: 'pending' | 'gone';
}

const NO_GELOEST: ReadonlyMap<number, never> = new Map<number, never>();

/**
 * Die gelöste Zeile hält ihre Stelle (LLH-1254, Spec `material-am-ort`, „Gelöste Zeile hält ihre Stelle“;
 * geteilt seit LLH-1722, Spec `bedien-muster`, „Gelöste Zeile hält ihre Stelle“):
 * sonst rückt der Lösen-Auslöser der nächsten Zeile unter Finger oder Zeiger, und ein schneller zweiter
 * Tipp löst den falschen Datensatz. Alle Platzhalter fallen ZUSAMMEN, sobald kein Maus- oder
 * Stiftzeiger über dem Baustein steht, kein Fokus darin liegt und {@link HOLD_MS} seit dem letzten
 * Tipp vergangen ist; einzeln fallende sprängen wieder. Die Bedingungen Zeiger und Fokus folgen der
 * Zuflussschleuse (`components/useZuflussSchleuse.ts`): Touch zählt nicht, weil ein Tipp betritt und
 * verlässt; ein Portal-Menü ist kein Verlassen. Die Schleuse selbst hält nur Zuwachs, Entfallenes
 * fällt dort sofort (design.md D1).
 */
export function useHoldGeloest<T extends { id: number }>(posten: readonly T[], ortKey: string) {
  const [state, setState] = useState<{ ort: string; entries: ReadonlyMap<number, Geloest<T>> }>(
    () => ({ ort: ortKey, entries: NO_GELOEST }),
  );
  // Ein anderer Ort (oder Einsatz) leert: die Platzhalter gehören zum Ort, an dem gelöst wurde.
  const geloest = state.ort === ortKey ? state.entries : NO_GELOEST;
  const update = useCallback(
    (f: (prev: ReadonlyMap<number, Geloest<T>>) => ReadonlyMap<number, Geloest<T>>) =>
      setState((s) => {
        const prev = s.ort === ortKey ? s.entries : NO_GELOEST;
        const next = f(prev);
        return next === prev && s.ort === ortKey ? s : { ort: ortKey, entries: next };
      }),
    [ortKey],
  );

  // Die Folge, wie sie gezeichnet ist: der Platzhalter steht an der Stelle des gelösten Postens,
  // die übrigen in der Folge der Quelle. Mehrere behalten ihre Plätze, weil aufsteigend eingefügt wird.
  const rows = useMemo(() => {
    const present = new Set(posten.map((p) => p.id));
    const list = posten.map((p) => ({ p, isGeloest: geloest.get(p.id)?.phase === 'pending' }));
    [...geloest.values()]
      .filter((g) => !present.has(g.p.id))
      .sort((a, b) => a.index - b.index)
      .forEach((g) => list.splice(Math.min(g.index, list.length), 0, { p: g.p, isGeloest: true }));
    return list;
  }, [posten, geloest]);

  const shownIds = useRef<number[]>([]);
  useLayoutEffect(() => {
    shownIds.current = rows.map((r) => r.p.id);
  });

  // Phasen nachführen; zeichnen tut die Folge oben schon richtig, das hier ist nur Buchhaltung.
  useEffect(() => {
    const present = new Set(posten.map((p) => p.id));
    update((prev) => {
      let next: Map<number, Geloest<T>> | null = null;
      for (const [id, g] of prev) {
        if (present.has(id) && g.phase === 'gone') {
          next ??= new Map(prev);
          next.delete(id);
        } else if (!present.has(id) && g.phase === 'pending') {
          next ??= new Map(prev);
          next.set(id, { ...g, phase: 'gone' });
        }
      }
      return next ?? prev;
    });
  }, [posten, update]);

  const conditions = useRef({ pointer: false, focus: false, lastTap: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const check = useCallback(
    function check() {
      clearTimeout(timer.current);
      const c = conditions.current;
      if (c.pointer || c.focus) return;
      const rest = HOLD_MS - (Date.now() - c.lastTap);
      if (rest > 0) {
        timer.current = setTimeout(check, rest);
        return;
      }
      update((prev) => (prev.size === 0 ? prev : NO_GELOEST));
    },
    [update],
  );
  const isHolding = geloest.size > 0;
  useEffect(() => {
    if (!isHolding) return;
    timer.current = setTimeout(check, HOLD_MS);
    return () => clearTimeout(timer.current);
  }, [isHolding, check]);
  useEffect(() => () => clearTimeout(timer.current), []);

  /** Nach dem Erfolg des Lösens: die Zeile wird Platzhalter, das Lösen zählt als Tipp. */
  const add = useCallback(
    (p: T) => {
      conditions.current.lastTap = Date.now();
      const index = shownIds.current.indexOf(p.id);
      update((prev) =>
        new Map(prev).set(p.id, {
          p,
          index: index < 0 ? shownIds.current.length : index,
          phase: 'pending',
        }),
      );
    },
    [update],
  );
  /** Nach „Rückgängig“: kehrt der Posten in die Quelle zurück, gewinnt die echte Zeile. */
  const release = useCallback(
    (id: number) =>
      update((prev) => {
        const g = prev.get(id);
        return g == null || g.phase === 'gone'
          ? prev
          : new Map(prev).set(id, { ...g, phase: 'gone' });
      }),
    [update],
  );

  const rootProps = {
    onPointerMove: (e: ReactPointerEvent) => {
      if (e.pointerType !== 'touch') conditions.current.pointer = true;
    },
    onPointerLeave: (e: ReactPointerEvent) => {
      if (e.pointerType === 'touch') return;
      conditions.current.pointer = false;
      check();
    },
    onPointerDown: () => {
      conditions.current.lastTap = Date.now();
    },
    onFocus: () => {
      conditions.current.focus = true;
    },
    onBlur: (e: ReactFocusEvent<HTMLDivElement>) => {
      const ziel = e.relatedTarget;
      if (ziel != null && e.currentTarget.contains(ziel)) return;
      if (ziel?.closest?.('.ant-dropdown, .ant-select-dropdown, .ant-picker-dropdown')) return;
      conditions.current.focus = false;
      check();
    },
  };

  return { rows, add, release, rootProps };
}
