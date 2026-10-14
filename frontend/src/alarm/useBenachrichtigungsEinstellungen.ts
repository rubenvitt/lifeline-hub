import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ladeBenutzerEinstellungen, setzeBenutzerEinstellung } from '../api/benutzerEinstellungen';
import { globalKeys } from '../api/queryKeys';
import type { BenachrichtigungArt, BenutzerEinstellungen } from '../api/types';
import { useAuthOptional } from '../auth/AuthContext';
import { ALLE_ARTEN, BENACHRICHTIGUNG_ARTEN } from './benachrichtigungKatalog';

/** Schlüssel im Präferenz-Fach (`src/benutzer_einstellungen`, design.md D6). */
export const SCHLUESSEL_BENACHRICHTIGUNGEN_AUS = 'benachrichtigungen_aus';

/** Die abgeschalteten Hinweis-Arten aus dem Fach; Unlesbares und Alarm-Arten fallen weg. */
export function leseAbgeschaltete(e: BenutzerEinstellungen | undefined): BenachrichtigungArt[] {
  const wert = e?.eintraege?.[SCHLUESSEL_BENACHRICHTIGUNGEN_AUS];
  if (!wert) return [];
  let liste: unknown;
  try {
    liste = JSON.parse(wert);
  } catch {
    return [];
  }
  if (!Array.isArray(liste)) return [];
  return ALLE_ARTEN.filter(
    (a) => BENACHRICHTIGUNG_ARTEN[a].stufe === 'hinweis' && liste.includes(a),
  );
}

export interface BenachrichtigungsEinstellungen {
  geladen: boolean;
  fehler: boolean;
  neuLaden: () => void;
  istAn: (art: BenachrichtigungArt) => boolean;
  setze: (art: BenachrichtigungArt, an: boolean) => void;
  /** Die Art, deren Schalter gerade schreibt; nur dieser ist gesperrt. */
  laeuft: BenachrichtigungArt | null;
  /** Die Art, deren letzte Änderung der Server nicht angenommen hat. */
  fehlgeschlagen: BenachrichtigungArt | null;
}

/**
 * Schalter je Hinweis-Art (design.md D6). Die Liste liegt auf dem Server und folgt dem Nutzer
 * über seine Geräte; der Server lehnt Alarm-Arten ab (422).
 *
 * Optimistisch: der Schalter steht sofort. Jede Änderung schickt die ganze Liste aus dem Cache;
 * nur die Antwort der jüngsten Anfrage schreibt zurück, sonst setzte eine späte ältere Antwort
 * eine schnellere zweite Änderung zurück. Scheitert eine, springt nur ihr Schalter zurück.
 */
export function useBenachrichtigungsEinstellungen(): BenachrichtigungsEinstellungen {
  const auth = useAuthOptional();
  const benutzerId = auth?.benutzer?.id ?? null;
  const client = useQueryClient();
  const key = useMemo(() => globalKeys.benutzerEinstellungenVon(benutzerId), [benutzerId]);
  const { data, isSuccess, isError, refetch } = useQuery({
    queryKey: key,
    queryFn: ladeBenutzerEinstellungen,
    enabled: benutzerId != null,
    staleTime: Infinity,
  });
  const [laeuft, setLaeuft] = useState<BenachrichtigungArt | null>(null);
  const [fehlgeschlagen, setFehlgeschlagen] = useState<BenachrichtigungArt | null>(null);
  const anfrageRef = useRef(0);

  const aus = useMemo(() => leseAbgeschaltete(data), [data]);

  const schreibeListe = useCallback(
    (liste: BenachrichtigungArt[]) =>
      client.setQueryData<BenutzerEinstellungen>(key, (alt) => ({
        ...alt,
        eintraege: {
          ...alt?.eintraege,
          [SCHLUESSEL_BENACHRICHTIGUNGEN_AUS]: JSON.stringify(liste),
        },
      })),
    [client, key],
  );

  const setze = useCallback(
    (art: BenachrichtigungArt, an: boolean) => {
      const vorher = leseAbgeschaltete(client.getQueryData<BenutzerEinstellungen>(key));
      const neu = an ? vorher.filter((a) => a !== art) : [...vorher.filter((a) => a !== art), art];
      schreibeListe(neu);
      setLaeuft(art);
      setFehlgeschlagen((f) => (f === art ? null : f));
      const nummer = ++anfrageRef.current;
      setzeBenutzerEinstellung(SCHLUESSEL_BENACHRICHTIGUNGEN_AUS, JSON.stringify(neu))
        .then((antwort) => {
          if (nummer !== anfrageRef.current) return;
          const wert = antwort.eintraege?.[SCHLUESSEL_BENACHRICHTIGUNGEN_AUS];
          client.setQueryData<BenutzerEinstellungen>(key, (alt) => ({
            ...alt,
            geaendert_at: antwort.geaendert_at ?? alt?.geaendert_at,
            eintraege: {
              ...alt?.eintraege,
              [SCHLUESSEL_BENACHRICHTIGUNGEN_AUS]: wert ?? JSON.stringify(neu),
            },
          }));
        })
        .catch(() => {
          // Nur diesen Schalter zurück; andere Änderungen seither bleiben stehen.
          const jetzt = leseAbgeschaltete(client.getQueryData<BenutzerEinstellungen>(key));
          schreibeListe(
            an ? [...jetzt.filter((a) => a !== art), art] : jetzt.filter((a) => a !== art),
          );
          setFehlgeschlagen(art);
        })
        .finally(() => setLaeuft((l) => (l === art ? null : l)));
    },
    [client, key, schreibeListe],
  );

  const istAn = useCallback((art: BenachrichtigungArt) => !aus.includes(art), [aus]);
  const neuLaden = useCallback(() => void refetch(), [refetch]);

  return {
    geladen: isSuccess,
    fehler: isError,
    neuLaden,
    istAn,
    setze,
    laeuft,
    fehlgeschlagen,
  };
}
