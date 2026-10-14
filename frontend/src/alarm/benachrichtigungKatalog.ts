import type {
  BenachrichtigungArt,
  BenachrichtigungBezugTyp,
  BenachrichtigungEreignis,
  BenachrichtigungStufe,
} from '../api/types';
import {
  abloesungPfad,
  auftraegePfad,
  einsaetzePfad,
  einsatzModulPfad,
  einsatzPfad,
  einheitenPfad,
  erinnerungenPfad,
  fahrzeugePfad,
  lageberichtePfad,
  lagebesprechungPfad,
  lagekartePfad,
  meldungenPfad,
  nachforderungenPfad,
  personenPfad,
  wetterPegelPfad,
} from '../routing/deeplinks';

/**
 * Katalog der Benachrichtigungsarten im Client (design.md D4). Die Stufe spiegelt
 * `BenachrichtigungArt::stufe` (Server); der Record über den generierten Typ macht eine neue
 * Art zum Typfehler.
 *
 * - `name`: kurzer Name für die Einstellungsseite und die Zählzeilen des Sammeltoasts.
 * - `org`: Org-Art (Org-Kanal), gezeigt auch außerhalb eines Einsatzes.
 * - `einstellbar`: steht auf der Einstellungsseite. `unwetter` erkennt der Browser selbst; er
 *   prüft die Einstellung erst mit der Teilaufgabe „bestehende Alarme“ (tasks.md 3.5), bis dahin
 *   stünde dort ein Schalter ohne Wirkung.
 *
 * Titel, Detailzeile und Sprungziel einer einzelnen Benachrichtigung bildet der Server
 * (`src/benachrichtigung/text.rs`); hier steht nur, was der Client ohne Text braucht.
 */
export const BENACHRICHTIGUNG_ARTEN: Record<
  BenachrichtigungArt,
  { name: string; stufe: BenachrichtigungStufe; org: boolean; einstellbar: boolean }
> = {
  sofortmeldung: { name: 'Sofortmeldung', stufe: 'alarm', org: false, einstellbar: true },
  sofortmeldung_eskaliert: {
    name: 'Sofortmeldung unbestätigt',
    stufe: 'alarm',
    org: false,
    einstellbar: true,
  },
  auftrag_ueberfaellig: {
    name: 'Auftrag überfällig',
    stufe: 'alarm',
    org: false,
    einstellbar: true,
  },
  abloesung_faellig: { name: 'Ablösung fällig', stufe: 'alarm', org: false, einstellbar: true },
  erinnerung_faellig: {
    name: 'Erinnerung fällig',
    stufe: 'hinweis',
    org: false,
    einstellbar: true,
  },
  abloesung_vorwarnung: {
    name: 'Ablösung steht an',
    stufe: 'hinweis',
    org: false,
    einstellbar: true,
  },
  auftrag_erteilt: { name: 'Neuer Auftrag', stufe: 'hinweis', org: false, einstellbar: true },
  auftrag_quittiert: {
    name: 'Auftrag quittiert',
    stufe: 'hinweis',
    org: false,
    einstellbar: true,
  },
  auftrag_erledigt: { name: 'Auftrag erledigt', stufe: 'hinweis', org: false, einstellbar: true },
  befehl: { name: 'Neuer Befehl', stufe: 'hinweis', org: false, einstellbar: true },
  lagebericht: { name: 'Neuer Lagebericht', stufe: 'hinweis', org: false, einstellbar: true },
  meldung: { name: 'Neue Meldung', stufe: 'hinweis', org: false, einstellbar: true },
  lagebesprechung_vorher: {
    name: 'Lagebesprechung in 10 Minuten',
    stufe: 'hinweis',
    org: false,
    einstellbar: true,
  },
  lagebesprechung_faellig: {
    name: 'Lagebesprechung fällig',
    stufe: 'hinweis',
    org: false,
    einstellbar: true,
  },
  nachforderung_status: {
    name: 'Status einer Nachforderung',
    stufe: 'hinweis',
    org: false,
    einstellbar: true,
  },
  gefahr: { name: 'Neue Gefahr', stufe: 'hinweis', org: false, einstellbar: true },
  sichtung_eins: { name: 'Sichtung I', stufe: 'hinweis', org: false, einstellbar: true },
  wieder_verfuegbar: {
    name: 'Wieder verfügbar',
    stufe: 'hinweis',
    org: false,
    einstellbar: true,
  },
  chat_erwaehnung: { name: 'Erwähnung im Chat', stufe: 'hinweis', org: false, einstellbar: true },
  einsatz_aufnahme: {
    name: 'Aufnahme in einen Einsatz',
    stufe: 'hinweis',
    org: true,
    einstellbar: true,
  },
  einsatz_neu: { name: 'Neuer Einsatz', stufe: 'hinweis', org: true, einstellbar: true },
  unwetter: { name: 'Unwetterwarnung', stufe: 'hinweis', org: false, einstellbar: false },
};

/** Alle Arten in Katalogreihenfolge. */
export const ALLE_ARTEN = Object.keys(BENACHRICHTIGUNG_ARTEN) as BenachrichtigungArt[];

export function istOrgArt(art: BenachrichtigungArt): boolean {
  return BENACHRICHTIGUNG_ARTEN[art]?.org ?? false;
}

/**
 * Ziel eines Sprungs im Sammeltoast. Die ersten fünf sind die der bestehenden Alarme; ihre
 * Reihenfolge bestimmt den Hauptknopf.
 */
export type AlarmZiel =
  | 'meldungen'
  | 'auftraege'
  | 'erinnerungen'
  | 'abloesung'
  | 'wetter-pegel'
  | 'befehle'
  | 'lageberichte'
  | 'lagebesprechung'
  | 'nachforderungen'
  | 'lagekarte'
  | 'personen'
  | 'einheiten'
  | 'fahrzeuge'
  | 'chat'
  | 'einsatz'
  | 'einsaetze';

/** Knopftext je Ziel, in der Reihenfolge des Sammeltoasts. */
export const ZIEL_SPRUENGE: readonly { ziel: AlarmZiel; text: string }[] = [
  { ziel: 'meldungen', text: 'Zu Meldungen' },
  { ziel: 'auftraege', text: 'Zu Aufträgen' },
  { ziel: 'erinnerungen', text: 'Zu Erinnerungen' },
  { ziel: 'abloesung', text: 'Zu Ablösungen' },
  { ziel: 'wetter-pegel', text: 'Zu Wetter & Pegel' },
  { ziel: 'befehle', text: 'Zu Befehlen' },
  { ziel: 'lageberichte', text: 'Zu Lageberichten' },
  { ziel: 'lagebesprechung', text: 'Zur Lagebesprechung' },
  { ziel: 'nachforderungen', text: 'Zu Nachforderungen' },
  { ziel: 'lagekarte', text: 'Zur Lagekarte' },
  { ziel: 'personen', text: 'Zu Personen' },
  { ziel: 'einheiten', text: 'Zu Einheiten' },
  { ziel: 'fahrzeuge', text: 'Zu Fahrzeugen' },
  { ziel: 'chat', text: 'Zum Chat' },
  { ziel: 'einsatz', text: 'Zum Einsatz' },
  { ziel: 'einsaetze', text: 'Zu Einsätzen' },
];

/** Pfad eines Sammel-Sprungs; `einsatzId` `null` (Org-Layout) führt in die Einsatzliste. */
export function zielPfad(ziel: AlarmZiel, einsatzId: number | null): string {
  if (einsatzId == null) return einsaetzePfad();
  switch (ziel) {
    case 'meldungen':
      return meldungenPfad(einsatzId);
    case 'auftraege':
      return auftraegePfad(einsatzId);
    case 'erinnerungen':
      return erinnerungenPfad(einsatzId);
    case 'abloesung':
      return abloesungPfad(einsatzId);
    case 'wetter-pegel':
      return wetterPegelPfad(einsatzId);
    case 'befehle':
      return auftraegePfad(einsatzId, { reiter: 'befehle' });
    case 'lageberichte':
      return lageberichtePfad(einsatzId);
    case 'lagebesprechung':
      return lagebesprechungPfad(einsatzId);
    case 'nachforderungen':
      return nachforderungenPfad(einsatzId);
    case 'lagekarte':
      return lagekartePfad(einsatzId);
    case 'personen':
      return personenPfad(einsatzId);
    case 'einheiten':
      return einheitenPfad(einsatzId);
    case 'fahrzeuge':
      return fahrzeugePfad(einsatzId);
    case 'chat':
      return einsatzModulPfad(einsatzId, 'chat');
    case 'einsatz':
      return einsatzPfad(einsatzId);
    case 'einsaetze':
      return einsaetzePfad();
  }
}

const BEZUG_ZIEL: Record<BenachrichtigungBezugTyp, AlarmZiel> = {
  einsatz: 'einsatz',
  meldung: 'meldungen',
  auftrag: 'auftraege',
  befehl: 'befehle',
  lagebericht: 'lageberichte',
  erinnerung: 'erinnerungen',
  abloesung: 'abloesung',
  lagebesprechung: 'lagebesprechung',
  nachforderung: 'nachforderungen',
  gefahrengebiet: 'lagekarte',
  person: 'personen',
  einheit: 'einheiten',
  fahrzeug: 'fahrzeuge',
  chat_nachricht: 'chat',
};

/** Sammel-Ziel einer Benachrichtigung: das Modul ihres Bezugs, Org-Arten die Einsatzliste. */
export function zielVon(e: Pick<BenachrichtigungEreignis, 'art' | 'bezug_typ'>): AlarmZiel {
  if (istOrgArt(e.art)) return 'einsaetze';
  return BEZUG_ZIEL[e.bezug_typ] ?? 'einsatz';
}

/**
 * Toast-Schlüssel einer Benachrichtigung. Die vier Arten, die heute noch zusätzlich über die
 * Sonderwege in `useEinsatzLiveStream` kommen, bekommen den Schlüssel ihres Sonderwegs: so teilen
 * beide Wege einen Toast, und dieselbe Benachrichtigung erscheint nie zweimal. Mit dem Ende der
 * Sonderwege (tasks.md 3.5) kann das entfallen; `b-<id>` reicht dann für alle.
 */
export function toastSchluessel(
  e: Pick<BenachrichtigungEreignis, 'art' | 'bezug_id' | 'benachrichtigung_id'>,
): string {
  switch (e.art) {
    case 'sofortmeldung':
      return `sofort-${e.bezug_id}`;
    case 'auftrag_ueberfaellig':
      return `auftrag-${e.bezug_id}`;
    case 'erinnerung_faellig':
      return `erinnerung-${e.bezug_id}`;
    case 'abloesung_faellig':
      return `abloesung-${e.bezug_id}-faellig`;
    case 'abloesung_vorwarnung':
      return `abloesung-${e.bezug_id}-vorwarnung`;
    default:
      return `b-${e.benachrichtigung_id}`;
  }
}

/**
 * Gruppe für den Titel des Sammeltoasts. Die Gruppen der Sonderwege tragen ihren eigenen Titel
 * („3 weitere Sofortmeldungen“); eine Benachrichtigung derselben Art fällt in dieselbe Gruppe.
 */
export type SammelGruppe =
  'sofort' | 'auftrag-ueberfaellig' | 'erinnerung' | 'abloesung' | 'unwetter' | BenachrichtigungArt;

export function sammelGruppeVon(art: BenachrichtigungArt): SammelGruppe {
  if (art === 'sofortmeldung') return 'sofort';
  if (art === 'auftrag_ueberfaellig') return 'auftrag-ueberfaellig';
  if (art === 'erinnerung_faellig') return 'erinnerung';
  if (art === 'abloesung_faellig' || art === 'abloesung_vorwarnung') return 'abloesung';
  return art;
}

const GRUPPEN_TITEL: Partial<Record<SammelGruppe, string>> = {
  sofort: 'Sofortmeldungen',
  'auftrag-ueberfaellig': 'überfällige Aufträge',
  erinnerung: 'fällige Erinnerungen',
  abloesung: 'Ablösungen',
};

/**
 * Titel des Sammeltoasts: Zahl und Art, das Ziel steht am Knopf (LFH-1078). Eine einzige Gruppe
 * der bestehenden Alarme behält ihren Titel; sonst „Alarme“, sobald einer dabei ist, und
 * „Hinweise“, wenn alle Hinweise sind.
 */
export function sammelTitel(
  eintraege: readonly { gruppe: SammelGruppe; stufe: BenachrichtigungStufe }[],
): string {
  const anzahl = eintraege.length;
  const gruppen = new Set(eintraege.map((e) => e.gruppe));
  if (gruppen.size === 1) {
    const titel = GRUPPEN_TITEL[[...gruppen][0]];
    if (titel) return `${anzahl} weitere ${titel}`;
  }
  return eintraege.some((e) => e.stufe === 'alarm')
    ? `${anzahl} weitere Alarme`
    : `${anzahl} weitere Hinweise`;
}

/**
 * Zählzeilen des Sammeltoasts, je Name eine („2 × Neuer Auftrag“), in der Reihenfolge des ersten
 * Auftretens. Leer bei nur einer Art: dann sagt der Titel schon alles.
 */
export function sammelZeilen(eintraege: readonly { name: string }[]): string[] {
  const zaehler = new Map<string, number>();
  for (const e of eintraege) zaehler.set(e.name, (zaehler.get(e.name) ?? 0) + 1);
  if (zaehler.size < 2) return [];
  return [...zaehler].map(([name, n]) => `${n} × ${name}`);
}
