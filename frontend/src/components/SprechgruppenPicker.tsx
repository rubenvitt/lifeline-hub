import { App, Button, Input, Space, theme } from 'antd';
import { Select } from './Select';
import { PlusOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { einsatzKeys } from '../api/queryKeys';
import { legeEinsatzSprechgruppeAn, listeEinsatzSprechgruppen } from '../api/sprechgruppen';
import type { Betriebsart, Sprechgruppe } from '../api/types';
import { ApiError } from '../api/client';

interface SprechgruppenPickerProps {
  einsatzId: number;
  /** Ausgewählte Sprechgruppen-IDs (antd-Form-Control-Vertrag). */
  value?: number[];
  onChange?: (ids: number[]) => void;
}

/**
 * Mehrfachauswahl von Sprechgruppen (org-weiter Katalog + einsatz-lokale) als ein
 * `Select mode="multiple"`, gruppiert nach Betriebsart. Darunter ein kompaktes
 * Inline-Formular zum Anlegen einer einsatz-lokalen Sprechgruppe.
 *
 * Bewusst KEIN verschachteltes `<Form>`/Submit-Button: der Picker wird selbst in einem
 * antd-`<Form>` (Abschnitt/Einheit) gerendert — ein innerer Submit würde das äußere
 * Formular nativ abschicken (Seiten-Reload). Anlegen läuft daher rein über `onClick`.
 */
export default function SprechgruppenPicker({ einsatzId, value = [], onChange }: SprechgruppenPickerProps) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const qc = useQueryClient();
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [neuBezeichnung, setNeuBezeichnung] = useState('');
  const [neuBetriebsart, setNeuBetriebsart] = useState<Betriebsart | undefined>(undefined);

  const { data: sprechgruppen = [] } = useQuery({
    queryKey: einsatzKeys.sprechgruppen(einsatzId),
    queryFn: () => listeEinsatzSprechgruppen(einsatzId),
  });

  const labelVon = (s: Sprechgruppe) => (s.einsatz_lokal ? `${s.bezeichnung} (lokal)` : s.bezeichnung);
  const optionenFuer = (ba: Betriebsart) =>
    sprechgruppen.filter((s) => s.betriebsart === ba).map((s) => ({ value: s.id, label: labelVon(s) }));
  const gruppen = [
    { label: 'TMO', title: 'TMO', options: optionenFuer('TMO') },
    { label: 'DMO', title: 'DMO', options: optionenFuer('DMO') },
  ].filter((g) => g.options.length > 0);

  const kannAnlegen = neuBezeichnung.trim().length > 0 && !!neuBetriebsart;

  const mutation = useMutation({
    mutationFn: () =>
      legeEinsatzSprechgruppeAn(einsatzId, {
        bezeichnung: neuBezeichnung.trim(),
        betriebsart: neuBetriebsart as Betriebsart,
      }),
    onSuccess: (neu: Sprechgruppe) => {
      qc.invalidateQueries({ queryKey: einsatzKeys.sprechgruppen(einsatzId) });
      onChange?.([...value, neu.id]);
      setNeuBezeichnung('');
      setNeuBetriebsart(undefined);
      setAnlegenOffen(false);
      message.success(`Sprechgruppe „${neu.bezeichnung}" angelegt`);
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Anlegen fehlgeschlagen'),
  });

  const anlegen = () => {
    if (kannAnlegen && !mutation.isPending) mutation.mutate();
  };

  return (
    <div>
      <Select
        mode="multiple"
        value={value}
        onChange={(ids: number[]) => onChange?.(ids)}
        options={gruppen}
        placeholder="Sprechgruppen auswählen"
        style={{ width: '100%' }}
        allowClear
      />

      {!anlegenOffen && (
        <Button
          type="link"
          icon={<PlusOutlined />}
          style={{ padding: 0, marginTop: token.marginSM }}
          onClick={() => setAnlegenOffen(true)}
        >
          neue Sprechgruppe anlegen
        </Button>
      )}

      {anlegenOffen && (
        <Space size={token.marginSM} wrap style={{ marginTop: token.marginSM, width: '100%' }}>
          <Input
            aria-label="Neue Bezeichnung"
            placeholder="z. B. 412_F_DRK"
            value={neuBezeichnung}
            onChange={(e) => setNeuBezeichnung(e.target.value)}
            onKeyDown={(e) => {
              // Enter darf NICHT das umgebende Abschnitt-/Einheit-Formular abschicken.
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                anlegen();
              }
            }}
          />
          <Select<Betriebsart>
            aria-label="Neue Betriebsart"
            placeholder="Betriebsart"
            value={neuBetriebsart}
            onChange={(v) => setNeuBetriebsart(v)}
            style={{ width: 130 }}
            options={[
              { value: 'TMO', label: 'TMO' },
              { value: 'DMO', label: 'DMO' },
            ]}
          />
          <Button type="primary" onClick={anlegen} loading={mutation.isPending} disabled={!kannAnlegen}>
            Anlegen
          </Button>
          <Button
            onClick={() => {
              setNeuBezeichnung('');
              setNeuBetriebsart(undefined);
              setAnlegenOffen(false);
            }}
          >
            Abbrechen
          </Button>
        </Space>
      )}
    </div>
  );
}
