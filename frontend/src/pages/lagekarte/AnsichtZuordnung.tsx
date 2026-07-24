import { Typography } from 'antd';
import { Select } from '../../components/Select';
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
  if (ansichten.length <= 1) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Sichtbar auf
      </Typography.Text>
      <Select<number>
        size="small"
        style={{ width: '100%', marginTop: 2 }}
        value={wert ?? ALLE}
        disabled={disabled}
        onChange={(v) => onChange(v === ALLE ? null : v)}
        aria-label="Ansichts-Zuordnung"
        options={[
          { value: ALLE, label: 'Allen Ansichten' },
          ...ansichten.map((a) => ({ value: a.id, label: a.name })),
        ]}
      />
    </div>
  );
}
