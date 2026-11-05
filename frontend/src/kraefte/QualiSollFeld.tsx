import { Button, InputNumber, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { QUALI_SOLL_ANZAHL_MAX, QUALI_SOLL_MAX } from '../api/eingabegrenzen';
import { listeQualifikationen } from '../api/qualifikationen';
import { globalKeys } from '../api/queryKeys';
import type { QualiSollEingabe, QualiSollEintrag } from '../api/types';
import { Select } from '../components/Select';
import { IconMuelleimer, IconPlus } from '../icons';

/** Eine Zeile im Entwurf; die Qualifikation fehlt, bis jemand wählt. */
export interface QualiSollZeile {
  qualifikation_id?: number;
  anzahl: number | null;
}

/** Die sendbaren Zeilen: ohne Qualifikation fällt eine Zeile weg, leere Anzahl zählt als 1. */
export function vollstaendig(zeilen: readonly QualiSollZeile[] | undefined): QualiSollEingabe[] {
  return (zeilen ?? []).flatMap((z) =>
    z.qualifikation_id == null
      ? []
      : [{ qualifikation_id: z.qualifikation_id, anzahl: z.anzahl ?? 1 }],
  );
}

const KEINE: QualiSollZeile[] = [];

/**
 * Qualifikationssoll als Zeilen „Qualifikation · Anzahl“ (LLH-1553, design.md D6), kontrolliert
 * für `Form.Item`. Ohne Zeile steht nur der Knopf. Jede Qualifikation steht höchstens einmal da:
 * eine Dublette lehnte der Server ab.
 *
 * `bekannt` liefert Labels für Einträge, die der aktive Katalog nicht mehr führt (deaktiviert).
 */
export default function QualiSollFeld({
  value = KEINE,
  onChange,
  disabled,
  bekannt,
}: {
  value?: QualiSollZeile[];
  onChange?: (zeilen: QualiSollZeile[]) => void;
  disabled?: boolean;
  bekannt?: readonly QualiSollEintrag[] | null;
}) {
  const katalog = useQuery({
    queryKey: globalKeys.qualifikationen(),
    queryFn: listeQualifikationen,
  });
  const alle = [
    ...(katalog.data ?? []).map((q) => ({ value: q.id, label: q.label })),
    ...(bekannt ?? [])
      .filter((b) => !(katalog.data ?? []).some((q) => q.id === b.qualifikation_id))
      .map((b) => ({ value: b.qualifikation_id, label: b.label })),
  ];

  const aendere = (index: number, aenderung: Partial<QualiSollZeile>) =>
    onChange?.(value.map((z, i) => (i === index ? { ...z, ...aenderung } : z)));

  return (
    <div>
      {value.map((zeile, index) => {
        const nummer = index + 1;
        const vergeben = new Set(
          value.filter((_, i) => i !== index).map((z) => z.qualifikation_id),
        );
        return (
          <Space key={index} align="start" style={{ display: 'flex', marginBottom: 8 }} wrap>
            <Select<number>
              aria-label={`Qualifikation ${nummer}`}
              placeholder="Qualifikation"
              loading={katalog.isLoading}
              options={alle.filter((o) => !vergeben.has(o.value))}
              value={zeile.qualifikation_id}
              onChange={(qualifikation_id) => aendere(index, { qualifikation_id })}
              disabled={disabled}
              style={{ minWidth: 200 }}
            />
            <InputNumber
              aria-label={`Anzahl ${nummer}`}
              min={1}
              max={QUALI_SOLL_ANZAHL_MAX}
              precision={0}
              value={zeile.anzahl}
              onChange={(anzahl) => aendere(index, { anzahl })}
              disabled={disabled}
              style={{ width: 88 }}
            />
            <Button
              type="text"
              danger
              aria-label={`Qualifikation ${nummer} entfernen`}
              icon={<IconMuelleimer />}
              onClick={() => onChange?.(value.filter((_, i) => i !== index))}
              disabled={disabled}
            />
          </Space>
        );
      })}
      <Button
        icon={<IconPlus />}
        onClick={() => onChange?.([...value, { anzahl: 1 }])}
        disabled={disabled || value.length >= QUALI_SOLL_MAX}
      >
        Qualifikation fordern
      </Button>
    </div>
  );
}
