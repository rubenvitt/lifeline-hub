import { Augenbraue, Kennzahl, Kennzahlenband, useRollen } from '../components/instrument';
import { useViewport } from '../components/useViewport';
import type { BandZelle } from './meldebildRaster';
import { bandSpalten } from './statusbandStil';

/**
 * Das Statusband des Meldebilds (Neuentwurf S6, `statusStufen`) — Fahrzeuge je FMS-Status,
 * darunter die Personalverteilung in DERSELBEN Spaltengeometrie. Die Zählung steht in
 * `meldebildRaster.ts` (`fahrzeugBand`, `personalBand`), die Spaltenregel rein in
 * `statusbandStil.ts`; hier wird nur gesetzt.
 *
 * ── DIE ZELLE IST DER BAUSTEIN `Kennzahl` (seit 22.09.2026) ─────────────────────
 *
 * Vorher ein Eigenbau, weil `Kennzahl` nur drei Töne kannte. Seit der Baustein alle fünf
 * Status-Töne führt (`normal` für „frei", `bedien` für „am Einsatzort"), ist jede Zelle eine
 * `Kennzahl`: Code als Augenbraue mit Statuspunkt (8-px-Quadrat in der Rollenfarbe, neutral
 * in `schwach`), Zahl Mono 22 (`klein`; der Eigenbau hatte 26, das kennt die Schriftskala
 * nicht), Wort als Notiz. Die Kontrastregel der Zahl — TAGS bei `achtung`/`alarm` in `text`,
 * weil die Tonfarbe den 7 : 1-Boden auf `flaeche` nicht trägt — liegt jetzt im Baustein
 * (`zahlFarbe`) und gilt damit für jede Kennzahl, nicht nur hier. Neu durch den Baustein:
 * `achtung`/`alarm` tragen seine abgestufte Innenkante (3/6 px) — ein zusätzlicher Kanal,
 * kein Verlust.
 *
 * ── NEUTRALE FLÄCHE STATT GETÖNTER ZELLE (Nacharbeit 22.09.2026) ────────────────
 *
 * Die Zellen stehen auf `flaeche` (Klasse `.lfh-kennzahl`), der Ton nur im Quadrat und in
 * der Zahl. Das Band läuft als Fugenraster über die volle Inhaltsbreite: 6 Spalten ab `xl`,
 * 3 ab `md`, 2 darunter; eine unvollständige letzte Reihe wird mit leeren Zellen auf
 * `flaeche` aufgefüllt, sonst stünde dort der Fugengrund als Block.
 *
 * Zweiter Kanal: Code („S4") UND Wort („Am Einsatzort") stehen sichtbar neben der Zahl.
 *
 * ── „KEINE RÜCKMELDUNG" IST EINE EIGENE GRUPPE (LFH-610) ────────────────────────
 *
 * Der Entwurf setzt die Kachel ans Ende der FMS-Reihe. Sie zählt aber EINHEITEN, nicht
 * Fahrzeuge — in der Gruppe „Fahrzeuge je Status" summierte sich das Band dann nicht mehr
 * auf die Fahrzeugzahl, und ein Vorleser hörte eine Einheitenzahl als Fahrzeugstatus. Sie
 * steht deshalb in einer eigenen Gruppe mit derselben Spaltengeometrie. Ob sie erscheint,
 * entscheidet die Seite: nur bei lesbaren Daten und mindestens einer Einheit ohne
 * Rückmeldung (`keineRueckmeldungZelle`).
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
  fahrzeuge: readonly BandZelle[];
  personal: readonly BandZelle[];
  /** Datenzustand beider Listen zusammen. */
  zustand: 'daten' | 'laden' | 'fehler';
  /** Kachel „keine Rückmeldung" — `null`/fehlend, wenn es nichts zu melden gibt oder nichts lesbar ist. */
  rueckmeldung?: BandZelle | null;
}

export default function Statusband({
  fahrzeuge,
  personal,
  zustand,
  rueckmeldung = null,
}: StatusbandProps) {
  const { token } = useRollen();
  const { abBreite } = useViewport();
  const spalten = bandSpalten(abBreite);
  if (zustand !== 'daten') {
    return (
      <Kennzahlenband beschriftung="Statusband">
        <Kennzahl titel="Fahrzeuge" wert={null} zustand={zustand} />
        <Kennzahl titel="Personal" wert={null} zustand={zustand} />
      </Kennzahlenband>
    );
  }
  if (fahrzeuge.length === 0 && personal.length === 0 && !rueckmeldung) {
    return (
      <Kennzahlenband beschriftung="Statusband">
        <Kennzahl titel="Fahrzeuge" wert={0} notiz="keine Kräfte disponiert" />
      </Kennzahlenband>
    );
  }
  return (
    <div
      data-lfh="meldebild-statusband"
      style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}
    >
      {fahrzeuge.length > 0 && (
        <section aria-label="Fahrzeuge je Status">
          <Augenbraue als="h2" style={{ marginBlockEnd: token.marginXXS }}>
            Fahrzeuge · FMS
          </Augenbraue>
          <Kennzahlenband spalten={spalten}>
            {fahrzeuge.map((z) => (
              <BandZelleAnsicht key={z.schluessel} zelle={z} />
            ))}
            <Auffuellung anzahl={fahrzeuge.length} spalten={spalten} />
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
