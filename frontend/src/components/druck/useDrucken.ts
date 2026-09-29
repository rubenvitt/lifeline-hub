import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ladeOrganisation } from '../../api/organisation';
import { globalKeys } from '../../api/queryKeys';

type DruckZustand = 'bereit' | 'laedt' | 'fehler';

/**
 * Höchstwartezeit auf `decode()` des Logos. Ein Bildabruf, der nie antwortet, hielte den
 * Druckdialog sonst für immer zurück. Danach wird ohne Logo gedruckt, wie beim Dekodierfehler.
 */
const LOGO_FRIST_MS = 3_000;

interface Drucken {
  /** Fordert den Druckdialog an; er öffnet sich, sobald der Druckkopf vollständig ist. */
  drucken: () => void;
  zustand: DruckZustand;
  /** Lädt die Organisation nach einem Fehler neu. */
  wiederholen: () => void;
}

/**
 * Drucken erst mit geladenem Kopf (LFH-22, design.md D2 des Changes `lfh-22-druck-export`).
 *
 * `window.print()` friert das Druckbild im aktuellen Zustand ein; ein Blatt ohne
 * Organisationsnamen wäre nicht zuzuordnen. Der Hook nimmt die Anforderung deshalb nur an und
 * löst den Druck in einem Effekt aus, sobald die Abfrage Daten hat. Der Effekt läuft NACH dem
 * Commit, also steht auch alles, was der Aufrufer im selben Zug gerendert hat, schon im DOM.
 *
 * ZÄHLER STATT FLAG: jede Anforderung bekommt eine Nummer, der Ref merkt die zuletzt erledigte.
 * So löst ein Rendern ohne neue Anforderung nie einen zweiten Dialog aus, und es gibt kein
 * `setState` im Effekt. Scheitert die Abfrage, verfällt eine offene Anforderung: ein Dialog,
 * der Minuten später nach „Erneut laden" von selbst aufginge, wäre eine Überraschung.
 */
export function useDrucken(): Drucken {
  const organisation = useQuery({
    queryKey: globalKeys.organisation(),
    queryFn: ladeOrganisation,
  });
  const [anforderung, setAnforderung] = useState(0);
  const erledigt = useRef(0);
  /**
   * Bereit heißt „Daten da", nicht „letzter Abruf gelungen": nach einem gescheiterten
   * HINTERGRUND-Refetch steht in TanStack v5 `isError`, `data` aber bleibt. Ein Fehler zählt nur,
   * solange es keine Daten gibt.
   */
  const bereit = organisation.data !== undefined;
  const gescheitert = !bereit && organisation.isError;

  useEffect(() => {
    if (anforderung === erledigt.current) return;
    if (gescheitert) {
      erledigt.current = anforderung;
      return;
    }
    if (!bereit) return;
    // `window.print()` NIE direkt aus dem Effekt: es feuert `beforeprint` synchron, und im
    // Passiv-Effekt rendert das `flushSync` der Listener (Druckzeit, Druckform der Tabelle) nicht.
    // Deshalb immer erst nach einem Takt Aufschub.
    //
    // Das Logo muss dekodiert sein, bevor das Druckbild einfriert; gewartet wird höchstens
    // `LOGO_FRIST_MS`. Fehler oder Fristablauf heißen „ohne Logo drucken" (der Druckkopf nimmt das
    // Bild bei einem Fehler weg); der Takt Aufschub sichert, dass dessen Fehlerereignis verarbeitet
    // ist.
    //
    // `erledigt` wird erst beim Drucken gesetzt, nicht beim Einplanen: fällt der Effekt dazwischen
    // neu an, plant der neue Lauf die offene Anforderung erneut ein, statt sie zu verlieren.
    const logos = Array.from(
      document.querySelectorAll<HTMLImageElement>('[data-lfh="druckkopf"] img'),
    );
    let abgebrochen = false;
    let frist: ReturnType<typeof setTimeout> | undefined;
    const dekodiert = Promise.all(
      logos.map((bild) =>
        typeof bild.decode === 'function' ? bild.decode().catch(() => undefined) : undefined,
      ),
    );
    const fristAbgelaufen = new Promise<void>((weiter) => {
      frist = setTimeout(weiter, logos.length > 0 ? LOGO_FRIST_MS : 0);
    });
    void Promise.race([dekodiert, fristAbgelaufen])
      .then(() => {
        clearTimeout(frist);
        return new Promise((weiter) => setTimeout(weiter, 0));
      })
      .then(() => {
        if (abgebrochen) return;
        erledigt.current = anforderung;
        window.print();
      });
    return () => {
      abgebrochen = true;
      clearTimeout(frist);
    };
  }, [anforderung, bereit, gescheitert]);

  const drucken = useCallback(() => setAnforderung((n) => n + 1), []);
  const { refetch } = organisation;
  const wiederholen = useCallback(() => void refetch(), [refetch]);

  const zustand: DruckZustand = bereit ? 'bereit' : gescheitert ? 'fehler' : 'laedt';
  return { drucken, zustand, wiederholen };
}
