import { Button, Flex, Popover, theme } from 'antd';
import { useRef, useState } from 'react';
import { ZEIT_BLATT, zeitPanelAmFeldAb, ZeitraumEingabe, type Zeitraum } from './ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from './zeitEingabe';
import {
  ZEITFENSTER_LABEL,
  zeitfensterArten,
  zeitfensterWahl,
  taktisch,
  zeitraumBeschriftung,
  type ZeitfensterArt,
} from './zeitfenster';
import { useAnzeigeKonventionen } from './AnzeigeKonventionenContext';
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
  /** `data-lfh` des Auslösers, je Liste eigen (`etb-zeitraum`, `lagemeldungen-zeitraum`). */
  kennung: string;
}

/**
 * Der Zeitraumfilter einer zeitlich geordneten Liste (LLH-1080, Spec `etb-filterleiste`, „Zeitraum
 * mit Schnellwahl“; seit LLH-1322 auch die Lagemeldungen): EIN Bedienziel statt zweier Felder. Es zeigt den wirksamen Wert („seit 1345“,
 * „seit LB 1330“, „Heute“, „1000–1100“) und öffnet eine Spalte großer Ziele: die Schnellwahl
 * (`anzeige/zeitfenster.ts`) und einen eigenen Zeitraum im Zeiteingabe-Baustein (taktisch
 * tippbar, ohne Sekunden, „bis“ leer heißt jetzt).
 *
 * Jede Wahl schreibt ABSOLUTE Grenzen, einmal (Entscheidung Ruben, 17.10.2026): kein Abruf je
 * Tastendruck, und Link, Druck und Bildschirm zeigen dieselbe Menge. Wo der Kalender nicht neben
 * das Feld passt (Handschirm, Handschuh), steht der Aufklapper als Blatt (`ZEIT_BLATT`, dieselbe
 * Weiche wie die Zeitfelder).
 */
export default function ZeitraumWahl({ von, bis, letzteLb, onWahl, kennung }: Props) {
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
  const ausloeser = useRef<HTMLButtonElement>(null);
  const ersterKnopf = useRef<HTMLButtonElement>(null);

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
      return `${ZEITFENSTER_LABEL.seitLb} (${taktisch(letzteLb, bezug)})`;
    }
    return ZEITFENSTER_LABEL[art];
  }

  // Ein Dialog, kein Tooltip (antd hängt das Popover ans Ende von `<body>`): der Fokus geht beim
  // Öffnen hinein (`afterOpenChange`), Escape schließt und gibt ihn dem Auslöser zurück.
  const inhalt = (
    <Flex
      vertical
      gap={token.marginXS}
      role="dialog"
      aria-label="Zeitraum"
      style={{ minWidth: istBlatt ? undefined : 280 }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        setOffen(false);
        ausloeser.current?.focus();
      }}
    >
      {zeitfensterArten({ mitLb: letzteLb != null }).map((art, i) => (
        <Button
          key={art}
          ref={i === 0 ? ersterKnopf : undefined}
          block
          onClick={() => schnell(art)}
          style={{ justifyContent: 'start' }}
        >
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
          {/* Nicht gesperrt: ein getipptes Feld schreibt seinen Wert erst beim Verlassen fest, und
              ein gesperrter Knopf schluckte genau diesen Klick. Ohne Wert schließt er nur. */}
          <Button
            type="primary"
            onClick={() =>
              eigen && (eigen[0] != null || eigen[1] != null)
                ? waehle({
                    von: eigen[0] ? alsBackendZeit(eigen[0]) : undefined,
                    bis: eigen[1] ? alsBackendZeit(eigen[1]) : undefined,
                  })
                : setOffen(false)
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
      afterOpenChange={(o) => {
        if (o) ersterKnopf.current?.focus();
      }}
    >
      <Button
        ref={ausloeser}
        aria-haspopup="dialog"
        aria-expanded={offen}
        aria-label={von || bis ? `Zeitraum ${beschriftung}` : 'Zeitraum'}
        data-lfh={kennung}
      >
        <span style={von || bis ? monoStil(13) : undefined}>{beschriftung}</span>
      </Button>
    </Popover>
  );
}
