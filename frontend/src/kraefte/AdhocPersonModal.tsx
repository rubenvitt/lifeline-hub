import { App, Form, Input } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { ApiError } from '../api/client';
import { disponiereAdhoc, type AdhocEingabe } from '../api/einsatzPersonal';
import { POSITION_OPTIONEN } from '../api/personal';
import { einsatzKeys } from '../api/queryKeys';
import type { EinsatzPersonal } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';

interface AdhocPersonModalProps {
  offen: boolean;
  einsatzId: number;
  /** Serienmodus wie in der Personal-Liste; aus dem Stab heraus eine Einzelanlage. */
  serie?: boolean;
  onSchliessen: () => void;
  /** Die neu angelegte Disposition — z. B. zur Vorauswahl in einer aufrufenden Maske. */
  onAngelegt?: (ep: EinsatzPersonal) => void;
}

/**
 * Ad-hoc-Person disponieren — EIN Bauteil für zwei Orte (Personal-Liste, Stab-Besetzung).
 *
 * FELDBUDGET: vier Felder (Name, Funktion, Trägerorganisation, Stärke-Position), im Rahmen der
 * Modal-/Schnellerfassungs-Leitlinie (LFH-19: ≤ ~4). Name ist Pflicht, die anderen drei
 * unterscheiden eine ad-hoc erfasste Person von einer namenlosen Zeile.
 *
 * `onFertig` der Hülle gibt kein Ergebnis weiter; die angelegte Disposition wandert deshalb über
 * `onSuccess` in einen Ref und wird in `onErfasst` gemeldet — das läuft erst nach bestandener
 * Abbruchprüfung der Hülle.
 */
export default function AdhocPersonModal({
  offen,
  einsatzId,
  serie = false,
  onSchliessen,
  onAngelegt,
}: AdhocPersonModalProps) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<AdhocEingabe>();
  const angelegtRef = useRef<EinsatzPersonal | null>(null);

  const mutation = useMutation({
    mutationFn: (daten: AdhocEingabe) => disponiereAdhoc(einsatzId, daten),
    onSuccess: (ep) => {
      angelegtRef.current = ep;
      void qc.invalidateQueries({ queryKey: einsatzKeys.personal(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
    },
    onError: (e: unknown) =>
      message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  return (
    <ErfassungsModal<AdhocEingabe>
      offen={offen}
      titel="Ad-hoc-Person disponieren"
      form={form}
      erfassenText="Disponieren"
      laeuft={mutation.isPending}
      serie={serie}
      uebernahme={serie ? ['traegerorganisation', 'staerke_position'] : undefined}
      onErfassen={(w) => mutation.mutateAsync(w)}
      onErfasst={() => {
        if (angelegtRef.current) onAngelegt?.(angelegtRef.current);
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true }]}>
        <Input placeholder="z. B. Dr. Schmidt" />
      </Form.Item>
      <Form.Item label="Funktion" name="funktion">
        <Input placeholder="z. B. Notarzt" />
      </Form.Item>
      <Form.Item label="Trägerorganisation" name="traegerorganisation">
        <Input placeholder="z. B. KV Musterstadt" />
      </Form.Item>
      <Form.Item label="Stärke-Position" name="staerke_position">
        <Select allowClear placeholder="optional" options={POSITION_OPTIONEN} />
      </Form.Item>
    </ErfassungsModal>
  );
}
