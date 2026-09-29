import type { CSSProperties } from 'react';
import { theme } from 'antd';
import { FOKUSABSTAND_SPEICHERLEISTE, useFokusabstandUnten } from './fokusabstandUnten';

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

/**
 * Props der Leiste, zum Ausbreiten auf ihr `<div>`: Stil, Marke und der Fokusabstand.
 *
 * **Sticky allein verdeckt, was es schützen soll** (LFH-475, WCAG 2.4.11): beim Vorwärtstabben
 * rollt der Browser ein Feld an den UNTEREN Fensterrand — genau unter die Leiste. Gemessen auf
 * der Fahrzeug-Detailseite bei 390 × 420: das nächste Feld stand vollständig hinter ihr. Die
 * Leiste misst deshalb ihre Höhe (`components/fokusabstandUnten.ts`), und das Dokument hält sie
 * per `scroll-padding-block-end` frei, solange die Marke `data-lfh="speicherleiste"` im Baum
 * steht (`index.css`; `scroll-margin` an den Feldern blieb gemessen wirkungslos). Nachweis:
 * `e2e/fokus-verdeckung.spec.ts`.
 */
export function useSpeicherLeiste() {
  const { token } = theme.useToken();
  const ref = useFokusabstandUnten(token.marginSM, FOKUSABSTAND_SPEICHERLEISTE);
  return { ref, 'data-lfh': 'speicherleiste', style: speicherLeisteStil(token) } as const;
}
