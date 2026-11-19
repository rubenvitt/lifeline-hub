import { useMemo, useState } from 'react';
import { Alert, Button, theme } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLinkClickHandler } from 'react-router';
import dayjs from 'dayjs';
import { useAuthOptional } from '../auth/AuthContext';
import { ladeBenutzerEinstellungen, setzeBenutzerEinstellung } from '../api/benutzerEinstellungen';
import { globalKeys } from '../api/queryKeys';
import type { BenutzerEinstellungen } from '../api/types';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import Tastenkuerzel from '../components/Tastenkuerzel';
import { useViewport } from '../components/useViewport';
import { istApplePlattform } from '../command-palette/befehle';
import { hilfePfad } from '../routing/deeplinks';
import { SCHLUESSEL_WILLKOMMEN_GESCHLOSSEN, istWillkommenOffen } from './willkommen';

/**
 * Willkommenskarte auf der Einsatzliste (LLH-1824): führt Erstnutzer an den Aufbau, die Hilfe zur
 * Seite und die Sprungpalette heran. Sie steht, bis man sie schließt; das merkt sich der Server je
 * Benutzer. Die anschauliche Einführung folgt als eigene Aufgabe (LLH-1990).
 */
export default function WillkommenKarte() {
  const auth = useAuthOptional();
  // Ein gekoppeltes Gerät hat keine Einsatzliste mit Hilfe (LFH-892).
  const benutzerId = auth?.geraet ? null : ((auth?.benutzer as { id?: number } | null)?.id ?? null);
  const client = useQueryClient();
  const key = useMemo(() => globalKeys.benutzerEinstellungenVon(benutzerId), [benutzerId]);
  const { data } = useQuery({
    queryKey: key,
    queryFn: ladeBenutzerEinstellungen,
    enabled: benutzerId != null,
    staleTime: Infinity,
  });
  const [geschlossen, setGeschlossen] = useState(false);
  const { token } = theme.useToken();
  const { istBeruehrung } = useViewport();
  const einweisung = hilfePfad({ gruppe: 'alle' });
  const zurEinweisung = useLinkClickHandler<HTMLElement>(einweisung);

  if (benutzerId == null || geschlossen || !istWillkommenOffen(data)) return null;

  function schliesse() {
    // Sofort weg und nur den eigenen Schlüssel im geteilten Fach ergänzen, nie den ganzen Stand
    // ersetzen: sonst überschriebe die späte Antwort, was `useZuletztBefehle` inzwischen gemerkt
    // hat (dort wird die Antwort aus demselben Grund verworfen). Ein Fehler kostet höchstens ein
    // erneutes Erscheinen in einer späteren Sitzung.
    const wert = alsBackendZeit(dayjs());
    setGeschlossen(true);
    client.setQueryData<BenutzerEinstellungen>(key, (alt) =>
      alt
        ? { ...alt, eintraege: { ...alt.eintraege, [SCHLUESSEL_WILLKOMMEN_GESCHLOSSEN]: wert } }
        : alt,
    );
    setzeBenutzerEinstellung(SCHLUESSEL_WILLKOMMEN_GESCHLOSSEN, wert).catch(() => {});
  }

  const palette = istApplePlattform(navigator.userAgent) ? '⌘ K' : 'Strg + K';

  return (
    <div data-lfh="willkommen-karte" style={{ marginBlockEnd: token.marginLG }}>
      <Alert
        type="info"
        showIcon
        closable={{ 'aria-label': 'Willkommen schließen' }}
        onClose={schliesse}
        title="Willkommen bei Lifeline Hub"
        description={
          <>
            <ul style={{ margin: 0, paddingInlineStart: token.paddingLG }}>
              <li>
                Hier stehen die Einsätze. In einem Einsatz führen links die Module durch die Arbeit.
              </li>
              <li>
                <Tastenkuerzel>?</Tastenkuerzel> oder der Knopf mit dem Fragezeichen öffnet die
                Hilfe zur aktuellen Seite.
              </li>
              <li>
                {istBeruehrung ? (
                  'Die Suche im Kopf findet jedes Modul und jeden Einsatz.'
                ) : (
                  <>
                    <Tastenkuerzel>{palette}</Tastenkuerzel> öffnet die Sprungpalette: sie findet
                    jedes Modul und jeden Einsatz.
                  </>
                )}
              </li>
            </ul>
            <div style={{ display: 'flex', gap: token.marginSM, marginBlockStart: token.marginSM }}>
              <Button href={einweisung} onClick={zurEinweisung}>
                Einweisung lesen
              </Button>
              <Button type="primary" onClick={schliesse}>
                Verstanden
              </Button>
            </div>
          </>
        }
      />
    </div>
  );
}
