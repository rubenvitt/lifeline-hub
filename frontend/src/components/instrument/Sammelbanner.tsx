import { ArrowDownOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { monoStil, useRollen } from './rollenwerte';

/**
 * Sammelbanner — „12 neue Meldungen" statt eingeschobener Zeilen (Neuentwurf S4;
 * Bedien-Leitlinie Festlegung 6: Live-Updates springen nicht unter dem Cursor, CLS ≤ 0,1,
 * WCAG 3.2.5).
 *
 * Grund `bannerGrund`, Kante `bannerLinie`, Pfeilikone in `bedien`, Text 12 in
 * `bedienText` (Kontrast Tag 7,19 · Nacht 9,71), rechts die Aktion Mono in `bedien`.
 * Blau, nicht Rot: ein neuer Eintrag ist eine Bedienaufforderung, keine Gefahr.
 *
 * `role="status"` — höflich angesagt, nie unterbrechend. Das Banner ist die EINE Meldung
 * je Liste; eine zweite Aktualisierung ändert seinen Text, sie stapelt kein zweites.
 *
 * Die Aktion ist ein antd-`Button type="link"`: er erbt `controlHeight` vom
 * `ConfigProvider` und schuldet damit nicht die zwei Angaben eines handgebauten
 * Bedienziels (LFH-365). Die Ikone steht in einer `aria-hidden`-Hülle — antds Ikonen
 * bringen ein eigenes englisches `aria-label` mit.
 */
export interface SammelbannerProps {
  /** Die Mitteilung („14 neue Einträge seit 13:04"). */
  children: ReactNode;
  /** Die eine Aktion rechts („anzeigen", „alle als gesichtet markieren"). */
  aktion?: { label: string; onKlick: () => void };
  style?: CSSProperties;
}

export default function Sammelbanner({ children, aktion, style }: SammelbannerProps) {
  const { token, rollen } = useRollen();
  return (
    <div
      role="status"
      data-lfh="sammelbanner"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: token.paddingSM,
        paddingBlock: token.paddingXS,
        paddingInline: token.padding,
        background: rollen.bannerGrund,
        border: `1px solid ${rollen.bannerLinie}`,
        ...style,
      }}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex', color: rollen.bedien }}>
        <ArrowDownOutlined />
      </span>
      <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 12, color: rollen.bedienText }}>
        {children}
      </span>
      {aktion != null && (
        <Button
          type="link"
          onClick={aktion.onKlick}
          style={{ ...monoStil(11), paddingInline: token.paddingXS }}
        >
          {aktion.label}
        </Button>
      )}
    </div>
  );
}
