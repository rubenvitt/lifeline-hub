import { Modal } from 'antd';
import { useEffect, useRef } from 'react';
import type { Auftrag, AuftragPatch, NeuerAuftrag } from '../api/types';
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
  /**
   * Berichtigen statt Erteilen (LLH-1098): dasselbe Formular, vorbelegt mit dem Stand beim Öffnen,
   * ohne Serie. Der Dialog schließt erst beim Erfolg.
   */
  berichtigen?: { auftrag: Auftrag; onSpeichern: (patch: AuftragPatch) => Promise<unknown> };
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
  berichtigen: berichtigenProp,
}: Props) {
  // Beim Schließen räumt der Aufrufer den Auftrag; bis zum Ende der Animation bleibt der Dialog der
  // Berichtigen-Dialog, statt kurz auf „Auftrag erteilen“ umzuspringen.
  const gemerkt = useRef(berichtigenProp);
  if (berichtigenProp) gemerkt.current = berichtigenProp;
  const berichtigen = berichtigenProp ?? (offen ? undefined : gemerkt.current);
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
      title={
        berichtigen
          ? berichtigen.auftrag.lfd_nr != null
            ? `Auftrag #${berichtigen.auftrag.lfd_nr} berichtigen`
            : 'Auftrag berichtigen'
          : 'Auftrag erteilen'
      }
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
        // Je Auftrag ein frisches Formular: die Vorbelegung gilt ab dem Öffnen.
        key={berichtigen?.auftrag.id ?? 'neu'}
        card={false}
        senden={senden}
        abschnitte={abschnitte}
        einheiten={einheiten}
        einsatzId={einsatzId}
        serie={!berichtigen}
        onAnlegen={onAnlegen}
        berichtigen={berichtigen}
        // Nach dem Einzel-Erteilen schließt der Dialog; „Speichern und nächste“ hält ihn offen.
        onFertig={onSchliessen}
        speicherung={speicherung}
        speicherFehlerTitel={berichtigen ? 'Auftrag nicht berichtigt' : 'Auftrag nicht erteilt'}
        speicherFehlerFallback={
          berichtigen ? 'Berichtigen fehlgeschlagen' : 'Erteilen fehlgeschlagen'
        }
      />
    </Modal>
  );
}
