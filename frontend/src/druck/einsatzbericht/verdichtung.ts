import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type {
  BetreuungUebersicht,
  Einheit,
  EinheitPerioden,
  EinsatzAnzeige,
  EinsatzPersonal,
  Einsatzperiode,
  EtbEintragAnzeige,
  EtbZaehler,
  LageberichtAnzeige,
  Lagebesprechung,
  MitgliedAnzeige,
  Person,
  PersonPerioden,
  Schaden,
  Stab,
  Verpflegung,
} from '../../api/types';
import { inZone, taktischeDtgVoll, type AnzeigeKonventionen } from '../../anzeige/format';
import { staerkeText, summiereStaerke } from '../../anzeige/staerke';
import { evakuierungKennzahl } from '../../betreuung/evakuierungKennzahl';
import { einsatzDauer } from '../../einsatz/einsatzDauer';
import { EINSATZART_LABELS } from '../../einsatz/einsatzart';
import { typBilanz } from '../../etb/zeitachseModell';
import { besetzungAusStab } from '../../fuehrung/funktionsOptionenKern';
import { dauerText, kraftDauern } from '../../kraefte/zeitachse';
import { kettenKoepfe } from '../../lageberichte/ketten';
import { vorlage } from '../../lageberichte/vorlagen';
import {
  SICHTUNGSBILD_REIHE,
  sichtungsbild,
  transportBilanz,
  verbleibZaehlung,
} from '../../personen/personenBilanz';
import { SACHGEBIETE } from '../../stab/sachgebiete';
import {
  etbTyp,
  personStatus,
  schadenAusmass,
  schadenStatus,
  sichtung,
} from '../../theme/statusFarben';
import type { BerichtQuellen, EinsatzberichtRoh, QuellenErgebnis } from './abruf';
import { BLOECKE, STANDARDUMFANG, ordneAuswahl, type BlockSchluessel } from './auswahl';

dayjs.extend(utc);

/**
 * Verdichtung des Einsatzberichts (LFH-726, design.md D5): aus den Rohdaten der Quellen ein
 * Objekt, das die Darstellung nur noch abbildet.
 *
 * **Kein Personenbezug Betroffener** (Spec „Keine personenbezogenen Daten Betroffener“): aus
 * Personen und Schäden gelangen nur Zählungen hierher, nie Name, Vorname, Geburtsdatum,
 * Registriernummer oder Angaben zu Geschädigten. Die Darstellung bekommt nur dieses Objekt und
 * kann deshalb nichts davon zeigen. Freitext (Lagebericht, ETB-Entscheidung) steht, wie ihn die
 * Führung geschrieben hat (design.md, Risiken).
 *
 * **Keine erfundenen Zahlen:** ein lesbarer, leerer Bestand sagt „keine Einträge“, ein im Einsatz
 * ausgeblendetes Modul „In diesem Einsatz nicht genutzt“, eine Kraft ohne Zeitachse geht nicht
 * mit 0 in die Helferstunden ein.
 *
 * Aufgerufen wird nur, wenn jede Quelle `daten` oder `nicht-genutzt` ist (`berichtZustand`).
 */

export const KEINE_EINTRAEGE = 'keine Einträge';
export const NICHT_GENUTZT = 'In diesem Einsatz nicht genutzt';
const KEINE_ZEITACHSE = 'keine Zeitachse erfasst';
const LEER = '—';

export interface Zeile {
  etikett: string;
  wert: string;
}

export type Inhalt =
  | { art: 'zeilen'; zeilen: Zeile[] }
  | { art: 'tabelle'; kopf: string[]; zeilen: string[][] }
  | { art: 'vermerk'; text: string }
  | { art: 'markdown'; abschnitte: { titel: string; text: string }[] };

export interface Abschnitt {
  /** Fehlt bei Blöcken mit genau einem Abschnitt (Stammdaten, Zeiten). */
  titel?: string;
  inhalt: Inhalt[];
}

export interface Block {
  schluessel: BlockSchluessel;
  titel: string;
  abschnitte: Abschnitt[];
}

export interface Einsatzbericht {
  /** Der Einsatz läuft: Kopf und Zeiten tragen den Vorläufig-Vermerk. */
  vorlaeufig: boolean;
  /** Stand des Schnappschusses, taktische DTG in der Zone der Organisation. */
  stand: string;
  bloecke: Block[];
}

// ── Hilfen ─────────────────────────────────────────────────────────────────────────

/** Die Daten einer Quelle oder `null` für „nicht genutzt“. Andere Zustände sind ein Aufruffehler. */
function daten<T>(q: QuellenErgebnis<T>): T | null {
  if (q.zustand === 'daten') return q.daten;
  if (q.zustand === 'nicht-genutzt') return null;
  throw new Error(`Einsatzbericht: Quelle im Zustand ${q.zustand} verdichtet`);
}

const zeilen = (z: Zeile[]): Inhalt => ({ art: 'zeilen', zeilen: z });
const vermerk = (text: string): Inhalt => ({ art: 'vermerk', text });
const textOder = (s: string | null | undefined): string => (s && s.trim() ? s : LEER);
const zahl = (n: number): string => String(n);

/**
 * Zeitangabe im Berichtstext wie im ETB-Druck („29.03.2026 01:30“, Zone der Organisation): der
 * Bericht geht auch an Behörden. Die taktische DTG trägt nur der Stand im Druckkopf.
 */
function zeit(wire: string | null | undefined, konv: AnzeigeKonventionen): string {
  if (!wire) return LEER;
  return inZone(wire, konv).format('DD.MM.YYYY HH:mm');
}

/** Ein Abschnitt, dessen Quelle ausgeblendet ist oder leer: dann nur der Vermerk. */
function abschnittAus<T>(
  titel: string | undefined,
  quelle: T | null,
  leer: (d: T) => boolean,
  bauen: (d: T) => Inhalt[],
): Abschnitt {
  if (quelle == null) return { titel, inhalt: [vermerk(NICHT_GENUTZT)] };
  if (leer(quelle)) return { titel, inhalt: [vermerk(KEINE_EINTRAEGE)] };
  return { titel, inhalt: bauen(quelle) };
}

// ── Blöcke ─────────────────────────────────────────────────────────────────────────

function stammdaten(e: EinsatzAnzeige): Abschnitt[] {
  return [
    {
      inhalt: [
        zeilen([
          { etikett: 'Bezeichnung', wert: e.bezeichnung },
          { etikett: 'Einsatznummer', wert: textOder(e.einsatznummer_intern) },
          { etikett: 'Leitstellennummer', wert: textOder(e.leitstellen_nr) },
          { etikett: 'Einsatzart', wert: EINSATZART_LABELS[e.einsatzart] ?? e.einsatzart },
          { etikett: 'Stichwort', wert: textOder(e.stichwort) },
          { etikett: 'Einsatzort', wert: textOder(e.einsatzort) },
          { etikett: 'Meldende Stelle', wert: textOder(e.meldende_stelle) },
          { etikett: 'Sachverhalt', wert: textOder(e.sachverhalt) },
        ]),
      ],
    },
  ];
}

function zeiten(e: EinsatzAnzeige, standMs: number, konv: AnzeigeKonventionen): Abschnitt[] {
  const laeuft = e.status === 'aktiv';
  const ende = laeuft ? null : (e.abgeschlossen_at ?? null);
  const dauer = einsatzDauer(e.begonnen_at, ende, standMs);
  return [
    {
      inhalt: [
        zeilen([
          { etikett: 'Beginn', wert: zeit(e.begonnen_at, konv) },
          { etikett: 'Ende', wert: laeuft ? 'läuft' : zeit(ende, konv) },
          {
            etikett: 'Dauer',
            wert: dauer == null ? LEER : laeuft ? `${dauer} (bis Stand)` : dauer,
          },
        ]),
      ],
    },
  ];
}

function fuehrung(
  mitglieder: MitgliedAnzeige[],
  stab: Stab | null,
  besprechungen: Lagebesprechung[] | null,
  konv: AnzeigeKonventionen,
): Abschnitt[] {
  const leitung = mitglieder.filter((m) => m.einsatz_rolle === 'einsatzleitung');
  const besetzung = besetzungAusStab(stab ?? undefined);
  return [
    abschnittAus(
      'Einsatzleitung',
      leitung,
      (l) => l.length === 0,
      (l) => [
        zeilen(
          l.map((m) => ({
            etikett: 'Einsatzleitung',
            wert: m.fuehrungsstelle_anzeige
              ? `${m.anzeigename} (${m.fuehrungsstelle_anzeige})`
              : m.anzeigename,
          })),
        ),
      ],
    ),
    abschnittAus(
      'Stab',
      stab,
      () => false,
      () => [
        zeilen(
          SACHGEBIETE.map((s) => ({
            etikett: s.kuerzel,
            wert: besetzung.get(s.sachgebiet) ?? 'nicht vergeben',
          })),
        ),
      ],
    ),
    abschnittAus(
      'Lagebesprechungen',
      besprechungen,
      (b) => b.length === 0,
      (b) => [
        {
          art: 'tabelle',
          kopf: ['Nr.', 'Zeit', 'Entschluss'],
          zeilen: [...b]
            .sort((x, y) => x.lfd_nr - y.lfd_nr)
            .map((x) => [zahl(x.lfd_nr), zeit(x.abgehalten_at, konv), x.entschluss]),
        },
      ],
    ),
  ];
}

/**
 * Helferstunden: Summe der Einsatzzeit aller Personen mit Periode (design.md D6 von LFH-726). EINE
 * Rechnung für den Block Kräfte und die Personal-Anlage (LFH-902): beide Zahlen stimmen überein.
 */
function helferMinuten(personalPerioden: readonly PersonPerioden[], bisMs: number): number {
  let minuten = 0;
  for (const p of personalPerioden) minuten += kraftDauern(p.perioden, bisMs).gesamtMinuten ?? 0;
  return minuten;
}

function kraefte(
  einheiten: Einheit[] | null,
  einheitenPerioden: EinheitPerioden[] | null,
  personal: unknown[] | null,
  personalPerioden: PersonPerioden[] | null,
  fahrzeuge: unknown[] | null,
  bisMs: number,
): Abschnitt[] {
  const jetzt: Zeile[] = [
    {
      etikett: 'Stärke',
      wert: einheiten == null ? NICHT_GENUTZT : staerkeText(summiereStaerke(einheiten)),
    },
    { etikett: 'Einheiten', wert: einheiten == null ? NICHT_GENUTZT : zahl(einheiten.length) },
    { etikett: 'Fahrzeuge', wert: fahrzeuge == null ? NICHT_GENUTZT : zahl(fahrzeuge.length) },
  ];

  const einheitenMit = einheitenPerioden?.filter((e) => e.perioden.length > 0).length ?? null;
  const personenMit = personalPerioden?.filter((p) => p.perioden.length > 0) ?? null;
  const minuten = helferMinuten(personenMit ?? [], bisMs);

  const insgesamt: Zeile[] = [
    {
      etikett: 'Einheiten',
      wert:
        einheitenMit == null
          ? NICHT_GENUTZT
          : einheitenMit === 0
            ? KEINE_ZEITACHSE
            : zahl(einheitenMit),
    },
    {
      etikett: 'Personen',
      wert:
        personenMit == null
          ? NICHT_GENUTZT
          : personenMit.length === 0
            ? KEINE_ZEITACHSE
            : zahl(personenMit.length),
    },
    {
      etikett: 'Helferstunden',
      wert:
        personenMit == null
          ? NICHT_GENUTZT
          : personenMit.length === 0
            ? KEINE_ZEITACHSE
            : dauerText(minuten),
    },
  ];
  const insgesamtInhalt: Inhalt[] = [zeilen(insgesamt)];
  if (personenMit != null && personal != null && personenMit.length > 0) {
    insgesamtInhalt.push(
      vermerk(`Zeitachse für ${personenMit.length} von ${personal.length} Personen erfasst`),
    );
  }
  return [
    { titel: 'Stärke zum Druckzeitpunkt', inhalt: [zeilen(jetzt)] },
    { titel: 'Insgesamt eingesetzt', inhalt: insgesamtInhalt },
  ];
}

/** Abschnitte eines Lageberichts in der Reihenfolge seiner Vorlage, leere ausgelassen. */
function lageberichtText(b: LageberichtAnzeige): { titel: string; text: string }[] {
  const defs = vorlage(b.vorlage)?.abschnitte ?? [];
  const nachSchluessel = new Map(b.abschnitte.map((a) => [a.schluessel, a.text]));
  const bekannt = defs
    .map((d) => ({ titel: d.label, text: nachSchluessel.get(d.schluessel) ?? '' }))
    .filter((a) => a.text.trim());
  const fremd = b.abschnitte
    .filter((a) => !defs.some((d) => d.schluessel === a.schluessel) && a.text.trim())
    .map((a) => ({ titel: a.schluessel, text: a.text }));
  return [...bekannt, ...fremd];
}

function lage(berichte: LageberichtAnzeige[] | null, konv: AnzeigeKonventionen): Abschnitt[] {
  if (berichte == null) return [{ inhalt: [vermerk(NICHT_GENUTZT)] }];
  // Erst filtern, dann Köpfe bilden: ein Entwurf v2 über einer freigegebenen v1 ließe sonst
  // die Kette mit dem Entwurf als Kopf aus dem Verzeichnis fallen (design.md D7).
  const freigegeben = berichte.filter((b) => b.status === 'freigegeben');
  const koepfe = kettenKoepfe(freigegeben)
    .map((k) => k.kopf)
    .sort((a, b) => a.zeitstand.localeCompare(b.zeitstand));
  if (koepfe.length === 0) return [{ inhalt: [vermerk(KEINE_EINTRAEGE)] }];
  const letzter = koepfe.reduce((a, b) =>
    (b.freigegeben_at ?? '') > (a.freigegeben_at ?? '') ? b : a,
  );
  return [
    {
      titel: 'Verzeichnis der Lageberichte',
      inhalt: [
        {
          art: 'tabelle',
          kopf: ['Zeitstand', 'Titel', 'Version', 'Freigegeben von'],
          zeilen: koepfe.map((b) => [
            zeit(b.zeitstand, konv),
            b.titel,
            `v${b.version}`,
            textOder(b.freigegeben_von_name),
          ]),
        },
      ],
    },
    {
      titel: `Letzter Lagebericht: ${letzter.titel}`,
      inhalt: [{ art: 'markdown', abschnitte: lageberichtText(letzter) }],
    },
  ];
}

function personenBilanz(personen: Person[]): Inhalt[] {
  const bild = sichtungsbild(personen);
  const transport = transportBilanz(personen);
  const status = { erfasst: 0, vermisst: 0, betroffen: 0, verstorben: 0, abgemeldet: 0 };
  for (const p of personen) status[p.status] += 1;
  const patienten = bild.je.sk1 + bild.je.sk2 + bild.je.sk3 + bild.je.sk4;
  // Je UHS ein Posten wäre ein Name der Einrichtung; im Bericht genügt die Art des Verbleibs.
  const verbleib = new Map<string, number>();
  for (const p of verbleibZaehlung(personen, () => undefined)) {
    const label = p.schluessel.startsWith('uhs:') ? 'Unfallhilfsstelle' : p.label;
    verbleib.set(label, (verbleib.get(label) ?? 0) + p.wert);
  }
  return [
    zeilen([
      { etikett: 'Erfasst', wert: zahl(personen.length) },
      { etikett: 'Patienten (SK I–IV)', wert: zahl(patienten) },
      ...SICHTUNGSBILD_REIHE.map((k) => ({
        etikett: k === 'ohne' ? 'ohne Sichtung' : sichtung[k].label,
        wert: zahl(bild.je[k]),
      })),
      { etikett: 'Transportiert', wert: zahl(transport.transportiert) },
    ]),
    zeilen(
      (Object.keys(status) as (keyof typeof status)[]).map((k) => ({
        etikett: personStatus[k].label,
        wert: zahl(status[k]),
      })),
    ),
    zeilen(
      [...verbleib].map(([etikett, n]) => ({ etikett: `Verbleib: ${etikett}`, wert: zahl(n) })),
    ),
  ];
}

function schadenBilanz(schaeden: Schaden[]): Inhalt[] {
  const status = { offen: 0, uebergeben: 0, abgeschlossen: 0 };
  const ausmass = { gering: 0, mittel: 0, gross: 0, katastrophal: 0 };
  for (const s of schaeden) {
    status[s.status] += 1;
    ausmass[s.ausmass] += 1;
  }
  return [
    zeilen([
      { etikett: 'Erfasst', wert: zahl(schaeden.length) },
      ...(Object.keys(status) as (keyof typeof status)[]).map((k) => ({
        etikett: schadenStatus[k].label,
        wert: zahl(status[k]),
      })),
    ]),
    zeilen(
      (Object.keys(ausmass) as (keyof typeof ausmass)[]).map((k) => ({
        etikett: schadenAusmass[k].label,
        wert: zahl(ausmass[k]),
      })),
    ),
  ];
}

function betreuungBilanz(b: BetreuungUebersicht): Inhalt[] {
  const evak = evakuierungKennzahl(b.bezirke);
  const stellen = b.stellen.filter((s) => !s.storniert_at);
  const kapazitaet = stellen.reduce((n, s) => n + (s.kapazitaet_personen ?? 0), 0);
  const belegt = stellen.reduce((n, s) => n + (s.belegung?.belegt ?? 0), 0);
  const evakZeilen: Zeile[] = evak
    ? [
        {
          etikett: 'Evakuiert',
          wert: `${evak.evakuiert == null ? LEER : zahl(evak.evakuiert)} von ${zahl(evak.geplant)} geplant${evak.geschaetzt ? ' (teils geschätzt)' : ''}`,
        },
        { etikett: 'Bezirke', wert: zahl(evak.bezirke) },
        { etikett: 'Bezirke ohne Standmeldung', wert: zahl(evak.ohneMeldung) },
      ]
    : [{ etikett: 'Evakuierung', wert: 'kein Bezirk' }];
  return [
    zeilen([
      ...evakZeilen,
      { etikett: 'Betreuungsstellen', wert: zahl(stellen.length) },
      {
        etikett: 'Belegt',
        wert: kapazitaet > 0 ? `${zahl(belegt)} von ${zahl(kapazitaet)} Plätzen` : zahl(belegt),
      },
    ]),
  ];
}

function verpflegungBilanz(v: Verpflegung): Inhalt[] {
  const summe = (f: (z: Verpflegung['zeitfenster'][number]) => number) =>
    v.zeitfenster.reduce((n, z) => n + f(z), 0);
  return [
    zeilen([
      { etikett: 'Zeitfenster', wert: zahl(v.zeitfenster.length) },
      { etikett: 'Bedarf (Portionen)', wert: zahl(summe((z) => z.bedarf.gesamt)) },
      { etikett: 'Ausgegeben', wert: zahl(summe((z) => z.ausgegeben.gesamt)) },
      { etikett: 'Fehlmenge', wert: zahl(summe((z) => z.fehlmenge.gesamt)) },
    ]),
  ];
}

function etbAuszug(
  zaehler: EtbZaehler | null,
  entscheidungen: { eintraege: EtbEintragAnzeige[]; berichtigungen: EtbEintragAnzeige[] } | null,
  konv: AnzeigeKonventionen,
): Abschnitt[] {
  return [
    abschnittAus(
      'Einträge je Typ',
      zaehler,
      (z) => z.gesamt === 0,
      (z) => [
        zeilen([
          { etikett: 'Gesamt', wert: zahl(z.gesamt) },
          ...typBilanz(z.je_typ).map((b) => ({
            etikett: etbTyp[b.typ].label,
            wert: zahl(b.anzahl),
          })),
        ]),
      ],
    ),
    abschnittAus(
      'Entscheidungen',
      entscheidungen,
      (e) => e.eintraege.length === 0,
      (e) => {
        const alle = [...e.eintraege, ...e.berichtigungen];
        const berichtigtDurch = (id: number) =>
          alle
            .filter((x) => x.typ === 'berichtigung' && x.berichtigt_eintrag_id === id)
            .map((x) => x.lfd_nr)
            .sort((a, b) => a - b);
        return [
          {
            art: 'tabelle',
            kopf: ['Nr.', 'Zeit', 'Inhalt', 'Hinweis'],
            zeilen: [...e.eintraege]
              .sort((a, b) => a.lfd_nr - b.lfd_nr)
              .map((x) => {
                const durch = berichtigtDurch(x.id);
                return [
                  zahl(x.lfd_nr),
                  zeit(x.ereigniszeit, konv),
                  x.inhalt,
                  durch.length > 0 ? `berichtigt durch Nr. ${durch.join(', ')}` : '',
                ];
              }),
          },
        ];
      },
    ),
  ];
}

// ── Anlagen (LFH-902, design.md D5) ────────────────────────────────────────────────

const OHNE_ZEITACHSE = 'keine Zeitachse';

/** Beginn, Ende und Einsatzzeit einer Kraft aus ihren Perioden, als Tabellenzellen. */
function zeitenDerKraft(
  perioden: readonly Einsatzperiode[],
  bisMs: number,
  abgeschlossen: boolean,
  konv: AnzeigeKonventionen,
): [string, string, string] {
  const dauern = kraftDauern(perioden, bisMs);
  if (dauern.gesamtMinuten == null) return [LEER, LEER, OHNE_ZEITACHSE];
  const letzte = perioden[perioden.length - 1];
  // Offen in einem laufenden Einsatz heißt „läuft“; offen nach dem Abschluss hat niemand das Ende
  // erfasst — gezählt wird bis zum Abschluss, aber kein Ende behauptet.
  const ende = letzte.ende_at
    ? zeit(letzte.ende_at, konv)
    : abgeschlossen
      ? 'nicht erfasst'
      : 'läuft';
  return [zeit(perioden[0].beginn_at, konv), ende, dauerText(dauern.gesamtMinuten)];
}

/** Anzeigename einer Einheit: Name, der Funkrufname in Klammern, wenn er etwas hinzufügt. */
function einheitName(e: Einheit): string {
  return e.funkrufname && e.funkrufname !== e.name ? `${e.name} (${e.funkrufname})` : e.name;
}

function einheitenZeiten(
  einheiten: Einheit[] | null,
  einheitenPerioden: EinheitPerioden[] | null,
  bisMs: number,
  abgeschlossen: boolean,
  konv: AnzeigeKonventionen,
): Abschnitt[] {
  if (einheiten == null || einheitenPerioden == null) return [{ inhalt: [vermerk(NICHT_GENUTZT)] }];
  if (einheiten.length === 0) return [{ inhalt: [vermerk(KEINE_EINTRAEGE)] }];
  const perioden = new Map(einheitenPerioden.map((e) => [e.einheit_id, e.perioden]));
  const mit = einheiten
    .map((e) => ({ e, p: perioden.get(e.id) ?? [] }))
    .filter((x) => x.p.length > 0)
    .sort((a, b) => a.p[0].beginn_at.localeCompare(b.p[0].beginn_at));
  const ohne = einheiten.length - mit.length;
  const inhalt: Inhalt[] = [];
  if (mit.length > 0) {
    inhalt.push({
      art: 'tabelle',
      kopf: ['Einheit', 'Beginn', 'Ende', 'Einsatzzeit'],
      zeilen: mit.map(({ e, p }) => [
        einheitName(e),
        ...zeitenDerKraft(p, bisMs, abgeschlossen, konv),
      ]),
    });
  }
  // Ohne Zeitachse keine Zeile mit 0 (Spec „Anlage Einheiten mit Einsatzzeiten“), aber gezählt.
  if (ohne > 0) {
    inhalt.push(
      vermerk(`Für ${ohne} ${ohne === 1 ? 'Einheit' : 'Einheiten'} keine Zeitachse erfasst`),
    );
  }
  return [{ inhalt }];
}

/**
 * Personal je Kopf als Helfernachweis. **Feld-Whitelist:** aus `EinsatzPersonal` gelangen nur Name,
 * Funktion und die Zuordnung zur Einheit hierher; Bemerkung, Trägerorganisation, Stamm-Kennung und
 * Status nicht. Es sind Einsatzkräfte, nie Betroffene (Spec „Anlage Personal je Kopf“).
 */
function personalJeKopf(
  personal: EinsatzPersonal[] | null,
  personalPerioden: PersonPerioden[] | null,
  einheiten: Einheit[] | null,
  bisMs: number,
  abgeschlossen: boolean,
  konv: AnzeigeKonventionen,
): Abschnitt[] {
  if (personal == null || personalPerioden == null) return [{ inhalt: [vermerk(NICHT_GENUTZT)] }];
  if (personal.length === 0) return [{ inhalt: [vermerk(KEINE_EINTRAEGE)] }];
  const perioden = new Map(personalPerioden.map((p) => [p.personal_id, p.perioden]));
  const namen = new Map((einheiten ?? []).map((e) => [e.id, einheitName(e)]));
  const tabellenZeilen = personal
    .map((k) => ({
      name: k.name,
      funktion: textOder(k.funktion),
      einheit: k.einheit_id != null ? namen.get(k.einheit_id) : undefined,
      zeiten: zeitenDerKraft(perioden.get(k.id) ?? [], bisMs, abgeschlossen, konv),
    }))
    // Nach Einheit, dann Name; Kräfte ohne (lesbare) Einheit am Ende.
    .sort(
      (a, b) =>
        Number(a.einheit == null) - Number(b.einheit == null) ||
        (a.einheit ?? '').localeCompare(b.einheit ?? '', 'de') ||
        a.name.localeCompare(b.name, 'de'),
    )
    .map((z) => [z.name, z.funktion, z.einheit ?? LEER, ...z.zeiten]);
  const mitZeitachse = personalPerioden.filter((p) => p.perioden.length > 0);
  return [
    {
      inhalt: [
        {
          art: 'tabelle',
          kopf: ['Name', 'Funktion', 'Einheit', 'Beginn', 'Ende', 'Einsatzzeit'],
          zeilen: tabellenZeilen,
        },
        zeilen([
          { etikett: 'Personen', wert: zahl(personal.length) },
          {
            etikett: 'Helferstunden',
            wert:
              mitZeitachse.length === 0
                ? KEINE_ZEITACHSE
                : dauerText(helferMinuten(mitZeitachse, bisMs)),
          },
        ]),
      ],
    },
  ];
}

// ── Gesamt ─────────────────────────────────────────────────────────────────────────

/**
 * Baut die gewählten Blöcke in Druckreihenfolge (LFH-902). Ein abgewählter Block entsteht gar
 * nicht, und seine Quellen werden nicht gelesen — sie sind `nicht-gewaehlt` und nicht abgerufen.
 */
export function verdichteEinsatzbericht(
  roh: EinsatzberichtRoh,
  konv: AnzeigeKonventionen,
  auswahl: readonly BlockSchluessel[] = STANDARDUMFANG,
): Einsatzbericht {
  const q: BerichtQuellen = roh.quellen;
  const einsatz = daten(q.einsatz);
  if (!einsatz) throw new Error('Einsatzbericht: Einsatz fehlt');
  const standMs = Date.parse(roh.geladenAt);
  // Helferstunden zählen höchstens bis zum Abschluss (design.md D6). Wirestrings ohne Zone sind
  // UTC und werden ausdrücklich so gelesen (wie `einsatz/einsatzDauer.ts`).
  const abschluss = einsatz.abgeschlossen_at ? dayjs.utc(einsatz.abgeschlossen_at) : null;
  const bisMs = abschluss?.isValid() ? Math.min(standMs, abschluss.valueOf()) : standMs;
  const abgeschlossen = einsatz.status !== 'aktiv';

  const bauen: Record<BlockSchluessel, () => Abschnitt[]> = {
    stammdaten: () => stammdaten(einsatz),
    zeiten: () => zeiten(einsatz, standMs, konv),
    fuehrung: () =>
      fuehrung(daten(q.mitglieder) ?? [], daten(q.stab), daten(q.lagebesprechungen), konv),
    kraefte: () =>
      kraefte(
        daten(q.einheiten),
        daten(q.einheitenPerioden),
        daten(q.personal),
        daten(q.personalPerioden),
        daten(q.fahrzeuge),
        bisMs,
      ),
    lage: () => lage(daten(q.lageberichte), konv),
    bilanz: () => [
      abschnittAus('Personen', daten(q.personen), (p) => p.length === 0, personenBilanz),
      abschnittAus('Schäden', daten(q.schaeden), (s) => s.length === 0, schadenBilanz),
      abschnittAus(
        'Betreuung und Evakuierung',
        daten(q.betreuung),
        (b) => b.bezirke.length === 0 && b.stellen.length === 0,
        betreuungBilanz,
      ),
      abschnittAus(
        'Verpflegung',
        daten(q.verpflegung),
        (v) => v.zeitfenster.length === 0,
        verpflegungBilanz,
      ),
    ],
    etb: () => etbAuszug(daten(q.etbZaehler), daten(q.etbEntscheidungen), konv),
    'einheiten-zeiten': () =>
      einheitenZeiten(daten(q.einheiten), daten(q.einheitenPerioden), bisMs, abgeschlossen, konv),
    'personal-kopf': () =>
      personalJeKopf(
        daten(q.personal),
        daten(q.personalPerioden),
        daten(q.einheiten),
        bisMs,
        abgeschlossen,
        konv,
      ),
  };

  const gewaehlt = ordneAuswahl(auswahl);
  return {
    vorlaeufig: einsatz.status === 'aktiv',
    stand: taktischeDtgVoll(roh.geladenAt, konv),
    bloecke: BLOECKE.filter((b) => gewaehlt.includes(b.schluessel)).map((b) => ({
      schluessel: b.schluessel,
      titel: b.titel,
      abschnitte: bauen[b.schluessel](),
    })),
  };
}
