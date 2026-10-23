/**
 * Tag aus der Vorlage (LLH-1058, Spec `kraefte-verpflegung`, „Tag aus der Vorlage anlegen“ und
 * „Tag aus der Vorlage in der Oberfläche“): der reine Kern der Seite `TagAusVorlage.tsx`.
 *
 * - Die Uhrzeiten des Verpflegungsplans legt der CLIENT auf den Kalendertag der Anzeigezone
 *   (`anzeige/uhrzeit.ts`); der Server prüft nur Tageslänge und „Beginn im Tag“. Endet eine
 *   Mahlzeit am Folgetag, gilt ihr Ende am nächsten Kalendertag.
 * - „Vorhanden“ heißt wie beim Server: ein Zeitfenster gleicher Bezeichnung (getrimmt, ohne
 *   Groß- und Kleinschreibung) beginnt an diesem Tag schon im Einsatz. Der Server überspringt es
 *   ohnehin; die Seite zeigt es vorher und schickt es nicht.
 * - Fällt eine Mahlzeit ganz in die Lücke der Vorstellung (29.03. 02:00–03:00 in Berlin), liegt
 *   ihr Ende nicht nach dem Beginn; sie ist nicht anlegbar, statt den ganzen Tag mit 422 scheitern
 *   zu lassen.
 *
 * Es entstehen gewöhnliche Zeitfenster ohne Bezug zur Vorlage; nichts schreibt sich fort.
 */
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { naechsterTag, tagesgrenzen, uhrzeitAmTag } from '../anzeige/uhrzeit';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import type { AnzeigeKonventionen } from '../anzeige/format';
import { kalendertag } from '../anzeige/zeitDarstellung';
import type {
  TagAusVorlageEingabe,
  VerpflegungTagErgebnis,
  VerpflegungVorlage,
  VerpflegungZeitfenster,
} from '../api/types';
import { zitat } from './verpflegungText';

dayjs.extend(utc);

/** Eine Mahlzeit des Plans, auf den gewählten Tag gelegt. */
export interface TagFenster {
  vorlage: VerpflegungVorlage;
  /** Beginn und Ende als Wire-Zeit (UTC ohne Zone). */
  von_at: string;
  bis_at: string;
  /** Das Ende liegt am nächsten Kalendertag (aus der Vorlage). */
  folgetag: boolean;
  /** Am Tag beginnt schon ein gleichnamiges Zeitfenster: wird übersprungen. */
  vorhanden: boolean;
  /** Das Ende liegt nicht nach dem Beginn, weil die Mahlzeit in die Zeitumstellung fällt. */
  zeitumstellung: boolean;
}

/** Bezeichnungen gleichen getrimmt und ohne Groß- und Kleinschreibung (wie der Server). */
export function isGleicheBezeichnung(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Wird das Fenster gesendet? Nicht, wenn es vorhanden ist oder in die Umstellung fällt. */
export function isAnlegbar(f: TagFenster): boolean {
  return !f.vorhanden && !f.zeitumstellung;
}

/**
 * Die aktiven Mahlzeiten des Plans als Fenster des Tages, in der Folge des Plans (nach Beginn).
 * `bestand` sind die Zeitfenster des Einsatzes.
 */
export function buildTagFenster(
  vorlagen: readonly VerpflegungVorlage[],
  tag: string,
  zone: string | null | undefined,
  bestand: readonly VerpflegungZeitfenster[],
): TagFenster[] {
  const { von: tagVon, bis: tagBis } = tagesgrenzen(tag, zone);
  const amTag = bestand.filter((zf) => {
    const beginn = dayjs.utc(zf.von_at).valueOf();
    return beginn >= tagVon.valueOf() && beginn < tagBis.valueOf();
  });
  return vorlagen
    .filter((v) => v.aktiv)
    .map((v) => {
      const von = uhrzeitAmTag(tag, v.beginn, zone);
      const bis = uhrzeitAmTag(v.folgetag ? naechsterTag(tag) : tag, v.ende, zone);
      return {
        vorlage: v,
        von_at: alsBackendZeit(von),
        bis_at: alsBackendZeit(bis),
        folgetag: v.folgetag,
        vorhanden: amTag.some((zf) => isGleicheBezeichnung(zf.bezeichnung, v.bezeichnung)),
        zeitumstellung: bis.valueOf() <= von.valueOf(),
      };
    });
}

/** Ein gewähltes Fenster mit dem Bedarf aus der Vorschau. */
export interface GewaehltesFenster {
  fenster: TagFenster;
  bedarf_kraefte: number;
  bedarf_betreute: number;
}

/**
 * Die Anfrage „Tag aus der Vorlage anlegen“: Tagesgrenzen der Anzeigezone und die gewählten
 * Fenster in der Folge des Plans. Ohne Stellen (die Zuordnung geschieht danach an der Karte),
 * ohne weitere Personen und Sonderkost (Vorgabe 0, nachzutragen über „Bedarf bearbeiten“).
 */
export function buildTagAusVorlageEingabe(
  tag: string,
  zone: string | null | undefined,
  gewaehlt: readonly GewaehltesFenster[],
): TagAusVorlageEingabe {
  const { von, bis } = tagesgrenzen(tag, zone);
  const folge = [...gewaehlt].sort((a, b) => a.fenster.von_at.localeCompare(b.fenster.von_at));
  return {
    tag_von_at: alsBackendZeit(von),
    tag_bis_at: alsBackendZeit(bis),
    zeitfenster: folge.map(({ fenster, bedarf_kraefte, bedarf_betreute }) => ({
      bezeichnung: fenster.vorlage.bezeichnung,
      von_at: fenster.von_at,
      bis_at: fenster.bis_at,
      bedarf_kraefte,
      bedarf_betreute,
      ...(fenster.vorlage.verpflegungsart
        ? { verpflegungsart: fenster.vorlage.verpflegungsart }
        : {}),
    })),
  };
}

/** Der Kalendertag in der Schreibweise des Formatkerns: „11okt26“ bzw. „11.10.26“ (LLH-1061). */
export function tagText(tag: string, konv: AnzeigeKonventionen): string {
  return kalendertag(tag, konv);
}

/** Rückmeldung nach dem Anlegen: Zahl und Tag, dazu jedes übersprungene Fenster. */
export function quittungText(
  ergebnis: VerpflegungTagErgebnis,
  tag: string,
  konv: AnzeigeKonventionen,
): string {
  const n = ergebnis.angelegt.length;
  const kopf =
    n === 0
      ? 'Kein Zeitfenster angelegt'
      : `${n} Zeitfenster für den ${tagText(tag, konv)} angelegt`;
  if (ergebnis.uebersprungen.length === 0) return kopf;
  return `${kopf} · am Tag schon vorhanden: ${ergebnis.uebersprungen.map(zitat).join(', ')}`;
}
