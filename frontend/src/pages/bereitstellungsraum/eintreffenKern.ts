/**
 * Reine Logik des Dialogs „Eintreffen buchen“ (LLH-1075 Teil II, design.md
 * D9, D13, D14): Kandidatengruppen „Erwartet“ und „Im Einsatz“, Suche über
 * Name, Typ und Funkrufnamen, Doppelbuchungs-Hinweis und die Request-Körper.
 * Teil III: ohne Netz vorgemerkte Buchungen (Offline-Queue) kennt der Server
 * noch nicht; sie gelten weder als frei buchbar noch als Kraft im Einsatz.
 */
import type {
  Einheit,
  EinheitPerioden,
  EinsatzFahrzeug,
  EintreffenEingabe,
  Staerke,
} from '../../api/types';
import { abschnittDerEinheit, COLLATOR } from '../../kraefte/kraeftebaumKern';

/** Ein buchbarer Treffer der Suche. */
export interface EintreffenTreffer {
  art: 'einheit' | 'fahrzeug';
  id: number;
  name: string;
  /** Funkrufnamen der Fahrzeuge einer Einheit (Suche und Anzeige). */
  funkrufnamen: string[];
  typ: string | null;
  abschnitt: string | null;
  /** Beginn der offenen Periode, wenn sie mit einer Alarmierung begann. */
  alarmiertAt: string | null;
  /** Eintreffen in der offenen Periode. */
  eingetroffenAt: string | null;
  /** Erfassungszeitpunkt einer ohne Netz vorgemerkten Buchung dieser Kraft (Teil III). */
  vorgemerktAt: string | null;
}

export interface EintreffenGruppen {
  erwartet: EintreffenTreffer[];
  imEinsatz: EintreffenTreffer[];
}

export interface EintreffenGruppenEingabe {
  einheiten?: readonly Einheit[];
  fahrzeuge?: readonly EinsatzFahrzeug[];
  perioden?: readonly EinheitPerioden[];
  /** Kräfte, die der Detail-Cache schon im Raum kennt. */
  imRaum?: { einheiten: readonly number[]; fahrzeuge: readonly number[] };
  /** Ohne Netz vorgemerkte Buchungen dieses Geräts, noch nicht beim Server (Teil III). */
  vorgemerkt?: readonly EintreffenEingabe[];
  suche?: string;
}

// `objekt_typ` ist am Draht ein `string` (KraftAngabe).
const kraftSchluessel = (art: string, id: number) => `${art}-${id}`;

/** Vorgemerkte Buchungen bekannter Kräfte: Schlüssel → Erfassungszeitpunkt. */
function vorgemerkteKraefte(vorgemerkt: readonly EintreffenEingabe[] = []) {
  const je = new Map<string, string | null>();
  for (const v of vorgemerkt) {
    if (v.kraft) {
      je.set(kraftSchluessel(v.kraft.objekt_typ, v.kraft.objekt_id), v.zeitpunkt_at ?? null);
    }
  }
  return je;
}

/** Trimmt, vereinheitlicht Leerraum und faltet Groß/Klein (wie der Server). */
export function normalizeFunkrufname(wert: string): string {
  return wert.trim().split(/\s+/u).filter(Boolean).join(' ').toLocaleLowerCase('de');
}

function offenePeriode(p: EinheitPerioden | undefined) {
  return p?.perioden.find((x) => x.ende_at == null) ?? null;
}

function matches(
  treffer: EintreffenTreffer,
  weitere: readonly (string | null | undefined)[],
  suche: string,
) {
  if (!suche) return true;
  const felder = [treffer.name, treffer.typ, ...treffer.funkrufnamen, ...weitere];
  return felder.some((f) => f != null && normalizeFunkrufname(f).includes(suche));
}

/**
 * Teilt die Kräfte des Einsatzes in „Erwartet“ (ohne Abschnitt und ohne
 * Eintreffen in der offenen Periode, dazu einheitenlose Fahrzeuge) und
 * „Im Einsatz“. Kräfte in einem Raum fehlen, Fahrzeuge einer Einheit
 * erscheinen nur über ihre Einheit.
 */
export function buildEintreffenGruppen(e: EintreffenGruppenEingabe): EintreffenGruppen {
  const einheiten = e.einheiten ?? [];
  const suche = normalizeFunkrufname(e.suche ?? '');
  const imRaumE = new Set(e.imRaum?.einheiten ?? []);
  const imRaumF = new Set(e.imRaum?.fahrzeuge ?? []);
  const periodenJe = new Map((e.perioden ?? []).map((p) => [p.einheit_id, p]));
  const abschnittJe = abschnittDerEinheit(einheiten);
  const vorgemerktJe = vorgemerkteKraefte(e.vorgemerkt);
  const vorgemerktAt = (art: EintreffenTreffer['art'], id: number) =>
    vorgemerktJe.get(kraftSchluessel(art, id)) ?? null;

  const erwartet: EintreffenTreffer[] = [];
  const imEinsatz: EintreffenTreffer[] = [];

  for (const x of einheiten) {
    if (x.aufgeloest_at != null || x.aktueller_br_id != null || imRaumE.has(x.id)) continue;
    const offen = offenePeriode(periodenJe.get(x.id));
    const abschnitt = abschnittJe.get(x.id) ?? null;
    const t: EintreffenTreffer = {
      art: 'einheit',
      id: x.id,
      name: x.name,
      funkrufnamen: x.fahrzeug_mitglieder.map((m) => m.funkrufname),
      typ: x.typ_label ?? null,
      abschnitt: abschnitt ? (abschnitt.name ?? null) : null,
      alarmiertAt: offen?.anker === 'alarmierung' ? offen.beginn_at : null,
      eingetroffenAt: offen?.eintreffen_at ?? null,
      vorgemerktAt: vorgemerktAt('einheit', x.id),
    };
    if (!matches(t, [x.funkrufname], suche)) continue;
    (abschnitt == null && t.eingetroffenAt == null ? erwartet : imEinsatz).push(t);
  }

  for (const f of e.fahrzeuge ?? []) {
    if (f.beendet_at != null || f.einheit_id != null) continue;
    if (f.aktueller_br_id != null || imRaumF.has(f.id)) continue;
    const t: EintreffenTreffer = {
      art: 'fahrzeug',
      id: f.id,
      name: f.funkrufname,
      funkrufnamen: [],
      typ: f.fahrzeugtyp ?? null,
      abschnitt: null,
      alarmiertAt: null,
      eingetroffenAt: null,
      vorgemerktAt: vorgemerktAt('fahrzeug', f.id),
    };
    if (matches(t, [], suche)) erwartet.push(t);
  }

  const nachName = (a: EintreffenTreffer, b: EintreffenTreffer) => COLLATOR.compare(a.name, b.name);
  return { erwartet: erwartet.sort(nachName), imEinsatz: imEinsatz.sort(nachName) };
}

/** Kurze Hinweise eines Treffers: Vormerkung ohne Netz, Alarmierung, Abschnitt, Eintreffen. */
export function trefferHinweise(
  t: EintreffenTreffer,
  zeitpunkt: (wert: string) => string,
): string[] {
  const hinweise: string[] = [];
  if (t.vorgemerktAt) hinweise.push(`vorgemerkt ${zeitpunkt(t.vorgemerktAt)}`);
  if (t.alarmiertAt) hinweise.push(`alarmiert ${zeitpunkt(t.alarmiertAt)}`);
  if (t.abschnitt) hinweise.push(t.abschnitt);
  if (t.eingetroffenAt) hinweise.push(`eingetroffen ${zeitpunkt(t.eingetroffenAt)}`);
  return hinweise;
}

export interface Doppelbuchung {
  /** Name der gleichnamigen Kraft, wie sie im Einsatz heißt oder vorgemerkt ist. */
  name: string;
  /**
   * Der buchbare Treffer dazu; `null`, wenn die Kraft schon in einem Raum steht oder ihre Buchung
   * ohne Netz vorgemerkt ist (dann bucht „Diese buchen“ sie nicht ein zweites Mal).
   */
  treffer: EintreffenTreffer | null;
  /** Die Buchung dieser Kraft liegt noch in der Offline-Queue (Teil III). */
  vorgemerkt: boolean;
}

/**
 * Sucht eine aktive Kraft mit genau diesem Funkrufnamen (D9): Name oder
 * Funkrufname einer Einheit, Funkrufname eines Fahrzeugs. Ein Fahrzeug einer
 * Einheit verweist auf die Einheit. Ohne Netz (Teil III) zählen dazu die
 * vorgemerkten unangemeldeten Kräfte dieses Geräts; sie und vorgemerkte
 * bekannte Kräfte sind kein buchbarer Treffer. Fehlen die Kräfte des
 * Einsatzes (nicht geladen), findet die Prüfung nichts: sie erfindet keine
 * Doppelbuchung, und der Server prüft beim Senden.
 */
export function findDoppelbuchung(
  funkrufname: string,
  d: {
    einheiten: readonly Einheit[];
    fahrzeuge: readonly EinsatzFahrzeug[];
    kandidaten: EintreffenGruppen;
    vorgemerkt?: readonly EintreffenEingabe[];
  },
): Doppelbuchung | null {
  const ziel = normalizeFunkrufname(funkrufname);
  if (!ziel) return null;
  const alle = [...d.kandidaten.erwartet, ...d.kandidaten.imEinsatz];
  const gleich = (w: string | null | undefined) => w != null && normalizeFunkrufname(w) === ziel;
  const kraft = (name: string, art: EintreffenTreffer['art'], id: number): Doppelbuchung => {
    const treffer = alle.find((t) => t.art === art && t.id === id) ?? null;
    const vorgemerkt = treffer?.vorgemerktAt != null;
    return { name, treffer: vorgemerkt ? null : treffer, vorgemerkt };
  };

  for (const x of d.einheiten) {
    if (x.aufgeloest_at != null) continue;
    if (gleich(x.name) || gleich(x.funkrufname)) return kraft(x.name, 'einheit', x.id);
  }
  for (const f of d.fahrzeuge) {
    if (f.beendet_at != null || !gleich(f.funkrufname)) continue;
    return f.einheit_id != null
      ? kraft(f.funkrufname, 'einheit', f.einheit_id)
      : kraft(f.funkrufname, 'fahrzeug', f.id);
  }
  for (const v of d.vorgemerkt ?? []) {
    const name = v.unangemeldet?.fahrzeuge?.find((f) => gleich(f.funkrufname))?.funkrufname;
    if (name) return { name, treffer: null, vorgemerkt: true };
  }
  return null;
}

/** Körper für eine bekannte Kraft. */
export function kraftEingabe(t: EintreffenTreffer): EintreffenEingabe {
  return { kraft: { objekt_typ: t.art, objekt_id: t.id } };
}

export interface UnangemeldetWerte {
  funkrufname: string;
  traegerorganisation?: string | null;
  fahrzeugtyp?: string | null;
  staerke?: Staerke | null;
  bemerkung?: string | null;
  weitere?: readonly { funkrufname?: string | null; fahrzeugtyp?: string | null }[];
}

const text = (w: string | null | undefined) => {
  const t = (w ?? '').trim();
  return t ? t : undefined;
};

/** Körper für eine unangemeldete Kraft; leere Felder fehlen. */
export function buildEintreffenEingabe(
  werte: UnangemeldetWerte,
  opts: { trotzdemAnlegen?: boolean } = {},
): EintreffenEingabe & { unangemeldet: NonNullable<EintreffenEingabe['unangemeldet']> } {
  const organisation = text(werte.traegerorganisation);
  const fahrzeug = (funkrufname: string, typ: string | null | undefined) => ({
    funkrufname,
    ...(text(typ) ? { fahrzeugtyp: text(typ) } : {}),
    ...(organisation ? { traegerorganisation: organisation } : {}),
  });
  const fahrzeuge = [fahrzeug(werte.funkrufname.trim(), werte.fahrzeugtyp)];
  for (const w of werte.weitere ?? []) {
    const name = text(w.funkrufname);
    if (name) fahrzeuge.push(fahrzeug(name, w.fahrzeugtyp));
  }
  const bemerkung = text(werte.bemerkung);
  return {
    unangemeldet: {
      fahrzeuge,
      ...(werte.staerke ? { staerke: werte.staerke } : {}),
      ...(bemerkung ? { bemerkung } : {}),
      ...(opts.trotzdemAnlegen ? { trotzdem_anlegen: true } : {}),
    },
  };
}
