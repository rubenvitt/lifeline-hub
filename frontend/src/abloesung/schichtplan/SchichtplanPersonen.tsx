import { useDraggable } from '@dnd-kit/core';
import { Input, Typography } from 'antd';
import { useId, useMemo, useState } from 'react';
import { useRollen } from '../../components/instrument';
import { IconMenue } from '../../icons';
import { PERSONEN_GRUPPEN, type PersonOption } from './schichtplanZeilen';

/**
 * Seitenleiste des Schichtplans (LLH-1554): wer eingeteilt werden kann, nach „Verfügbar“, „Im
 * Einsatz“, „Stamm“ und „Helfer“, zum Ziehen auf einen Block. Gezogen wird mit dnd-kit und
 * `ZugPointerSensor` (Kontext in `SchichtplanAnsicht`); jede Zeile ist ganz der Griff
 * (`touch-action: none`), damit es auch auf dem Führungs-Tablet zieht. Die Zeilen sind keine
 * Tastaturziele: den Weg ohne Ziehen trägt das Feld „Personen“ im Blockdialog (WCAG 2.5.7), wie
 * in der Gliederung (`pages/einsatzabschnitte/GliederungDrag.tsx`).
 */

/** Daten einer gezogenen Person. */
export interface PersonZugDaten {
  art: 'person';
  option: PersonOption;
}

interface SchichtplanPersonenProps {
  /** `null` lädt noch. */
  optionen: readonly PersonOption[] | null;
  /** Grund, warum niemand gezogen werden kann (Modul Personal, Schreibrecht). */
  gesperrt?: string;
}

export default function SchichtplanPersonen({ optionen, gesperrt }: SchichtplanPersonenProps) {
  const { token, rollen } = useRollen();
  const [suche, setSuche] = useState('');
  const gefiltert = useMemo(() => {
    const s = suche.trim().toLocaleLowerCase('de');
    return (optionen ?? []).filter((o) => !s || o.name.toLocaleLowerCase('de').includes(s));
  }, [optionen, suche]);
  return (
    <aside
      aria-label="Personen zum Einteilen"
      data-lfh="schichtplan-personen"
      style={{
        border: `1px solid ${rollen.linie}`,
        background: rollen.paneel,
        padding: token.paddingSM,
        display: 'flex',
        flexDirection: 'column',
        gap: token.marginXS,
        minWidth: 0,
      }}
    >
      <Typography.Text strong>Personen</Typography.Text>
      {gesperrt ? (
        <Typography.Text type="secondary" data-lfh="schichtplan-personen-sperre">
          {gesperrt}
        </Typography.Text>
      ) : (
        <>
          <Input
            allowClear
            aria-label="Personen suchen"
            placeholder="Name"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
          />
          {optionen == null ? (
            <Typography.Text type="secondary">lädt …</Typography.Text>
          ) : (
            PERSONEN_GRUPPEN.map((g) => {
              const eigene = gefiltert.filter((o) => o.gruppe === g.gruppe);
              if (eigene.length === 0) return null;
              return (
                <section key={g.gruppe} aria-label={g.titel}>
                  <Typography.Text
                    type="secondary"
                    style={{ display: 'block', fontSize: 12, marginBottom: 2 }}
                  >
                    {g.titel} ({eigene.length})
                  </Typography.Text>
                  {eigene.map((o) => (
                    <PersonZeile key={o.schluessel} option={o} />
                  ))}
                </section>
              );
            })
          )}
        </>
      )}
    </aside>
  );
}

function PersonZeile({ option }: { option: PersonOption }) {
  const { token, rollen } = useRollen();
  const instanz = useId();
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: `schichtplan-person-${option.schluessel}${instanz}`,
    data: { art: 'person', option } satisfies PersonZugDaten,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      data-lfh="schichtplan-person"
      data-person={option.schluessel}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: token.marginXS,
        minHeight: token.controlHeight,
        paddingInline: token.paddingXS,
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        opacity: isDragging ? 0.4 : 1,
        borderBottom: `1px solid ${rollen.linie}`,
      }}
    >
      <span aria-hidden="true" style={{ color: rollen.gedaempft, display: 'inline-flex' }}>
        <IconMenue />
      </span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {option.name}
      </span>
    </div>
  );
}
