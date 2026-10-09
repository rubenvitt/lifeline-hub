import { Modal, Typography } from 'antd';
import type { EtbEintragAnzeige, NeuerAuftrag } from '../api/types';
import AuftragFormular, { type ZielOption } from '../auftraege/AuftragFormular';
import type { Speicherung } from '../components/Erfassung';

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
  const sperrt = speicherung?.isPending === true;
  return (
    <Modal
      open={eintrag !== null}
      title="Aus ETB-Eintrag Auftrag erteilen"
      footer={null}
      // Kreuz, Maske und Escape: gesperrt, solange der Auftrag unterwegs ist. Schließen räumt den
      // Grund, damit der Dialog nie mit einer alten Ablehnung öffnet.
      onCancel={() => {
        if (sperrt) return;
        if (speicherung?.error != null) speicherung.reset();
        onAbbrechen();
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
        initialText={initialText(eintrag)}
        zitat={
          eintrag && (
            // Read-only Wortlaut des Quell-Eintrags (LFH-343 · C8) — dieselbe
            // Begründung wie bei Meldung→Auftrag: der vorbelegte Auftragstext wird
            // beim Formulieren überschrieben, das ETB ist beweissichernd.
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
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
