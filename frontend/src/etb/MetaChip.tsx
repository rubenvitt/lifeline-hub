import { CloseOutlined } from '@ant-design/icons';
import { AutoComplete, DatePicker, Input, Space, Tag } from 'antd';
import { Select } from '../components/Select';
import dayjs from 'dayjs';
import { useState } from 'react';
import type { MeldeWeg } from '../api/types';
import { MELDEWEG_OPTIONEN, METADATEN_FELDER, type MetaFeld } from './schnellerfassungModell';
import BuchstabierHilfe from './BuchstabierHilfe';

type Wert = string | dayjs.Dayjs | MeldeWeg | undefined;

interface Props {
  feld: MetaFeld;
  editing: boolean;
  wert: Wert;
  /** Optionale Vorschläge (z. B. Funkrufnamen für von/an) → AutoComplete statt Input.
   *  Freitext bleibt erlaubt (AC#1). */
  optionen?: string[];
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
  if (feldDef(feld).editor === 'zeit') return (wert as dayjs.Dayjs).format('HHmm');
  if (feld === 'meldeweg') return MELDEWEG_OPTIONEN.find((o) => o.value === wert)?.label ?? String(wert);
  return String(wert);
}

export default function MetaChip({ feld, editing, wert, optionen, onCommit, onCancel, onRemove, onEdit }: Props) {
  const d = feldDef(feld);
  const [text, setText] = useState(typeof wert === 'string' ? wert : '');

  if (editing) {
    if (d.editor === 'text') {
      const editor = optionen && optionen.length > 0 ? (
        <AutoComplete
          size="small"
          autoFocus
          aria-label={d.label}
          style={{ width: 200 }}
          value={text}
          onChange={(v) => setText(v)}
          // Klick auf Vorschlag feuert nur onChange → onSelect committet sofort.
          onSelect={(v) => onCommit(feld, v)}
          options={optionen.map((o) => ({ value: o }))}
          showSearch={{
            filterOption: (input, option) =>
              (option?.value ?? '').toLowerCase().includes(input.toLowerCase()),
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { if (text.trim()) onCommit(feld, text.trim()); else onCancel(feld); }
            if (e.key === 'Escape') onCancel(feld);
          }}
        />
      ) : (
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
      // LFH-110: Buchstabierhilfe additiv am Von/An-Feld (Funkrufname/Absender/Empfänger).
      if (feld === 'von' || feld === 'an') {
        return (
          <Space.Compact block size="small">
            {editor}
            <BuchstabierHilfe text={text} />
          </Space.Compact>
        );
      }
      return editor;
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
