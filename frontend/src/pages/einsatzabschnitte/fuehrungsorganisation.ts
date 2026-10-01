import type { AbrufZustand } from '../../api/abrufZustand';
import type { Einheit, Einsatzabschnitt, Staerke, Stabsfunktion } from '../../api/types';
import { staerkeText, summiereStaerke } from '../../anzeige/staerke';
import { besetzungDarstellung } from '../../stab/besetzung';
import { md, ZUSTAND_GRUND } from '../../stab/funkplan';
import { SACHGEBIETE } from '../../stab/sachgebiete';
import { baueTzProps, type TzProps } from '../lagekarte/taktischesZeichen';
import { abschnittStaerken } from './abschnittStaerke';

/**
 * Die Führungsorganisation des Einsatzes (FwDV 100) als Organigramm — eine reine Ableitung aus
 * Abschnitten und Einheiten, ohne eigene Datenhaltung (LFH-626). Bildschirm, Druck und Lagebericht
 * lesen alle dieses eine Modell.
 *
 * - **Platzierung wie im Funkplan** (`stab/funkplan.ts:baueFunkplan`) und im Meldebild:
 *   Unterabschnitte unter ihren Abschnitt, Waisen an die Wurzel; oberste Einheiten unter ihren
 *   Abschnitt, Untereinheiten unter ihre Einheit; Einheiten ohne Abschnitt in den Sammelknoten.
 *   Dieselben Schlüssel (`ab-<id>`, `eh-<id>`, `sammel`), damit der Kommunikationsplan (LFH-625)
 *   seine Ebene auf diesen Baum setzen kann.
 * - **Stärke aus derselben Rechnung wie der Gliederungsbaum** (`abschnittStaerken`, LFH-550). Die
 *   Wurzel „Einsatzleitung“ gehört nicht ins Modell: sie trägt keine Zahl, die Einsatzstärke hat
 *   ihre Heimat im Meldebild.
 *
 * Herleitung: `openspec/changes/archive/2026-10-01-lfh-626-fuehrungsorganisation-skizze/design.md` (D2, D4).
 */

interface KnotenBasis {
  key: string;
  /** Datenbank-ID — nur für Deeplinks, nie für die Anzeige. */
  id: number;
  name: string;
  /** Abschnitt: Kurzbezeichnung · Einheit: Funkrufname. Nie geraten. */
  rufname: string | null;
  /** Abschnitt: Abschnittsleiter · Einheit: Führer. */
  leitung: string | null;
  /** `null`: keine Einheit zugeordnet oder Einheiten nicht geladen — nie „0“. */
  staerke: Staerke | null;
  tz: TzProps;
  kinder: OrgKnoten[];
}

export type OrgKnoten =
  | (KnotenBasis & { art: 'abschnitt' })
  | (KnotenBasis & { art: 'einheit' })
  | { art: 'sammel'; key: 'sammel'; kinder: OrgKnoten[] };

export interface Fuehrungsorganisation {
  /** Oberste Abschnitte, danach „Ohne Abschnitt“ (nur, wenn es solche Einheiten gibt). */
  wurzeln: OrgKnoten[];
  /** Die Einheiten fehlen (gesperrt/nicht geladen): Abschnitte ohne Stärke, Hinweis an der Seite. */
  einheitenFehlen: boolean;
}

function gruppiere<T, K>(liste: readonly T[], schluessel: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of liste) {
    const k = schluessel(x);
    const bisher = m.get(k);
    if (bisher) bisher.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/**
 * @param einheiten `null`, wenn die Einheiten nicht vorliegen — ein fehlender Bestand ist kein
 *   leerer.
 */
export function baueFuehrungsorganisation(
  abschnitte: readonly Einsatzabschnitt[],
  einheiten: readonly Einheit[] | null,
): Fuehrungsorganisation {
  const einheitenFehlen = einheiten == null;
  const alleEinheiten = einheiten ?? [];
  // Zyklussicher: ein korrupter Ring hängt sonst endlos ab. Jeder Knoten höchstens einmal.
  const gesehen = new Set<string>();

  const einheitIds = new Set(alleEinheiten.map((e) => e.id));
  const istUntereinheit = (e: Einheit) =>
    e.ueber_einheit_id != null && einheitIds.has(e.ueber_einheit_id);
  const untereinheiten = gruppiere(
    alleEinheiten.filter(istUntereinheit),
    (e) => e.ueber_einheit_id!,
  );

  const einheitKnoten = (e: Einheit): OrgKnoten | null => {
    const key = `eh-${e.id}`;
    if (gesehen.has(key)) return null;
    gesehen.add(key);
    return {
      art: 'einheit',
      key,
      id: e.id,
      name: e.name,
      rufname: e.funkrufname ?? null,
      leitung: e.fuehrer_name ?? null,
      staerke: summiereStaerke([e]),
      tz: baueTzProps({
        objekttyp: 'einheit',
        einheitTypLabel: e.typ_label,
        fachaufgabe: e.tz_fachaufgabe,
        organisation: e.tz_organisation,
      }),
      kinder: knotenAus(untereinheiten.get(e.id) ?? [], einheitKnoten),
    };
  };

  const abschnittIds = new Set(abschnitte.map((a) => a.id));
  const istUnterabschnitt = (a: Einsatzabschnitt) =>
    a.ueber_abschnitt_id != null && abschnittIds.has(a.ueber_abschnitt_id);
  const unterabschnitte = gruppiere(
    abschnitte.filter(istUnterabschnitt),
    (a) => a.ueber_abschnitt_id!,
  );
  const obersteEinheiten = alleEinheiten.filter((e) => !istUntereinheit(e));
  const einheitenJeAbschnitt = gruppiere(
    obersteEinheiten.filter((e) => e.abschnitt_id != null && abschnittIds.has(e.abschnitt_id)),
    (e) => e.abschnitt_id!,
  );

  const abschnittKnoten = (a: Einsatzabschnitt): OrgKnoten | null => {
    const key = `ab-${a.id}`;
    if (gesehen.has(key)) return null;
    gesehen.add(key);
    return {
      art: 'abschnitt',
      key,
      id: a.id,
      name: a.name,
      rufname: a.kurzbezeichnung ?? null,
      leitung: a.leiter_name ?? null,
      // Derselbe Aufruf wie der Gliederungsbaum (`baueBaum`): inklusive aller Unterabschnitte.
      staerke: einheitenFehlen
        ? null
        : abschnittStaerken([...abschnitte], [...alleEinheiten], a.id).inklUnter,
      tz: baueTzProps({
        objekttyp: 'abschnitt',
        fachaufgabe: a.tz_fachaufgabe,
        organisation: a.tz_organisation,
      }),
      kinder: [
        ...knotenAus(unterabschnitte.get(a.id) ?? [], abschnittKnoten),
        ...knotenAus(einheitenJeAbschnitt.get(a.id) ?? [], einheitKnoten),
      ],
    };
  };

  const wurzeln = knotenAus(
    abschnitte.filter((a) => !istUnterabschnitt(a)),
    abschnittKnoten,
  );
  // Ein Ring aus Abschnitten hat keine Wurzel; seine Mitglieder kommen sonst nie vor.
  wurzeln.push(...knotenAus(abschnitte, abschnittKnoten));

  const heimatlos = knotenAus(
    obersteEinheiten.filter((e) => e.abschnitt_id == null || !abschnittIds.has(e.abschnitt_id)),
    einheitKnoten,
  );
  // Ebenso ein Ring aus Einheiten: an seinem Abschnitt bzw. im Sammelknoten nachtragen.
  for (const e of alleEinheiten) {
    if (gesehen.has(`eh-${e.id}`)) continue;
    const k = einheitKnoten(e);
    if (!k) continue;
    const heimat = e.abschnitt_id != null ? finde(wurzeln, `ab-${e.abschnitt_id}`) : undefined;
    (heimat ? heimat.kinder : heimatlos).push(k);
  }
  if (heimatlos.length > 0) wurzeln.push({ art: 'sammel', key: 'sammel', kinder: heimatlos });

  return { wurzeln, einheitenFehlen };
}

function knotenAus<T>(liste: readonly T[], bau: (x: T) => OrgKnoten | null): OrgKnoten[] {
  return liste.map(bau).filter((k): k is OrgKnoten => k != null);
}

function finde(knoten: readonly OrgKnoten[], key: string): OrgKnoten | undefined {
  for (const k of knoten) {
    if (k.key === key) return k;
    const t = finde(k.kinder, key);
    if (t) return t;
  }
  return undefined;
}

/** Schlüssel aller Knoten mit Kindern — „Alle zuklappen“ und der Druck klappen hierüber. */
export function klappbareSchluessel(knoten: readonly OrgKnoten[]): string[] {
  return knoten.flatMap((k) =>
    k.kinder.length > 0 ? [k.key, ...klappbareSchluessel(k.kinder)] : [],
  );
}

// ── Markdown für den Lagebericht (D8) ──────────────────────────────────────────────────────────

/** Der Stab in S-Folge mit dem Wortlaut der Stabseite; unbesetzte Sachgebiete fehlen. */
export function stabZeilen(
  besetzung: readonly Stabsfunktion[],
): { kuerzel: string; text: string }[] {
  return SACHGEBIETE.flatMap((s) => {
    const zeile = besetzung.find((b) => b.sachgebiet === s.sachgebiet);
    return zeile ? [{ kuerzel: s.kuerzel, text: besetzungDarstellung(zeile).label }] : [];
  });
}

function knotenMarkdown(k: OrgKnoten, tiefe: number): string[] {
  const einzug = '  '.repeat(tiefe);
  const kopf =
    k.art === 'sammel'
      ? `${einzug}- Ohne Abschnitt`
      : `${einzug}- ${[
          `**${md(k.name)}**`,
          k.rufname != null ? `Rufname ${md(k.rufname)}` : 'kein Rufname',
          k.leitung != null ? `Leitung ${md(k.leitung)}` : 'Leitung nicht besetzt',
          `Stärke ${staerkeText(k.staerke)}`,
        ].join(' · ')}`;
  return [kopf, ...k.kinder.flatMap((c) => knotenMarkdown(c, tiefe + 1))];
}

/**
 * Die Führungsorganisation als Freitext für „In Lagebericht übernehmen“: Kopf, Einsatzleitung
 * (mit Stab nur, wenn übergeben — also freigegeben und geladen), fehlende Quellen, dann die
 * Gliederung als verschachtelte Liste. Namen laufen durch `md()`: im Bericht stehen sie als Text,
 * nie als Auszeichnung. Erreichbarkeit führt das Organigramm nicht, also auch nicht hier.
 */
export function rendereFuehrungsorganisationMarkdown(
  org: Fuehrungsorganisation,
  opts: {
    stand: string;
    /** `null`: nicht freigegeben (kein Wort darüber) · `'fehler'`: Abruf gescheitert. */
    stab: readonly Stabsfunktion[] | 'fehler' | null;
    einheitenZustand: AbrufZustand;
  },
): string {
  const stab =
    opts.stab == null
      ? []
      : opts.stab === 'fehler'
        ? ['- Stab: Besetzung nicht geladen']
        : [
            `- Stab: ${
              opts.stab.length === 0 || stabZeilen(opts.stab).length === 0
                ? 'kein Sachgebiet besetzt'
                : stabZeilen(opts.stab)
                    .map((z) => `${z.kuerzel} ${md(z.text)}`)
                    .join(' · ')
            }`,
          ];
  // Der Bericht geht bei Freigabe unveränderlich ins ETB: was fehlt, steht darin.
  const quellen =
    opts.einheitenZustand !== 'daten'
      ? [
          '## Quellen',
          '',
          `- Einheiten: ${ZUSTAND_GRUND[opts.einheitenZustand]} — Einheiten und Stärken fehlen`,
          '',
        ]
      : [];
  const gliederung =
    org.wurzeln.length > 0
      ? org.wurzeln.flatMap((k) => knotenMarkdown(k, 0))
      : ['_(keine Abschnitte und keine Einheiten erfasst)_'];
  return [
    '# Führungsorganisation',
    '',
    `**Stand:** ${opts.stand}`,
    '',
    '## Einsatzleitung',
    '',
    // LFH-849: die eigene Führungsstelle ist kein Datum.
    '- Leitung nicht erfasst',
    ...stab,
    '',
    ...quellen,
    '## Gliederung',
    '',
    ...gliederung,
    '',
  ].join('\n');
}
