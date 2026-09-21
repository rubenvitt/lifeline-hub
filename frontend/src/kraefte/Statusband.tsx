import type { CSSProperties } from 'react';
import {
  Augenbraue,
  Kennzahl,
  Kennzahlenband,
  monoStil,
  schriftStil,
  statusFlaeche,
  useRollen,
} from '../components/instrument';
import type { BandZelle } from './meldebildRaster';

/**
 * Das Statusband des Meldebilds (Neuentwurf S6) — Fahrzeuge je FMS-Status, dahinter die
 * Personalverteilung. Die Zählung steht in `meldebildRaster.ts` (`fahrzeugBand`,
 * `personalBand`); hier wird nur gesetzt.
 *
 * ── WARUM EIN EIGENER ZELLENBAU UND NICHT `Kennzahl` ────────────────────────────
 *
 * `Kennzahl` kennt die Töne `neutral`/`achtung`/`alarm` und färbt nur die Zahl auf dem
 * Grund `flaeche`. Das Band braucht alle fünf Status-Töne (`normal` für „frei") und einen
 * Farbpunkt. Eine getönte Zahl auf `flaeche` ist aber nirgends kontrastgerechnet — die
 * Rechnung in `statusFlaeche.ts` gilt für Text AUF der Statusfläche. Die Zelle trägt
 * deshalb die Statusfläche als Grund (Entscheidung 2: Status als getönte Fläche), Zahl,
 * Code und Wort in deren Text, der Punkt in der Kante. Damit bleibt jedes Paar eines, das
 * `statusFlaeche` belegt hat. Gemeldet als Ergänzungswunsch an `components/instrument`.
 *
 * Zweiter Kanal: Code („S4") UND Wort („Am Einsatzort") stehen sichtbar neben der Zahl.
 */

function zelleStil(grund: string, token: { padding: number; paddingLG: number }): CSSProperties {
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
  const f = statusFlaeche(rollen, zelle.ton, dunkel);
  return (
    <div
      data-lfh="meldebild-bandzelle"
      data-ton={zelle.ton}
      title={`${zelle.code} · ${zelle.wort}: ${zelle.wert}`}
      style={zelleStil(f.grund, token)}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: token.marginXS }}>
        <span aria-hidden style={{ width: 8, height: 8, flex: '0 0 8px', background: f.kante }} />
        <span style={{ ...monoStil(11), letterSpacing: '.06em', color: f.text }}>{zelle.code}</span>
      </span>
      <span
        data-lfh="meldebild-bandwert"
        style={{ ...schriftStil('datenwert'), lineHeight: 1, color: f.text }}
      >
        {zelle.wert}
      </span>
      <span style={{ fontSize: 11, lineHeight: 1.4, color: f.text }}>{zelle.wort}</span>
    </div>
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
          <Kennzahlenband>
            {fahrzeuge.map((z) => (
              <BandZelleAnsicht key={z.schluessel} zelle={z} />
            ))}
          </Kennzahlenband>
        </section>
      )}
      {personal.length > 0 && (
        <section aria-label="Personal je Status">
          <Augenbraue als="h2" style={{ marginBlockEnd: token.marginXXS }}>
            Personal
          </Augenbraue>
          <Kennzahlenband>
            {personal.map((z) => (
              <BandZelleAnsicht key={z.schluessel} zelle={z} />
            ))}
          </Kennzahlenband>
        </section>
      )}
    </div>
  );
}
