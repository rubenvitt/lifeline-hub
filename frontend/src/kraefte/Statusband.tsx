import type { ReactNode } from 'react';
import {
  DashboardFlaeche,
  Kennzahl,
  PaneelReihe,
  VerteilungsPaneel,
  useRollen,
} from '../components/instrument';
import type { BandZelle } from './meldebildRaster';
import { bandVerteilung } from './statusbandStil';
import type { ZulaufZelle } from './zulauf';

/**
 * Das Statusband des Meldebilds — der Kopf über der Vergleichstabelle, aus dem Dashboard-Baukasten
 * (LLH-1140, Regel in `frontend/AGENTS.md`; Spec `kraeftebaum`, „Statusband ohne Füllkacheln“):
 * eine Paneelreihe mit „Einheiten nach FMS-Status“ und „Personal nach Status“ als
 * `VerteilungsPaneel` (je Status Wort, Zahl und Anteilsbalken; die Zahl führt) und, wenn es sie
 * gibt, der Kennzahl „keine Rückmeldung“ mit Sprung in die Meldungen. Die Zählung steht in
 * `meldebildRaster.ts` (`einheitBand`, `personalBand`), Wort und Farbe je Zeile in
 * `statusbandStil.ts`; hier wird nur gesetzt.
 *
 * Eine Füllkachel gibt es nicht: die Paneele füllen die Reihe (`PaneelReihe` zählt nur gerenderte
 * Kinder), ein Status ohne Einheit steht gar nicht da. Laden, Fehler und Leer zeigt jedes Paneel
 * selbst (`PaneelZustand`), nie als Null.
 *
 * „Keine Rückmeldung“ ist eine EIGENE Kennzahl: es ist kein FMS-Status, in der Verteilung stünde
 * die Einheit doppelt, und ein Vorleser hörte eine Statusstufe. Ob sie erscheint, entscheidet die
 * Seite (nur bei mindestens einer Einheit ohne Rückmeldung, LFH-610).
 *
 * „Zulauf“ (LLH-1384, Spec `kraeftebaum`, „Zulauf aus Nachforderungen“) ist ebenfalls eine EIGENE
 * Kennzahl: was zugesagt oder unterwegs ist, zählt nicht in Einheiten, Personal oder Stärke. Die
 * Zahl ist die Menge im Zulauf, die Notiz nennt die Einträge je Art mit Eintreffen
 * (`kraefte/zulauf.ts`), das Ziel ist das Board der Nachforderungen. Ob sie erscheint (Freigabe,
 * Filter, Daten), entscheidet die Seite. Sie steht auch neben „Keine Einheiten gebildet.“: gerade
 * am Anfang eines Einsatzes ist noch nichts da, aber schon etwas unterwegs.
 *
 * Jedes Paneel ist eine benannte Region (sein Titel; „Einheiten ohne Rückmeldung“ für die
 * Kennzahl): Prüfanker der Seite und der e2e-Suite, und ein Vorleser springt so in die Gruppe.
 */

const summe = (zellen: readonly BandZelle[]) => zellen.reduce((s, z) => s + z.wert, 0);

/** Zähler im Kopf, Einzahl und Mehrzahl richtig (LFH-973): „1 Einheit“, nicht „1 Einheiten“. */
const zaehler = (zellen: readonly BandZelle[], einzahl: string, mehrzahl: string) => {
  const n = summe(zellen);
  return `${n} ${n === 1 ? einzahl : mehrzahl}`;
};

/** Grund im Zustand `gesperrt` — das Band hat keinen, die Listen gehören der Seite selbst. */
const GESPERRT = 'Modul nicht freigegeben.';

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
  /** Erneuter Abruf beider Listen (Fehlerzustand der Paneele). */
  onNeuladen: () => void;
  /** Kennzahl „keine Rückmeldung" — `null`/fehlend, wenn es nichts zu melden gibt oder nichts lesbar ist. */
  rueckmeldung?: BandZelle | null;
  /** Sprungziel der Kennzahl „keine Rückmeldung"; fehlt, wenn das Modul gesperrt ist. */
  rueckmeldungZiel?: string;
  /** Kennzahl „Zulauf“ aus Nachforderungen — `null`/fehlend ohne Zulauf, Freigabe oder bei Filter. */
  zulauf?: ZulaufZelle | null;
  /** Ziel der Kennzahl „Zulauf“ (Board der Nachforderungen); fehlt, ist sie nicht klickbar. */
  zulaufZiel?: string;
}

export default function Statusband({
  einheiten,
  einheitenHinweis,
  personal,
  zustand,
  onNeuladen,
  rueckmeldung = null,
  rueckmeldungZiel,
  zulauf = null,
  zulaufZiel,
}: StatusbandProps) {
  const { rollen } = useRollen();
  const daten = zustand === 'daten';
  const kopf = (text: string, marke?: ReactNode) =>
    daten ? (
      <>
        {text}
        {marke}
      </>
    ) : undefined;
  return (
    <DashboardFlaeche kennung="meldebild-statusband">
      <PaneelReihe kennung="meldebild-statusband-paneele">
        <VerteilungsPaneel
          titel="Einheiten nach FMS-Status"
          kennung="statusband-einheit"
          dichte="kompakt"
          zustand={daten && einheiten.length === 0 ? 'leer' : zustand}
          meta={kopf(
            zaehler(einheiten, 'Einheit', 'Einheiten'),
            einheitenHinweis ? (
              <>
                {' · '}
                <span data-lfh="statusband-hinweis">{einheitenHinweis}</span>
              </>
            ) : undefined,
          )}
          leerText="Keine Einheiten gebildet."
          gesperrtText={GESPERRT}
          onNeuladen={onNeuladen}
          zeilen={bandVerteilung(einheiten, rollen)}
        />
        <VerteilungsPaneel
          titel="Personal nach Status"
          kennung="statusband-personal"
          dichte="kompakt"
          zustand={daten && personal.length === 0 ? 'leer' : zustand}
          meta={kopf(zaehler(personal, 'Kraft', 'Kräfte'))}
          leerText="Kein Personal erfasst."
          gesperrtText={GESPERRT}
          onNeuladen={onNeuladen}
          zeilen={bandVerteilung(personal, rollen)}
        />
        {rueckmeldung && (
          <section
            aria-label="Einheiten ohne Rückmeldung"
            data-lfh="meldebild-rueckmeldung"
            style={{ minWidth: 0, display: 'grid', background: rollen.paneel }}
          >
            <Kennzahl
              titel="Rückmeldung"
              wert={rueckmeldung.wert}
              notiz={rueckmeldung.wort}
              ton={rueckmeldung.ton}
              punkt={rueckmeldung.ton}
              ziel={rueckmeldungZiel}
            />
          </section>
        )}
        {zulauf && (
          <section
            aria-label="Zulauf aus Nachforderungen"
            data-lfh="meldebild-zulauf"
            style={{ minWidth: 0, display: 'grid', background: rollen.paneel }}
          >
            <Kennzahl
              titel="Zulauf"
              wert={zulauf.wert}
              notiz={zulauf.notiz}
              ton={zulauf.ton}
              // Ohne eigene Beschriftung: der Link heißt nach Zahl und Notiz, nicht nur „öffnen“.
              ziel={zulaufZiel}
            />
          </section>
        )}
      </PaneelReihe>
    </DashboardFlaeche>
  );
}
