import { Augenbraue, Kennzahl, Kennzahlenband, useRollen } from '../components/instrument';
import { useViewport } from '../components/useViewport';
import type { BandZelle } from './meldebildRaster';
import { bandSpalten } from './statusbandStil';

/**
 * Das Statusband des Meldebilds — EINHEITEN je FMS-Status, darunter die Personalverteilung in
 * derselben Spaltengeometrie. Die Zählung steht in `meldebildRaster.ts`, die Spaltenregel in
 * `statusbandStil.ts`; hier wird nur gesetzt.
 *
 * Jede Zelle ist der Baustein `Kennzahl`: Code als Augenbraue mit Statuspunkt, Zahl Mono 22,
 * Wort als Notiz. Die Kontrastregel der Zahl liegt im Baustein. Die Zellen stehen auf
 * `flaeche`, der Ton nur im Quadrat und in der Zahl. Fugenraster über die volle Breite (6 ab
 * `xl`, 3 ab `md`, 2 darunter); eine unvollständige letzte Reihe wird mit leeren Zellen
 * aufgefüllt, sonst stünde dort der Fugengrund als Block.
 *
 * „Keine Rückmeldung" steht in einer EIGENEN Gruppe: es ist kein FMS-Status, in der Reihe
 * stünde die Einheit doppelt, das Band summierte sich nicht mehr auf die Einheitenzahl, und ein
 * Vorleser hörte eine Statusstufe. Ob die Kachel erscheint, entscheidet die Seite.
 */

function BandZelleAnsicht({ zelle }: { zelle: BandZelle }) {
  return (
    <Kennzahl
      titel={zelle.code}
      wert={zelle.wert}
      notiz={zelle.wort}
      groesse="klein"
      ton={zelle.ton}
      punkt={zelle.ton}
    />
  );
}

/** Leere Zellen, die die letzte Reihe des Fugenrasters schließen. */
function Auffuellung({ anzahl, spalten }: { anzahl: number; spalten: number }) {
  const { token, rollen } = useRollen();
  const rest = (spalten - (anzahl % spalten)) % spalten;
  return (
    <>
      {Array.from({ length: rest }, (_, i) => (
        <div
          key={`leer-${i}`}
          aria-hidden
          data-lfh="meldebild-bandluecke"
          style={{ background: rollen.flaeche, minWidth: 0, minHeight: token.controlHeight }}
        />
      ))}
    </>
  );
}

export interface StatusbandProps {
  einheiten: readonly BandZelle[];
  /**
   * Sichtbarer Zusatz, wenn Filter nur die MITTEL treffen: das Einheitenband zählt alle Einheiten
   * des Abschnitts — ohne den Satz widersprächen sich die zwei Bänder stumm.
   */
  einheitenHinweis?: string | null;
  personal: readonly BandZelle[];
  /** Datenzustand beider Listen zusammen. */
  zustand: 'daten' | 'laden' | 'fehler';
  /** Kachel „keine Rückmeldung" — `null`/fehlend, wenn es nichts zu melden gibt oder nichts lesbar ist. */
  rueckmeldung?: BandZelle | null;
}

export default function Statusband({
  einheiten,
  einheitenHinweis,
  personal,
  zustand,
  rueckmeldung = null,
}: StatusbandProps) {
  const { token, rollen } = useRollen();
  const { abBreite } = useViewport();
  const spalten = bandSpalten(abBreite);
  if (zustand !== 'daten') {
    return (
      <Kennzahlenband beschriftung="Statusband">
        <Kennzahl titel="Einheiten" wert={null} zustand={zustand} />
        <Kennzahl titel="Personal" wert={null} zustand={zustand} />
      </Kennzahlenband>
    );
  }
  if (einheiten.length === 0 && personal.length === 0 && !rueckmeldung) {
    return (
      <Kennzahlenband beschriftung="Statusband">
        <Kennzahl titel="Einheiten" wert={0} notiz="keine Einheiten gebildet" />
      </Kennzahlenband>
    );
  }
  return (
    <div
      data-lfh="meldebild-statusband"
      style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}
    >
      {einheiten.length > 0 && (
        <section aria-label="Einheiten je Status">
          <Augenbraue als="h2" style={{ marginBlockEnd: token.marginXXS }}>
            Einheiten · FMS
          </Augenbraue>
          {einheitenHinweis && (
            <div
              data-lfh="statusband-hinweis"
              style={{ fontSize: 11, color: rollen.gedaempft, marginBlockEnd: token.marginXXS }}
            >
              {einheitenHinweis}
            </div>
          )}
          <Kennzahlenband spalten={spalten}>
            {einheiten.map((z) => (
              <BandZelleAnsicht key={z.schluessel} zelle={z} />
            ))}
            <Auffuellung anzahl={einheiten.length} spalten={spalten} />
          </Kennzahlenband>
        </section>
      )}
      {personal.length > 0 && (
        <section aria-label="Personal je Status">
          <Augenbraue als="h2" style={{ marginBlockEnd: token.marginXXS }}>
            Personal
          </Augenbraue>
          <Kennzahlenband spalten={spalten}>
            {personal.map((z) => (
              <BandZelleAnsicht key={z.schluessel} zelle={z} />
            ))}
            <Auffuellung anzahl={personal.length} spalten={spalten} />
          </Kennzahlenband>
        </section>
      )}
      {rueckmeldung && (
        <section aria-label="Einheiten ohne Rückmeldung" data-lfh="meldebild-rueckmeldung">
          <Augenbraue als="h2" style={{ marginBlockEnd: token.marginXXS }}>
            Rückmeldung
          </Augenbraue>
          <Kennzahlenband spalten={spalten}>
            <BandZelleAnsicht zelle={rueckmeldung} />
            <Auffuellung anzahl={1} spalten={spalten} />
          </Kennzahlenband>
        </section>
      )}
    </div>
  );
}
