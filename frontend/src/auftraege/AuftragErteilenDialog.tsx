import { Modal } from 'antd';
import { useEffect, useRef } from 'react';
import type { NeuerAuftrag } from '../api/types';
import type { Speicherung } from '../components/Erfassung';
import AuftragFormular, { type ZielOption } from './AuftragFormular';

interface Props {
  offen: boolean;
  onSchliessen: () => void;
  abschnitte: ZielOption[];
  einheiten: ZielOption[];
  einsatzId: number;
  senden: boolean;
  /** `mutateAsync`: die Hülle leert die Felder nur, wenn der Auftrag angekommen ist. */
  onAnlegen: (d: NeuerAuftrag) => Promise<unknown>;
  /** Die Erteilen-Mutation (LFH-1077): ihr Grund steht im Formular; solange sie läuft, ist jeder Ausweg gesperrt. */
  speicherung?: Speicherung;
}

/**
 * „Auftrag erteilen“ als Dialog statt Inline-Paneel über der Liste (Spec `auftraege-befehle`,
 * „Erfassen per Dialog“; design.md D10). Kein `ErfassungsModal`: `AuftragFormular` bringt sein
 * eigenes `ErfassungsFormular` mit (Enter sendet, Fokus im ersten Feld, Serie, Reset), ein
 * `ErfassungsModal` darum ergäbe zwei Formulare. Dieselbe Hülle wie die drei Modal-Fassungen
 * (`meldungen/AuftragErteilenModal.tsx`), aber mit Serie: an derselben Lage entstehen mehrere
 * Aufträge hintereinander.
 *
 * `destroyOnHidden` hängt das Formular je Öffnen neu ein: so setzt jeder Weg hinaus (Kreuz, Escape,
 * Maske) zurück, ohne dass der Aufrufer `resetFields()` ruft.
 */
export default function AuftragErteilenDialog({
  offen,
  onSchliessen,
  abschnitte,
  einheiten,
  einsatzId,
  senden,
  onAnlegen,
  speicherung,
}: Props) {
  const sperrt = speicherung?.isPending === true;
  // Öffnen und Schließen räumen den Grund: ein schließender Dialog bleibt bis zum Ende seiner
  // Animation eingehängt, ein schnelles Wiederöffnen hängt das Formular nicht neu ein.
  const speicherungRef = useRef(speicherung);
  speicherungRef.current = speicherung;
  useEffect(() => {
    const s = speicherungRef.current;
    if (s && !s.isPending && s.error != null) s.reset();
  }, [offen]);
  return (
    <Modal
      open={offen}
      title="Auftrag erteilen"
      footer={null}
      onCancel={() => {
        if (!sperrt) onSchliessen();
      }}
      closable={sperrt ? { disabled: true } : true}
      mask={{ closable: !sperrt }}
      keyboard={!sperrt}
      destroyOnHidden
      width={640}
    >
      <AuftragFormular
        card={false}
        senden={senden}
        abschnitte={abschnitte}
        einheiten={einheiten}
        einsatzId={einsatzId}
        serie
        onAnlegen={onAnlegen}
        // Nach dem Einzel-Erteilen schließt der Dialog; „Speichern und nächste“ hält ihn offen.
        onFertig={onSchliessen}
        speicherung={speicherung}
        speicherFehlerTitel="Auftrag nicht erteilt"
        speicherFehlerFallback="Erteilen fehlgeschlagen"
      />
    </Modal>
  );
}
