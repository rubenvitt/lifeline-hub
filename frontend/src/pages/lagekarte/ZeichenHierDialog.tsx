/**
 * „Hier Zeichen setzen“ aus dem Kontextmenü der Lagekarte (LFH-776, Spec `lagekarte-kontextmenue`,
 * `openspec/changes/archive/2026-10-03-lfh-776-lagekarte-kontextmenue/design.md` D7): die Zeichenwahl der Leiste in
 * einem Dialog; „Setzen“ (oder Enter im Picker) legt das Zeichen an der Stelle an, ohne zweiten
 * Tipp auf die Karte. Kein `<Form>` — wie in der Leiste gehört das Absenden dem Aufrufer.
 *
 * Fokus ins Suchfeld nur bei der Maus: am Touchschirm klappte sonst die Bildschirmtastatur über
 * das Raster.
 *
 * Eine Ablehnung steht im Dialog, der offen bleibt (LFH-1077): Öffnen und Abbrechen räumen sie,
 * das nächste „Setzen“ ebenso (react-query räumt `error` beim Übergang nach `pending`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Modal, Space, theme } from 'antd';
import type { FreiesZeichenUpdate } from '../../api/types';
import type { Speicherung } from '../../components/Erfassung';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import FreiesZeichenPicker from './FreiesZeichenPicker';

interface Props {
  offen: boolean;
  /** Woher das Kontextmenü kam. */
  quelle: 'maus' | 'touch';
  /** Das Anlegen läuft; „Setzen“ ist gesperrt. */
  laeuft: boolean;
  onSetzen: (spec: FreiesZeichenUpdate) => void;
  onAbbrechen: () => void;
  /** Die Anlege-Mutation: ihr Fehler steht im Dialog. */
  speicherung?: Speicherung;
}

export default function ZeichenHierDialog({
  offen,
  quelle,
  laeuft,
  onSetzen,
  onAbbrechen,
  speicherung,
}: Props) {
  const { token } = theme.useToken();
  // Derselbe Startentwurf wie in der Leiste; „Zuletzt verwendet“ bringt der Picker selbst mit.
  const [entwurf, setEntwurf] = useState<FreiesZeichenUpdate>({
    grundzeichen: 'taktische-formation',
  });
  const setzen = (spec: FreiesZeichenUpdate) => {
    if (laeuft) return;
    setEntwurf(spec);
    onSetzen(spec);
  };
  // Ref, damit Öffnen und Abbrechen die aktuelle Mutation räumen; eine laufende bleibt unberührt.
  const speicherungRef = useRef(speicherung);
  speicherungRef.current = speicherung;
  const raeume = useCallback(() => {
    const s = speicherungRef.current;
    if (s && !s.isPending && s.error != null) s.reset();
  }, []);
  useEffect(() => {
    if (offen) raeume();
  }, [offen, raeume]);
  const abbrechen = () => {
    if (laeuft) return;
    raeume();
    onAbbrechen();
  };

  return (
    <Modal
      open={offen}
      title="Zeichen hier setzen"
      onCancel={abbrechen}
      destroyOnHidden
      // Während des Anlegens gibt es kein Zurück: Schließen hielte den POST nicht auf, das Zeichen
      // entstünde trotzdem („Abbrechen legt nichts an“ wäre gelogen).
      closable={!laeuft}
      mask={{ closable: !laeuft }}
      keyboard={!laeuft}
      footer={
        <Space>
          <Button onClick={abbrechen} disabled={laeuft}>
            Abbrechen
          </Button>
          <Button type="primary" loading={laeuft} onClick={() => setzen(entwurf)}>
            Setzen
          </Button>
        </Space>
      }
    >
      <FreiesZeichenPicker
        wert={entwurf}
        onChange={setEntwurf}
        onAbsenden={setzen}
        autoFokus={quelle === 'maus'}
      />
      {speicherung?.error != null && (
        <div style={{ marginTop: token.marginSM }}>
          <SpeicherFehler
            fehler={speicherung.error}
            titel="Zeichen nicht angelegt"
            fallback="Anlegen fehlgeschlagen"
          />
        </div>
      )}
    </Modal>
  );
}
