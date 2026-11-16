import { Typography } from 'antd';
import type { ReactNode } from 'react';

/**
 * Kennung mit gedämpfter zweiter Zeile (LLH-1790, Change `lsug0joq-tabellen-touch`, D4): etwa der
 * Funkrufname mit dem Fahrzeugtyp darunter. Dieselbe Darstellung in Tabelle und Karte, weil der
 * Kartentitel das `render` der Kennungsspalte nimmt. Ohne Zusatz keine leere Zeile.
 */
export function KennungMitZusatz({
  kennung,
  zusatz,
}: {
  kennung: ReactNode;
  zusatz?: string | null;
}): ReactNode {
  const text = zusatz?.trim();
  if (!text) return kennung;
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', minWidth: 0 }}>
      {kennung}
      <Typography.Text type="secondary" style={{ fontSize: 12 }} data-lfh="kennung-zusatz">
        {text}
      </Typography.Text>
    </span>
  );
}
