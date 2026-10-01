import { AutoComplete, DatePicker, Input, Space, Tag } from 'antd';
import { MenueAusloeser, type MenueEintrag } from '../components/MenueAusloeser';
import { Select } from '../components/Select';
import dayjs from 'dayjs';
import { useState } from 'react';
import type { MeldeWeg } from '../api/types';
import { MELDEWEG_OPTIONEN, METADATEN_FELDER, type MetaFeld } from './schnellerfassungModell';
import BuchstabierHilfe from './BuchstabierHilfe';
import { teilwortSuche } from '../components/teilwortSuche';

type Wert = string | dayjs.Dayjs | MeldeWeg | undefined;

const CHIP_MENUE: readonly MenueEintrag<'bearbeiten' | 'entfernen'>[] = [
  { key: 'bearbeiten', label: 'Bearbeiten' },
  { key: 'entfernen', label: 'Entfernen', gefahr: true },
];

interface Props {
  feld: MetaFeld;
  editing: boolean;
  wert: Wert;
  /** Optionale Vorschläge (z. B. Funkrufnamen für von/an) → AutoComplete statt Input.
   *  Freitext bleibt erlaubt (AC#1). Ein Objekt trägt ein eigenes Label; eingesetzt wird der
   *  Wert (Sachgebiet „S2 – Lage (Müller)“ → „S2“, LFH-549). */
  optionen?: readonly (string | { value: string; label: string })[];
  onCommit: (feld: MetaFeld, wert: string | dayjs.Dayjs | MeldeWeg) => void;
  onCancel: (feld: MetaFeld) => void;
  onRemove: (feld: MetaFeld) => void;
  onEdit: (feld: MetaFeld) => void;
  /** Während des Sendens: kein Schnellweg, kein Aktionsmenü. */
  gesperrt?: boolean;
}

function feldDef(feld: MetaFeld) {
  return METADATEN_FELDER.find((d) => d.feld === feld)!;
}

function anzeige(feld: MetaFeld, wert: Wert): string {
  if (wert == null) return '';
  if (feldDef(feld).editor === 'zeit') return (wert as dayjs.Dayjs).format('HHmm');
  if (feld === 'meldeweg')
    return MELDEWEG_OPTIONEN.find((o) => o.value === wert)?.label ?? String(wert);
  return String(wert);
}

/**
 * Fokussiert die Eingabe OHNE die Seite zu rollen (LFH-373). Ersetzt `autoFocus` an den vier
 * Editoren: React ruft dafür `focus()` ohne Optionen, und die Chip-Eingabe steht in der
 * angepinnten Erfassungsleiste am Seitenfuß — der native Fokus rollte die Seite, und wer oben
 * im Tagebuch las, verlor seine Stelle. antd reicht die Optionen bis zum nativen Feld durch
 * (`@rc-component/input` `triggerFocus`, `@rc-component/select` `SelectInput`). Modulweit,
 * damit die Ref-Identität stabil bleibt und React sie nur beim Einhängen ruft.
 */
function fokusOhneRollen(el: { focus: (optionen?: FocusOptions) => void } | null) {
  el?.focus({ preventScroll: true });
}

export default function MetaChip({
  feld,
  editing,
  wert,
  optionen,
  onCommit,
  onCancel,
  onRemove,
  onEdit,
  gesperrt = false,
}: Props) {
  const d = feldDef(feld);
  const [text, setText] = useState(typeof wert === 'string' ? wert : '');

  if (editing) {
    if (d.editor === 'text') {
      const editor =
        optionen && optionen.length > 0 ? (
          <AutoComplete
            ref={fokusOhneRollen}
            aria-label={d.label}
            style={{ width: 200 }}
            value={text}
            onChange={(v) => setText(v)}
            // Klick auf Vorschlag feuert nur onChange → onSelect committet sofort.
            onSelect={(v) => onCommit(feld, v)}
            options={optionen.map((o) => (typeof o === 'string' ? { value: o } : o))}
            showSearch={teilwortSuche}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (text.trim()) onCommit(feld, text.trim());
                else onCancel(feld);
              }
              if (e.key === 'Escape') onCancel(feld);
            }}
          />
        ) : (
          <Input
            ref={fokusOhneRollen}
            aria-label={d.label}
            style={{ width: 160 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPressEnter={() => (text.trim() ? onCommit(feld, text.trim()) : onCancel(feld))}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onCancel(feld);
            }}
          />
        );
      // Buchstabierhilfe additiv am Von/An-Feld (LFH-110).
      if (feld === 'von' || feld === 'an') {
        return (
          /*
           * Ohne Größenangabe: `Space.Compact size="small"` trägt die Kleingröße über
           * `SpaceCompactItemContext` auch den Kindern auf (`ant-input-sm`/`ant-btn-sm`). Deshalb steht
           * der Wrapper in der Liste interaktiver Elemente des Dichte-Guards.
           */
          <Space.Compact block>
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
          ref={fokusOhneRollen}
          defaultOpen
          aria-label={d.label}
          style={{ width: 160 }}
          placeholder="Meldeweg"
          options={MELDEWEG_OPTIONEN}
          value={typeof wert === 'string' ? (wert as MeldeWeg) : undefined}
          onSelect={(v) => onCommit(feld, v as MeldeWeg)}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Escape') onCancel(feld);
          }}
        />
      );
    }
    // editor === 'zeit'
    return (
      <DatePicker
        showTime
        ref={fokusOhneRollen}
        aria-label={d.label}
        defaultValue={dayjs.isDayjs(wert) ? wert : dayjs()}
        onOk={(v) => onCommit(feld, v)}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === 'Escape') onCancel(feld);
        }}
      />
    );
  }

  return (
    <Tag>
      {/* Der Maus-Schnellweg hängt am TEXT, nicht am ganzen Chip.

         Ein `onClick` am `<Tag>` machte jeden Nachfahren zum Auslöser, und das Menü-Overlay IST
         ein Nachfahre: ein Synthetic Event steigt durch den Komponentenbaum auf, auch über die
         Portal-Grenze. Ein Griff auf das 4-px-Polsterband des Overlays
         (`dropdownEdgeChildPadding` → `paddingXXS`) schlösse das Menü ohne Aktion UND schaltete den
         Chip in den Editor. Riegel am Menü-`onClick` fangen das nicht (der feuert nur für
         Einträge); richtig ist, dem Overlay den klickbaren Vorfahren zu nehmen. Der Handler liegt
         deshalb an einem Geschwisterknoten des Menüs, ohne `stopPropagation`. Der Portal-Riegel in
         `components/MenueAusloeser.tsx` (LFH-683) fängt denselben Fall noch einmal; er ist die
         zweite Sicherung, nicht der Grund, den Schnellweg zurück an den `<Tag>` zu hängen. */}
      <span
        onClick={gesperrt ? undefined : () => onEdit(feld)}
        style={{ cursor: gesperrt ? 'default' : 'pointer' }}
      >
        {d.label}: {anzeige(feld, wert)}
      </span>
      {/* `danger` am Entfernen, aber ohne Rückfrage: ein entferntes Metadatenfeld ist umkehrbar,
         „Bearbeiten" daneben legt es wieder an (LFH-363). */}
      <MenueAusloeser
        eintraege={CHIP_MENUE}
        zugaenglicherName={`Aktionen zu ${d.label}`}
        gesperrt={gesperrt}
        onWahl={(key) => {
          if (key === 'bearbeiten') onEdit(feld);
          if (key === 'entfernen') onRemove(feld);
        }}
      />
    </Tag>
  );
}
