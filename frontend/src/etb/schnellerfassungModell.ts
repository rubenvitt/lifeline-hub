import { relativ } from '../anzeige/dauer';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { EtbBaustein, EtbTyp, MeldeWeg } from '../api/types';
import type { NeuerEintrag } from '../api/etb';
import { ETB_INHALT_MAX, ETB_PARTEI_MAX } from '../api/eingabegrenzen';
import { grenzeText, istZuLang, zeichenZahl } from '../components/zeichenGrenze';
import { deuteZeit, GRUND } from '../anzeige/zeitParser';

dayjs.extend(utc);

export type MetaFeld = 'ereigniszeit' | 'von' | 'an' | 'meldeweg' | 'veranlassung';

type EditorTyp = 'zeit' | 'text' | 'meldeweg';

interface MetaFeldDef {
  feld: MetaFeld;
  label: string;
  /** Kleingeschriebene Filter-Stichwörter für das /-Menü. */
  trigger: string[];
  editor: EditorTyp;
  /** Die Kurzeingabe dafür, im /-Menü neben dem Feld gezeigt (`/zeit 1420`, LLH-1088). */
  kurz?: string;
}

/** Anzeige-/Tab-Reihenfolge der Felder im /-Menü und in der Chip-Leiste. */
export const METADATEN_FELDER: MetaFeldDef[] = [
  {
    feld: 'ereigniszeit',
    label: 'Ereigniszeit',
    trigger: ['zeit', 'ereigniszeit', 'uhrzeit'],
    editor: 'zeit',
    kurz: '/zeit 1420',
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

interface SlashTrigger {
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
function parseTrigger(text: string, caret: number, zeichen: '/' | '@'): SlashTrigger {
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
export function parseSlashTrigger(text: string, caret: number): SlashTrigger {
  return parseTrigger(text, caret, '/');
}

/** `@` am Wortanfang: Funkrufname für Von bzw. An. */
export function parseAtTrigger(text: string, caret: number): SlashTrigger {
  return parseTrigger(text, caret, '@');
}

/**
 * Steht der Auslöser am ZEILENANFANG? Nur dort wählt `/` auch den Typ (`/anordnung …`).
 * Mitten im Satz bleibt `/` bei Feldern und Bausteinen — „Lage /von" soll nicht den Typ anbieten.
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
  /** Kurzeingabe des Felds, leise neben dem Wort (`/zeit 1420`). */
  hinweis?: string;
}

interface SlashTreffer {
  /** Leer, solange der Aufrufer die Typen nicht anbietet (nur am Zeilenanfang). */
  typen: SlashEintrag[];
  felder: SlashEintrag[];
  bausteine: SlashEintrag[];
}

/** Die Typen, die ein `/` am Zeilenanfang setzen kann — genau die erfassbaren. */
export const TYP_BEFEHLE: readonly EtbTyp[] = ['meldung', 'anordnung', 'entscheidung', 'lage'];

/** Die Typen der Mitarbeit (LLH-1817): Meldung und Lage; Anordnung und Entscheidung führt sie nicht. */
export const TYP_BEFEHLE_MITARBEIT: readonly EtbTyp[] = ['meldung', 'lage'];

export function filterSlashEintraege(
  filter: string,
  bausteine: EtbBaustein[],
  gesetzteFelder: MetaFeld[],
  optionen: { typen?: boolean; erlaubteTypen?: readonly EtbTyp[] } = {},
): SlashTreffer {
  const f = filter.trim().toLowerCase();
  const typen: SlashEintrag[] = optionen.typen
    ? (optionen.erlaubteTypen ?? TYP_BEFEHLE)
        .filter((t) => f === '' || t.includes(f))
        .map((t) => ({
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
    ...(def.kurz ? { hinweis: def.kurz } : {}),
  }));

  const treffer: SlashEintrag[] = bausteine
    .filter((b) => f === '' || b.label.toLowerCase().includes(f))
    .map((b) => ({ art: 'baustein', key: String(b.id), label: b.label }));

  return { typen, felder, bausteine: treffer };
}

interface EintragArgs {
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

/** Was der Server an einem ETB-Eintrag zählt, mit Grenze und Wort für den Hinweis (LFH-937). */
const LAENGEN_FELDER = [
  { wort: 'Inhalt', max: ETB_INHALT_MAX, wert: (inhalt: string) => inhalt },
  { wort: 'Von', max: ETB_PARTEI_MAX, wert: (_: string, m: MetadatenWerte) => m.von },
  { wort: 'An', max: ETB_PARTEI_MAX, wert: (_: string, m: MetadatenWerte) => m.an },
  {
    wort: 'Veranlassung',
    max: ETB_PARTEI_MAX,
    wert: (_: string, m: MetadatenWerte) => m.veranlassung,
  },
] as const;

/**
 * Hinweis, wenn der Server den Eintrag wegen eines zu langen Felds ablehnte, sonst `null`
 * (LFH-937, design.md D8). Das Textfeld endet an der Grenze, aber ein Baustein oder ein
 * Slash-Befehl setzt den Text von außen: geprüft wird deshalb vor Upload und Warteschlange, wie
 * bei der Von/An-Pflicht.
 */
export function laengenVerstoss(inhalt: string, metadaten: MetadatenWerte): string | null {
  const gruende = LAENGEN_FELDER.flatMap(({ wort, max, wert }) => {
    const w = wert(inhalt, metadaten);
    if (!istZuLang(w, max)) return [];
    const jetzt = grenzeText(zeichenZahl((w ?? '').trim()));
    return [`${wort} ist zu lang: höchstens ${grenzeText(max)} Zeichen (jetzt ${jetzt})`];
  });
  return gruende.length > 0 ? `${gruende.join(' · ')}. Bitte kürzen.` : null;
}

/**
 * Wie weit eine Ereigniszeit vor der Serveruhr liegen darf (LLH-1088): dieselbe Toleranz, die der
 * Server Zeitpunkten aus dem Client lässt (`ZUKUNFT_TOLERANZ_SEKUNDEN`, `src/routes/support.rs`) —
 * Uhren gehen nie gleich.
 */
export const ZUKUNFT_TOLERANZ_S = 60;

/**
 * Liegt die Ereigniszeit mehr als {@link ZUKUNFT_TOLERANZ_S} nach `jetzt` (Serveruhr)? Dann nennt
 * die Erfassung den Grund am Zeit-Chip und sendet nicht (Spec `etb-schnellerfassung-tastatur`,
 * „Keine Ereigniszeit in der Zukunft“), geprüft vor Upload und Warteschlange wie die
 * Zeichengrenzen. Nur im Client: der Server begrenzt die Ereigniszeit nicht, ein vorgemerkter
 * Eintrag mit vergangener Zeit kommt also später an.
 */
export function zukunftsVerstoss(metadaten: MetadatenWerte, jetzt: dayjs.Dayjs): string | null {
  const zeit = metadaten.ereigniszeit;
  if (zeit == null) return null;
  return zeit.diff(jetzt, 'second') > ZUKUNFT_TOLERANZ_S ? GRUND.zukunft : null;
}

/**
 * `/anordnung ` am Textanfang, mit folgendem Leerzeichen, setzt den Typ ohne Menü — wer
 * den Befehl auswendig tippt, soll nicht auf die Liste warten müssen. Liefert den Typ und
 * den Text ohne den Befehl, sonst `null`. Nur exakte Typwörter: `/lagebericht` ist kein
 * Befehl und bleibt Text.
 */
export function parseTypBefehl(
  text: string,
  erlaubteTypen: readonly EtbTyp[] = TYP_BEFEHLE,
): { typ: EtbTyp; rest: string } | null {
  const treffer = /^\/([a-zäöü]+)\s/.exec(text);
  if (!treffer) return null;
  const typ = treffer[1] as EtbTyp;
  if (!erlaubteTypen.includes(typ)) return null;
  return { typ, rest: text.slice(treffer[0].length) };
}

/**
 * `/zeit <Angabe>` an einem Wortanfang irgendwo im Text (LLH-1088, LLH-1754, Spec
 * `etb-schnellerfassung-tastatur`, „Kurzeingabe der Ereigniszeit“): die Angabe wird wie im
 * Zeitfeld eines Ereignisses gedeutet (`deuteZeit`, `art: 'ereignis'`: `1420`, `14:20`, `101420`,
 * `-15` …), der Befehl verlässt den Inhalt, der Rest bleibt. `abgeschlossen` heißt: hinter der
 * Angabe steht ein Leerzeichen. Nur dann löst schon das Tippen aus — vorher tippt jemand noch;
 * am Textende ohne Leerzeichen übernimmt erst Enter bzw. „Erfassen“ (LLH-1754: sonst ginge der
 * Befehl als Text ins Tagebuch). Unlesbar: `ok: false` mit Grund, der Text bleibt stehen. Ein
 * vorangestellter Typbefehl ist zuvor schon abgezogen. Es zählt das erste `/zeit` im Text.
 */
export function parseZeitBefehl(
  text: string,
  optionen: { zone: string | null | undefined; jetzt: dayjs.Dayjs },
): ZeitBefehl | null {
  const treffer = /(^|\s)\/zeit(\s+)(\S+)(\s|$)/.exec(text);
  if (!treffer) return null;
  // `start`/`ende`: wo der Befehl steht — der Aufrufer löst beim Tippen nur aus, wenn genau an
  // `ende` getippt wurde.
  const start = treffer.index + treffer[1].length;
  const ende = treffer.index + treffer[0].length;
  const abgeschlossen = treffer[4] !== '';
  // `angabe`: wo die Zeitangabe steht — dorthin geht der Cursor, wenn sie unlesbar ist (LLH-1866).
  const angabeStart = start + '/zeit'.length + treffer[2].length;
  const angabe = { start: angabeStart, end: angabeStart + treffer[3].length };
  const lage = { start, ende, angabe, abgeschlossen };
  const deutung = deuteZeit(treffer[3], { ...optionen, art: 'ereignis' });
  if (!deutung.ok) return { ok: false, grund: deutung.grund, ...lage };
  if (deutung.zeitpunkt == null) return null;
  // Am Textende fällt mit dem Befehl auch das Leerzeichen davor: „Pumpe läuft /zeit 1420“. Beim
  // Tippen („Pumpe /zeit 1420 “) bleibt es, dahinter geht der Satz weiter.
  const davor = text.slice(0, start);
  const rest = abgeschlossen ? davor + text.slice(ende) : davor.trimEnd();
  return { ok: true, zeitpunkt: deutung.zeitpunkt, rest, ...lage };
}

interface ZeitBefehlLage {
  /** Wo der Befehl beginnt (das `/`). */
  start: number;
  /** Wo er endet, samt Leerzeichen dahinter. */
  ende: number;
  /** Wo die Zeitangabe steht. */
  angabe: TextRange;
  /** Steht hinter der Angabe ein Leerzeichen? Sonst tippt womöglich noch jemand. */
  abgeschlossen: boolean;
}

export type ZeitBefehl =
  | ({ ok: true; zeitpunkt: dayjs.Dayjs; rest: string } & ZeitBefehlLage)
  | ({ ok: false; grund: string } & ZeitBefehlLage);

/** Ein Text, der nur aus einem Befehl besteht (LLH-1754), und was er meint. */
export type NurBefehl =
  | { art: 'typ'; typ: EtbTyp }
  | { art: 'feld'; feld: MetaFeld }
  | { art: 'unbekannt'; befehl: string };

/**
 * Besteht der ganze Text aus einem `/wort` (LLH-1754)? Dann sendet die Erfassung nie, sondern
 * tut, was das Wort meint: ein erlaubter Typ setzt den Typ, ein Feld-Stichwort des `/`-Menüs
 * springt ins Feld, alles andere bleibt stehen und heißt „kein Befehl“. Ein Eintrag „/lage“ oder
 * „/zeit“ im Tagebuch wäre Müll, den nur noch eine Berichtigung heilt.
 */
export function parseNurBefehl(
  text: string,
  erlaubteTypen: readonly EtbTyp[] = TYP_BEFEHLE,
): NurBefehl | null {
  const treffer = /^\/(\p{L}*)$/u.exec(text.trim());
  if (!treffer) return null;
  const wort = treffer[1].toLowerCase();
  const typ = erlaubteTypen.find((t) => t === wort);
  if (typ) return { art: 'typ', typ };
  const def = METADATEN_FELDER.find((d) => wort !== '' && d.trigger.includes(wort));
  if (def) return { art: 'feld', feld: def.feld };
  return { art: 'unbekannt', befehl: `/${treffer[1]}` };
}

/** Ein Abschnitt im Text, halboffen: `start` einschließlich, `end` ausschließlich. */
export interface TextRange {
  start: number;
  end: number;
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

/**
 * Trägt der Inhalt Formatierung (Auszeichnung, Überschrift, Liste, Zitat, Code, Verweis)? Nur dann
 * bietet die Erfassung „Vorschau“ an (Spec `etb-schnellerfassung-tastatur`, „Entwurfsreiter und
 * Vorschau nur bei Bedarf“). Reiner Text braucht keine Vorschau; im Zweifel lieber angeboten.
 */
export function hatFormatierung(text: string): boolean {
  return (
    /(\*\*|__)\S/.test(text) ||
    /(^|\s)[*_][^\s*_][^*_\n]*[*_](\s|$)/.test(text) ||
    /`[^`\n]+`/.test(text) ||
    /^\s{0,3}(#{1,6}\s|>\s|[-*+]\s|\d+[.)]\s)/m.test(text) ||
    /\[[^\]\n]+\]\([^)\s]+\)/.test(text)
  );
}

/**
 * Wie viele volle Minuten die Ereigniszeit vor `jetzt` liegt, ab einer Minute; sonst `null`
 * (Spec „Abweichende Ereigniszeit bleibt sichtbar“). Eine Zeit in der Zukunft ist kein Nachtrag,
 * sie ist ein Fehler ({@link zukunftsVerstoss}).
 */
export function nachtragMinuten(
  ereigniszeit: dayjs.Dayjs | undefined,
  jetzt: dayjs.Dayjs,
): number | null {
  if (ereigniszeit == null) return null;
  const minuten = Math.floor(jetzt.diff(ereigniszeit, 'second') / 60);
  return minuten >= 1 ? minuten : null;
}

/** „Nachtrag · Ereignis vor 14 min“, ab einer Stunde „vor 1 h 05 min“ (`anzeige/dauer.ts`). */
export function nachtragHinweis(minuten: number): string {
  return `Nachtrag · Ereignis ${relativ(minuten, 'vor')}`;
}

/** Die fehlenden Pflichtseiten in Feldfolge (Spec „Pflicht im Client“: fehlen beide, beide). */
export function fehlendeSeiten(wirksam: MetadatenWerte): ('von' | 'an')[] {
  return (['von', 'an'] as const).filter((s) => !wirksam[s]?.trim());
}
