/**
 * Auswahlmenü für übereinanderliegende Flächen der Lagekarte (LFH-812). Liegen am Tipppunkt zwei
 * oder mehr Flächen (`entscheideKlickziel` → `mehrdeutig`), wählt der Mensch hier selbst.
 *
 * Bedienung nach Leitlinie „Datensatz-Aktionen": antds `Dropdown` im Portal mit `autoFocus`
 * (Pfeile, Enter, Esc bringt das Menü mit), Einträge in der Steuerhöhe der Dichtestufe
 * (`flaechenwahlEintragStil`). Verankert an einem unsichtbaren Punkt am Tipppunkt. Jeder Weg hinaus
 * gibt den Fokus an die Karte zurück (`fokusZiel`). Esc bei offenem Menü erkennt der Zeichnen-Esc
 * über `escGehoertOverlay` als Overlay.
 */
import { useEffect, useRef } from 'react';
import { Dropdown, theme } from 'antd';
import { flaechenwahlEintragStil } from './flaechenwahl';

export interface Flaechenwahl {
  /** Tipppunkt in Pixeln relativ zum Kartencontainer. */
  x: number;
  y: number;
  eintraege: { schluessel: string; text: string }[];
}

interface Props {
  wahl: Flaechenwahl | null;
  onWaehlen: (schluessel: string) => void;
  onSchliessen: () => void;
  /** Wohin der Fokus beim Schließen zurückgeht (die Karte). */
  fokusZiel?: () => HTMLElement | null;
}

export default function FlaechenwahlMenue({ wahl, onWaehlen, onSchliessen, fokusZiel }: Props) {
  const { token } = theme.useToken();
  const fokusZielRef = useRef(fokusZiel);
  fokusZielRef.current = fokusZiel;
  // Nimmt die Karte das Menü ohne antd weg (Kartenbewegung, exklusiver Modus), fiele der Fokus
  // mit dem Eintrag auf `body`. Zurück an die Karte, aber nur, wenn er noch im Menü oder im
  // Nichts steht: einen Fokus, den der Mensch woanders hingesetzt hat, nimmt das nicht weg.
  const offen = wahl != null;
  useEffect(() => {
    if (!offen) return;
    return () => {
      const aktiv = document.activeElement;
      if (!aktiv || aktiv === document.body || aktiv.closest('.ant-dropdown'))
        fokusZielRef.current?.()?.focus({ preventScroll: true });
    };
  }, [offen]);
  if (!wahl) return null;

  const schliessen = () => {
    onSchliessen();
    fokusZiel?.()?.focus({ preventScroll: true });
  };

  return (
    <Dropdown
      open
      trigger={['click']}
      autoFocus
      onOpenChange={(offen) => {
        if (!offen) schliessen();
      }}
      menu={{
        'aria-label': 'Fläche wählen',
        items: wahl.eintraege.map((e) => ({
          key: e.schluessel,
          label: e.text,
          style: flaechenwahlEintragStil(token),
        })),
        // Geschlossen wird allein über `onOpenChange`: antd meldet dort auch den Klick auf einen
        // Eintrag (Quelle `menu`), ein zweites Schließen hier liefe doppelt.
        onClick: ({ key, domEvent }) => {
          domEvent.stopPropagation();
          onWaehlen(key);
        },
      }}
    >
      <span
        aria-hidden="true"
        data-lfh="flaechenwahl-anker"
        style={{
          position: 'absolute',
          left: wahl.x,
          top: wahl.y,
          width: 1,
          height: 1,
          pointerEvents: 'none',
        }}
      />
    </Dropdown>
  );
}
