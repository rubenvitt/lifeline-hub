import { DatePicker, Input, Select, Space } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import type { EtbFilterWerte } from '../api/etb';
import type { EtbTyp } from '../api/types';
import { TYP_LABEL } from './typFarben';

interface Props {
  onChange: (werte: EtbFilterWerte) => void;
}

const TYP_OPTIONEN = (Object.keys(TYP_LABEL) as EtbTyp[]).map((t) => ({
  value: t,
  label: TYP_LABEL[t],
}));

/** Wandelt einen dayjs-Zeitpunkt ins SQLite-/Backend-Format (UTC). */
function alsBackendZeit(d: dayjs.Dayjs): string {
  return d.utc().format('YYYY-MM-DD HH:mm:ss');
}

export default function EtbFilterleiste({ onChange }: Props) {
  const [werte, setWerte] = useState<EtbFilterWerte>({});

  function aktualisiere(teil: Partial<EtbFilterWerte>) {
    const neu = { ...werte, ...teil };
    // Leere Strings/undefined entfernen, damit keine leeren Query-Parameter entstehen.
    (Object.keys(neu) as (keyof EtbFilterWerte)[]).forEach((k) => {
      if (neu[k] === undefined || neu[k] === '') delete neu[k];
    });
    setWerte(neu);
    onChange(neu);
  }

  return (
    <Space wrap style={{ marginBottom: 16 }}>
      <Input.Search
        placeholder="Volltextsuche"
        allowClear
        style={{ width: 220 }}
        onChange={(e) => aktualisiere({ q: e.target.value })}
      />
      <Select
        placeholder="Typ"
        allowClear
        style={{ width: 150 }}
        options={TYP_OPTIONEN}
        onChange={(v?: EtbTyp) => aktualisiere({ typ: v })}
      />
      <DatePicker
        showTime
        placeholder="von"
        onChange={(d) => aktualisiere({ von: d ? alsBackendZeit(d) : undefined })}
      />
      <DatePicker
        showTime
        placeholder="bis"
        onChange={(d) => aktualisiere({ bis: d ? alsBackendZeit(d) : undefined })}
      />
    </Space>
  );
}
