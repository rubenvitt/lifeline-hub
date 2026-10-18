import { Typography } from 'antd';
import type { ReactNode } from 'react';
import { Datenfeld, Datenraster } from '../components/instrument';

export interface StammdatenAngabe {
  label: string;
  /** `null`/leer = ohne Angabe; landet in der Zeile „Ohne Angabe", nicht als Strich im Raster. */
  wert: ReactNode;
  mono?: boolean;
  breit?: boolean;
}

function leer(wert: ReactNode): boolean {
  return wert == null || wert === false || (typeof wert === 'string' && wert.trim() === '');
}

/**
 * Stammdaten als `Datenraster` (LFH-963, design.md D8): nur gesetzte Angaben als Feld, die leeren
 * in EINER Zeile darunter. Eine Spalte voller Striche läse sich am Handy als Inhalt und schöbe die
 * gesetzten Angaben aus dem Bild.
 */
export default function StammdatenRaster({ angaben }: { angaben: readonly StammdatenAngabe[] }) {
  const gesetzt = angaben.filter((a) => !leer(a.wert));
  const ohne = angaben.filter((a) => leer(a.wert)).map((a) => a.label);
  return (
    <div>
      {gesetzt.length > 0 && (
        <Datenraster spalten={2} beschriftung="Stammdaten">
          {gesetzt.map((a) => (
            <Datenfeld key={a.label} label={a.label} mono={a.mono} breit={a.breit}>
              {a.wert}
            </Datenfeld>
          ))}
        </Datenraster>
      )}
      {ohne.length > 0 && (
        <Typography.Paragraph
          type="secondary"
          data-lfh="ohne-angabe"
          style={{ marginTop: 8, marginBottom: 0 }}
        >
          Ohne Angabe: {ohne.join(', ')}
        </Typography.Paragraph>
      )}
    </div>
  );
}
