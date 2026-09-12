import { App, Drawer, Form, Input } from 'antd';
import { useCallback, useEffect, useRef } from 'react';
import { Select } from '../../components/Select';
import { ErfassungsFormular, type ErfassungsFormularSteuerung } from '../../components/Erfassung';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { legeUhsAn, type UhsEingabe } from '../../api/einsatzUhs';
import { ApiError } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import type { Uhs } from '../../api/types';
import { uhsTyp } from '../../theme/statusFarben';

interface Props {
  einsatzId: number;
  open: boolean;
  onClose: () => void;
  /** Wird nach erfolgreichem Anlegen mit der neuen UHS aufgerufen. */
  onAngelegt?: (uhs: Uhs) => void;
}

/** Wiederverwendbarer Drawer zum Anlegen einer UHS (Liste, Leerzustand, Switcher). */
export default function UhsAnlegenDrawer({ einsatzId, open, onClose, onAngelegt }: Props) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<UhsEingabe>();
  const angelegteUhs = useRef<Uhs | null>(null);
  const formularSteuerung = useRef<ErfassungsFormularSteuerung>(null);
  const abbruchGeneration = useRef(0);
  const formularEinsatzId = useRef(einsatzId);

  useEffect(() => {
    if (formularEinsatzId.current === einsatzId) return;
    formularEinsatzId.current = einsatzId;
    form.resetFields();
  }, [einsatzId, form]);

  const anlegenMut = useMutation({
    mutationFn: (daten: UhsEingabe) => legeUhsAn(einsatzId, daten),
    onSuccess: () => {
      message.success('UHS angelegt');
      qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
    },
    onError: (e: unknown) =>
      message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  const abbrechen = useCallback(() => {
    abbruchGeneration.current += 1;
    angelegteUhs.current = null;
    onClose();
  }, [onClose]);

  const drawerSchliessen = () => {
    if (formularSteuerung.current) formularSteuerung.current.abbrechen();
    else abbrechen();
  };

  return (
    <Drawer
      title="Unfallhilfsstelle anlegen"
      open={open}
      keyboard={false}
      onClose={drawerSchliessen}
      size={420}
      destroyOnHidden
    >
      <ErfassungsFormular<UhsEingabe>
        form={form}
        steuerungRef={formularSteuerung}
        onErfassen={async (daten) => {
          const generation = abbruchGeneration.current;
          const uhs = await anlegenMut.mutateAsync(daten);
          if (abbruchGeneration.current === generation) angelegteUhs.current = uhs;
        }}
        onFertig={() => {
          const uhs = angelegteUhs.current;
          angelegteUhs.current = null;
          onClose();
          if (uhs) onAngelegt?.(uhs);
        }}
        onAbbrechen={abbrechen}
        laeuft={anlegenMut.isPending}
        erfassenText="Anlegen"
        initialValues={{ typ: 'behandlungsplatz' }}
      >
        <Form.Item
          label="Bezeichnung"
          name="bezeichnung"
          rules={[{ required: true, message: 'Bezeichnung erforderlich' }]}
        >
          <Input placeholder="z. B. BHP 50" />
        </Form.Item>
        <Form.Item label="Typ" name="typ" rules={[{ required: true }]}>
          <Select
            options={Object.entries(uhsTyp).map(([v, d]) => ({ value: v, label: d.label }))}
          />
        </Form.Item>
        <Form.Item label="Standort (optional)" name="standort">
          <Input placeholder="Adresse / Hinweis" />
        </Form.Item>
        <Form.Item label="Notiz (optional)" name="notiz">
          <Input.TextArea rows={3} />
        </Form.Item>
      </ErfassungsFormular>
    </Drawer>
  );
}
