/**
 * Registrierstelle — reiner Kern (LLH-1612, Change `hitr91ob-registrierstelle-betreuung`,
 * design.md D3/D4/D7/D8): Wörter der Kostformen, der Body einer Registrierung aus der Maske, die
 * Zählung des Bands „Kostformen“ und die Anzeige der Registrierliste. Ohne React, damit Maske,
 * Liste und Gerät dieselben Wörter und Zahlen lesen.
 */
import { parseKalenderdatum, formatKalenderdatum } from '../../anzeige/kalenderdatum';
import type {
  Geschlecht,
  PersonKostform,
  RegistrierListe,
  RegistriertePerson,
  RegistrierungEingabe,
} from '../../api/types';
import { KOSTFORM_LABEL, KOSTFORMEN } from '../../verpflegung/verpflegungText';

/** Kostformen der Person in fester Folge: „Normalkost“, dann die Sonderkost der Verpflegung. */
export const KOSTFORM_REIHE: readonly PersonKostform[] = ['normal', ...KOSTFORMEN];

/** Volles Wort je Kostform (zugänglicher Name, Liste, Band); die Sonderkost aus der Verpflegung. */
export const KOSTFORM_WORT: Record<PersonKostform, string> = {
  normal: 'Normalkost',
  ...KOSTFORM_LABEL,
};

/** Kurzwort auf der Fläche der Maske (design.md D8); das volle Wort trägt der zugängliche Name. */
export const KOSTFORM_KURZ: Record<PersonKostform, string> = {
  normal: 'Normal',
  vegetarisch: 'Veg.',
  vegan: 'Vegan',
  ohne_schwein: 'o. Schwein',
  diaet_allergenarm: 'Diät',
  saeugling_kleinkind: 'Kleinkind',
};

/** Segment „m · w · d · ?“ der Maske; das Wort aus `GESCHLECHT_WORT` ist der zugängliche Name. */
export const GESCHLECHT_KURZ: Record<Geschlecht, string> = {
  maennlich: 'm',
  weiblich: 'w',
  divers: 'd',
  unbekannt: '?',
};

/** Eine Personenzeile der Maske. */
export interface RegistrierZeile {
  name?: string;
  vorname?: string;
  /** Wie getippt („3.4.1985“); gelesen über `parseKalenderdatum`. */
  geburtsdatum?: string;
  geschlecht?: Geschlecht | null;
  kostform: PersonKostform;
  unvertraeglichkeiten?: string;
}

/** Die Werte der Maske: Haushaltsangaben einmal oben, darunter je Person eine Zeile. */
export interface RegistrierWerte {
  herkunft_adresse?: string;
  kontakt?: string;
  personen: RegistrierZeile[];
}

/** Eine neue Zeile mit „Normalkost“ vorgewählt, auf Wunsch mit vorbelegtem Nachnamen. */
export function leereZeile(nachname?: string): RegistrierZeile {
  return nachname ? { name: nachname, kostform: 'normal' } : { kostform: 'normal' };
}

function text(s: string | null | undefined): string | undefined {
  const t = s?.trim();
  return t ? t : undefined;
}

/**
 * Der Body aus der Maske: Herkunftsadresse und Kontakt des Haushalts an jede Person (design.md
 * D3), leere Angaben fehlen, das Geburtsdatum als `YYYY-MM-DD`. Die Maske hat die Felder schon
 * geprüft; ein unlesbares Datum fehlt hier, statt geraten zu werden.
 */
export function registrierBody(
  werte: RegistrierWerte,
  heute: string,
  haushaltId?: number,
): RegistrierungEingabe {
  const herkunft = text(werte.herkunft_adresse);
  const kontakt = text(werte.kontakt);
  const personen = werte.personen.map((z) => {
    const datum = z.geburtsdatum ? parseKalenderdatum(z.geburtsdatum, heute) : null;
    const geburtsdatum = datum?.ok ? (datum.datum ?? undefined) : undefined;
    const vorname = text(z.vorname);
    const unvertraeglichkeiten = text(z.unvertraeglichkeiten);
    return {
      name: text(z.name) ?? '',
      ...(vorname ? { vorname } : {}),
      ...(geburtsdatum ? { geburtsdatum } : {}),
      ...(z.geschlecht ? { geschlecht: z.geschlecht } : {}),
      ...(herkunft ? { herkunft_adresse: herkunft } : {}),
      ...(kontakt ? { kontakt } : {}),
      kostform: z.kostform,
      ...(unvertraeglichkeiten ? { unvertraeglichkeiten } : {}),
    };
  });
  return { ...(haushaltId != null ? { haushalt_id: haushaltId } : {}), personen };
}

/**
 * Unverträglichkeiten ohne Sonderkost: die Maske fragt „Diät/allergenarm wählen?“ (design.md D4).
 * Eine Unverträglichkeit setzt die Kostform nie von selbst.
 */
export function isDiaetHinweis(z: Pick<RegistrierZeile, 'unvertraeglichkeiten' | 'kostform'>) {
  return z.kostform === 'normal' && text(z.unvertraeglichkeiten) != null;
}

export type KostformBand = Record<PersonKostform | 'ohne_angabe', number>;

/** Alle hier registrierten Personen der Liste, Haushalte und Personen ohne Haushalt. */
export function allePersonen(liste: RegistrierListe): RegistriertePerson[] {
  return [...liste.haushalte.flatMap((h) => h.personen), ...liste.ohne_haushalt];
}

/**
 * Das Band „Kostformen“ einer Stelle (design.md D7): je Kostform und „ohne Angabe“, nur aus der
 * geladenen Liste der Stelle. Vorgemerkte Haushalte zählen nicht (der Server kennt sie noch nicht).
 */
export function kostformBand(liste: RegistrierListe): KostformBand {
  const band = Object.fromEntries(
    [...KOSTFORM_REIHE, 'ohne_angabe'].map((k) => [k, 0]),
  ) as KostformBand;
  for (const p of allePersonen(liste)) band[p.kostform ?? 'ohne_angabe'] += 1;
  return band;
}

/** „H-7“. */
export function haushaltKennung(nummer: number): string {
  return `H-${nummer}`;
}

/** „Weber, Anna“; ohne Namen ausdrücklich, nie leer. */
export function personName(p: { name?: string | null; vorname?: string | null }): string {
  const teile = [text(p.name), text(p.vorname)].filter(Boolean);
  return teile.length > 0 ? teile.join(', ') : 'ohne Namen';
}

/** Volle Jahre zwischen zwei Kalendertagen `YYYY-MM-DD`. */
function jahreZwischen(geboren: string, heute: string): number | null {
  const g = /^(\d{4})-(\d{2})-(\d{2})$/.exec(geboren);
  const h = /^(\d{4})-(\d{2})-(\d{2})$/.exec(heute);
  if (!g || !h) return null;
  const jahre = Number(h[1]) - Number(g[1]);
  const vorGeburtstag = h[2] < g[2] || (h[2] === g[2] && h[3] < g[3]);
  return vorGeburtstag ? jahre - 1 : jahre;
}

/**
 * „10.11.1985 (40)“ aus dem Geburtsdatum am Tag der Anzeigezone, sonst „ca. 4 J.“ aus dem
 * geschätzten Alter, sonst leer. Ein Altbestand im freien Format steht roh, ohne Alter.
 */
export function alterText(
  p: Pick<RegistriertePerson, 'geburtsdatum' | 'alter_geschaetzt'>,
  heute: string,
): string {
  if (p.geburtsdatum) {
    const jahre = jahreZwischen(p.geburtsdatum, heute);
    const datum = formatKalenderdatum(p.geburtsdatum);
    return jahre != null && jahre >= 0 ? `${datum} (${jahre})` : datum;
  }
  if (p.alter_geschaetzt != null) return `ca. ${p.alter_geschaetzt} J.`;
  return '';
}
