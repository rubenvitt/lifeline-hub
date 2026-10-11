import type { CSSProperties, ReactNode } from 'react';
import DemoMarke from '../components/DemoMarke';

/**
 * Auswahllisten zum Disponieren aus den Stammdaten (LFH-733, Spec `demo-daten`, Anforderung
 * „Demo-Stammdaten in den Auswahllisten“; `openspec/changes/archive/2026-10-01-lfh-733-demo-marke-stammdaten/design.md`
 * D4): Demo-Stammdaten bleiben wählbar, tragen die `DemoMarke` und stehen gesammelt in einer
 * Gruppe hinter allen echten Einträgen. Die echten Einträge behalten die Eingangsreihenfolge
 * (das Backend sortiert).
 *
 * Die Demo-Labels sind ReactNodes. Bekommt ein Feld später `showSearch`, braucht es ein
 * `optionFilterProp` auf ein Textfeld — nach dem Label kann antd dann nicht mehr filtern.
 */

export const DEMO_GRUPPE = 'Demo-Daten';

/**
 * Das Auswahlfeld ist schmal (`minWidth: 260`), die Liste so breit wie das Feld. Gekürzt wird
 * deshalb der Text, nie die Marke: ohne `flex: none` an der Marke schnitt antds Ellipse beim
 * längsten Demo-Eintrag „Demo“ zu „De“ ab (gesehen im Stack-Durchgang zu LFH-733).
 */
const demoLabelStil: CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 };
const demoTextStil: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export interface AuswahlOption {
  value: number;
  label: ReactNode;
}

export interface AuswahlGruppe {
  label: string;
  title: string;
  options: AuswahlOption[];
}

/**
 * Demo-Label: Text gekürzt, Marke ganz. Für Auswahllisten, die eigene Optionen bauen (etwa die
 * Rufname-Vorschläge, LFH-1187), aus derselben Quelle wie `demoGruppierteOptionen`.
 */
export function DemoLabel({ children }: { children: ReactNode }) {
  return (
    <span style={demoLabelStil}>
      <span style={demoTextStil}>{children}</span>
      <span style={{ flex: 'none' }}>
        <DemoMarke />
      </span>
    </span>
  );
}

/** Teilt in echte und Demo-Einträge; beide behalten die Eingangsreihenfolge. */
export function trenneDemo<T extends { ist_demo: boolean }>(
  eintraege: readonly T[],
): { echte: T[]; demo: T[] } {
  const echte: T[] = [];
  const demo: T[] = [];
  for (const e of eintraege) (e.ist_demo ? demo : echte).push(e);
  return { echte, demo };
}

export function demoGruppierteOptionen<T extends { id: number; ist_demo: boolean }>(
  eintraege: readonly T[],
  label: (eintrag: T) => string,
): (AuswahlOption | AuswahlGruppe)[] {
  const { echte, demo } = trenneDemo(eintraege);
  const echteOptionen = echte.map((e) => ({ value: e.id, label: label(e) }));
  return demo.length
    ? [
        ...echteOptionen,
        {
          label: DEMO_GRUPPE,
          title: DEMO_GRUPPE,
          options: demo.map((e) => ({ value: e.id, label: <DemoLabel>{label(e)}</DemoLabel> })),
        },
      ]
    : echteOptionen;
}
