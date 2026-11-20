import { Modal, Typography, theme } from 'antd';
import { useEffect, useRef } from 'react';
import type { Meldung, NeuerAuftrag } from '../api/types';
import AuftragFormular, { type ZielOption } from '../auftraege/AuftragFormular';
import {
  MASKE_HAELT_FOKUS,
  type ErfassungsFormularSteuerung,
  type Speicherung,
} from '../components/Erfassung';

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
  const { token } = theme.useToken();
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
  const steuerung = useRef<ErfassungsFormularSteuerung>(null);
  return (
    <Modal
      open={offen}
      title="Aus Meldung Auftrag erteilen"
      footer={null}
      // Kreuz über die Pforte der Erfassungshülle: bei Änderung erst die Rückfrage (LLH-1755).
      onCancel={() => steuerung.current?.abbrechen()}
      closable={sperrt ? { disabled: true } : true}
      // Die Maske schließt nie; Escape läuft über die Tastatur-Ebene des Formulars.
      mask={{ closable: false }}
      wrapProps={MASKE_HAELT_FOKUS}
      keyboard={false}
      destroyOnHidden
      width={520}
    >
      <AuftragFormular
        steuerungRef={steuerung}
        onAbbrechen={onAbbrechen}
        rueckfrageTitel="Aus Meldung Auftrag erteilen"
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
            <Typography.Paragraph type="secondary" style={{ marginBottom: token.margin }}>
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
