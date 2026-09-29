import { theme } from 'antd';
import { useId } from 'react';
import { Select } from '../../components/Select';
import FeldLabel from '../../components/FeldLabel';
import type { KartenAnsicht } from '../../api/types';

interface AnsichtZuordnungProps {
  ansichten: KartenAnsicht[];
  /** Aktuelle Zuordnung des Objekts; `null`/`undefined` = auf allen Ansichten sichtbar. */
  wert: number | null | undefined;
  disabled?: boolean;
  onChange: (ansichtId: number | null) => void;
}

/** Sentinel für „auf allen Ansichten" (ansicht_id = NULL) — 0 ist keine gültige DB-id. */
const ALLE = 0;

/**
 * Ansichts-Zuordnung eines Karten-Objekts: „Auf allen Ansichten zeigen" (NULL) oder eine konkrete
 * Ansicht. Bei nur einer Ansicht entfällt sie. Geteilt von Zonen-/Zeichen-/Bild-Inspektor.
 */
export default function AnsichtZuordnung({
  ansichten,
  wert,
  disabled,
  onChange,
}: AnsichtZuordnungProps) {
  const { token } = theme.useToken();
  // Mehrere Aufrufstellen können nebeneinander stehen → id je Instanz.
  const id = useId();
  if (ansichten.length <= 1) return null;
  return (
    <div style={{ marginTop: token.marginXS }}>
      {/* Das FeldLabel trägt den Namen; „Sichtbar auf" ist zugleich der Accessible Name. */}
      <FeldLabel text="Sichtbar auf" htmlFor={id}>
        <Select<number>
          id={id}
          style={{ width: '100%' }}
          value={wert ?? ALLE}
          disabled={disabled}
          onChange={(v) => onChange(v === ALLE ? null : v)}
          options={[
            { value: ALLE, label: 'Allen Ansichten' },
            ...ansichten.map((a) => ({ value: a.id, label: a.name })),
          ]}
        />
      </FeldLabel>
    </div>
  );
}
