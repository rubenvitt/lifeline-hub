import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { monoStil, useRollen } from '../components/instrument';
import { kartenKante } from './kartenKante';

type Hueller = Omit<HTMLAttributes<HTMLElement>, 'children' | 'style'>;

/**
 * Karte der vier Kommunikations-Module (Meldung, Auftrag, Erinnerung, Nachforderung) im
 * Neuentwurf „Instrumententafel" — ersetzt antds `Card`. Rahmen `linie`, Grund `paneel`,
 * Radius 0; links optional die ZEITSPALTE eines Zeitachsen-Eintrags (Zeit Mono 13/500,
 * darunter die Nummer Mono 10), dann der Inhalt.
 *
 * DER LINKE KARTENRAND IST VERTRAG (LFH-343 · C8, Befund H47), nicht Dekoration: 3 px,
 * EINE Farbe, Gefahr gewinnt — `alarm` (rot) vor `unbearbeitet` (gelb) vor nichts. Die
 * Entscheidung trifft {@link kartenKante} (rein, getestet); die Karte trägt sie zusätzlich
 * als `data-alarm` / `data-unbearbeitet`, damit der Zustand ohne Farbrechnung prüfbar ist.
 * Das ETIKETT in der Karte bleibt davon unberührt — vergeben ist der Rand, nicht die Aussage.
 *
 * Eine alarmierte Karte steht zusätzlich auf der getönten Alarmfläche (`alarmFlaeche`,
 * Neuentwurf „Ampel als Fläche"); vorher war das antds `colorErrorBg`.
 */
export default function KommKarte({
  alarm = false,
  unbearbeitet = false,
  hervorgehoben = false,
  zeit,
  nr,
  children,
  style,
  ...rest
}: Hueller & {
  alarm?: boolean;
  unbearbeitet?: boolean;
  /** Deeplink-Hervorhebung (`?meldung=` / `?auftrag=`): Ring in Bedienfarbe. */
  hervorgehoben?: boolean;
  /** Zeitspalte links (Zeitachsen-Optik) — ohne sie beginnt die Karte mit dem Inhalt. */
  zeit?: ReactNode;
  nr?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const { token, rollen } = useRollen();
  const kante = kartenKante(rollen, { alarm, unbearbeitet });
  return (
    <article
      {...rest}
      data-lfh="komm-karte"
      data-alarm={alarm ? 'true' : undefined}
      data-unbearbeitet={kante.zustand === 'unbearbeitet' ? 'true' : undefined}
      data-hervorgehoben={hervorgehoben ? 'true' : undefined}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        minWidth: 0,
        marginBottom: token.marginXS,
        background: alarm ? rollen.alarmFlaeche : rollen.paneel,
        border: `1px solid ${rollen.linie}`,
        borderInlineStart: `3px solid ${kante.farbe}`,
        borderRadius: 0,
        boxShadow: hervorgehoben ? `0 0 0 2px ${rollen.bedien}` : undefined,
        color: rollen.text,
        ...style,
      }}
    >
      {zeit != null && (
        <div
          data-lfh="komm-karte-zeit"
          style={{
            flex: '0 0 auto',
            minWidth: 64,
            paddingBlock: token.paddingSM,
            paddingInline: token.padding,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            borderInlineEnd: `1px solid ${rollen.flaeche3}`,
          }}
        >
          <span style={{ ...monoStil(13, 500), color: rollen.text }}>{zeit}</span>
          {nr != null && <span style={{ ...monoStil(10), color: rollen.schwach }}>{nr}</span>}
        </div>
      )}
      <div
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          paddingBlock: token.paddingSM,
          paddingInline: token.padding,
        }}
      >
        {children}
      </div>
    </article>
  );
}
