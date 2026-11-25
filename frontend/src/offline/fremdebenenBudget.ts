import { EINSATZ_KEYS } from '../api/queryKeys';
import { FREMDEBENE_GRENZEN, type Fremdebene } from '../api/fremdebenen';

/**
 * Höchstens so viele Bytes normiertes GeoJSON der Fremdebenen liegen je Einsatz auf der Platte
 * (LLH-2130, Entscheidung Ruben 25.11.2026). Der Persister schreibt bei jeder Speicherung den
 * ganzen Datensatz; eine Ebene darf 8 MiB haben, ihre Zahl ist nicht begrenzt.
 */
export const FREMDEBENEN_OFFLINE_BUDGET = 16 * 1024 * 1024;

interface Eintrag {
  queryKey: readonly unknown[];
  state: { data?: unknown };
}

const istZahl = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * Lässt von den Daten-Einträgen der Fremdebenen (`[fremdebeneDaten, einsatzId, ebeneId]`) je
 * Einsatz nur so viele stehen, wie ins Budget passen: nach `data_size` der Liste
 * (`[fremdebenen, einsatzId]`) aufsteigend, bei Gleichstand die neuere zuerst. Gezählt wird nur,
 * was im Cache liegt; eine ausgeblendete Ebene lädt nie und zählt nicht. Ohne `data_size` zählt
 * eine Ebene mit dem Höchstwert, ohne Liste oder ohne Eintrag darin fallen die Daten. Alle
 * anderen Einträge bleiben unverändert und in ihrer Reihenfolge.
 */
export function fremdebenenImBudget<E extends Eintrag>(
  eintraege: readonly E[],
  budget: number = FREMDEBENEN_OFFLINE_BUDGET,
): E[] {
  const listen = new Map<number, readonly Fremdebene[]>();
  const kandidaten = new Map<number, { eintrag: E; ebene: Fremdebene }[]>();
  const ohneEbene = new Set<E>();
  for (const e of eintraege) {
    const [prefix, einsatzId] = e.queryKey;
    if (prefix === EINSATZ_KEYS.fremdebenen && istZahl(einsatzId) && Array.isArray(e.state.data)) {
      listen.set(einsatzId, e.state.data as Fremdebene[]);
    }
  }
  for (const e of eintraege) {
    const [prefix, einsatzId, ebeneId] = e.queryKey;
    if (prefix !== EINSATZ_KEYS.fremdebeneDaten) continue;
    const ebene =
      istZahl(einsatzId) && istZahl(ebeneId)
        ? listen.get(einsatzId)?.find((x) => x.id === ebeneId)
        : undefined;
    if (!ebene || !istZahl(einsatzId)) {
      ohneEbene.add(e);
      continue;
    }
    const liste = kandidaten.get(einsatzId) ?? [];
    liste.push({ eintrag: e, ebene });
    kandidaten.set(einsatzId, liste);
  }
  const behalten = new Set<E>();
  for (const liste of kandidaten.values()) {
    const groesse = (f: Fremdebene) =>
      istZahl(f.data_size) ? f.data_size : FREMDEBENE_GRENZEN.geojsonBytes;
    liste.sort(
      (a, b) =>
        groesse(a.ebene) - groesse(b.ebene) || b.ebene.created_at.localeCompare(a.ebene.created_at),
    );
    let summe = 0;
    for (const { eintrag, ebene } of liste) {
      const g = groesse(ebene);
      if (summe + g > budget) break;
      summe += g;
      behalten.add(eintrag);
    }
  }
  return eintraege.filter(
    (e) => e.queryKey[0] !== EINSATZ_KEYS.fremdebeneDaten || (!ohneEbene.has(e) && behalten.has(e)),
  );
}
