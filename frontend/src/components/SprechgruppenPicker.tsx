import { App, Button, Checkbox, Form, Input, Select, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { legeEinsatzSprechgruppeAn, listeEinsatzSprechgruppen } from '../api/sprechgruppen';
import type { Betriebsart, Sprechgruppe } from '../api/types';
import { ApiError } from '../api/client';

const { Text } = Typography;

interface InlineFormWerte {
  bezeichnung: string;
  betriebsart: Betriebsart;
  hinweis?: string;
}

interface SprechgruppenPickerProps {
  einsatzId: number;
  value?: number[];
  onChange?: (ids: number[]) => void;
}

export default function SprechgruppenPicker({ einsatzId, value = [], onChange }: SprechgruppenPickerProps) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [inlineOffen, setInlineOffen] = useState(false);
  const [form] = Form.useForm<InlineFormWerte>();

  const { data: sprechgruppen = [] } = useQuery({
    queryKey: ['einsatz-sprechgruppen', einsatzId],
    queryFn: () => listeEinsatzSprechgruppen(einsatzId),
  });

  const tmo = sprechgruppen.filter((s) => s.betriebsart === 'TMO');
  const dmo = sprechgruppen.filter((s) => s.betriebsart === 'DMO');
  const tmoIds = tmo.map((s) => s.id);
  const dmoIds = dmo.map((s) => s.id);

  const handleTmoChange = (checked: (string | number | boolean)[]) => {
    const checkedNums = checked as number[];
    onChange?.([...checkedNums, ...value.filter((id) => dmoIds.includes(id))]);
  };

  const handleDmoChange = (checked: (string | number | boolean)[]) => {
    const checkedNums = checked as number[];
    onChange?.([...value.filter((id) => tmoIds.includes(id)), ...checkedNums]);
  };

  const mutation = useMutation({
    mutationFn: (werte: InlineFormWerte) =>
      legeEinsatzSprechgruppeAn(einsatzId, {
        bezeichnung: werte.bezeichnung.trim(),
        betriebsart: werte.betriebsart,
        hinweis: werte.hinweis?.trim() || undefined,
      }),
    onSuccess: (neu: Sprechgruppe) => {
      qc.invalidateQueries({ queryKey: ['einsatz-sprechgruppen', einsatzId] });
      onChange?.([...(value ?? []), neu.id]);
      form.resetFields();
      setInlineOffen(false);
    },
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  function checkboxOption(s: Sprechgruppe) {
    return {
      value: s.id,
      label: (
        <span>
          {s.bezeichnung}
          {s.einsatz_lokal && (
            <Tag color="blue" style={{ marginLeft: 4, fontSize: 11 }}>
              lokal
            </Tag>
          )}
        </span>
      ),
    };
  }

  return (
    <div>
      {tmo.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Text strong>TMO</Text>
          <div>
            <Checkbox.Group
              options={tmo.map(checkboxOption)}
              value={value.filter((id) => tmoIds.includes(id))}
              onChange={handleTmoChange}
            />
          </div>
        </div>
      )}

      {dmo.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Text strong>DMO</Text>
          <div>
            <Checkbox.Group
              options={dmo.map(checkboxOption)}
              value={value.filter((id) => dmoIds.includes(id))}
              onChange={handleDmoChange}
            />
          </div>
        </div>
      )}

      {!inlineOffen && (
        <Button
          type="dashed"
          size="small"
          onClick={() => setInlineOffen(true)}
        >
          + neue Sprechgruppe
        </Button>
      )}

      {inlineOffen && (
        <Form<InlineFormWerte>
          form={form}
          layout="inline"
          onFinish={(w) => mutation.mutate(w)}
          style={{ marginTop: 8, flexWrap: 'wrap', gap: 4 }}
        >
          <Form.Item
            label="Bezeichnung"
            name="bezeichnung"
            rules={[{ required: true, whitespace: true, message: 'Pflichtfeld' }]}
          >
            <Input size="small" placeholder="z. B. 412_F_DRK" />
          </Form.Item>

          <Form.Item
            label="Betriebsart"
            name="betriebsart"
            rules={[{ required: true, message: 'Pflichtfeld' }]}
          >
            <Select
              size="small"
              style={{ minWidth: 160 }}
              options={[
                { value: 'TMO', label: 'TMO – Trunked Mode' },
                { value: 'DMO', label: 'DMO – Direct Mode' },
              ]}
            />
          </Form.Item>

          <Form.Item label="Hinweis" name="hinweis">
            <Input size="small" placeholder="Optional" />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button
                type="primary"
                size="small"
                htmlType="submit"
                loading={mutation.isPending}
              >
                Speichern
              </Button>
              <Button
                size="small"
                onClick={() => {
                  form.resetFields();
                  setInlineOffen(false);
                }}
              >
                Abbrechen
              </Button>
            </Space>
          </Form.Item>
        </Form>
      )}
    </div>
  );
}
