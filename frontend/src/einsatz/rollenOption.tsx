import type { SelectProps } from 'antd';
import { Textstufe } from '../components/instrument';
import type { RollenBegriff } from './rollenVokabular';

/** Eine Option einer Rollenauswahl: `label` ist der Name, `darf` die zweite Zeile der Liste. */
export interface RollenOption<K extends string> {
  value: K;
  label: string;
  darf: string;
}

/**
 * Optionen einer Rollenauswahl aus dem Vokabular (LLH-1818), in der Reihenfolge des Records oder
 * der übergebenen. Das geschlossene Feld zeigt `label`, also nur den Namen: schmale Spalten
 * (Modul-Einstellungen) wachsen nicht.
 */
export function rollenOptionen<K extends string>(
  record: Record<K, RollenBegriff>,
  reihenfolge: readonly K[] = Object.keys(record) as K[],
): RollenOption<K>[] {
  return reihenfolge.map((k) => ({ value: k, label: record[k].name, darf: record[k].darf }));
}

/**
 * `optionRender` jeder Rollenauswahl: in der aufgeklappten Liste unter dem Namen klein, was die
 * Rolle darf (`frontend/AGENTS.md`, „Begriffe“, und die Ausnahme in „Texte: zeigen statt
 * erklären“). Muster wie die Zeit unter dem Stand der Lagekarte (`SnapshotLeiste.tsx`).
 */
export const rollenOptionRender: NonNullable<SelectProps['optionRender']> = ({ data }) => {
  const darf = (data as Partial<RollenOption<string>>).darf;
  return (
    <div style={{ whiteSpace: 'normal' }}>
      <div>{data.label}</div>
      {darf && (
        <Textstufe stufe="textKlein" ton="gedaempft">
          {darf}
        </Textstufe>
      )}
    </div>
  );
};
