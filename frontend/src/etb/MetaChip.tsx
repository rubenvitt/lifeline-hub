import { CloseOutlined } from '@ant-design/icons';
import { DatePicker, Input, Select, Tag } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import type { MeldeWeg } from '../api/types';
import { MELDEWEG_OPTIONEN, METADATEN_FELDER, type MetaFeld } from './schnellerfassungModell';

type Wert = string | dayjs.Dayjs | MeldeWeg | undefined;

interface Props {
  feld: MetaFeld;
  editing: boolean;
  wert: Wert;
  onCommit: (feld: MetaFeld, wert: string | dayjs.Dayjs | MeldeWeg) => void;
  onCancel: (feld: MetaFeld) => void;
  onRemove: (feld: MetaFeld) => void;
  onEdit: (feld: MetaFeld) => void;
}

function feldDef(feld: MetaFeld) {
  return METADATEN_FELDER.find((d) => d.feld === feld)!;
}

function anzeige(feld: MetaFeld, wert: Wert): string {
  if (wert == null) return '';
  if (feldDef(feld).editor === 'zeit') return (wert as dayjs.Dayjs).format('HH:mm');
  if (feld === 'meldeweg') return MELDEWEG_OPTIONEN.find((o) => o.value === wert)?.label ?? String(wert);
  return String(wert);
}

export default function MetaChip({ feld, editing, wert, onCommit, onCancel, onRemove, onEdit }: Props) {
  const d = feldDef(feld);
  const [text, setText] = useState(typeof wert === 'string' ? wert : '');

  if (editing) {
    if (d.editor === 'text') {
      return (
        <Input
          size="small"
          autoFocus
          aria-label={d.label}
          style={{ width: 160 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPressEnter={() => (text.trim() ? onCommit(feld, text.trim()) : onCancel(feld))}
          onKeyDown={(e) => { if (e.key === 'Escape') onCancel(feld); }}
        />
      );
    }
    if (d.editor === 'meldeweg') {
      return (
        <Select
          size="small"
          autoFocus
          defaultOpen
          aria-label={d.label}
          style={{ width: 160 }}
          placeholder="Meldeweg"
          options={MELDEWEG_OPTIONEN}
          value={typeof wert === 'string' ? (wert as MeldeWeg) : undefined}
          onSelect={(v) => onCommit(feld, v as MeldeWeg)}
          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Escape') onCancel(feld); }}
        />
      );
    }
    // editor === 'zeit'
    return (
      <DatePicker
        size="small"
        showTime
        autoFocus
        aria-label={d.label}
        defaultValue={dayjs.isDayjs(wert) ? wert : dayjs()}
        onOk={(v) => onCommit(feld, v)}
        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Escape') onCancel(feld); }}
      />
    );
  }

  return (
    <Tag
      closable
      closeIcon={<CloseOutlined aria-label="schließen" />}
      onClose={(e) => { e.stopPropagation(); onRemove(feld); }}
      onClick={() => onEdit(feld)}
      style={{ cursor: 'pointer' }}
    >
      {d.label}: {anzeige(feld, wert)}
    </Tag>
  );
}
