import { Form, Input } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { erfasseSichtung } from '../api/einsatzPerson';
import type { Sichtungskategorie } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';
import { useFehlerMeldung } from '../components/useFehlerMeldung';
import { SK_META } from './personMeta';

interface SichtungWerte {
  kategorie: Sichtungskategorie;
  notiz?: string;
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
  const fehler = useFehlerMeldung();
  const sichtungMutation = useMutation({
    mutationFn: (v: SichtungWerte) =>
      erfasseSichtung(einsatzId, personId, v.kategorie, v.notiz ?? null),
    onSuccess: onErfasst,
    onError: fehler,
  });

  return (
    <ErfassungsModal<SichtungWerte>
      offen={offen}
      titel="Sichtung erfassen"
      form={form}
      erfassenText="Übernehmen"
      laeuft={sichtungMutation.isPending}
      onErfassen={(v) => sichtungMutation.mutateAsync(v)}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item label="Kategorie" name="kategorie" rules={[{ required: true }]}>
        <Select
          options={(Object.keys(SK_META) as Sichtungskategorie[]).map((k) => ({
            value: k,
            label: SK_META[k].label,
          }))}
        />
      </Form.Item>
      <Form.Item label="Kurzbegründung (optional)" name="notiz">
        <Input />
      </Form.Item>
    </ErfassungsModal>
  );
}
