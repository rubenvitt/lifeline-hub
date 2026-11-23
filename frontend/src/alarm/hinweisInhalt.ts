import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { ladeAuftrag } from '../api/auftraege';
import { ladeBefehl } from '../api/befehle';
import { listeNachrichten } from '../api/chat';
import { ladeLagebericht } from '../api/lageberichte';
import { listeZonen } from '../api/lagezonen';
import { listeNachforderungen } from '../api/nachforderungen';
import { einsatzKeys } from '../api/queryKeys';
import type { BenachrichtigungArt, BenachrichtigungEreignis, MeldungStatus } from '../api/types';
import { nachforderungName } from '../nachforderungen/nachforderungName';
import { ladeErinnerungTitel } from './erinnerungInhalt';
import { INHALT_FRIST_MS, ladeMeldungInhalt, wortlautAnfang } from './meldungInhalt';

/**
 * Der Gegenstand eines Hinweises (LLH-1909, Fortsetzung von LLH-1052 und LLH-1737): was Alarmzone,
 * Eingangsband und Verlauf (unter „Neu“) über den Text des Servers hinaus nennen.
 *
 * Titel und Freitexte sind Scrub-Werte: der Server nennt sie weder im Live-Ereignis noch im Text
 * der Benachrichtigung (`src/benachrichtigung/text.rs`, nur Retain-Spalten). Der Client holt sie
 * über die Abrufe, die er ohnehin hat. Der Empfänger darf das Modul des Bezugs lesen
 * (`src/benachrichtigung/aufloesung.rs`), sonst bekäme er den Hinweis nicht. Wo ein Abruf unter
 * dem Key einer Seite liegt, teilt er ihren Cache.
 *
 * | Art | Abruf | zeigt |
 * |---|---|---|
 * | Meldung (`meldungInhalt.ts`) | `GET …/meldungen/{id}` | Absender im Titel, Wortlautanfang |
 * | Erinnerung (`erinnerungInhalt.ts`) | offene Erinnerungen | Titel als Gegenstand |
 * | Auftrag | `GET …/auftraege/{id}` | „#12 · Textanfang“; bei Quittung, wer quittiert hat |
 * | Befehl, Lagebericht | Einzelabruf | Dokumenttitel als Gegenstand |
 * | Gefahr | Zonen der Lagekarte | Bezeichnung als Gegenstand |
 * | Nachforderung | Liste der Nachforderungen | Art und Bezeichnung als Gegenstand |
 * | Chat-Erwähnung | Nachrichten des Kanals bis zur Nachricht | Absender, Textanfang |
 *
 * Für Gefahr gibt es keinen Einzelabruf, und `/hazard-areas` verlangt das Modul
 * `gefahrenzonen`, der Empfänger hat sicher nur `lagekarte`. Die Zone trägt beim Anlegen
 * dieselbe Bezeichnung wie ihr Gebiet, und nur das Anlegen meldet. Die Quittung eines Auftrags
 * zeigt auf die Empfängerzeile und eine Erwähnung auf die Nachricht; Auftrag und Kanal stehen nur
 * im Sprungpfad der Benachrichtigung (`pfad`).
 *
 * Antwortet ein Abruf nicht in {@link INHALT_FRIST_MS}, bleibt der Text des Servers. Push-Meldungen
 * bei geschlossener App (`public/alarm-sw.js`) bleiben dabei; nur die Meldung nennt dort auf
 * Wunsch ihren Inhalt (LLH-1369).
 */
export type HinweisInhalt = {
  /** Ersetzt den Titel des Servers ganz („Sofortmeldung · RTW 2“). */
  titel: string | null;
  /** Steht hinter dem Titel des Servers: „Neuer Befehl: Räumung Nord“. */
  gegenstand: string | null;
  /** Steht hinter dem Titel des Servers: „Erwähnt im Chat · Anna Berg“. */
  wer: string | null;
  /** Ersetzt die Detailzeile. */
  anfang: string | null;
  /** Der ganze Text hinter {@link HinweisInhalt.anfang}, fürs Titel-Attribut. */
  wortlaut: string | null;
  /** Absender einer Meldung allein, für die Zeilen des Eingangshinweises. */
  absender: string | null;
  /** Triage-Status einer Meldung beim Abruf: „Sichten“ gibt es nur für eine neue. */
  status: MeldungStatus | null;
};

const LEER: HinweisInhalt = {
  titel: null,
  gegenstand: null,
  wer: null,
  anfang: null,
  wortlaut: null,
  absender: null,
  status: null,
};

/** Der Titel eines Hinweises mit seinem Inhalt; ohne Inhalt der des Servers. */
export function titelMit(titel: string, inhalt: HinweisInhalt | null | undefined): string {
  if (!inhalt) return titel;
  if (inhalt.titel) return inhalt.titel;
  let mit = titel;
  if (inhalt.wer) mit = `${mit} · ${inhalt.wer}`;
  if (inhalt.gegenstand) mit = `${mit}: ${inhalt.gegenstand}`;
  return mit;
}

type Ereignis = Pick<BenachrichtigungEreignis, 'art' | 'bezug_typ' | 'bezug_id' | 'einsatz_id'>;
/** Eine Benachrichtigung mit Einsatz: nur sie hat einen Gegenstand (LLH-2026: ohne Einsatz nie). */
type Quelle = Omit<Ereignis, 'einsatz_id'> & { einsatz_id: number };

type Kontext = {
  /** Sprungpfad der Benachrichtigung; im Live-Weg erst mit ihrem Text. */
  pfad: Promise<string | null>;
  qc: QueryClient | null;
};

type Lader = (e: Quelle, k: Kontext) => Promise<HinweisInhalt | null>;

/** Eine Liste, die eine Seite gerade geholt hat, reicht (wie bei der Erinnerung). */
const CACHE_FRISCH_MS = 30_000;

function holen<T>(qc: QueryClient | null, queryKey: QueryKey, queryFn: () => Promise<T>) {
  return qc ? qc.fetchQuery({ queryKey, queryFn, staleTime: CACHE_FRISCH_MS }) : queryFn();
}

/** Eine Zahl aus der Abfrage eines Sprungpfads („/einsaetze/1/chat?kanal=6“). */
function zahlAusPfad(pfad: string | null, name: string): number | null {
  if (!pfad) return null;
  const wert = Number(new URL(pfad, 'http://pfad.invalid').searchParams.get(name));
  return Number.isInteger(wert) && wert > 0 ? wert : null;
}

/** Ein getrimmter Text, leer als `null`. */
function text(wert: string | null | undefined): string | null {
  return wert?.trim() || null;
}

const meldung: Lader = async (e) => {
  const m = await ladeMeldungInhalt(e);
  return m && { ...LEER, ...m };
};

const erinnerung: Lader = async (e, k) => {
  const titel = await ladeErinnerungTitel(e, k.qc);
  return titel ? { ...LEER, gegenstand: titel } : null;
};

const auftrag: Lader = async (e, k) => {
  const quittung = e.bezug_typ === 'auftrag_empfaenger';
  const auftragId =
    e.bezug_typ === 'auftrag' ? e.bezug_id : quittung ? zahlAusPfad(await k.pfad, 'auftrag') : null;
  if (auftragId == null) return null;
  const a = await holen(k.qc, einsatzKeys.auftragEinzeln(e.einsatz_id, auftragId), () =>
    ladeAuftrag(e.einsatz_id, auftragId),
  );
  const wortlaut = text(a.auftrag_text);
  const anfang = wortlaut && wortlautAnfang(wortlaut);
  return {
    ...LEER,
    wer: quittung ? text(a.empfaenger?.find((x) => x.id === e.bezug_id)?.snap_anzeige) : null,
    anfang: anfang && (a.lfd_nr != null ? `#${a.lfd_nr} · ${anfang}` : anfang),
    wortlaut,
  };
};

const befehl: Lader = async (e, k) => {
  if (e.bezug_typ !== 'befehl') return null;
  const b = await holen(k.qc, einsatzKeys.befehl(e.einsatz_id, e.bezug_id), () =>
    ladeBefehl(e.einsatz_id, e.bezug_id),
  );
  const titel = text(b.titel);
  return titel ? { ...LEER, gegenstand: titel } : null;
};

const lagebericht: Lader = async (e, k) => {
  if (e.bezug_typ !== 'lagebericht') return null;
  const b = await holen(k.qc, einsatzKeys.lagebericht(e.einsatz_id, e.bezug_id), () =>
    ladeLagebericht(e.einsatz_id, e.bezug_id),
  );
  const titel = text(b.titel);
  return titel ? { ...LEER, gegenstand: titel } : null;
};

const gefahr: Lader = async (e, k) => {
  if (e.bezug_typ !== 'gefahrengebiet') return null;
  const zonen = await holen(k.qc, einsatzKeys.zonen(e.einsatz_id), () => listeZonen(e.einsatz_id));
  const label = zonen
    .filter((z) => z.gefahrengebiet_id === e.bezug_id)
    .map((z) => text(z.label))
    .find(Boolean);
  return label ? { ...LEER, gegenstand: label } : null;
};

const nachforderung: Lader = async (e, k) => {
  if (!e.bezug_typ.startsWith('nachforderung_')) return null;
  // Unter demselben Key holen Überblick und Nachforderungsseite alle Status.
  const liste = await holen(k.qc, einsatzKeys.nachforderungen(e.einsatz_id), () =>
    listeNachforderungen(e.einsatz_id, {}),
  );
  const n = liste.find((x) => x.id === e.bezug_id);
  // Die Anzahl nennt schon die Detailzeile des Servers („2× an Leitstelle“).
  const name = n && text(nachforderungName({ ...n, anzahl: null }));
  return name ? { ...LEER, gegenstand: name } : null;
};

const chat: Lader = async (e, k) => {
  if (e.bezug_typ !== 'chat_nachricht') return null;
  const kanal = zahlAusPfad(await k.pfad, 'kanal');
  if (kanal == null) return null;
  // Die Seite vor `id + 1` beginnt mit der Nachricht selbst (`src/chat/repo.rs`, absteigend).
  const seite = await listeNachrichten(e.einsatz_id, kanal, { aelter: e.bezug_id + 1 });
  const n = seite.find((x) => x.id === e.bezug_id);
  if (!n) return null;
  const wortlaut = n.geloescht_at ? null : text(n.inhalt);
  return {
    ...LEER,
    wer: text(n.autor_name),
    anfang: wortlaut && wortlautAnfang(wortlaut),
    wortlaut,
  };
};

/** Der Lader je Art; eine Art ohne Eintrag bleibt beim Text des Servers. */
const LADER: Partial<Record<BenachrichtigungArt, Lader>> = {
  sofortmeldung: meldung,
  sofortmeldung_eskaliert: meldung,
  meldung,
  erinnerung_faellig: erinnerung,
  auftrag_erteilt: auftrag,
  auftrag_quittiert: auftrag,
  auftrag_erledigt: auftrag,
  auftrag_ueberfaellig: auftrag,
  befehl,
  lagebericht,
  gefahr,
  nachforderung_status: nachforderung,
  chat_erwaehnung: chat,
};

/**
 * Holt den Inhalt zu einem Hinweis, höchstens {@link INHALT_FRIST_MS} lang. Wirft nie: ein
 * Fehler, eine Art ohne Gegenstand oder ein fremder Bezug ergeben `null`. `pfad` ist der
 * Sprungpfad der Benachrichtigung; ohne ihn nennen Quittung und Erwähnung nichts.
 */
export function ladeHinweisInhalt(
  e: Ereignis,
  opts: { pfad?: string | null | Promise<string | null>; qc?: QueryClient | null } = {},
): Promise<HinweisInhalt | null> {
  const lader = LADER[e.art];
  const einsatzId = e.einsatz_id;
  if (!lader || einsatzId == null) return Promise.resolve(null);
  const abruf = lader(
    { ...e, einsatz_id: einsatzId },
    {
      pfad: Promise.resolve(opts.pfad ?? null).catch(() => null),
      qc: opts.qc ?? null,
    },
  ).catch(() => null);
  let uhr: ReturnType<typeof setTimeout> | undefined;
  const frist = new Promise<null>((fertig) => {
    uhr = setTimeout(() => fertig(null), INHALT_FRIST_MS);
  });
  return Promise.race([abruf, frist]).finally(() => clearTimeout(uhr));
}
