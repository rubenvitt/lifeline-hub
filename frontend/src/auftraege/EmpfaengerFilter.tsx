import { Select } from '../components/Select';

export interface FilterZiel {
  id: number;
  name: string;
}

/**
 * Empfängerfilter beider Reiter „Einzelaufträge“ und „Einsatzbefehle“ (Spec `auftraege-befehle`,
 * „Beide Reiter gleich gebaut, mit Empfängerfilter“; LLH-1173 design.md D7). Der Wert ist
 * kodiert als `abschnitt:<id>` bzw. `einheit:<id>`; die Aufträge reichen ihn an den Server
 * ({@link empfaengerFilterZiel}), die Befehle prüfen im Client ({@link trifftEmpfaenger}).
 */
export default function EmpfaengerFilter({
  abschnitte,
  einheiten,
  value,
  onChange,
}: {
  abschnitte: FilterZiel[];
  einheiten: FilterZiel[];
  value: string | undefined;
  onChange: (wert: string | undefined) => void;
}) {
  const optionen = [
    {
      label: 'Einsatzabschnitte',
      options: abschnitte.map((a) => ({ value: `abschnitt:${a.id}`, label: a.name })),
    },
    {
      label: 'Einheiten',
      options: einheiten.map((e) => ({ value: `einheit:${e.id}`, label: e.name })),
    },
  ];
  return (
    <Select
      allowClear
      placeholder="Empfänger filtern"
      style={{ minWidth: 220 }}
      value={value}
      onChange={(v) => onChange(v ?? undefined)}
      options={optionen}
    />
  );
}

/** Abschnitt bzw. Einheit aus dem Filterwert; ohne Filter beides leer. */
export function empfaengerFilterZiel(filter: string | undefined): {
  abschnittId?: number;
  einheitId?: number;
} {
  if (!filter) return {};
  const [typ, id] = filter.split(':');
  if (typ === 'abschnitt') return { abschnittId: Number(id) };
  if (typ === 'einheit') return { einheitId: Number(id) };
  return {};
}

/**
 * Ob ein Empfänger der Liste das Filterziel nennt, genau wie der Server bei den Aufträgen: der
 * Abschnitt selbst, ohne Unterabschnitte. Ohne Filter trifft alles, auch eine leere Liste.
 */
export function trifftEmpfaenger(
  eintraege: readonly { abschnitt_id?: number | null; einheit_id?: number | null }[],
  filter: string | undefined,
): boolean {
  const { abschnittId, einheitId } = empfaengerFilterZiel(filter);
  if (abschnittId == null && einheitId == null) return true;
  return eintraege.some((e) =>
    abschnittId != null ? e.abschnitt_id === abschnittId : e.einheit_id === einheitId,
  );
}
