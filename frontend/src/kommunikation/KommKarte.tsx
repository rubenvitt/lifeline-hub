import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { monoStil, useRollen } from '../components/instrument';
import { kartenGrund, kartenKante } from './kartenKante';

type Hueller = Omit<HTMLAttributes<HTMLElement>, 'children' | 'style'>;

/**
 * Karte der vier Kommunikations-Module (Meldung, Auftrag, Erinnerung, Nachforderung): Rahmen
 * `linie`, Grund `paneel`, Radius 0; links optional die Zeitspalte, dann der Inhalt.
 *
 * DER LINKE KARTENRAND IST VERTRAG: 3 px, EINE Farbe, Gefahr gewinnt — `alarm` vor
 * `unbearbeitet` vor nichts ({@link kartenKante}). Zusätzlich als `data-alarm` /
 * `data-unbearbeitet` prüfbar. Das Etikett bleibt davon unberührt. Eine alarmierte Karte steht
 * außerdem auf der getönten Alarmfläche.
 *
 * Deeplink-Hervorhebung (LFH-896, Spec `deeplink-hervorhebung`): dieselbe Form wie Datensicht und
 * Zeitachse (`index.css`, `.zeile-hervorgehoben`) — Fläche `bedienFlaeche` und je eine 2-px-Linie
 * oben und unten in `bedien`, als `inset`-Schatten innerhalb des Rahmens, damit die Statuskante
 * links stehen bleibt und die Karte beim Sprung nicht wächst. Kein umlaufender Ring: das ist die
 * Form des Fokusrings. Gefahr gewinnt: eine alarmierte Karte behält ihre Fläche
 * ({@link kartenGrund}), die Markierung legt nur die Linien darüber.
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
  /** Deeplink-Hervorhebung (`?meldung=` / `?auftrag=`): Bedienfläche plus Ober-/Unterlinie. */
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
        background: kartenGrund(rollen, { alarm, hervorgehoben }),
        border: `1px solid ${rollen.linie}`,
        borderInlineStart: `3px solid ${kante.farbe}`,
        borderRadius: 0,
        boxShadow: hervorgehoben
          ? `inset 0 2px 0 ${rollen.bedien}, inset 0 -2px 0 ${rollen.bedien}`
          : undefined,
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
