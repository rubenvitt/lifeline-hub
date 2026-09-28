import type { CSSProperties } from 'react';

// Baustein aller Formularseiten (Einstellungen, `stammdaten/`: Organisation, Fahrzeug- und
// Personal-Detail).

/**
 * Speicher-Leiste am unteren Rand einer Sektion — sticky, mit Trennlinie und eigenem Grund.
 *
 * **Sticky ist die halbe Zusicherung, „im `<form>`" die andere.** Ein Knopf im Kopf-Slot von
 * `EinsatzSeite` stünde AUSSERHALB des `<form>` und könnte nichts übermitteln; hier trägt er
 * `htmlType="submit"`, und Enter sendet über die eingebaute Formularübermittlung (Erfassungs-Norm
 * B4/LFH-332). Sticky, weil er sonst bei vielen Feldern aus dem Bild scrollt, während man das
 * letzte ausfüllt.
 *
 * Kein `<Space>`: hier steht genau EIN Knopf, kein `danger`-Nachbar.
 */
export function speicherLeisteStil(token: {
  colorBgContainer: string;
  paddingSM: number;
  colorBorderSecondary: string;
}): CSSProperties {
  return {
    position: 'sticky',
    bottom: 0,
    zIndex: 1,
    background: token.colorBgContainer,
    paddingBlock: token.paddingSM,
    borderTop: `1px solid ${token.colorBorderSecondary}`,
  };
}
