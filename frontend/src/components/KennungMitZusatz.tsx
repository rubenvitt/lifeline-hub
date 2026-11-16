import { Typography } from 'antd';
import type { ReactNode } from 'react';
import { useSpalteGezeigt } from './Datensicht';
import { schriftStil } from './instrument/rollenwerte';

/**
 * Kennung mit gedämpfter zweiter Zeile (LLH-1790, Change `lsug0joq-tabellen-touch`, D4): etwa der
 * Funkrufname mit dem Fahrzeugtyp darunter. Dieselbe Darstellung in Tabelle und Karte, weil der
 * Kartentitel das `render` der Kennungsspalte nimmt. Ohne Zusatz keine leere Zeile.
 *
 * `ausSpalte`: steht diese Spalte in der Tabelle (nach Breite UND Handwahl im Spaltenschalter),
 * entfällt die zweite Zeile; der Wert steht dann in der Spalte und nie doppelt. Ist sie verborgen,
 * egal warum, steht er hier.
 */
export function KennungMitZusatz({
  kennung,
  zusatz,
  ausSpalte,
}: {
  kennung: ReactNode;
  zusatz?: string | null;
  ausSpalte?: string;
}): ReactNode {
  const isSpalteGezeigt = useSpalteGezeigt(ausSpalte);
  const text = zusatz?.trim();
  if (!text || isSpalteGezeigt) return kennung;
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', minWidth: 0 }}>
      {kennung}
      <Typography.Text type="secondary" style={schriftStil('meta')} data-lfh="kennung-zusatz">
        {text}
      </Typography.Text>
    </span>
  );
}
