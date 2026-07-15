import { Segmented, theme } from 'antd';
import { useState } from 'react';
import type { ReactNode } from 'react';

interface Sektion {
  key: string;
  label: ReactNode;
  inhalt: ReactNode;
}

interface SegmentSektionenProps {
  sektionen: Sektion[];
  /** Benennt die Segmented-radiogroup für Screenreader/Tests. */
  ariaLabel: string;
  /** Initial aktive Sektion (uncontrolled). Default: erste Sektion. */
  standardKey?: string;
  /** Segmented über die volle Breite strecken. */
  block?: boolean;
}

/**
 * Binnen-Gliederung mehrsektioniger Verwaltungs-Seiten via antd `Segmented` (Pillen)
 * statt verschachtelter Tabs (LFH-281). Referenzmuster: `ThemeToggle`.
 *
 * ALLE Panels bleiben gemountet (inaktiv `display:none`, kein conditional unmount):
 * nötig, damit ein seitenweites `<Form>`-Submit alle Felder erfasst und
 * `getByText`/`getByLabelText` auch verborgene Inhalte finden. Interaktive
 * Section-Tests klicken erst die Pille (`getByText(label)`), dann tippen.
 */
export default function SegmentSektionen({
  sektionen,
  ariaLabel,
  standardKey,
  block,
}: SegmentSektionenProps) {
  const { token } = theme.useToken();
  const [aktiv, setAktiv] = useState<string>(standardKey ?? sektionen[0]?.key ?? '');
  return (
    <>
      <Segmented
        value={aktiv}
        onChange={(wert) => setAktiv(String(wert))}
        aria-label={ariaLabel}
        block={block}
        options={sektionen.map((s) => ({ value: s.key, label: s.label }))}
        style={{ marginBottom: token.marginLG }}
      />
      {sektionen.map((s) => (
        <div key={s.key} style={{ display: aktiv === s.key ? 'block' : 'none' }}>
          {s.inhalt}
        </div>
      ))}
    </>
  );
}
