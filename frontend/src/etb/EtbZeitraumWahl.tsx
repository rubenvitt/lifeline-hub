import { Button, Flex, Popover, theme } from 'antd';
import { useState } from 'react';
import {
  ZEIT_BLATT,
  zeitPanelAmFeldAb,
  ZeitraumEingabe,
  type Zeitraum,
} from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from '../anzeige/zeitEingabe';
import {
  ZEITFENSTER_LABEL,
  zeitfensterArten,
  zeitfensterWahl,
  zeitraumBeschriftung,
  type ZeitfensterArt,
} from '../anzeige/zeitfenster';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { formatZeitKurz } from '../anzeige/format';
import { monoStil } from '../components/instrument';
import { useViewport } from '../components/useViewport';
import { serverJetzt } from '../offline/serveruhr';

/** Was eine Wahl in den Filter schreibt: beide Grenzen, geleerte als `undefined`. */
export interface ZeitraumGrenzen {
  von: string | undefined;
  bis: string | undefined;
}

interface Props {
  /** Wirksame Grenzen aus der Adresse (Wire, UTC). */
  von?: string;
  bis?: string;
  /** `abgehalten_at` der letzten Lagebesprechung — nur mit Freigabe und wenn es eine gibt. */
  letzteLb?: string | null;
  onWahl: (grenzen: ZeitraumGrenzen) => void;
}

/**
 * Der Platz „Zeitraum“ der ETB-Filterleiste (LLH-1080, Spec `etb-filterleiste`, „Zeitraum mit
 * Schnellwahl“): EIN Bedienziel statt zweier Felder. Es zeigt den wirksamen Wert („seit 1345“,
 * „seit LB 1330“, „Heute“, „1000–1100“) und öffnet eine Spalte großer Ziele: die Schnellwahl
 * (`anzeige/zeitfenster.ts`) und einen eigenen Zeitraum im Zeiteingabe-Baustein (taktisch
 * tippbar, ohne Sekunden, „bis“ leer heißt jetzt).
 *
 * Jede Wahl schreibt ABSOLUTE Grenzen, einmal (Entscheidung Ruben, 17.10.2026): kein Abruf je
 * Tastendruck, und Link, Druck und Bildschirm zeigen dieselbe Menge. Wo der Kalender nicht neben
 * das Feld passt (Handschirm, Handschuh), steht der Aufklapper als Blatt (`ZEIT_BLATT`, dieselbe
 * Weiche wie die Zeitfelder).
 */
export default function EtbZeitraumWahl({ von, bis, letzteLb, onWahl }: Props) {
  // Dieselbe Anzeigezone wie die Zeitfelder darin und der Druckkopf (LFH-692).
  const zone = useAnzeigeKonventionen().konventionen.zeitzone;
  const [offen, setOffen] = useState(false);
  const { abBreite } = useViewport();
  const { token } = theme.useToken();
  const ab = zeitPanelAmFeldAb(token);
  const istBlatt = ab === null || !abBreite(ab);
  const bezug = { jetzt: serverJetzt(), zone, letzteLb };
  const beschriftung = zeitraumBeschriftung({ von, bis }, bezug);
  const [eigen, setEigen] = useState<Zeitraum | null>(null);

  function waehle(grenzen: ZeitraumGrenzen) {
    setOffen(false);
    onWahl(grenzen);
  }

  function schnell(art: ZeitfensterArt) {
    const g = zeitfensterWahl(art, { jetzt: serverJetzt(), zone, letzteLb });
    if (g) waehle({ von: g.von, bis: undefined });
  }

  function label(art: ZeitfensterArt): string {
    if (art === 'seitLb' && letzteLb) {
      return `${ZEITFENSTER_LABEL.seitLb} (${formatZeitKurz(letzteLb, { zeitzone: zone })})`;
    }
    return ZEITFENSTER_LABEL[art];
  }

  const inhalt = (
    <Flex vertical gap={token.marginXS} style={{ minWidth: istBlatt ? undefined : 280 }}>
      {zeitfensterArten({ mitLb: letzteLb != null }).map((art) => (
        <Button key={art} block onClick={() => schnell(art)} style={{ justifyContent: 'start' }}>
          {label(art)}
        </Button>
      ))}
      <div role="group" aria-label="Eigener Zeitraum" style={{ marginTop: token.marginXS }}>
        <ZeitraumEingabe
          placeholder={['von', 'bis']}
          value={eigen ?? [alsZeitpunkt(von) ?? null, alsZeitpunkt(bis) ?? null]}
          onChange={(z) => setEigen(z ?? [null, null])}
        />
        <Flex gap={token.marginXS} wrap style={{ marginTop: token.marginXS }}>
          <Button
            type="primary"
            disabled={eigen == null || (eigen[0] == null && eigen[1] == null)}
            onClick={() =>
              eigen &&
              waehle({
                von: eigen[0] ? alsBackendZeit(eigen[0]) : undefined,
                bis: eigen[1] ? alsBackendZeit(eigen[1]) : undefined,
              })
            }
          >
            Zeitraum übernehmen
          </Button>
          {(von || bis) && (
            <Button onClick={() => waehle({ von: undefined, bis: undefined })}>
              Ohne Zeitraum
            </Button>
          )}
        </Flex>
      </div>
    </Flex>
  );

  return (
    <Popover
      open={offen}
      onOpenChange={(o) => {
        setOffen(o);
        if (o) setEigen(null);
      }}
      trigger="click"
      placement="bottomLeft"
      arrow={false}
      destroyOnHidden
      classNames={istBlatt ? { root: ZEIT_BLATT } : undefined}
      content={inhalt}
    >
      <Button
        aria-haspopup="dialog"
        aria-expanded={offen}
        aria-label={von || bis ? `Zeitraum ${beschriftung}` : 'Zeitraum'}
        data-lfh="etb-zeitraum"
      >
        <span style={von || bis ? monoStil(13) : undefined}>{beschriftung}</span>
      </Button>
    </Popover>
  );
}
