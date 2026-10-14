import type { CSSProperties, ReactNode } from 'react';
import { Kennzahl, Kennzahlenband, useRollen } from '../components/instrument';
import type { BandZelle } from './meldebildRaster';
import { bandSegmente } from './statusbandStil';

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
}

export default function Statusband({
  einheiten,
  einheitenHinweis,
  personal,
  zustand,
  rueckmeldung = null,
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
      </Kennzahlenband>
    </div>
  );
}
