import { App, Form } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { belegeBr } from '../../api/einsatzBereitstellungsraum';
import { einsatzKeys } from '../../api/queryKeys';
import type { BrListenEintrag, ObjektTyp } from '../../api/types';
import { ErfassungsModal } from '../../components/Erfassung';
import { Select } from '../../components/Select';
import { verlegenQuittung } from './verlegenKern';

/** Wen der Dialog verlegt. */
export interface VerlegenZiel {
  objekt_typ: ObjektTyp;
  objekt_id: number;
  /** Name der Einheit bzw. Funkrufname des Fahrzeugs, für Titel und Quittung. */
  name: string;
}

const RAUM_WEG = 'Raum nicht mehr in Betrieb';

interface VerlegenWerte {
  ziel_br_id?: number;
}

export interface VerlegenDialogProps {
  einsatzId: number;
  /** Der Raum, in dem die Kraft gerade steht. */
  brId: number;
  /** `null`: der Dialog ist zu. */
  ziel: VerlegenZiel | null;
  /** Die wählbaren Räume (`zielRaeume`): in Betrieb, nicht storniert, ohne den eigenen. */
  raeume: readonly BrListenEintrag[];
  onClose: () => void;
}

/**
 * „In anderen BR verlegen …“ (LLH-1315, Spec `bereitstellungsraum-belegung`, „Verlegen in einen
 * anderen Raum“; Entwurf LLH-1085 D20). Ein Feld, also Modal (`frontend/AGENTS.md`,
 * „UI-Form-Leitlinie“). Gebucht wird ein Wechsel am **Ziel**-Raum über `…/belegung`: der Server
 * setzt den Raum der Kraft um, schreibt das ETB, und der Verlauf beider Räume nennt den Wechsel.
 * Eine abgerufene Kraft verlegt die Seite nicht (der Server lehnt sie mit 422 ab, LLH-1085 D12);
 * eine Ablehnung steht im Dialog, ohne Fehler-Toast. Ein Gerät verlegt nie (`br-verlegen`).
 */
export default function VerlegenDialog({
  einsatzId,
  brId,
  ziel,
  raeume,
  onClose,
}: VerlegenDialogProps) {
  const [form] = Form.useForm<VerlegenWerte>();
  const qc = useQueryClient();
  const { message } = App.useApp();

  const mutation = useMutation({
    mutationFn: ({ kraft, raum }: { kraft: VerlegenZiel; raum: BrListenEintrag }) =>
      belegeBr(einsatzId, raum.id, {
        objekt_typ: kraft.objekt_typ,
        objekt_id: kraft.objekt_id,
        art: 'wechsel',
      }),
    onSuccess: (_antwort, { kraft, raum }) => {
      message.success({
        content: verlegenQuittung(kraft.objekt_typ, kraft.name, raum.bezeichnung),
        key: 'br-belegung',
      });
      for (const key of [
        einsatzKeys.br(einsatzId),
        einsatzKeys.brDetail(einsatzId, brId),
        einsatzKeys.brDetail(einsatzId, raum.id),
        einsatzKeys.brVerlauf(einsatzId, brId),
        einsatzKeys.brVerlauf(einsatzId, raum.id),
        einsatzKeys.einheiten(einsatzId),
        einsatzKeys.fahrzeuge(einsatzId),
        einsatzKeys.etb(einsatzId),
      ]) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
  });

  return (
    <ErfassungsModal<VerlegenWerte>
      offen={ziel != null}
      titel={ziel ? `${ziel.name} verlegen` : ''}
      form={form}
      erfassenText="Verlegen"
      speicherung={mutation}
      speicherFehlerTitel="Nicht verlegt"
      speicherFehlerFallback="Verlegen fehlgeschlagen"
      onErfassen={async (w) => {
        if (!ziel) return;
        const raum = raeume.find((r) => r.id === w.ziel_br_id);
        // Der gewählte Raum ging während der Wahl außer Betrieb (Live-Liste): nichts senden, der
        // Dialog bleibt offen und nennt den Grund am Feld.
        if (!raum) {
          form.setFields([{ name: 'ziel_br_id', errors: [RAUM_WEG] }]);
          throw new Error(RAUM_WEG);
        }
        await mutation.mutateAsync({ kraft: ziel, raum });
      }}
      onFertig={onClose}
      onAbbrechen={onClose}
    >
      <Form.Item
        label="Ziel-Raum"
        name="ziel_br_id"
        rules={[{ required: true, message: 'Ziel-Raum wählen' }]}
      >
        <Select<number> options={raeume.map((r) => ({ value: r.id, label: r.bezeichnung }))} />
      </Form.Item>
    </ErfassungsModal>
  );
}
