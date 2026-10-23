import type { ReactNode } from 'react';
import { theme } from 'antd';
import { monoStil } from '../components/instrument';

/** Eine Spalte der Papierform: Kopfwort und Zelleninhalt als reiner Text. */
export interface DruckSpalte<T> {
  titel: string;
  wert: (zeile: T) => ReactNode;
  /** Nummern und Zeiten in Monospace, ohne Umbruch. */
  mono?: boolean;
}

interface Props<T> {
  /** `data-lfh` der Tabelle, für Tests und e2e. */
  kennung: string;
  spalten: readonly DruckSpalte<T>[];
  /** Bereits geordnet — die Tabelle sortiert nicht. */
  zeilen: readonly T[];
  schluessel: (zeile: T) => number | string;
}

/**
 * Papierform einer Modul-Liste (LFH-727, `openspec/changes/archive/2026-10-01-lfh-727-druck-modul-listen/design.md`
 * D6), nach dem Vorbild `etb/EtbDruckTabelle.tsx`: ein schlichtes HTML-`<table>`, weder
 * `KatalogTabelle` noch `Datensicht` — die Druckansicht ist kein Bedienort. Keine Sortierung, kein
 * Filter, kein Spaltenschalter, keine Links. Den Kopf je Druckseite und „Zeile nicht über den
 * Rand" trägt `druck/druck.css` (`thead`, `tr`).
 */
export default function DruckTabelle<T>({ kennung, spalten, zeilen, schluessel }: Props<T>) {
  const { token } = theme.useToken();
  const zelle = {
    padding: `${token.paddingXXS}px ${token.paddingXS}px`,
    borderBlockEnd: `1px solid ${token.colorBorderSecondary}`,
    verticalAlign: 'top',
    textAlign: 'start',
  } as const;

  return (
    <table
      data-lfh={kennung}
      style={{ width: '100%', borderCollapse: 'collapse', fontSize: token.fontSize }}
    >
      <thead>
        <tr>
          {spalten.map((s) => (
            <th
              key={s.titel}
              scope="col"
              style={{
                ...zelle,
                borderBlockEnd: `1px solid ${token.colorBorder}`,
                fontWeight: 600,
              }}
            >
              {s.titel}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {zeilen.map((z) => (
          <tr key={schluessel(z)}>
            {spalten.map((s) => (
              <td
                key={s.titel}
                style={
                  s.mono ? { ...zelle, ...monoStil(token.fontSize), whiteSpace: 'nowrap' } : zelle
                }
              >
                {s.wert(z)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
