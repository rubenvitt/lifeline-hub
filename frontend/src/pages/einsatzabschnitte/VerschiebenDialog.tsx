import { Button, Modal } from 'antd';
import { useRef } from 'react';
import type { Einsatzabschnitt } from '../../api/types';
import { useRollen } from '../../components/instrument';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { verschiebeZiele } from './gliederungDragKern';
import { useNewGesture } from './useNewGesture';

interface Props {
  /** Der zu verschiebende Abschnitt; `null` = zu. */
  abschnitt: Einsatzabschnitt | null;
  abschnitte: readonly Einsatzabschnitt[];
  laeuft: boolean;
  fehler: unknown;
  onWahl: (zielId: number | null) => void;
  onAbbrechen: () => void;
  /**
   * Nach dem Ausblenden (Ende der Zoom-Animation, in jsdom nie): dort setzt der Aufrufer den Fokus
   * ein zweites Mal, falls die Animation ihn verschoben hat.
   */
  nachDemSchliessen: () => void;
}

/**
 * „Verschieben unter …“ (LFH-1212): derselbe Umhang wie der Zug in der Gliederung, ohne Ziehen —
 * für Tastatur, Touch und Handschuh (WCAG 2.5.7). Ein Ziel wählen IST das Speichern: die Liste
 * nennt die gültigen Ziele (eigene Nachfahren fehlen, ein Zyklus ist unwählbar), der jetzige Ort
 * steht gesperrt mit Grund.
 *
 * Der Dialog schließt erst beim Erfolg; solange gespeichert wird, ist Abbrechen gesperrt, und der
 * Grund einer Ablehnung steht im Dialog (`frontend/AGENTS.md`, „Rückwege und Fehler“).
 */
export default function VerschiebenDialog({
  abschnitt,
  abschnitte,
  laeuft,
  fehler,
  onWahl,
  onAbbrechen,
  nachDemSchliessen,
}: Props) {
  const { token } = useRollen();
  const listeRef = useRef<HTMLUListElement>(null);
  // Erst eine neue Geste handelt: das Enter, das den Dialog aus dem Menü öffnete, nicht.
  const isNewGesture = useNewGesture(abschnitt !== null);
  const abbrechen = () => {
    if (isNewGesture()) onAbbrechen();
  };
  const ziele = abschnitt ? verschiebeZiele(abschnitte, abschnitt.id) : [];
  return (
    <Modal
      open={abschnitt !== null}
      title={abschnitt ? `„${abschnitt.name}“ verschieben unter …` : undefined}
      onCancel={laeuft ? undefined : abbrechen}
      closable={!laeuft}
      keyboard={!laeuft}
      mask={{ closable: !laeuft }}
      // Den Fokus setzt der Aufrufer (an den Auslöser des Abschnitts): antds Rückgabe zielte auf den
      // Menüeintrag, den es nicht mehr gibt, und landete auf <body>.
      focusable={{ focusTriggerAfterClose: false }}
      afterClose={nachDemSchliessen}
      // Fokus ins erste wählbare Ziel, wenn der Dialog steht.
      afterOpenChange={(offen) => {
        if (offen) listeRef.current?.querySelector<HTMLButtonElement>('button:enabled')?.focus();
      }}
      destroyOnHidden
      footer={
        <Button onClick={abbrechen} disabled={laeuft}>
          Abbrechen
        </Button>
      }
    >
      {fehler != null && (
        <div style={{ marginBottom: token.marginSM }}>
          <SpeicherFehler
            fehler={fehler}
            titel="Nicht verschoben"
            fallback="Verschieben fehlgeschlagen"
          />
        </div>
      )}
      <ul
        ref={listeRef}
        aria-label="Ziele"
        data-lfh="verschieben-ziele"
        style={{ listStyle: 'none', margin: 0, padding: 0 }}
      >
        {ziele.map((z) => (
          <li key={z.id ?? 'wurzel'}>
            <Button
              type="text"
              block
              disabled={z.jetzt || laeuft}
              onClick={() => {
                if (isNewGesture()) onWahl(z.id);
              }}
              style={{
                justifyContent: 'flex-start',
                paddingInlineStart: token.paddingSM + z.tiefe * token.paddingLG,
              }}
            >
              {z.name}
              {z.jetzt && ' (jetziger Ort)'}
            </Button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
