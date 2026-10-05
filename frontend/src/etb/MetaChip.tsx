import { AutoComplete, Input, Space, Tag } from 'antd';
import { ZeitpunktEingabe, useZeitEingabe } from '../anzeige/ZeitpunktEingabe';
import { MenueAusloeser, type MenueEintrag } from '../components/MenueAusloeser';
import { Select } from '../components/Select';
import dayjs from 'dayjs';
import { serverJetzt } from '../offline/serveruhr';
import { useState } from 'react';
import type { MeldeWeg } from '../api/types';
import { MELDEWEG_OPTIONEN, METADATEN_FELDER, type MetaFeld } from './schnellerfassungModell';
import BuchstabierHilfe from './BuchstabierHilfe';
import { teilwortSuche } from '../components/teilwortSuche';

type Wert = string | dayjs.Dayjs | MeldeWeg | undefined;

type ChipAktion = 'bearbeiten' | 'entfernen' | 'standard';

const CHIP_MENUE: readonly MenueEintrag<ChipAktion>[] = [
  { key: 'bearbeiten', label: 'Bearbeiten' },
  { key: 'entfernen', label: 'Entfernen', gefahr: true },
];
/**
 * Ein Chip aus dem Standard-Rufnamen (LFH-894) hat nichts zu entfernen; dafür führt sein Menü zum
 * Standard selbst. Kein eigener Knopf in der Chip-Zeile: er bräche die Zeile im Handschuh-Betrieb
 * um, und die Erfassungsleiste risse den Deckel (`e2e/leisten-flaeche.spec.ts`).
 */
const CHIP_MENUE_STANDARD: readonly MenueEintrag<ChipAktion>[] = [
  { key: 'bearbeiten', label: 'Nur für diesen Eintrag ändern' },
  { key: 'standard', label: 'Standard-Rufname ändern' },
];
const STANDARD_TITEL = 'Standard-Rufname: gilt für jeden neuen Eintrag, ändern nur für diesen';

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
  /**
   * Während des Sendens: kein Schnellweg, kein Aktionsmenü — und ein offener Editor nimmt nichts
   * an (LFH-748). Er bleibt sichtbar stehen; nach einem Fehler geht es mit seinem Wert weiter.
   */
  gesperrt?: boolean;
  /**
   * Der Wert kommt aus dem Standard-Rufnamen, nicht aus diesem Eintrag (LFH-894): kein
   * „Entfernen“ (es gäbe nichts zu entfernen, die Pflicht bliebe), ein Klick bearbeitet ihn für
   * diesen Eintrag. Der Titel sagt, woher der Wert kommt.
   */
  ausStandard?: boolean;
  /** Öffnet die Rufname-Abfrage; nur an Chips aus dem Standard. */
  onStandardAendern?: () => void;
}

function feldDef(feld: MetaFeld) {
  return METADATEN_FELDER.find((d) => d.feld === feld)!;
}

function anzeige(
  feld: MetaFeld,
  wert: Wert,
  formatiere: (d: dayjs.Dayjs, format: string) => string,
): string {
  if (wert == null) return '';
  // Uhrzeit in der Anzeigezone, nie im Modus des Objekts: ein wiederhergestellter Entwurf trägt
  // einen UTC-Zeitpunkt (`entwurfModell.zuWerte`) und zeigte sonst die UTC-Uhrzeit (LFH-692).
  if (feldDef(feld).editor === 'zeit') return formatiere(wert as dayjs.Dayjs, 'HHmm');
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
  ausStandard = false,
  onStandardAendern,
}: Props) {
  const d = feldDef(feld);
  const [text, setText] = useState(typeof wert === 'string' ? wert : '');
  const { formatiere } = useZeitEingabe();

  if (editing) {
    if (d.editor === 'text') {
      const editor =
        optionen && optionen.length > 0 ? (
          <AutoComplete
            ref={fokusOhneRollen}
            aria-label={d.label}
            disabled={gesperrt}
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
            disabled={gesperrt}
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
          defaultOpen={!gesperrt}
          disabled={gesperrt}
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
      <ZeitpunktEingabe
        ref={fokusOhneRollen}
        aria-label={d.label}
        disabled={gesperrt}
        // Der Vorschlag kommt von derselben Uhr wie die Vorgabe ohne Chip, sonst lieferten „Chip
        // öffnen, OK“ und „Chip weglassen“ zwei Zeiten (LFH-895, `frontend/src/offline/AGENTS.md`,
        // „Schreiben ohne Netz“).
        defaultValue={dayjs.isDayjs(wert) ? wert : serverJetzt()}
        onOk={(v) => {
          if (v) onCommit(feld, v);
        }}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === 'Escape') onCancel(feld);
        }}
      />
    );
  }

  return (
    <Tag
      title={ausStandard ? STANDARD_TITEL : undefined}
      data-standard={ausStandard ? 'ja' : undefined}
    >
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
        {d.label}: {anzeige(feld, wert, formatiere)}
      </span>
      {/* `danger` am Entfernen, aber ohne Rückfrage: ein entferntes Metadatenfeld ist umkehrbar,
         „Bearbeiten" daneben legt es wieder an (LFH-363). */}
      <MenueAusloeser
        eintraege={
          !ausStandard
            ? CHIP_MENUE
            : onStandardAendern
              ? CHIP_MENUE_STANDARD
              : CHIP_MENUE_STANDARD.filter((e) => e.key !== 'standard')
        }
        zugaenglicherName={`Aktionen zu ${d.label}`}
        gesperrt={gesperrt}
        onWahl={(key) => {
          if (key === 'bearbeiten') onEdit(feld);
          if (key === 'entfernen') onRemove(feld);
          if (key === 'standard') onStandardAendern?.();
        }}
      />
    </Tag>
  );
}
