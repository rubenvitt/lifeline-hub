import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import type { StatusKategorie } from '../api/types';
import { parseRouteId } from '../routing/deeplinks';
import { liesErlaubt, useAdressSuche } from '../routing/useAdressWert';
import { useAdressAenderung } from '../routing/useLinkAuftrag';
import type { MeldebildFilter } from '../pages/KraefteuebersichtPage';

/** Exhaustiv: eine neue Kategorie wird hier zur Typfrage, nicht zum stillen Verwerfen. */
const KATEGORIE_ERLAUBT: Record<StatusKategorie, true> = {
  verfuegbar: true,
  gebunden: true,
  nicht_verfuegbar: true,
};

/**
 * Die Parameter des Filters. Der Abschnitt heißt `filter_abschnitt`, nicht `abschnitt`: das ist
 * ein Deeplink-Ziel (Einsatzabschnitte), und mit ihm hielte die Rollposition still
 * (`routing/rollGedaechtnis.guard.test.ts`).
 */
export const MELDEBILD_PARAMETER = [
  'filter_abschnitt',
  'traeger',
  'kategorie',
  'ohne_auftrag',
  'rueckmeldung_fehlt',
  'q',
] as const;

/** Die Felder außer der Suche, aus den Parametern; Fehlendes und Unbekanntes ist leer. */
function liesFilter(params: URLSearchParams): Omit<MeldebildFilter, 'suche'> {
  return {
    abschnittId: parseRouteId(params.get('filter_abschnitt') ?? undefined),
    traeger: params.get('traeger') || null,
    kategorie: liesErlaubt(params, 'kategorie', KATEGORIE_ERLAUBT) ?? null,
    ohneAuftrag: params.get('ohne_auftrag') === '1',
    rueckmeldungFehlt: params.get('rueckmeldung_fehlt') === '1',
  };
}

/**
 * Der Filter des Meldebilds als Zustand der Adresse (LLH-1826, Entwurf D3): `filter_abschnitt`,
 * `traeger`, `kategorie`, `ohne_auftrag=1`, `rueckmeldung_fehlt=1` und die Suche `q` (entprellt,
 * das Feld zeigt sofort). Ein leerer Wert steht nicht in der Adresse. Der Setter ist stabil und
 * rechnet vom ausstehenden Stand, zwei Änderungen im selben Zug bauen aufeinander auf.
 */
export function useMeldebildFilter(): [
  MeldebildFilter,
  (aenderung: MeldebildFilter | ((alt: MeldebildFilter) => MeldebildFilter)) => void,
] {
  const [params] = useSearchParams();
  const [suche, setzeSuche] = useAdressSuche();
  const aendereAdresse = useAdressAenderung();
  const ohneSuche = useMemo(() => liesFilter(params), [params]);
  const filter = useMemo(() => ({ ...ohneSuche, suche }), [ohneSuche, suche]);

  const stand = useRef({ aendereAdresse, suche, setzeSuche });
  useLayoutEffect(() => {
    stand.current = { aendereAdresse, suche, setzeSuche };
  });
  const setze = useCallback(
    (aenderung: MeldebildFilter | ((alt: MeldebildFilter) => MeldebildFilter)) => {
      const { aendereAdresse: aendere, suche: text, setzeSuche: sucheSetzen } = stand.current;
      let neueSuche = text;
      aendere((p) => {
        const alt = { ...liesFilter(p), suche: text };
        const neu = typeof aenderung === 'function' ? aenderung(alt) : aenderung;
        neueSuche = neu.suche;
        const schreibe = (name: string, wert: string | null | undefined) => {
          if (wert == null || wert === '') p.delete(name);
          else p.set(name, wert);
        };
        schreibe('filter_abschnitt', neu.abschnittId == null ? null : String(neu.abschnittId));
        schreibe('traeger', neu.traeger);
        schreibe('kategorie', neu.kategorie);
        schreibe('ohne_auftrag', neu.ohneAuftrag ? '1' : null);
        schreibe('rueckmeldung_fehlt', neu.rueckmeldungFehlt ? '1' : null);
        // Leeren wirkt sofort (Zurücksetzen, Marke schließen); Tippen geht entprellt übers Feld.
        if (neu.suche === '') p.delete('q');
      });
      if (neueSuche !== text) sucheSetzen(neueSuche);
    },
    [],
  );
  return [filter, setze];
}
