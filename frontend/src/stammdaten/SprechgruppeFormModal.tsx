import { Collapse, Form, Input } from 'antd';
import { Select } from '../components/Select';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ErfassungsModal } from '../components/Erfassung';
import { aktualisiereSprechgruppe, legeSprechgruppeAn } from '../api/sprechgruppen';
import type { Betriebsart, Sprechgruppe } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import { leerZuNull } from '../api/patchTriState';
import { SPRECHGRUPPE_BEDINGUNG_MAX } from '../api/eingabegrenzen';

interface FormWerte {
  bezeichnung: string;
  betriebsart: Betriebsart;
  hinweis?: string;
  netz?: string;
  sicherheit?: string;
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

  // VORBELEGUNG, kein Zurücksetzen — Begründung in `FahrzeugFormModal` (LFH-346/A6).
  useEffect(() => {
    if (!offen || !sprechgruppe) return;
    form.setFieldsValue({
      bezeichnung: sprechgruppe.bezeichnung,
      betriebsart: sprechgruppe.betriebsart,
      hinweis: sprechgruppe.hinweis ?? undefined,
      netz: sprechgruppe.netz ?? undefined,
      sicherheit: sprechgruppe.sicherheit ?? undefined,
    });
  }, [offen, sprechgruppe, form]);

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) => {
      const eingabe = {
        bezeichnung: werte.bezeichnung.trim(),
        betriebsart: werte.betriebsart,
        hinweis: leerZuNull(werte.hinweis),
        netz: leerZuNull(werte.netz),
        sicherheit: leerZuNull(werte.sicherheit),
      };
      return sprechgruppe
        ? aktualisiereSprechgruppe(sprechgruppe.id, eingabe)
        : legeSprechgruppeAn(eingabe);
    },
    // Kein `onClose()` mehr: das Schliessen macht `onFertig`, das Leeren die Hülle.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.sprechgruppenAlle() });
    },
  });

  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel={sprechgruppe ? 'Sprechgruppe bearbeiten' : 'Sprechgruppe anlegen'}
      form={form}
      erfassenText="Speichern"
      laeuft={mutation.isPending}
      // Kein `onError`-Toast: die Hülle nennt den Grund einer Ablehnung im Dialog
      // (`frontend/AGENTS.md`, „Rückwege und Fehler“, LFH-1077).
      speicherung={mutation}
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
      {/* Feldbudget (LFH-19): drei Felder offen, Netz und Sicherheit (LFH-1030) zugeklappt. Trägt
         die Sprechgruppe schon eine der beiden, steht der Bereich offen (je Sprechgruppe neu
         montiert, `key`): zugeklappt wären die Felder nicht montiert, `onFinish` ließe sie aus,
         und der PATCH leerte sie. Kurze Felder: natives `maxLength` aus dem Grenzspiegel. */}
      <Collapse
        key={sprechgruppe?.id ?? 'neu'}
        ghost
        style={{ marginInline: -8 }}
        defaultActiveKey={sprechgruppe?.netz || sprechgruppe?.sicherheit ? ['bedingung'] : []}
        items={[
          {
            key: 'bedingung',
            label: 'Netz und Sicherheit',
            children: (
              <>
                <Form.Item label="Netz" name="netz">
                  <Input placeholder="z. B. Gateway" maxLength={SPRECHGRUPPE_BEDINGUNG_MAX} />
                </Form.Item>
                <Form.Item label="Sicherheit" name="sicherheit">
                  <Input placeholder="z. B. E2E" maxLength={SPRECHGRUPPE_BEDINGUNG_MAX} />
                </Form.Item>
              </>
            ),
          },
        ]}
      />
    </ErfassungsModal>
  );
}
