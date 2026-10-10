import { Modal, Typography } from 'antd';
import { useEffect, useRef } from 'react';
import type { Meldung, NeuerAuftrag } from '../api/types';
import AuftragFormular, { type ZielOption } from '../auftraege/AuftragFormular';
import type { Speicherung } from '../components/Erfassung';

interface Props {
  meldung: Meldung | null;
  abschnitte: ZielOption[];
  einheiten: ZielOption[];
  /** Für die Katalogauswahl der Funktionen (LFH-549). */
  einsatzId?: number;
  senden: boolean;
  onAbbrechen: () => void;
  onAnlegen: (d: NeuerAuftrag) => Promise<unknown>;
  /**
   * Die Erteilen-Mutation (LFH-1077): ihr Fehler steht im Formular, bis zum nächsten Absenden; das
   * Formular hängt je Öffnen neu ein und räumt ihn dabei. Solange sie läuft, ist jeder Ausweg
   * gesperrt.
   */
  speicherung?: Speicherung;
}

/** Vorbelegung des Auftragstexts aus der Meldung (Absender + Inhalt, LFH-113). */
function initialText(m: Meldung | null): string {
  if (!m) return '';
  return `${m.absender}: ${m.inhalt}`;
}

/**
 * Meldung → Auftrag erteilen: das Auftragsformular, mit dem Meldungsinhalt vorbelegt (wie
 * `HeraufstufenAuftragModal`). `destroyOnHidden` remountet es je Öffnen, damit `initialText`
 * frisch greift.
 */
export default function AuftragErteilenModal({
  meldung,
  abschnitte,
  einsatzId,
  einheiten,
  senden,
  onAbbrechen,
  onAnlegen,
  speicherung,
}: Props) {
  const offen = meldung !== null;
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
      title="Aus Meldung Auftrag erteilen"
      footer={null}
      onCancel={() => {
        if (!sperrt) onAbbrechen();
      }}
      closable={sperrt ? { disabled: true } : true}
      mask={{ closable: !sperrt }}
      keyboard={!sperrt}
      destroyOnHidden
      width={520}
    >
      <AuftragFormular
        card={false}
        senden={senden}
        abschnitte={abschnitte}
        einheiten={einheiten}
        einsatzId={einsatzId}
        initialText={initialText(meldung)}
        zitat={
          meldung && (
            // Read-only Wortlaut der Quellmeldung: der vorbelegte Auftragstext wird beim Formulieren
            // überschrieben, dann fehlte sonst der Urtext.
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
              <Typography.Text strong>{meldung.absender}:</Typography.Text> {meldung.inhalt}
            </Typography.Paragraph>
          )
        }
        onAnlegen={onAnlegen}
        speicherung={speicherung}
        speicherFehlerTitel="Auftrag nicht erteilt"
        speicherFehlerFallback="Erteilen fehlgeschlagen"
      />
    </Modal>
  );
}
