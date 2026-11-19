import type { CSSProperties } from 'react';
import { Button, InputNumber } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { QUALI_SOLL_ANZAHL_MAX, QUALI_SOLL_MAX } from '../api/eingabegrenzen';
import { listeQualifikationen } from '../api/qualifikationen';
import { globalKeys } from '../api/queryKeys';
import type { QualiSollEingabe, QualiSollEintrag } from '../api/types';
import { FELD_KLASSE, Stapel } from '../components/instrument';
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

/** Hüllen der Eingaben einer Zeile: Breiten als Feldstufe (Spec `feldbreiten`). */
const AUSWAHL_HUELLE: CSSProperties = { display: 'grid', minWidth: 'var(--lfh-feld-schmal)' };
const ANZAHL_HUELLE: CSSProperties = { width: 'var(--lfh-feld-kurz)' };

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
  id,
  'aria-label': ariaLabel,
}: {
  value?: QualiSollZeile[];
  onChange?: (zeilen: QualiSollZeile[]) => void;
  disabled?: boolean;
  bekannt?: readonly QualiSollEintrag[] | null;
  /**
   * Ziel des Etiketts einer Zelle (`DatenfeldEingabe` reicht `id` herein, LLH-1920); mit
   * `aria-label` ist das Feld eine benannte Gruppe seiner Zeilen.
   */
  id?: string;
  'aria-label'?: string;
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
    <Stapel
      abstand="sm"
      ausrichten="start"
      id={id}
      role={ariaLabel ? 'group' : undefined}
      aria-label={ariaLabel}
    >
      {value.map((zeile, index) => {
        const nummer = index + 1;
        const vergeben = new Set(
          value.filter((_, i) => i !== index).map((z) => z.qualifikation_id),
        );
        return (
          <Stapel key={index} richtung="zeile" umbruch ausrichten="start" abstand="xs">
            <div style={AUSWAHL_HUELLE}>
              <Select<number>
                aria-label={`Qualifikation ${nummer}`}
                placeholder="Qualifikation"
                loading={katalog.isLoading}
                options={alle.filter((o) => !vergeben.has(o.value))}
                value={zeile.qualifikation_id}
                onChange={(qualifikation_id) => aendere(index, { qualifikation_id })}
                disabled={disabled}
              />
            </div>
            <div className={FELD_KLASSE} style={ANZAHL_HUELLE}>
              <InputNumber
                aria-label={`Anzahl ${nummer}`}
                min={1}
                max={QUALI_SOLL_ANZAHL_MAX}
                precision={0}
                value={zeile.anzahl}
                onChange={(anzahl) => aendere(index, { anzahl })}
                disabled={disabled}
              />
            </div>
            <Button
              type="text"
              danger
              aria-label={`Qualifikation ${nummer} entfernen`}
              icon={<IconMuelleimer />}
              onClick={() => onChange?.(value.filter((_, i) => i !== index))}
              disabled={disabled}
            />
          </Stapel>
        );
      })}
      <Button
        icon={<IconPlus />}
        onClick={() => onChange?.([...value, { anzahl: 1 }])}
        disabled={disabled || value.length >= QUALI_SOLL_MAX}
      >
        Qualifikation fordern
      </Button>
    </Stapel>
  );
}
