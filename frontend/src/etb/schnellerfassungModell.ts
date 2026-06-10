import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { EtbBaustein, EtbTyp, MeldeWeg } from '../api/types';
import type { NeuerEintrag } from '../api/etb';

dayjs.extend(utc);

export type MetaFeld = 'ereigniszeit' | 'von' | 'an' | 'meldeweg' | 'veranlassung';

export type EditorTyp = 'zeit' | 'text' | 'meldeweg';

export interface MetaFeldDef {
  feld: MetaFeld;
  label: string;
  /** Kleingeschriebene Filter-Stichwörter für das /-Menü. */
  trigger: string[];
  editor: EditorTyp;
}

/** Anzeige-/Tab-Reihenfolge der Felder im /-Menü und in der Chip-Leiste. */
export const METADATEN_FELDER: MetaFeldDef[] = [
  { feld: 'ereigniszeit', label: 'Ereigniszeit', trigger: ['zeit', 'ereigniszeit', 'uhrzeit'], editor: 'zeit' },
  { feld: 'von', label: 'Von', trigger: ['von', 'absender'], editor: 'text' },
  { feld: 'an', label: 'An', trigger: ['an', 'empfaenger', 'empfänger'], editor: 'text' },
  { feld: 'meldeweg', label: 'Meldeweg', trigger: ['meldeweg', 'weg', 'funk', 'telefon'], editor: 'meldeweg' },
  { feld: 'veranlassung', label: 'Veranlassung', trigger: ['veranlassung', 'massnahme', 'maßnahme'], editor: 'text' },
];

/** Vom Nutzer gesetzte Metadaten (vor dem Merge in NeuerEintrag). */
export interface MetadatenWerte {
  ereigniszeit?: dayjs.Dayjs;
  von?: string;
  an?: string;
  meldeweg?: MeldeWeg;
  veranlassung?: string;
}

export const MELDEWEG_OPTIONEN: { value: MeldeWeg; label: string }[] = [
  { value: 'funk', label: 'Funk' },
  { value: 'telefon', label: 'Telefon' },
  { value: 'persoenlich', label: 'Persönlich' },
  { value: 'sonstige', label: 'Sonstige' },
];

export interface SlashTrigger {
  aktiv: boolean;
  filter: string;
  start: number;
}

const INAKTIV: SlashTrigger = { aktiv: false, filter: '', start: -1 };

/**
 * Sucht links vom Cursor ein '/' am Wortanfang. Bricht bei Whitespace ab
 * (Whitespace zwischen '/' und Cursor schließt das Menü). '/' mitten im Wort
 * (z.B. "2/9", Datums-/Pfadangaben) triggert nicht.
 */
export function erkenneSlashTrigger(text: string, caret: number): SlashTrigger {
  for (let i = caret - 1; i >= 0; i--) {
    const c = text[i];
    if (c === '/') {
      const wortanfang = i === 0 || /\s/.test(text[i - 1]);
      return wortanfang ? { aktiv: true, filter: text.slice(i + 1, caret), start: i } : INAKTIV;
    }
    if (/\s/.test(c)) return INAKTIV;
  }
  return INAKTIV;
}

export interface SlashEintrag {
  art: 'feld' | 'baustein';
  key: string;
  label: string;
  gesetzt?: boolean;
}

export interface SlashTreffer {
  felder: SlashEintrag[];
  bausteine: SlashEintrag[];
}

export function filterSlashEintraege(
  filter: string,
  bausteine: EtbBaustein[],
  gesetzteFelder: MetaFeld[],
): SlashTreffer {
  const f = filter.trim().toLowerCase();
  const felder: SlashEintrag[] = METADATEN_FELDER.filter(
    (def) => f === '' || def.trigger.some((t) => t.includes(f)) || def.label.toLowerCase().includes(f),
  ).map((def) => ({
    art: 'feld',
    key: def.feld,
    label: def.label,
    gesetzt: gesetzteFelder.includes(def.feld),
  }));

  const treffer: SlashEintrag[] = bausteine
    .filter((b) => f === '' || b.label.toLowerCase().includes(f))
    .map((b) => ({ art: 'baustein', key: String(b.id), label: b.label }));

  return { felder, bausteine: treffer };
}

export interface EintragArgs {
  inhalt: string;
  typ: EtbTyp;
  metadaten: MetadatenWerte;
  berichtigungZuId?: number;
  /** ISO-Zeitstempel „jetzt" (vom Aufrufer übergeben — testbar). */
  jetztIso: string;
}

export function baueEintrag({ inhalt, typ, metadaten, berichtigungZuId, jetztIso }: EintragArgs): NeuerEintrag {
  return {
    typ: berichtigungZuId != null ? 'berichtigung' : typ,
    inhalt,
    von: metadaten.von || undefined,
    an: metadaten.an || undefined,
    meldeweg: metadaten.meldeweg || undefined,
    veranlassung: metadaten.veranlassung || undefined,
    ereigniszeit: (metadaten.ereigniszeit ?? dayjs.utc(jetztIso)).utc().format('YYYY-MM-DD HH:mm:ss'),
    erfasst_lokal_at: jetztIso,
    berichtigt_eintrag_id: berichtigungZuId,
  };
}
