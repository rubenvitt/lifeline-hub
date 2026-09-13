import { MoreOutlined } from '@ant-design/icons';
import { AutoComplete, Button, DatePicker, Dropdown, Input, Space, Tag } from 'antd';
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
  if (feld === 'meldeweg')
    return MELDEWEG_OPTIONEN.find((o) => o.value === wert)?.label ?? String(wert);
  return String(wert);
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
}: Props) {
  const d = feldDef(feld);
  const [text, setText] = useState(typeof wert === 'string' ? wert : '');

  if (editing) {
    if (d.editor === 'text') {
      const editor =
        optionen && optionen.length > 0 ? (
          <AutoComplete
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
              if (e.key === 'Enter') {
                if (text.trim()) onCommit(feld, text.trim());
                else onCancel(feld);
              }
              if (e.key === 'Escape') onCancel(feld);
            }}
          />
        ) : (
          <Input
            autoFocus
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
      // LFH-110: Buchstabierhilfe additiv am Von/An-Feld (Funkrufname/Absender/Empfänger).
      if (feld === 'von' || feld === 'an') {
        return (
          /*
           * Ohne Größenangabe (LFH-365 · B5e): `Space.Compact size="small"` trug die
           * Kleingröße über `SpaceCompactItemContext` auch den Kindern auf, die selbst
           * keine hatten (gemessen an `antd/es/space/Compact.js` — Kinder bekamen
           * `ant-input-sm`/`ant-btn-sm`). Die Angabe hier zu lassen und nur den Knopf in
           * `BuchstabierHilfe` zu befreien, wäre also wirkungslos gewesen; der Wrapper
           * steht genau deshalb in der Liste interaktiver Elemente des Dichte-Guards.
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
          autoFocus
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
        autoFocus
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
      {/*
        Der Maus-Schnellweg hängt am TEXT, nicht am ganzen Chip — und das ist der Kern
        der Sache, nicht Kosmetik.

        Ein `onClick` am `<Tag>` machte jeden Nachfahren zum Auslöser, und der
        Menü-Overlay IST ein Nachfahre: ein React-Synthetic-Event steigt durch den
        Komponentenbaum auf, auch über die Portal-Grenze. Das Overlay trägt rings um
        seine Einträge ein 4-px-Polsterband (`dropdownEdgeChildPadding` → `paddingXXS`,
        vom Projekt-Theme nicht überschrieben, also in JEDER Dichtestufe gleich schmal).
        Ein Griff daneben schloss das Menü ohne die Aktion auszuführen UND schaltete den
        Chip in den Editor — im Review gemessen.

        Zwei Riegel standen hier vorher und fingen es nicht: einer am Auslöser, einer am
        Menü-`onClick`. Der zweite feuert nur für Einträge; das Band gehört keinem. Ein
        dritter Riegel wäre die falsche Antwort auf die Frage — richtig ist, dem Overlay
        den klickbaren Vorfahren zu nehmen. Deshalb liegt der Handler jetzt an einem
        Geschwisterknoten des Menüs, und es braucht überhaupt kein `stopPropagation`
        mehr.
      */}
      <span onClick={() => onEdit(feld)} style={{ cursor: 'pointer' }}>
        {d.label}: {anzeige(feld, wert)}
      </span>
      <Dropdown
        trigger={['click']}
        /*
         * `autoFocus` aus demselben Grund wie an der Aktionsspalte in `EtbTabelle.tsx`
         * und an `components/Datensicht.tsx:664-670`: ohne ihn bleibt der Fokus am
         * Auslöser und die Pfeiltasten heben im Menü nichts hervor. Anders als dort ist
         * die Wirkung hier gemessen — mit dem Prop trägt der erste Eintrag beim Öffnen
         * die Hervorhebung, ohne ihn keiner.
         */
        autoFocus
        menu={{
          items: [
            { key: 'bearbeiten', label: 'Bearbeiten' },
            // `danger`, aber ohne Rückfrage: ein entferntes Metadatenfeld ist umkehrbar —
            // „Bearbeiten" daneben legt es wieder an. Reibung gehört ans Unumkehrbare
            // (LFH-363).
            { key: 'entfernen', label: 'Entfernen', danger: true },
          ],
          // Zuordnung am Menü statt an jedem Eintrag (Muster
          // `pages/lagekarte/AnsichtSwitcher.tsx:138`).
          onClick: ({ key }) => {
            if (key === 'bearbeiten') onEdit(feld);
            if (key === 'entfernen') onRemove(feld);
          },
        }}
      >
        {/*
          Kein `size`-Prop: die Trefffläche kommt aus `controlHeight` und zieht mit der
          Dichtestufe mit (30 / 48 / 72 px). Genau das konnte das ~10-px-`closeIcon`
          nicht, das hier vorher stand.
        */}
        <Button type="text" aria-label={`Aktionen zu ${d.label}`} icon={<MoreOutlined />} />
      </Dropdown>
    </Tag>
  );
}
