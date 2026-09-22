import type { CSSProperties, ReactNode } from 'react';
import type { Farbrollen } from '../../theme/tokens';
import { monoStil, useRollen } from './rollenwerte';
import '../../theme/sprache.css';

/**
 * Schnellerfassungszeile — NUR die Hülle (Neuentwurf S1 „Eine Zeile ersetzt sechs
 * Formulare", S4 ETB unten, S7 Betroffene).
 *
 * Rahmen `bedien` 1 px, Grund `flaeche2`, Höhe ≥ 40; links eine Präfix-Zelle Mono 14 in
 * `bedien` mit Trennlinie (`/anordnung`, `/person`), in der Mitte das Feld des Aufrufers,
 * rechts ein Mono-Hinweis 11 (`↵ eintragen`), darunter optional eine Hinweiszeile Mono 11
 * (`/meldung · /anordnung · @ Einheit · # Koordinate · ⧖ Nachtrag`).
 *
 * WAS SIE NICHT IST: kein Formular. Die Erfassungs-Norm (LFH-332/B4 — Enter sendet über
 * die eingebaute Übermittlung, Fokus-Rücksprung, Serienmodus, Offline-Queue mit
 * `client_id`, Sichtung im selben POST) bleibt beim Konsumenten, der seine Felder in
 * `ErfassungsFormular` oder `SchnellAnlegen` hält. Ein `<form>` HIER wäre ein
 * verschachteltes Formular und lüde beim Absenden die Seite neu (Memory
 * `antd-verschachteltes-form-submit`). Die Hülle rendert deshalb nur `<div>`.
 *
 * Das Feld im Kind verliert Rahmen und Grund über `.lfh-schnellerfassung__feld` in
 * `theme/sprache.css` — die Zeile trägt den Rahmen, nicht das Feld. Seine HÖHE bleibt die
 * des antd-Feldes (`controlHeight`), die Hülle wächst mit: 30 / 48 / 72 statt der 40 des
 * Entwurfs, wo die Staffel mehr verlangt.
 */
export function schnellerfassungStil(
  rollen: Pick<Farbrollen, 'bedien' | 'flaeche2' | 'text'>,
  token: { controlHeight: number },
): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'stretch',
    minHeight: Math.max(40, token.controlHeight + 2),
    background: rollen.flaeche2,
    border: `1px solid ${rollen.bedien}`,
    color: rollen.text,
  };
}

interface SchnellerfassungszeileProps {
  /** Befehlspräfix links (`/anordnung`). Ohne Präfix entfällt die Zelle. */
  praefix?: ReactNode;
  /** Das Eingabefeld (bzw. mehrere) des Konsumenten. */
  children: ReactNode;
  /** Mono-Hinweis rechts in der Zeile (`↵ eintragen`). */
  hinweis?: ReactNode;
  /** Hinweiszeile darunter (Befehle, Kürzel, „Zuletzt: …"). */
  hinweiszeile?: ReactNode;
  style?: CSSProperties;
}

export default function Schnellerfassungszeile({
  praefix,
  children,
  hinweis,
  hinweiszeile,
  style,
}: SchnellerfassungszeileProps) {
  const { token, rollen } = useRollen();
  return (
    <div
      data-lfh="schnellerfassung"
      style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS, ...style }}
    >
      <div className="lfh-schnellerfassung" style={schnellerfassungStil(rollen, token)}>
        {praefix != null && (
          <span
            data-lfh="schnellerfassung-praefix"
            style={{
              ...monoStil(14),
              display: 'flex',
              alignItems: 'center',
              flex: '0 0 auto',
              paddingInline: token.paddingSM,
              borderInlineEnd: `1px solid ${rollen.linie}`,
              color: rollen.bedien,
            }}
          >
            {praefix}
          </span>
        )}
        <div
          className="lfh-schnellerfassung__feld"
          style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center' }}
        >
          {children}
        </div>
        {hinweis != null && (
          <span
            style={{
              ...monoStil(11),
              display: 'flex',
              alignItems: 'center',
              flex: '0 0 auto',
              paddingInline: token.paddingSM,
              color: rollen.schwach,
            }}
          >
            {hinweis}
          </span>
        )}
      </div>
      {hinweiszeile != null && (
        <div
          style={{
            ...monoStil(11),
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: token.padding,
            rowGap: token.marginXXS,
            color: rollen.schwach,
          }}
        >
          {hinweiszeile}
        </div>
      )}
    </div>
  );
}
