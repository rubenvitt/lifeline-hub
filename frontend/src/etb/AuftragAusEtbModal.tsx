import { Modal, Typography, theme } from 'antd';
import type { EtbEintragAnzeige, NeuerAuftrag } from '../api/types';
import AuftragFormular, { type ZielOption } from '../auftraege/AuftragFormular';
import {
  MASKE_HAELT_FOKUS,
  type ErfassungsFormularSteuerung,
  type Speicherung,
} from '../components/Erfassung';
import { useRef } from 'react';

interface Props {
  eintrag: EtbEintragAnzeige | null;
  abschnitte: ZielOption[];
  einheiten: ZielOption[];
  /** Für die Katalogauswahl der Funktionen (LFH-549). */
  einsatzId?: number;
  senden: boolean;
  /**
   * Die Anlege-Mutation (LFH-1077): ihr Grund steht im Dialog, und solange sie läuft, schließt er
   * nicht — sonst hätte eine Ablehnung keinen Ort mehr (`frontend/AGENTS.md`, „Rückwege und
   * Fehler“).
   */
  speicherung?: Speicherung;
  onAbbrechen: () => void;
  onAnlegen: (d: NeuerAuftrag) => Promise<unknown>;
}

/** Vorbelegung des Auftragstexts aus dem ETB-Eintrag (Inhalt, LFH-112). */
function initialText(e: EtbEintragAnzeige | null): string {
  return e?.inhalt ?? '';
}

/** ETB→Auftrag erteilen (LFH-112): wiederverwendetes Auftragsformular, mit dem Eintragstext
 *  vorbelegt — gespiegelt von AuftragErteilenModal (Meldung→Auftrag). `destroyOnHidden`
 *  remountet das Formular bei jedem Öffnen, sodass `initialText` frisch greift. */
export default function AuftragAusEtbModal({
  eintrag,
  abschnitte,
  einsatzId,
  einheiten,
  senden,
  speicherung,
  onAbbrechen,
  onAnlegen,
}: Props) {
  const { token } = theme.useToken();
  const sperrt = speicherung?.isPending === true;
  const steuerung = useRef<ErfassungsFormularSteuerung>(null);
  return (
    <Modal
      open={eintrag !== null}
      title="Aus ETB-Eintrag Auftrag erteilen"
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
        rueckfrageTitel="Aus ETB-Eintrag Auftrag erteilen"
        card={false}
        senden={senden}
        abschnitte={abschnitte}
        einheiten={einheiten}
        einsatzId={einsatzId}
        initialText={initialText(eintrag)}
        zitat={
          eintrag && (
            // Read-only Wortlaut des Quell-Eintrags (LFH-343 · C8) — dieselbe
            // Begründung wie bei Meldung→Auftrag: der vorbelegte Auftragstext wird
            // beim Formulieren überschrieben, das ETB ist beweissichernd.
            <Typography.Paragraph type="secondary" style={{ marginBottom: token.margin }}>
              {eintrag.inhalt}
            </Typography.Paragraph>
          )
        }
        onAnlegen={onAnlegen}
        speicherung={speicherung}
        speicherFehlerTitel="Auftrag nicht erteilt"
        speicherFehlerFallback="Auftrag erteilen fehlgeschlagen"
      />
    </Modal>
  );
}
