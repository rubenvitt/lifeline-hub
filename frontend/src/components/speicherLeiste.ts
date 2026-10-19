import type { CSSProperties } from 'react';
import { theme } from 'antd';
import { FOKUSABSTAND_SPEICHERLEISTE, useFokusabstandUnten } from './fokusabstandUnten';

// Baustein aller Formularseiten (Einstellungen, `stammdaten/`: Organisation, Fahrzeug- und
// Personal-Detail) und des Bearbeiten-Modus von Schaden- und Tier-Detail (LLH-1101).

/**
 * Speicher-Leiste am unteren Rand einer Sektion — sticky, mit Trennlinie und eigenem Grund.
 *
 * **Sticky ist die halbe Zusicherung, „im `<form>`" die andere.** Ein Knopf im Kopf-Slot von
 * `EinsatzSeite` stünde AUSSERHALB des `<form>` und könnte nichts übermitteln; hier trägt er
 * `htmlType="submit"`, und Enter sendet über die eingebaute Formularübermittlung (Erfassungs-Norm
 * B4/LFH-332). Sticky, weil er sonst bei vielen Feldern aus dem Bild scrollt, während man das
 * letzte ausfüllt.
 *
 * Kein `<Space>`: auf den Formularseiten steht genau EIN Knopf, kein `danger`-Nachbar. Eine
 * Sitzung, die man abbrechen kann (Bearbeiten-Modus einer Detailseite, LLH-1101), trägt
 * „Speichern“ und „Abbrechen“: mit `hasAbbrechen` wird die Leiste eine umbrechende Reihe mit dem
 * Abstand `padding` (11/18/26 px), derselben Stufe wie der Fuß der Erfassungs-Hülle — die
 * Leitlinie verlangt ≥ 8 px mit Maus, ≥ 16 px mit Touch (`frontend/AGENTS.md`, „Farbe und
 * Zeichen“). Ohne die Option bleibt die Leiste, wie sie war.
 */
export function speicherLeisteStil(
  token: {
    colorBgContainer: string;
    paddingSM: number;
    padding: number;
    colorBorderSecondary: string;
  },
  { hasAbbrechen = false }: { hasAbbrechen?: boolean } = {},
): CSSProperties {
  return {
    position: 'sticky',
    bottom: 0,
    zIndex: 1,
    background: token.colorBgContainer,
    paddingBlock: token.paddingSM,
    borderTop: `1px solid ${token.colorBorderSecondary}`,
    ...(hasAbbrechen ? { display: 'flex', flexWrap: 'wrap', gap: token.padding } : {}),
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
export function useSpeicherLeiste(optionen: { hasAbbrechen?: boolean } = {}) {
  const { token } = theme.useToken();
  const ref = useFokusabstandUnten(token.marginSM, FOKUSABSTAND_SPEICHERLEISTE);
  return {
    ref,
    'data-lfh': 'speicherleiste',
    style: speicherLeisteStil(token, optionen),
  } as const;
}
