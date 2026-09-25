import { Button, Space, Typography } from 'antd';
import { useDrucken } from './useDrucken';

interface Props {
  /** Läuft im selben Zug VOR dem Druck (Meldebild: alle Mittel aufklappen). */
  vorbereiten?: () => void;
  /** Sperre des Aufrufers, z. B. solange die ETB-Druckansicht noch nicht alles geladen hat. */
  gesperrt?: boolean;
  /** `primary` nur dort, wo Drucken die Primäraktion der Seite ist (ETB-Druckansicht). */
  typ?: 'primary' | 'default';
}

/**
 * „Drucken / als PDF" für jedes Druckstück (LFH-22). Öffnet den Druckdialog über
 * `useDrucken`, also erst mit geladenem Druckkopf.
 *
 * Kann die Organisation nicht geladen werden, steht der Knopf GESPERRT da (nicht versteckt,
 * LFH-345 · M16) und daneben der Grund samt „Erneut laden". Kein `loading` am Knopf: antds
 * Ladezustand benennt ihn zu „loading Drucken / als PDF" um (LFH-495).
 */
export default function DruckKnopf({ vorbereiten, gesperrt = false, typ = 'default' }: Props) {
  const { drucken, zustand, wiederholen } = useDrucken();

  if (zustand === 'fehler') {
    return (
      <Space wrap size="middle">
        <Button type={typ} disabled>
          Drucken / als PDF
        </Button>
        <Typography.Text type="secondary">Organisation nicht geladen</Typography.Text>
        <Button onClick={wiederholen} aria-label="Organisation erneut laden">
          Erneut laden
        </Button>
      </Space>
    );
  }

  return (
    <Button
      type={typ}
      disabled={gesperrt}
      onClick={() => {
        vorbereiten?.();
        drucken();
      }}
    >
      Drucken / als PDF
    </Button>
  );
}
