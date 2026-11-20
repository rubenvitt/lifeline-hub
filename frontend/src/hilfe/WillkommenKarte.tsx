import { useState } from 'react';
import { Alert, Button, theme } from 'antd';
import { useLinkClickHandler } from 'react-router';
import Tastenkuerzel from '../components/Tastenkuerzel';
import { useViewport } from '../components/useViewport';
import { istApplePlattform } from '../command-palette/befehle';
import { hilfePfad } from '../routing/deeplinks';
import { SCHLUESSEL_WILLKOMMEN_GESCHLOSSEN, istWillkommenOffen } from './willkommen';
import { useEinstellungMerken } from './useEinstellungMerken';
import { useRundgang } from './rundgang/RundgangProvider';

/**
 * Steht fest, ob die Karte erscheint? Die Einsatzliste zeichnet ihren Inhalt erst dann
 * (`frontend/AGENTS.md`, „Modulwechsel zeigt sofort Kopf und Gerippe“: was erst mit den Daten
 * kommt, steht nicht über dem, was schon steht). Käme die Karte nach dem Gerippe, schöbe sie es um
 * ihre Höhe nach unten (183 px, `e2e/einsatzauswahl-cls.spec.ts`). Ohne Stand bleibt die Karte
 * ohnehin weg, deshalb wartet die Liste nicht auf Wiederholungen nach einem Fehlversuch.
 */
export function useWillkommenEntschieden(): boolean {
  return useEinstellungMerken().entschieden;
}

/**
 * Willkommenskarte auf der Einsatzliste (LLH-1824): führt Erstnutzer an den Aufbau, die Hilfe zur
 * Seite und die Sprungpalette heran. Sie steht, bis man sie schließt; das merkt sich der Server je
 * Benutzer. „Rundgang starten“ zeigt die Oberfläche in Sprechblasen (LLH-1990).
 */
export default function WillkommenKarte() {
  // Ein gekoppeltes Gerät hat keine Einsatzliste mit Hilfe (LFH-892): dann ohne Benutzer.
  const { stand: data, benutzerId, merke } = useEinstellungMerken();
  const [geschlossen, setGeschlossen] = useState(false);
  // Rundgang (LLH-1990): fehlt am Handschirm, dann auch der Knopf.
  const { starte: starteRundgang } = useRundgang();
  const { token } = theme.useToken();
  const { istBeruehrung } = useViewport();
  const einweisung = hilfePfad({ gruppe: 'alle' });
  const zurEinweisung = useLinkClickHandler<HTMLElement>(einweisung);

  if (benutzerId == null || geschlossen || !istWillkommenOffen(data)) return null;

  function schliesse() {
    setGeschlossen(true);
    merke(SCHLUESSEL_WILLKOMMEN_GESCHLOSSEN);
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
              {starteRundgang && <Button onClick={starteRundgang}>Rundgang starten</Button>}
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
