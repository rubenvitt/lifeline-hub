import { App, Button, Drawer, Form, Input } from 'antd';
import { Select } from '../../components/Select';
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

  const anlegenMut = useMutation({
    mutationFn: (daten: UhsEingabe) => legeUhsAn(einsatzId, daten),
    onSuccess: (uhs) => {
      message.success('UHS angelegt');
      qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      onClose();
      form.resetFields();
      onAngelegt?.(uhs);
    },
    onError: (e: unknown) =>
      message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  return (
    <Drawer
      title="Unfallhilfsstelle anlegen"
      open={open}
      onClose={onClose}
      size={420}
      destroyOnHidden
    >
      <Form<UhsEingabe>
        form={form}
        layout="vertical"
        onFinish={(v) => anlegenMut.mutate(v)}
        initialValues={{ typ: 'behandlungsplatz' }}
      >
        <Form.Item label="Typ" name="typ" rules={[{ required: true }]}>
          <Select options={Object.entries(uhsTyp).map(([v, d]) => ({ value: v, label: d.label }))} />
        </Form.Item>
        <Form.Item label="Bezeichnung" name="bezeichnung" rules={[{ required: true, message: 'Bezeichnung erforderlich' }]}>
          <Input placeholder="z. B. BHP 50" />
        </Form.Item>
        <Form.Item label="Standort (optional)" name="standort">
          <Input placeholder="Adresse / Hinweis" />
        </Form.Item>
        <Form.Item label="Notiz (optional)" name="notiz">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={anlegenMut.isPending}>Anlegen</Button>
      </Form>
    </Drawer>
  );
}
