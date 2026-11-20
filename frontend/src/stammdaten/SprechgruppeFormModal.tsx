import { Collapse, Form, Input, theme } from 'antd';
import { Select } from '../components/Select';
import { Feld } from '../components/instrument';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ErfassungsModal } from '../components/Erfassung';
import { aktualisiereSprechgruppe, legeSprechgruppeAn } from '../api/sprechgruppen';
import type { Betriebsart, Sprechgruppe } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import { leerZuNull } from '../api/patchTriState';
import { SPRECHGRUPPE_BEDINGUNG_MAX } from '../api/eingabegrenzen';
import { pflicht } from '../components/pflichtRegel';

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
  const { token } = theme.useToken();
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
    // Prefix: Liste und Paare mit Einsatz-Sprechgruppen (LLH-1645).
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.sprechgruppen() });
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
      <Feld
        label="Bezeichnung"
        name="bezeichnung"
        rules={[pflicht('Bezeichnung', { whitespace: true })]}
      >
        <Input placeholder="z. B. 412_F_DRK" />
      </Feld>
      <Feld label="Betriebsart" name="betriebsart" rules={[pflicht('Betriebsart')]}>
        <Select
          options={[
            { value: 'TMO', label: 'TMO – Trunked Mode' },
            { value: 'DMO', label: 'DMO – Direct Mode' },
          ]}
        />
      </Feld>
      <Feld label="Hinweis" name="hinweis">
        <Input placeholder="Optionaler Hinweis" />
      </Feld>
      {/* Feldbudget (LFH-19): drei Felder offen, Netz und Sicherheit (LFH-1030) zugeklappt. Trägt
         die Sprechgruppe schon eine der beiden, steht der Bereich offen (je Sprechgruppe neu
         montiert, `key`): zugeklappt wären die Felder nicht montiert, `onFinish` ließe sie aus,
         und der PATCH leerte sie. Kurze Felder: natives `maxLength` aus dem Grenzspiegel. */}
      <Collapse
        key={sprechgruppe?.id ?? 'neu'}
        ghost
        style={{ marginInline: -token.paddingSM }}
        defaultActiveKey={sprechgruppe?.netz || sprechgruppe?.sicherheit ? ['bedingung'] : []}
        items={[
          {
            key: 'bedingung',
            label: 'Netz und Sicherheit',
            children: (
              <>
                <Feld label="Netz" name="netz">
                  <Input placeholder="z. B. Gateway" maxLength={SPRECHGRUPPE_BEDINGUNG_MAX} />
                </Feld>
                <Feld label="Sicherheit" name="sicherheit">
                  <Input placeholder="z. B. E2E" maxLength={SPRECHGRUPPE_BEDINGUNG_MAX} />
                </Feld>
              </>
            ),
          },
        ]}
      />
    </ErfassungsModal>
  );
}
