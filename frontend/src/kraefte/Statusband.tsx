import type { CSSProperties } from 'react';
import {
  Augenbraue,
  Kennzahl,
  Kennzahlenband,
  monoStil,
  useRollen,
} from '../components/instrument';
import { useViewport } from '../components/useViewport';
import type { BandZelle } from './meldebildRaster';
import { bandQuadratFarbe, bandSpalten, bandZahlFarbe } from './statusbandStil';

/**
 * Das Statusband des Meldebilds (Neuentwurf S6, `statusStufen`) — Fahrzeuge je FMS-Status,
 * darunter die Personalverteilung in DERSELBEN Spaltengeometrie. Die Zählung steht in
 * `meldebildRaster.ts` (`fahrzeugBand`, `personalBand`), die Farb- und Spaltenregeln rein in
 * `statusbandStil.ts`; hier wird nur gesetzt.
 *
 * ── WARUM EIN EIGENER ZELLENBAU UND NICHT `Kennzahl` ────────────────────────────
 *
 * `Kennzahl` kennt die Töne `neutral`/`achtung`/`alarm`. Das Band braucht alle fünf
 * Status-Töne (`normal` für „frei", `bedien` für „am Einsatzort") und das farbige Quadrat
 * vor dem Code. Gemeldet als Ergänzungswunsch an `components/instrument`.
 *
 * ── NEUTRALE FLÄCHE STATT GETÖNTER ZELLE (Nacharbeit 22.09.2026) ────────────────
 *
 * Die erste Fassung trug je Zelle die Statusfläche als Grund; in der Sichtprüfung wirkte das
 * Band vollflächig getönt und schwer. Der Entwurf setzt die Zellen auf `flaeche` und trägt den
 * Ton nur im 8-px-Quadrat und in der Zahl (Mono 26). Das Band läuft als Fugenraster über die
 * volle Inhaltsbreite: 6 Spalten ab `xl`, 3 ab `md`, 2 darunter; eine unvollständige letzte
 * Reihe wird mit leeren Zellen auf `flaeche` aufgefüllt, sonst stünde dort der Fugengrund als
 * Block.
 *
 * Zweiter Kanal: Code („S4") UND Wort („Am Einsatzort") stehen sichtbar neben der Zahl.
 */

function zelleStil(token: { padding: number; paddingLG: number }, grund: string): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    minWidth: 0,
    paddingBlock: token.padding,
    paddingInline: token.paddingLG,
    background: grund,
  };
}

function BandZelleAnsicht({ zelle }: { zelle: BandZelle }) {
  const { token, rollen, dunkel } = useRollen();
  return (
    <div
      data-lfh="meldebild-bandzelle"
      data-ton={zelle.ton}
      title={`${zelle.code} · ${zelle.wort}: ${zelle.wert}`}
      style={zelleStil(token, rollen.flaeche)}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: token.marginXS }}>
        <span
          aria-hidden
          data-lfh="meldebild-bandquadrat"
          style={{
            width: 8,
            height: 8,
            flex: '0 0 8px',
            background: bandQuadratFarbe(rollen, zelle.ton),
          }}
        />
        <span style={{ ...monoStil(11), letterSpacing: '.06em', color: rollen.gedaempft }}>
          {zelle.code}
        </span>
      </span>
      <span
        data-lfh="meldebild-bandwert"
        style={{
          ...monoStil(26, 500),
          lineHeight: 1,
          color: bandZahlFarbe(rollen, zelle.ton, dunkel),
        }}
      >
        {zelle.wert}
      </span>
      <span
        style={{
          fontSize: 11,
          lineHeight: 1.4,
          color: rollen.gedaempft,
          overflowWrap: 'anywhere',
        }}
      >
        {zelle.wort}
      </span>
    </div>
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
          style={zelleStil(token, rollen.flaeche)}
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
}

export default function Statusband({ fahrzeuge, personal, zustand }: StatusbandProps) {
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
  if (fahrzeuge.length === 0 && personal.length === 0) {
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
    </div>
  );
}
