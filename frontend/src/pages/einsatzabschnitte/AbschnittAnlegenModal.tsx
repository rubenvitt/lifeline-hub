import { Form, Input, TreeSelect } from 'antd';
import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { legeAbschnittAn } from '../../api/einsatzabschnitte';
import { leerZuNull } from '../../api/patchTriState';
import { einsatzKeys } from '../../api/queryKeys';
import type { Einsatzabschnitt } from '../../api/types';
import { ErfassungsModal } from '../../components/Erfassung';
import { findKurzbezeichnungConflict, kurzbezeichnungVergeben } from './kurzbezeichnung';

interface AnlegenValues {
  name: string;
  kurzbezeichnung?: string;
  ueber_abschnitt_id?: number | null;
}

/**
 * „Abschnitt anlegen“ als kurze Erfassung (LFH-1208, design.md D6): drei Felder nach dem
 * Feldbudget (LFH-19), den Datensatz gibt es erst nach dem Absenden. Alles Weitere — Lagezustand,
 * Leiter, Funk — ergänzt man danach im Detail, wo der neue Abschnitt gewählt steht.
 */
export default function AbschnittAnlegenModal({
  open,
  einsatzId,
  abschnitte,
  onAngelegt,
  onClose,
}: {
  open: boolean;
  einsatzId: number;
  abschnitte: Einsatzabschnitt[];
  /** Nach dem Erfolg, mit der Kennung des neuen Abschnitts; der Aufrufer wählt ihn. */
  onAngelegt: (id: number) => void;
  onClose: () => void;
}) {
  const [form] = Form.useForm<AnlegenValues>();
  const qc = useQueryClient();
  // Die Kennung des neuen Abschnitts für `onFertig`: `anlegen.data` stünde dort erst nach dem
  // nächsten Rendern.
  const newIdRef = useRef<number | null>(null);

  const anlegen = useMutation({
    mutationFn: (w: AnlegenValues) =>
      legeAbschnittAn(einsatzId, {
        name: w.name.trim(),
        kurzbezeichnung: leerZuNull(w.kurzbezeichnung),
        ueber_abschnitt_id: w.ueber_abschnitt_id ?? null,
      }),
    onSuccess: (neu) => {
      // Sofort in die Liste, damit die Wahl nicht bis zum Neuabruf ins Leere zeigt.
      qc.setQueryData<Einsatzabschnitt[]>(einsatzKeys.abschnitte(einsatzId), (alt) =>
        alt && !alt.some((a) => a.id === neu.id) ? [...alt, neu] : alt,
      );
      qc.invalidateQueries({ queryKey: einsatzKeys.abschnitte(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
    },
  });

  return (
    <ErfassungsModal<AnlegenValues>
      offen={open}
      titel="Abschnitt anlegen"
      form={form}
      erfassenText="Anlegen"
      laeuft={anlegen.isPending}
      // Kein `onError`-Toast: die Hülle nennt den Grund im Dialog (LFH-1077).
      speicherung={anlegen}
      // `mutateAsync`: bei Ablehnung muss die Zusage brechen (LFH-332).
      onErfassen={async (w) => {
        newIdRef.current = (await anlegen.mutateAsync(w)).id;
      }}
      onFertig={() => {
        if (newIdRef.current != null) onAngelegt(newIdRef.current);
        newIdRef.current = null;
        onClose();
      }}
      onAbbrechen={onClose}
    >
      <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true }]}>
        <Input />
      </Form.Item>
      {/* Eindeutig je Einsatz wie der Index (NOCASE): als Prüfung am Feld (LFH-1078). */}
      <Form.Item
        label="Kurzbezeichnung"
        name="kurzbezeichnung"
        rules={[
          {
            validator: (_, value?: string) => {
              const conflict = value
                ? findKurzbezeichnungConflict(abschnitte, value, undefined)
                : null;
              return conflict
                ? Promise.reject(new Error(kurzbezeichnungVergeben(conflict)))
                : Promise.resolve();
            },
          },
        ]}
      >
        <Input maxLength={20} allowClear placeholder="z. B. EA-N" />
      </Form.Item>
      <Form.Item label="Über-Abschnitt" name="ueber_abschnitt_id">
        <TreeSelect
          allowClear
          placeholder="oberster Abschnitt"
          treeData={abschnitte.map((a) => ({ value: a.id, title: a.name }))}
        />
      </Form.Item>
    </ErfassungsModal>
  );
}
