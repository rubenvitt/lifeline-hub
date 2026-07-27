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
 * Ansichts-Zuordnung eines Karten-Objekts (B/LFH-320): „Auf allen Ansichten zeigen" (NULL)
 * oder auf eine konkrete Ansicht verschieben. Bei nur einer Ansicht entfällt die Zuordnung
 * (nichts zu wählen). Geteilt von Zonen-/Zeichen-/Bild-Inspektor.
 */
export default function AnsichtZuordnung({ ansichten, wert, disabled, onChange }: AnsichtZuordnungProps) {
  const { token } = theme.useToken();
  // Drei Aufrufstellen, die nebeneinander stehen können → id je Instanz, kein Literal.
  const id = useId();
  if (ansichten.length <= 1) return null;
  return (
    <div style={{ marginTop: token.marginXS }}>
      {/* Kein `aria-label` mehr: das FeldLabel trägt den Namen; der sichtbare Text
          („Sichtbar auf") ist damit zugleich der Accessible Name (LFH-328/A2). */}
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
