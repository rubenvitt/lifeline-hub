import { Typography } from 'antd';
import { Segmentleiste, type SegmentOption } from '../components/instrument';
import type { Zeitdarstellung } from '../api/types';
import { setzeZeitdarstellung, useZeitdarstellungGeraet } from './zeitDarstellungStore';

type Wahl = Zeitdarstellung | 'vorgabe';

const OPTIONEN: readonly SegmentOption<Wahl>[] = [
  { wert: 'vorgabe', label: 'Vorgabe' },
  { wert: 'taktisch', label: 'Taktisch' },
  { wert: 'datum_uhrzeit', label: 'Datum und Uhrzeit' },
];

/**
 * Zeitdarstellung dieses Geräts (LLH-1053, E3): „Vorgabe“ folgt Einsatz und Organisation, die
 * beiden anderen übersteuern sie hier, sofort in allen offenen Ansichten. Ausdrucke folgen nie
 * dieser Wahl (E4). Im Profil, Paneel „Darstellung auf diesem Gerät“; die Sprungpalette setzt
 * dieselbe Wahl.
 */
export default function ZeitdarstellungGeraetWahl() {
  const geraet = useZeitdarstellungGeraet();
  return (
    <section style={{ maxWidth: 480 }}>
      <Segmentleiste<Wahl>
        beschriftung="Zeitdarstellung auf diesem Gerät"
        optionen={OPTIONEN}
        wert={geraet ?? 'vorgabe'}
        onWechsel={(w) => setzeZeitdarstellung(w === 'vorgabe' ? null : w)}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
        Taktisch: 101430okt26, Datum und Uhrzeit: 10.10.26 14:30. „Vorgabe“ folgt der Einstellung
        von Einsatz und Organisation. Ausdrucke folgen immer ihr.
      </Typography.Paragraph>
    </section>
  );
}
