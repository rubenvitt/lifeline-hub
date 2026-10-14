import type { CSSProperties, ReactNode } from 'react';
import DemoMarke from '../components/DemoMarke';

/**
 * Auswahllisten zum Disponieren aus den Stammdaten (LFH-733, Spec `demo-daten`, Anforderung
 * „Demo-Stammdaten in den Auswahllisten“; `openspec/changes/archive/2026-10-01-lfh-733-demo-marke-stammdaten/design.md`
 * D4): Demo-Stammdaten bleiben wählbar, tragen die `DemoMarke` und stehen gesammelt in einer
 * Gruppe hinter allen echten Einträgen. Die echten Einträge behalten die Eingangsreihenfolge
 * (das Backend sortiert).
 *
 * Die Demo-Labels sind ReactNodes; nach dem Label kann antd sie nicht filtern. Wer sie
 * durchsuchbar braucht, gibt `suchtext` mit und setzt `showSearch={SUCHTEXT_SUCHE}` (LLH-1100,
 * Change `iw7x9980-sammel-disposition` D7): dann sucht das Feld über diesen Text, bei echten und
 * Demo-Einträgen gleich, und kann mehr als das Label kennen (Träger, Qualifikation).
 */

export const DEMO_GROUP = 'Demo-Daten';

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
  /** Text, über den das Feld sucht (nur mit `suchtext`, s. Dateikopf). */
  suchtext?: string;
}

/** Suche eines `Select` über das Feld `suchtext` der Optionen (s. Dateikopf). */
export const SUCHTEXT_SUCHE = { optionFilterProp: 'suchtext' } as const;

export interface AuswahlGroup {
  label: string;
  title: string;
  options: AuswahlOption[];
}

/**
 * Demo-Label: Text gekürzt, Marke ganz. Für Auswahllisten, die eigene Optionen bauen (etwa die
 * Rufname-Vorschläge, LFH-1187), aus derselben Quelle wie `demoGroupedOptions`.
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
export function splitDemo<T extends { ist_demo: boolean }>(
  eintraege: readonly T[],
): { echte: T[]; demo: T[] } {
  const echte: T[] = [];
  const demo: T[] = [];
  for (const e of eintraege) (e.ist_demo ? demo : echte).push(e);
  return { echte, demo };
}

export function demoGroupedOptions<T extends { id: number; ist_demo: boolean }>(
  eintraege: readonly T[],
  label: (eintrag: T) => string,
  suchtext?: (eintrag: T) => string,
): (AuswahlOption | AuswahlGroup)[] {
  const { echte, demo } = splitDemo(eintraege);
  const mitSuchtext = (e: T) => (suchtext ? { suchtext: suchtext(e) } : {});
  const echteOptionen = echte.map((e) => ({ value: e.id, label: label(e), ...mitSuchtext(e) }));
  return demo.length
    ? [
        ...echteOptionen,
        {
          label: DEMO_GROUP,
          title: DEMO_GROUP,
          options: demo.map((e) => ({
            value: e.id,
            label: <DemoLabel>{label(e)}</DemoLabel>,
            ...mitSuchtext(e),
          })),
        },
      ]
    : echteOptionen;
}
