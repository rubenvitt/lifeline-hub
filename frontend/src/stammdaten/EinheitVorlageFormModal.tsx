import { Form, Input } from 'antd';
import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Select } from '../components/Select';
import { ErfassungsModal } from '../components/Erfassung';
import { createEinheitVorlage } from '../api/einheitVorlagen';
import { listeEinheitTypen } from '../api/einheitTypen';
import { globalKeys } from '../api/queryKeys';
import { EINHEIT_VORLAGE_NAME_MAX } from '../api/eingabegrenzen';
import type { EinheitVorlage, NeueEinheitVorlage } from '../api/types';
import { orderAsTree } from './einheitVorlagenBaum';

interface FormValues {
  name: string;
  typ_id: number;
  ueber_vorlage_id?: number;
}

/**
 * Anlegen einer Einheiten-Vorlage (LLH-1042): Name, Typ und Unterstellung, drei Felder
 * (Feldbudget eines Modals, LFH-19). Alles Weitere pflegt die Detailseite; deshalb öffnet der
 * Aufrufer nach dem Anlegen dort (`onCreated`).
 */
export default function EinheitVorlageFormModal({
  open,
  vorlagen,
  parentId,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** Alle geladenen Vorlagen; als Unterstellung stehen die aktiven und die vorbelegte zur Wahl. */
  vorlagen: readonly EinheitVorlage[];
  /** Vorbelegte Unterstellung („Untereinheit anlegen“ auf der Detailseite). */
  parentId?: number;
  onClose: () => void;
  onCreated: (vorlage: EinheitVorlage) => void;
}) {
  const [form] = Form.useForm<FormValues>();
  const qc = useQueryClient();
  const created = useRef<EinheitVorlage | null>(null);

  const typenQuery = useQuery({
    queryKey: globalKeys.einheitTypen(),
    queryFn: listeEinheitTypen,
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const data: NeueEinheitVorlage = { name: values.name.trim(), typ_id: values.typ_id };
      if (values.ueber_vorlage_id != null) data.ueber_vorlage_id = values.ueber_vorlage_id;
      return createEinheitVorlage(data);
    },
    onSuccess: (vorlage) => {
      created.current = vorlage;
      return qc.invalidateQueries({ queryKey: globalKeys.einheitVorlagen() });
    },
  });

  const typOptions = (typenQuery.data ?? []).map((t) => ({ value: t.id, label: t.label }));
  // Die vorbelegte Unterstellung bleibt wählbar, auch inaktiv; sonst stünde nur ihre id im Feld
  // (wie die aktuelle auf der Detailseite).
  const ueberOptions = orderAsTree(vorlagen.filter((v) => v.aktiv || v.id === parentId)).map(
    ({ vorlage }) => ({
      value: vorlage.id,
      label: vorlage.name,
    }),
  );

  return (
    <ErfassungsModal<FormValues>
      offen={open}
      titel="Einheiten-Vorlage anlegen"
      form={form}
      erfassenText="Anlegen"
      laeuft={mutation.isPending}
      speicherung={mutation}
      initialValues={{ ueber_vorlage_id: parentId }}
      // `mutateAsync`: bei Ablehnung muss die Zusage brechen (LFH-332).
      onErfassen={(values) => mutation.mutateAsync(values)}
      onFertig={() => {
        onClose();
        const vorlage = created.current;
        created.current = null;
        if (vorlage) onCreated(vorlage);
      }}
      onAbbrechen={onClose}
    >
      <Form.Item
        label="Name"
        name="name"
        rules={[{ required: true, whitespace: true, message: 'Name darf nicht leer sein' }]}
      >
        <Input placeholder="z. B. Sanitätszug Musterstadt" maxLength={EINHEIT_VORLAGE_NAME_MAX} />
      </Form.Item>
      <Form.Item label="Typ" name="typ_id" rules={[{ required: true, message: 'Typ wählen' }]}>
        <Select<number> aria-label="Typ" options={typOptions} loading={typenQuery.isLoading} />
      </Form.Item>
      <Form.Item label="Unter" name="ueber_vorlage_id">
        <Select<number>
          aria-label="Unter"
          allowClear
          placeholder="keine (eigene Einheit)"
          options={ueberOptions}
        />
      </Form.Item>
    </ErfassungsModal>
  );
}
