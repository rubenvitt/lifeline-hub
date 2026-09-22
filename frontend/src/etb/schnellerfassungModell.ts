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
  {
    feld: 'ereigniszeit',
    label: 'Ereigniszeit',
    trigger: ['zeit', 'ereigniszeit', 'uhrzeit'],
    editor: 'zeit',
  },
  { feld: 'von', label: 'Von', trigger: ['von', 'absender'], editor: 'text' },
  { feld: 'an', label: 'An', trigger: ['an', 'empfaenger', 'empfänger'], editor: 'text' },
  {
    feld: 'meldeweg',
    label: 'Meldeweg',
    trigger: ['meldeweg', 'weg', 'funk', 'telefon'],
    editor: 'meldeweg',
  },
  {
    feld: 'veranlassung',
    label: 'Veranlassung',
    trigger: ['veranlassung', 'massnahme', 'maßnahme'],
    editor: 'text',
  },
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
 * Sucht links vom Cursor ein Auslösezeichen am Wortanfang. Bricht bei Whitespace ab
 * (Whitespace zwischen Zeichen und Cursor schließt das Menü). Ein Zeichen mitten im Wort
 * (z.B. "2/9", Datums-/Pfadangaben, eine Mailadresse) triggert nicht.
 */
function erkenneTrigger(text: string, caret: number, zeichen: '/' | '@'): SlashTrigger {
  for (let i = caret - 1; i >= 0; i--) {
    const c = text[i];
    if (c === zeichen) {
      const wortanfang = i === 0 || /\s/.test(text[i - 1]);
      return wortanfang ? { aktiv: true, filter: text.slice(i + 1, caret), start: i } : INAKTIV;
    }
    if (/\s/.test(c)) return INAKTIV;
  }
  return INAKTIV;
}

/** `/` am Wortanfang: Felder, Bausteine — und am Zeilenanfang zusätzlich der Typ. */
export function erkenneSlashTrigger(text: string, caret: number): SlashTrigger {
  return erkenneTrigger(text, caret, '/');
}

/** `@` am Wortanfang: Funkrufname für Von bzw. An (Neuentwurf S4). */
export function erkenneAtTrigger(text: string, caret: number): SlashTrigger {
  return erkenneTrigger(text, caret, '@');
}

/**
 * Steht der Auslöser am ZEILENANFANG? Nur dort wählt `/` auch den Typ (Neuentwurf S4:
 * `/anordnung …` am Beginn der Zeile). Mitten im Satz bleibt `/` bei Feldern und
 * Bausteinen — „Lage /von" soll nicht plötzlich den Typ anbieten.
 */
export function amZeilenanfang(text: string, start: number): boolean {
  return start === 0 || (start > 0 && text[start - 1] === '\n');
}

export interface SlashEintrag {
  /**
   * `typ` setzt den Eintragstyp (`key` = Typ), `einheit` setzt Von oder An (`key` =
   * `<feld>:<name>`, siehe {@link einheitAusSchluessel}).
   */
  art: 'feld' | 'baustein' | 'typ' | 'einheit';
  key: string;
  label: string;
  gesetzt?: boolean;
}

export interface SlashTreffer {
  /** Leer, solange der Aufrufer die Typen nicht anbietet (nur am Zeilenanfang). */
  typen: SlashEintrag[];
  felder: SlashEintrag[];
  bausteine: SlashEintrag[];
}

/** Die Typen, die ein `/` am Zeilenanfang setzen kann — genau die erfassbaren. */
export const TYP_BEFEHLE: readonly EtbTyp[] = ['meldung', 'anordnung', 'entscheidung', 'lage'];

export function filterSlashEintraege(
  filter: string,
  bausteine: EtbBaustein[],
  gesetzteFelder: MetaFeld[],
  optionen: { typen?: boolean } = {},
): SlashTreffer {
  const f = filter.trim().toLowerCase();
  const typen: SlashEintrag[] = optionen.typen
    ? TYP_BEFEHLE.filter((t) => f === '' || t.includes(f)).map((t) => ({
        art: 'typ',
        key: t,
        label: `/${t}`,
      }))
    : [];
  const felder: SlashEintrag[] = METADATEN_FELDER.filter(
    (def) =>
      f === '' || def.trigger.some((t) => t.includes(f)) || def.label.toLowerCase().includes(f),
  ).map((def) => ({
    art: 'feld',
    key: def.feld,
    label: def.label,
    gesetzt: gesetzteFelder.includes(def.feld),
  }));

  const treffer: SlashEintrag[] = bausteine
    .filter((b) => f === '' || b.label.toLowerCase().includes(f))
    .map((b) => ({ art: 'baustein', key: String(b.id), label: b.label }));

  return { typen, felder, bausteine: treffer };
}

export interface EintragArgs {
  inhalt: string;
  typ: EtbTyp;
  metadaten: MetadatenWerte;
  berichtigungZuId?: number;
  /** ISO-Zeitstempel „jetzt" (vom Aufrufer übergeben — testbar). */
  jetztIso: string;
}

export function baueEintrag({
  inhalt,
  typ,
  metadaten,
  berichtigungZuId,
  jetztIso,
}: EintragArgs): NeuerEintrag {
  return {
    typ: berichtigungZuId != null ? 'berichtigung' : typ,
    inhalt,
    von: metadaten.von || undefined,
    an: metadaten.an || undefined,
    meldeweg: metadaten.meldeweg || undefined,
    veranlassung: metadaten.veranlassung || undefined,
    ereigniszeit: (metadaten.ereigniszeit ?? dayjs.utc(jetztIso))
      .utc()
      .format('YYYY-MM-DD HH:mm:ss'),
    erfasst_lokal_at: jetztIso,
    berichtigt_eintrag_id: berichtigungZuId,
  };
}

/**
 * `/anordnung ` am Textanfang, mit folgendem Leerzeichen, setzt den Typ ohne Menü — wer
 * den Befehl auswendig tippt, soll nicht auf die Liste warten müssen. Liefert den Typ und
 * den Text ohne den Befehl, sonst `null`. Nur exakte Typwörter: `/lagebericht` ist kein
 * Befehl und bleibt Text.
 */
export function erkenneTypBefehl(text: string): { typ: EtbTyp; rest: string } | null {
  const treffer = /^\/([a-zäöü]+)\s/.exec(text);
  if (!treffer) return null;
  const typ = treffer[1] as EtbTyp;
  if (!TYP_BEFEHLE.includes(typ)) return null;
  return { typ, rest: text.slice(treffer[0].length) };
}

/**
 * Wohin `@Funkrufname` gehört: bei einer Anordnung an den EMPFÄNGER („an EA-Süd"), bei
 * allen anderen Typen an den ABSENDER („Deichwache N meldet …"). Eine Regel, eine Stelle —
 * und das Ergebnis steht danach als Chip sichtbar da und ist dort korrigierbar.
 */
export function atZielFeld(typ: EtbTyp): 'von' | 'an' {
  return typ === 'anordnung' ? 'an' : 'von';
}

const AT_TREFFER_MAX = 8;

/**
 * Die Einträge des `@`-Menüs: passende Funkrufnamen, beschriftet mit dem Feld, in das sie
 * gehen („An: ELW 1"). Steht der getippte Text nicht wörtlich in der Liste, kommt er als
 * Freitext dazu — Freitext bleibt erlaubt (AC#1 der Funkrufnamen-Vorschläge).
 */
export function filterAtEintraege(
  filter: string,
  namen: readonly string[],
  typ: EtbTyp,
): SlashEintrag[] {
  const feld = atZielFeld(typ);
  const etikett = feld === 'an' ? 'An' : 'Von';
  const f = filter.trim().toLowerCase();
  const passend = namen
    .filter((n) => f === '' || n.toLowerCase().includes(f))
    .slice(0, AT_TREFFER_MAX);
  const eintraege: SlashEintrag[] = passend.map((n) => ({
    art: 'einheit',
    key: `${feld}:${n}`,
    label: `${etikett}: ${n}`,
  }));
  const roh = filter.trim();
  if (roh !== '' && !namen.some((n) => n.toLowerCase() === f)) {
    eintraege.push({ art: 'einheit', key: `${feld}:${roh}`, label: `${etikett}: ${roh}` });
  }
  return eintraege;
}

/** Umkehr des Schlüssels eines `einheit`-Eintrags. Der Name darf selbst `:` enthalten. */
export function einheitAusSchluessel(key: string): { feld: 'von' | 'an'; wert: string } {
  const trenner = key.indexOf(':');
  const feld = key.slice(0, trenner) === 'an' ? 'an' : 'von';
  return { feld, wert: key.slice(trenner + 1) };
}
