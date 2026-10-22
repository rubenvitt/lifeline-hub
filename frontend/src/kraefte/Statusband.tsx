import type { CSSProperties, ReactNode } from 'react';
import { Kennzahl, Kennzahlenband, useRollen } from '../components/instrument';
import type { BandZelle } from './meldebildRaster';
import { bandSegmente } from './statusbandStil';
import type { ZulaufZelle } from './zulauf';

/**
 * Das Statusband des Meldebilds (LLH-1025, Spec `kraeftebaum`, „Statusband ohne Füllkacheln“):
 * je Gruppe EINE `Kennzahl` — die Zahl führt, die Aufgliederung folgt. „Einheiten“ ist die Zahl
 * der Einheiten der Auswahl, aufgegliedert je FMS-Status; „Personal“ die Zahl der Kräfte,
 * aufgegliedert je Zustand. Die Zählung steht in `meldebildRaster.ts` (`einheitBand`,
 * `personalBand`), die Segmentfarben in `statusbandStil.ts`; hier wird nur gesetzt.
 *
 * Vorher stand jeder Status als eigene Kachel im 6/3/2-Raster, aufgefüllt mit leeren Zellen —
 * bei zwei Status vier Füllkacheln, die wie fehlende Daten aussahen. Jetzt füllt das Band nach
 * Breite (`Kennzahlenband` ohne `spalten`) und kennt keine Füllkachel mehr.
 *
 * „Keine Rückmeldung“ ist eine EIGENE Kennzahl: es ist kein FMS-Status, in der Aufgliederung
 * stünde die Einheit doppelt, und ein Vorleser hörte eine Statusstufe. Ob sie erscheint,
 * entscheidet die Seite (nur bei mindestens einer Einheit ohne Rückmeldung, LFH-610).
 *
 * „Zulauf“ (LLH-1384, Spec `kraeftebaum`, „Zulauf aus Nachforderungen“) ist ebenfalls eine EIGENE
 * Kennzahl: was zugesagt oder unterwegs ist, zählt nicht in Einheiten, Personal oder Stärke. Die
 * Zahl ist die Menge im Zulauf, die Notiz nennt die Einträge je Art mit Eintreffen
 * (`kraefte/zulauf.ts`), das Ziel ist das Board der Nachforderungen. Ob sie erscheint (Freigabe,
 * Filter, Daten), entscheidet die Seite. Sie steht auch neben „keine Einheiten gebildet“: gerade
 * am Anfang eines Einsatzes ist noch nichts da, aber schon etwas unterwegs.
 *
 * Jede Kennzahl steht in einer benannten Region („Einheiten je Status“ …): Prüfanker der Seite
 * und der e2e-Suite, und ein Vorleser springt so gezielt in die Gruppe.
 */

/** Rasterzelle des Bands mit Namen — die Kennzahl darin füllt sie ganz. */
function Gruppe({ name, children, lfh }: { name: string; children: ReactNode; lfh?: string }) {
  const stil: CSSProperties = { minWidth: 0, display: 'grid' };
  return (
    <section aria-label={name} data-lfh={lfh} style={stil}>
      {children}
    </section>
  );
}

const summe = (zellen: readonly BandZelle[]) => zellen.reduce((s, z) => s + z.wert, 0);

interface StatusbandProps {
  einheiten: readonly BandZelle[];
  /**
   * Sichtbarer Zusatz, wenn Filter nur die MITTEL treffen: das Einheitenband zählt alle Einheiten
   * des Abschnitts — ohne die Marke widersprächen sich die zwei Zahlen stumm.
   */
  einheitenHinweis?: string | null;
  personal: readonly BandZelle[];
  /** Datenzustand beider Listen zusammen. */
  zustand: 'daten' | 'laden' | 'fehler';
  /** Kennzahl „keine Rückmeldung" — `null`/fehlend, wenn es nichts zu melden gibt oder nichts lesbar ist. */
  rueckmeldung?: BandZelle | null;
  /** Kennzahl „Zulauf“ aus Nachforderungen — `null`/fehlend ohne Zulauf, Freigabe oder bei Filter. */
  zulauf?: ZulaufZelle | null;
  /** Ziel der Kennzahl „Zulauf“ (Board der Nachforderungen); fehlt, ist sie nicht klickbar. */
  zulaufZiel?: string;
}

/** Die Kennzahl „Zulauf“ in ihrer Region. */
function ZulaufGruppe({ zulauf, ziel }: { zulauf: ZulaufZelle; ziel?: string }) {
  return (
    <Gruppe name="Zulauf aus Nachforderungen" lfh="meldebild-zulauf">
      <Kennzahl
        titel="Zulauf"
        wert={zulauf.wert}
        notiz={zulauf.notiz}
        groesse="klein"
        ton={zulauf.ton}
        // Ohne eigene Beschriftung: der Link heißt nach Zahl und Notiz, nicht nur „öffnen“.
        ziel={ziel}
      />
    </Gruppe>
  );
}

export default function Statusband({
  einheiten,
  einheitenHinweis,
  personal,
  zustand,
  rueckmeldung = null,
  zulauf = null,
  zulaufZiel,
}: StatusbandProps) {
  const { rollen } = useRollen();
  if (zustand !== 'daten') {
    return (
      <Kennzahlenband beschriftung="Statusband">
        <Kennzahl titel="Einheiten" wert={null} zustand={zustand} groesse="klein" />
        <Kennzahl titel="Personal" wert={null} zustand={zustand} groesse="klein" />
      </Kennzahlenband>
    );
  }
  if (einheiten.length === 0 && personal.length === 0 && !rueckmeldung) {
    return (
      <Kennzahlenband beschriftung="Statusband">
        <Kennzahl titel="Einheiten" wert={0} notiz="keine Einheiten gebildet" groesse="klein" />
        {zulauf && <ZulaufGruppe zulauf={zulauf} ziel={zulaufZiel} />}
      </Kennzahlenband>
    );
  }
  return (
    <div data-lfh="meldebild-statusband">
      <Kennzahlenband beschriftung="Statusband">
        {einheiten.length > 0 && (
          <Gruppe name="Einheiten je Status">
            <Kennzahl
              titel="Einheiten"
              wert={summe(einheiten)}
              groesse="klein"
              aufgliederung={{
                segmente: bandSegmente(einheiten, rollen),
                titel: 'Einheiten nach Status',
              }}
              notiz={
                einheitenHinweis ? (
                  <span data-lfh="statusband-hinweis">{einheitenHinweis}</span>
                ) : undefined
              }
            />
          </Gruppe>
        )}
        {personal.length > 0 && (
          <Gruppe name="Personal je Status">
            <Kennzahl
              titel="Personal"
              wert={summe(personal)}
              groesse="klein"
              aufgliederung={{
                segmente: bandSegmente(personal, rollen),
                titel: 'Personal nach Status',
              }}
            />
          </Gruppe>
        )}
        {rueckmeldung && (
          <Gruppe name="Einheiten ohne Rückmeldung" lfh="meldebild-rueckmeldung">
            <Kennzahl
              titel="Rückmeldung"
              wert={rueckmeldung.wert}
              notiz={rueckmeldung.wort}
              groesse="klein"
              ton={rueckmeldung.ton}
              punkt={rueckmeldung.ton}
            />
          </Gruppe>
        )}
        {zulauf && <ZulaufGruppe zulauf={zulauf} ziel={zulaufZiel} />}
      </Kennzahlenband>
    </div>
  );
}
