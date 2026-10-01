import type { ReactNode } from 'react';
import { Space } from 'antd';
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

export interface AuswahlOption {
  value: number;
  label: ReactNode;
}

export interface AuswahlGruppe {
  label: string;
  title: string;
  options: AuswahlOption[];
}

export function demoGruppierteOptionen<T extends { id: number; ist_demo: boolean }>(
  eintraege: readonly T[],
  label: (eintrag: T) => string,
): (AuswahlOption | AuswahlGruppe)[] {
  const echte: AuswahlOption[] = [];
  const demo: AuswahlOption[] = [];
  for (const e of eintraege) {
    if (e.ist_demo) {
      demo.push({
        value: e.id,
        label: (
          <Space size={4}>
            {label(e)}
            <DemoMarke />
          </Space>
        ),
      });
    } else {
      echte.push({ value: e.id, label: label(e) });
    }
  }
  return demo.length
    ? [...echte, { label: DEMO_GRUPPE, title: DEMO_GRUPPE, options: demo }]
    : echte;
}
