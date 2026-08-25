import { App, Form, Input } from 'antd';
import { Select } from '../components/Select';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { ErfassungsModal } from '../components/Erfassung';
import { aktualisiereSprechgruppe, legeSprechgruppeAn } from '../api/sprechgruppen';
import type { Betriebsart, Sprechgruppe } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import { leerZuNull } from '../api/patchTriState';

interface FormWerte {
  bezeichnung: string;
  betriebsart: Betriebsart;
  hinweis?: string;
}

export default function SprechgruppeFormModal({
  offen,
  sprechgruppe,
  onClose,
}: {
  offen: boolean;
  sprechgruppe: Sprechgruppe | null; // null = neu
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const { message } = App.useApp();

  // VORBELEGUNG, kein Zurücksetzen — Begründung in `FahrzeugFormModal` (LFH-346/A6).
  useEffect(() => {
    if (!offen || !sprechgruppe) return;
    form.setFieldsValue({
      bezeichnung: sprechgruppe.bezeichnung,
      betriebsart: sprechgruppe.betriebsart,
      hinweis: sprechgruppe.hinweis ?? undefined,
    });
  }, [offen, sprechgruppe, form]);

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) => {
      const eingabe = {
        bezeichnung: werte.bezeichnung.trim(),
        betriebsart: werte.betriebsart,
        hinweis: leerZuNull(werte.hinweis),
      };
      return sprechgruppe
        ? aktualisiereSprechgruppe(sprechgruppe.id, eingabe)
        : legeSprechgruppeAn(eingabe);
    },
    // Kein `onClose()` mehr: das Schliessen macht `onFertig`, das Leeren die Hülle.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.sprechgruppenAlle() });
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel={sprechgruppe ? 'Sprechgruppe bearbeiten' : 'Sprechgruppe anlegen'}
      form={form}
      erfassenText="Speichern"
      laeuft={mutation.isPending}
      // `mutateAsync`: bei Ablehnung muss die Zusage brechen (LFH-332).
      onErfassen={(w) => mutation.mutateAsync(w)}
      onFertig={onClose}
      onAbbrechen={onClose}
    >
      <Form.Item
        label="Bezeichnung"
        name="bezeichnung"
        rules={[{ required: true, whitespace: true, message: 'Bezeichnung darf nicht leer sein' }]}
      >
        <Input placeholder="z. B. 412_F_DRK" />
      </Form.Item>
      <Form.Item
        label="Betriebsart"
        name="betriebsart"
        rules={[{ required: true, message: 'Betriebsart ist erforderlich' }]}
      >
        <Select
          options={[
            { value: 'TMO', label: 'TMO – Trunked Mode' },
            { value: 'DMO', label: 'DMO – Direct Mode' },
          ]}
        />
      </Form.Item>
      <Form.Item label="Hinweis" name="hinweis">
        <Input placeholder="Optionaler Hinweis" />
      </Form.Item>
    </ErfassungsModal>
  );
}
