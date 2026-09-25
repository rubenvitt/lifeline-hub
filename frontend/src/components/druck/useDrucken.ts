import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ladeOrganisation } from '../../api/organisation';
import { globalKeys } from '../../api/queryKeys';

export type DruckZustand = 'bereit' | 'laedt' | 'fehler';

export interface Drucken {
  /** Fordert den Druckdialog an; er öffnet sich, sobald der Druckkopf vollständig ist. */
  drucken: () => void;
  zustand: DruckZustand;
  /** Lädt die Organisation nach einem Fehler neu. */
  wiederholen: () => void;
}

/**
 * Drucken erst mit geladenem Kopf (LFH-22, design.md D2 des Changes `lfh-22-druck-export`).
 *
 * `window.print()` friert das Druckbild in dem Zustand ein, in dem die Seite GERADE steht.
 * Ein Klick, bevor die Organisation geladen ist, druckte ein Blatt ohne Organisationsnamen —
 * nicht zuzuordnen, und niemand merkt es vor dem Einsammeln. Der Hook nimmt die Anforderung
 * deshalb nur an und löst den Druck in einem Effekt aus, sobald die Abfrage erfolgreich
 * war. Weil der Effekt NACH dem Commit läuft, steht dann auch alles, was der Aufrufer im
 * selben Zug gerendert hat (Meldebild: aufgeklappte Mittel), schon im DOM — das ersetzt den
 * früheren `printPending`-Effekt der Seite.
 *
 * ZÄHLER STATT FLAG: jede Anforderung bekommt eine Nummer, der Ref merkt die zuletzt
 * erledigte. So löst ein Rendern ohne neue Anforderung nie einen zweiten Dialog aus, und es
 * gibt kein `setState` im Effekt. Scheitert die Abfrage, verfällt eine offene Anforderung:
 * ein Druckdialog, der Minuten nach dem Klick von selbst aufgeht, weil „Erneut laden"
 * gelang, wäre eine Überraschung, keine Bedienung.
 */
export function useDrucken(): Drucken {
  const organisation = useQuery({
    queryKey: globalKeys.organisation(),
    queryFn: ladeOrganisation,
  });
  const [anforderung, setAnforderung] = useState(0);
  const erledigt = useRef(0);

  useEffect(() => {
    if (anforderung === erledigt.current) return;
    if (organisation.isError) {
      erledigt.current = anforderung;
      return;
    }
    if (!organisation.isSuccess) return;
    // `window.print()` NIE direkt aus dem Effekt: es feuert `beforeprint` synchron, und im
    // Passiv-Effekt steht React noch im Commit-Kontext — das `flushSync` der Listener
    // (Druckkopf: Druckzeit, KatalogTabelle: Druckform) rendert dort nicht, das Blatt trüge
    // den Stand vom Seitenaufbau. Deshalb immer erst nach einem Takt Aufschub.
    //
    // Das Logo im Druckkopf muss dekodiert sein, bevor das Druckbild einfriert — ein
    // nicht geladenes Bild fehlt dort, oder es steht ein leerer Rahmen. Ein Fehler zählt
    // als „ohne Logo drucken" (der Druckkopf nimmt das Bild dann weg); der Takt Aufschub
    // stellt dann zugleich sicher, dass dessen Fehlerereignis verarbeitet ist.
    //
    // `erledigt` wird erst beim Drucken gesetzt, nicht beim Einplanen: fällt der Effekt
    // dazwischen neu an (eine Abhängigkeit kippt), räumt das Aufräumen den alten Lauf ab,
    // und der neue plant die noch offene Anforderung erneut ein, statt sie still zu verlieren.
    const logos = Array.from(
      document.querySelectorAll<HTMLImageElement>('[data-lfh="druckkopf"] img'),
    );
    let abgebrochen = false;
    void Promise.all(
      logos.map((bild) =>
        typeof bild.decode === 'function' ? bild.decode().catch(() => undefined) : undefined,
      ),
    )
      .then(() => new Promise((weiter) => setTimeout(weiter, 0)))
      .then(() => {
        if (abgebrochen) return;
        erledigt.current = anforderung;
        window.print();
      });
    return () => {
      abgebrochen = true;
    };
  }, [anforderung, organisation.isSuccess, organisation.isError]);

  const drucken = useCallback(() => setAnforderung((n) => n + 1), []);
  const { refetch } = organisation;
  const wiederholen = useCallback(() => void refetch(), [refetch]);

  const zustand: DruckZustand = organisation.isSuccess
    ? 'bereit'
    : organisation.isError
      ? 'fehler'
      : 'laedt';
  return { drucken, zustand, wiederholen };
}
