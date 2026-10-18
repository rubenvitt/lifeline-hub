import { Form, Input } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { erfasseSichtung } from '../api/einsatzPerson';
import type { Sichtungskategorie } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import BestaetigtVonFeld from '../geraet/BestaetigtVonFeld';
import SichtungsWahl from './SichtungsWahl';

export interface SichtungWerte {
  kategorie: Sichtungskategorie;
  notiz?: string;
  /** Nur am UHS-Gerät (LFH-1046). */
  bestaetigt_personal_id?: number;
}

/**
 * Die Felder einer Nachsichtung — ohne eigenes `<Form>`, für zwei Hüllen: diesen Dialog
 * (Grundriss, Gerät) und die Fassung in der Ansicht (Patientenkopf, LLH-1094). Für die Wahl der
 * Kategorie gibt es kein Dropdown (LLH-1083, Spec `sichtungswahl`): eine Fläche, dann „Übernehmen“.
 */
export function SichtungFelder({ einsatzId }: { einsatzId: number }) {
  return (
    <>
      <Form.Item
        label="Kategorie"
        name="kategorie"
        rules={[{ required: true, message: 'Bitte eine Sichtungskategorie wählen' }]}
      >
        <SichtungsWahl aria-label="Sichtungskategorie" />
      </Form.Item>
      <Form.Item label="Kurzbegründung (optional)" name="notiz">
        <Input />
      </Form.Item>
      <BestaetigtVonFeld einsatzId={einsatzId} />
    </>
  );
}

/** Der Aufruf hinter beiden Hüllen; die Hülle reicht nur ihre Werte durch. */
export function sendeSichtung(einsatzId: number, personId: number, v: SichtungWerte) {
  return erfasseSichtung(
    einsatzId,
    personId,
    v.kategorie,
    v.notiz ?? null,
    v.bestaetigt_personal_id,
  );
}

interface SichtungDialogProps {
  einsatzId: number;
  personId: number;
  offen: boolean;
  /** Nach erfolgreichem POST (Invalidierung der Person); der Dialog schließt danach selbst. */
  onErfasst: () => void;
  onSchliessen: () => void;
}

/**
 * (Re-)Sichtung einer bereits angelegten Person, auf der Erfassungshülle (`frontend/AGENTS.md`,
 * Erfassungs-Norm; LFH-796). Die Erstsichtung beim Anlegen geht mit dem Anlegen mit
 * (`frontend/src/personen/AGENTS.md`), dieser Dialog schreibt jede weitere.
 */
export default function SichtungDialog({
  einsatzId,
  personId,
  offen,
  onErfasst,
  onSchliessen,
}: SichtungDialogProps) {
  const [form] = Form.useForm<SichtungWerte>();
  const sichtungMutation = useMutation({
    mutationFn: (v: SichtungWerte) => sendeSichtung(einsatzId, personId, v),
    onSuccess: onErfasst,
  });

  return (
    <ErfassungsModal<SichtungWerte>
      offen={offen}
      titel="Sichtung erfassen"
      form={form}
      erfassenText="Übernehmen"
      laeuft={sichtungMutation.isPending}
      // Grund einer Ablehnung im Dialog, bis zum nächsten Absenden (LFH-1077).
      speicherung={sichtungMutation}
      speicherFehlerTitel="Sichtung nicht gespeichert"
      onErfassen={(v) => sichtungMutation.mutateAsync(v)}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <SichtungFelder einsatzId={einsatzId} />
    </ErfassungsModal>
  );
}
