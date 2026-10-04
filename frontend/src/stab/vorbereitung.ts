import type { AbrufZustand } from '../api/abrufZustand';
import type { ModulZaehler, Stab } from '../api/types';
import {
  DEFAULT_KONVENTIONEN,
  formatUhrzeitMitTag,
  type AnzeigeKonventionen,
} from '../anzeige/format';
import { modulZuRoute } from '../einsatz/modulRegistry';
import {
  NICHT_FREIGEGEBEN,
  auftraegeNotiz,
  meldungenNotiz,
  type Zaehlstand,
} from '../pages/lage-dashboard/fuehrungsZahlen';
import type { KennzahlEtikett, Lagebild } from '../pages/lage-dashboard/lagebild';
import { SK_WORT } from '../personen/personMeta';
import { sichtung as SK_META, warnstufeKennzahl } from '../theme/statusFarben';
import { md, ZUSTAND_GRUND } from './funkplan';

/**
 * Vorbereitung der Lagebesprechung (LFH-550; FwDV 100 Anl. 2: S2 bereitet vor).
 *
 * **Keine eigene Zahl.** Jede Angabe liest aus dem Lagebild, das auch das Lage-Dashboard zeigt
 * (`useLagebild` + `baueLagebild`), bzw. aus dem Modulzähler (`fuehrungsZahlen.ts`). Diese Datei
 * formatiert nur.
 *
 * **Kein Vortragsschema.** Die Reihenfolge folgt dem Dashboard (Kennzahlenband, dann
 * Führungsstand), nicht einer Sachgebiets- oder Lehrmeinungsfolge (LFH-46 §2.3). Keine Zeile
 * gehört einem Sprecher. Jede nennt ihre Quelle (Modulname aus der Registry).
 *
 * **Nichts wird eingefroren.** Ein fester Stand entsteht nur durch die Übernahme in einen
 * Lagebericht (`vorbereitungMarkdown`).
 */

type AuftragsZaehler = NonNullable<ModulZaehler['auftraege']>;
type MeldungsZaehler = NonNullable<ModulZaehler['meldungen']>;

export interface VorbereitungsZeile {
  schluessel: string;
  titel: string;
  /** Der Wert; „—", wenn die Quelle fehlt (nie 0). */
  wert: string;
  notiz: string | null;
  /** Modulname der Quelle, wie ihn Navigation und Palette zeigen. */
  quelle: string;
  zustand: AbrufZustand;
}

export interface VorbereitungsQuellen {
  /** `null`, solange der Einsatz fehlt. */
  lagebild: Lagebild | null;
  zustand: {
    personen: AbrufZustand;
    kraefte: AbrufZustand;
    gefahren: AbrufZustand;
    lageberichte: AbrufZustand;
    stab: AbrufZustand;
  };
  auftraege: Zaehlstand<AuftragsZaehler>;
  meldungen: Zaehlstand<MeldungsZaehler>;
  stab: Stab | undefined;
}

/** Name des Quellmoduls aus der Registry — kein zweiter Wortlaut. */
function quelle(route: string): string {
  return modulZuRoute(route)?.label ?? route;
}

function fehlt(
  zustand: Exclude<AbrufZustand, 'daten'>,
): Pick<VorbereitungsZeile, 'wert' | 'notiz'> {
  return { wert: '—', notiz: ZUSTAND_GRUND[zustand] };
}

/** Wert und Notiz einer Kennzahl des Lagebilds, wie Dashboard und Vorbereitung sie zeigen. */
export function ausKennzahl(
  lagebild: Lagebild,
  etikett: KennzahlEtikett,
): Pick<VorbereitungsZeile, 'wert' | 'notiz'> {
  const k = lagebild.kennzahlen.find((x) => x.etikett === etikett);
  // Kern-Kennzahlen stehen in jeder Reihe (LFH-640); fehlt eine, ist das ein Fehler der Reihe.
  if (!k) return { wert: '—', notiz: null };
  return { wert: k.einheit ? `${k.wert} ${k.einheit}` : k.wert, notiz: k.notiz || null };
}

/** Die Sichtung im Wortlaut der Vorbereitung (auch Lagevortrag, LFH-869). */
export function sichtungText(sk: Lagebild['sk']): string {
  const teile = (['sk1', 'sk2', 'sk3', 'sk4'] as const).map((k) => `${SK_META[k].label} ${sk[k]}`);
  if (sk.tot > 0) teile.push(`${SK_META.tot.label} ${sk.tot}`);
  if (sk.unverletzt > 0) teile.push(`${SK_META.unverletzt.label} ${sk.unverletzt}`);
  teile.push(`${SK_WORT.ohne} ${sk.ohne}`);
  return teile.join(' · ');
}

/** Höchste Warnstufe mit der Zahl der Gebiete (auch Lagevortrag, LFH-869). */
export function warnstufeAngabe(l: Lagebild): Pick<VorbereitungsZeile, 'wert' | 'notiz'> {
  return {
    wert: warnstufeKennzahl[l.hoechsteWarnstufe].label,
    notiz:
      l.gebieteMitWarnstufe === 1
        ? '1 Gebiet mit Warnstufe'
        : `${l.gebieteMitWarnstufe} Gebiete mit Warnstufe`,
  };
}

function ausZaehler<T>(
  stand: Zaehlstand<T>,
  wert: (z: T) => string,
  notiz: (z: T) => string,
): Pick<VorbereitungsZeile, 'wert' | 'notiz' | 'zustand'> {
  if (stand.zustand === 'daten') {
    return { wert: wert(stand.zahl), notiz: notiz(stand.zahl), zustand: 'daten' };
  }
  const f = fehlt(stand.zustand);
  return {
    ...f,
    notiz: stand.zustand === 'gesperrt' ? NICHT_FREIGEGEBEN : f.notiz,
    zustand: stand.zustand,
  };
}

/**
 * Die Zeilen der Vorbereitung in fester Reihenfolge. Rein. Fehlt eine Quelle, trägt ihre Zeile
 * „—" mit Grund; die übrigen bleiben lesbar.
 */
export function vorbereitungsZeilen(
  q: VorbereitungsQuellen,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): VorbereitungsZeile[] {
  const lb = q.lagebild;
  const zeile = (
    schluessel: string,
    titel: string,
    route: string,
    zustand: AbrufZustand,
    daten: (lagebild: Lagebild) => Pick<VorbereitungsZeile, 'wert' | 'notiz'>,
  ): VorbereitungsZeile => {
    const z: AbrufZustand = lb ? zustand : 'laden';
    return {
      schluessel,
      titel,
      quelle: quelle(route),
      zustand: z,
      ...(z === 'daten' && lb ? daten(lb) : fehlt(z as Exclude<AbrufZustand, 'daten'>)),
    };
  };

  const auftraege = ausZaehler(q.auftraege, (z) => String(z.offen), auftraegeNotiz);
  const meldungen = ausZaehler(q.meldungen, (z) => String(z.offen), meldungenNotiz);
  const letzte = q.stab?.letzte_lagebesprechung;

  return [
    zeile('betroffene', 'Betroffene', 'personen', q.zustand.personen, (l) =>
      ausKennzahl(l, 'Betroffene'),
    ),
    zeile('vermisste', 'Vermisste', 'personen', q.zustand.personen, (l) =>
      ausKennzahl(l, 'Vermisste'),
    ),
    zeile('sichtung', 'Sichtung', 'personen', q.zustand.personen, (l) => ({
      wert: sichtungText(l.sk),
      notiz: null,
    })),
    zeile('kraefte', 'Kräfte', 'kraefteuebersicht', q.zustand.kraefte, (l) =>
      ausKennzahl(l, 'Kräfte'),
    ),
    zeile('warnstufe', 'Höchste Warnstufe', 'gefahren', q.zustand.gefahren, warnstufeAngabe),
    {
      schluessel: 'auftraege',
      titel: 'Aufträge offen',
      quelle: quelle('auftraege'),
      ...(lb ? auftraege : { ...fehlt('laden'), zustand: 'laden' as const }),
    },
    {
      schluessel: 'meldungen',
      titel: 'Meldungen offen',
      quelle: quelle('meldungen'),
      ...(lb ? meldungen : { ...fehlt('laden'), zustand: 'laden' as const }),
    },
    zeile('lagebericht', 'Letzter Lagebericht', 'lageberichte', q.zustand.lageberichte, (l) =>
      l.fuehrung.bericht
        ? {
            wert: formatUhrzeitMitTag(l.fuehrung.bericht.stand, konv),
            notiz: `${l.fuehrung.bericht.statusLabel} · ${l.fuehrung.bericht.titel}`,
          }
        : { wert: 'keiner', notiz: 'noch nicht erstellt' },
    ),
    zeile('besprechung', 'Letzte Lagebesprechung', 'stab', q.zustand.stab, () =>
      letzte
        ? {
            wert: `Nr. ${letzte.lfd_nr}`,
            notiz: `abgehalten ${formatUhrzeitMitTag(letzte.abgehalten_at, konv)}`,
          }
        : { wert: 'keine', notiz: 'noch keine abgehalten' },
    ),
    zeile('termin', 'Nächster Termin', 'stab', q.zustand.stab, () => ({
      wert: q.stab?.naechste_lagebesprechung_at
        ? formatUhrzeitMitTag(q.stab.naechste_lagebesprechung_at, konv)
        : 'kein Termin',
      notiz: null,
    })),
  ];
}

/** Zustand der Übernahme: sie wartet, bis keine Quelle mehr lädt. */
export function quellenLaden(zeilen: readonly VorbereitungsZeile[]): boolean {
  return zeilen.some((z) => z.zustand === 'laden');
}

/**
 * Der Lagestand als Freitext für einen Lagebericht. Stand in der Kopfzeile, Quelle je Zeile,
 * fehlende Quellen mit Grund, Herkunft in der Fußzeile. Namen und Titel maskiert (`md`). Rein.
 */
export function vorbereitungMarkdown(zeilen: readonly VorbereitungsZeile[], stand: string): string {
  return [
    '# Vorbereitung Lagebesprechung',
    '',
    `**Stand:** ${stand}`,
    '',
    ...zeilen.map((z) => {
      const notiz = z.notiz ? ` (${md(z.notiz)})` : '';
      return `- **${z.titel}:** ${md(z.wert)}${notiz} — Quelle: ${z.quelle}`;
    }),
    '',
    '_Zusammengestellt aus den Modulen des Einsatzes; keine Vortragsgliederung._',
    '',
  ].join('\n');
}
