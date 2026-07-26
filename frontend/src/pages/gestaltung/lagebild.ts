/**
 * LFH-352 · Sandbox — Datenmodell der Variantenrunde.
 *
 * Verdichtet die ECHTEN Queries des Lage-Dashboards auf ein flaches, darstellungs-
 * neutrales Lagebild. Zweck: die drei Gestaltungsvarianten zeigen dieselben echten
 * Zahlen desselben Einsatzes — Unterschiede sind dann Gestaltung, nicht Datenlage.
 *
 * Diese Datei ist Wegwerf-Gerüst: sie verschwindet mit der Sandbox, sobald die
 * Richtungsentscheidung gefallen und die Referenzseite gebaut ist.
 */
import type {
  Auftrag,
  Einheit,
  EinsatzAnzeige,
  EinsatzFahrzeug,
  EinsatzMaterial,
  EinsatzPersonal,
  Einsatzabschnitt,
  Gefahrengebiet,
  LageberichtAnzeige,
  LageZone,
  Meldung,
  Person,
  Schaden,
  Tier,
  Uhs,
  Warnstufe,
} from '../../api/types';
import { baueKraeftebild, staerkeText } from '../../kraefte/kraeftebild';
import {
  neuesterLagebericht,
  verdichteGefahrengebiete,
  verdichtePersonen,
  verdichteSchaeden,
  verdichteTiere,
  verdichteUhs,
} from '../lage-dashboard/lageVerdichtung';

/** Die vier Datenzustände, die eine Gestaltungssprache tragen muss.
 *  `fehler` und `leer` sind bewusst getrennt — der Sweep-Befund lautet
 *  „Fehler sieht aus wie leer" (LFH-326), und genau das soll jede Variante lösen. */
export type Datenzustand = 'daten' | 'laden' | 'fehler' | 'leer';

export type Dringlichkeit = 'alarm' | 'achtung' | 'normal';

export interface Ereigniszeile {
  zeit: string;
  text: string;
  von: string;
  stufe: Dringlichkeit;
}

export interface Kennzahl {
  etikett: string;
  wert: string;
  zusatz: string;
  /** Wortlaut statt nackter Zahl, wo die Zahl allein irreführt (Sweep M30). */
  stufe?: Dringlichkeit;
  route: string;
}

export interface Lagebild {
  bezeichnung: string;
  stichwort: string | null;
  org: string | null;
  seit: string;
  status: string;
  kennzahlen: Kennzahl[];
  sichtung: { etikett: string; wert: number; stufe: Dringlichkeit }[];
  betroffeneGesamt: number;
  vermisst: number;
  staerke: string;
  einheiten: number;
  abschnitte: number;
  fahrzeugeGebunden: number;
  fahrzeugeGesamt: number;
  uhsAktiv: number;
  uhsGesamt: number;
  schaedenOffen: number;
  schaedenGesamt: number;
  tiereAktiv: number;
  zonen: number;
  bericht: { titel: string; status: string; stand: string; von: string } | null;
  auftraegeOffen: number;
  auftraegeUeberfaellig: number;
  meldungenOffen: number;
  meldungenNeu: number;
  meldungenUeberfaellig: number;
  ereignisse: Ereigniszeile[];
}

const WARNSTUFE_STUFE: Record<Warnstufe, Dringlichkeit> = {
  keine: 'normal',
  niedrig: 'normal',
  mittel: 'achtung',
  hoch: 'alarm',
  akut: 'alarm',
};

const WARNSTUFE_WORT: Record<Warnstufe, string> = {
  keine: 'keine',
  niedrig: 'niedrig',
  mittel: 'mittel',
  hoch: 'hoch',
  akut: 'akut',
};

/** Tag + Ortszeit als DTG-Kurzform (`261432`), wie im Funkverkehr gesprochen.
 *  Bewusst aus den LOKALEN Feldern des Date gebaut, nicht aus `toISOString()` —
 *  das läge in UTC und würde im Sommer eine Stunde danebenliegen. */
export function dtgKurz(d: Date): string {
  const zz = (n: number) => String(n).padStart(2, '0');
  return `${zz(d.getDate())}${zz(d.getHours())}${zz(d.getMinutes())}`;
}

/** `2026-07-26 14:32:00` → `14:32`. */
export function uhrzeit(iso: string | null | undefined): string {
  if (!iso) return '——:——';
  const m = /[ T](\d{2}:\d{2})/.exec(iso);
  return m ? m[1] : '——:——';
}

export interface Rohdaten {
  einsatz: EinsatzAnzeige;
  personen: Person[];
  tiere: Tier[];
  uhs: Uhs[];
  schaeden: Schaden[];
  gefahren: Gefahrengebiet[];
  zonen: LageZone[];
  lageberichte: LageberichtAnzeige[];
  einheiten: Einheit[];
  personal: EinsatzPersonal[];
  fahrzeuge: EinsatzFahrzeug[];
  material: EinsatzMaterial[];
  abschnitte: Einsatzabschnitt[];
  auftraege: Auftrag[];
  meldungen: Meldung[];
}

export function baueLagebild(r: Rohdaten): Lagebild {
  const kraefte = baueKraeftebild(
    r.abschnitte,
    r.einheiten,
    r.personal,
    r.fahrzeuge,
    r.material,
  ).verdichtung;
  const betroffene = verdichtePersonen(r.personen);
  const uhs = verdichteUhs(r.uhs);
  const schaeden = verdichteSchaeden(r.schaeden);
  const tiere = verdichteTiere(r.tiere);
  const gefahren = verdichteGefahrengebiete(r.gefahren);
  const bericht = neuesterLagebericht(r.lageberichte);

  const auftraegeOffen = r.auftraege.filter(
    (a) => a.bearbeitungsstatus !== 'vollzogen' && a.bearbeitungsstatus !== 'abgenommen',
  ).length;
  const auftraegeUeberfaellig = r.auftraege.filter((a) => a.ist_ueberfaellig).length;
  const meldungenOffen = r.meldungen.filter((m) => m.ist_offen).length;
  const meldungenNeu = r.meldungen.filter((m) => m.status === 'neu').length;
  const meldungenUeberfaellig = r.meldungen.filter((m) => m.ist_ueberfaellig).length;

  // Nach EREIGNISZEIT, nicht nach Eingangszeit: im Meldebild zählt, wann es
  // passiert ist, nicht wann es jemand eingetippt hat (die Erfassung kann
  // Stunden später erfolgen — beim Seed liegen alle Eingänge auf derselben Minute).
  const ereignisse: Ereigniszeile[] = [...r.meldungen]
    .sort((a, b) => (a.ereigniszeit < b.ereigniszeit ? 1 : -1))
    .slice(0, 5)
    .map((m) => ({
      zeit: uhrzeit(m.ereigniszeit),
      text: m.inhalt,
      von: m.absender,
      stufe: m.ist_ueberfaellig ? 'alarm' : m.status === 'neu' ? 'achtung' : 'normal',
    }));

  return {
    bezeichnung: r.einsatz.bezeichnung,
    stichwort: r.einsatz.stichwort ?? null,
    org: r.einsatz.org_name ?? null,
    seit: uhrzeit(r.einsatz.begonnen_at),
    status: r.einsatz.status,
    kennzahlen: [
      {
        etikett: 'Kräfte F/UF/M//Σ',
        wert: staerkeText(kraefte.staerke),
        zusatz: `${kraefte.anzahlPersonal} Personen · ${r.einheiten.length} Einheiten`,
        route: 'kraefteuebersicht',
      },
      {
        etikett: 'Patienten SK I–IV',
        wert: String(betroffene.patienten),
        zusatz: `von ${betroffene.gesamt} erfasst`,
        stufe: betroffene.sk.sk1 > 0 ? 'alarm' : betroffene.patienten > 0 ? 'achtung' : 'normal',
        route: 'personen',
      },
      {
        etikett: 'Vermisst',
        wert: String(betroffene.vermisst),
        zusatz: betroffene.vermisst > 0 ? 'Suche läuft' : 'keine offenen Fälle',
        stufe: betroffene.vermisst > 0 ? 'alarm' : 'normal',
        route: 'personen',
      },
      {
        etikett: 'Höchste Warnstufe',
        wert: WARNSTUFE_WORT[gefahren.hoechste],
        zusatz: `${gefahren.anzahlAktiv} Gefahrengebiete aktiv`,
        stufe: WARNSTUFE_STUFE[gefahren.hoechste],
        route: 'gefahren',
      },
      {
        etikett: 'Schäden offen',
        wert: String(schaeden.offen),
        zusatz: `von ${schaeden.gesamt} gemeldet`,
        stufe: schaeden.offen > 0 ? 'achtung' : 'normal',
        route: 'schaeden',
      },
      {
        etikett: 'UHS aktiv',
        wert: String(uhs.aktiv),
        zusatz: `${uhs.geplant} geplant · ${uhs.aufgeloest} aufgelöst`,
        route: 'unfallhilfsstellen',
      },
    ],
    sichtung: [
      { etikett: 'SK I', wert: betroffene.sk.sk1, stufe: 'alarm' },
      { etikett: 'SK II', wert: betroffene.sk.sk2, stufe: 'achtung' },
      { etikett: 'SK III', wert: betroffene.sk.sk3, stufe: 'normal' },
      { etikett: 'SK IV', wert: betroffene.sk.sk4, stufe: 'normal' },
    ],
    betroffeneGesamt: betroffene.gesamt,
    vermisst: betroffene.vermisst,
    staerke: staerkeText(kraefte.staerke),
    einheiten: r.einheiten.length,
    abschnitte: r.abschnitte.length,
    fahrzeugeGebunden: kraefte.fahrzeugStatus.gebunden,
    fahrzeugeGesamt: kraefte.anzahlFahrzeuge,
    uhsAktiv: uhs.aktiv,
    uhsGesamt: uhs.gesamt,
    schaedenOffen: schaeden.offen,
    schaedenGesamt: schaeden.gesamt,
    tiereAktiv: tiere.aktiv,
    zonen: r.zonen.length,
    bericht: bericht
      ? {
          titel: bericht.titel,
          status: bericht.status,
          stand: bericht.zeitstand,
          von: bericht.ersteller_name,
        }
      : null,
    auftraegeOffen,
    auftraegeUeberfaellig,
    meldungenOffen,
    meldungenNeu,
    meldungenUeberfaellig,
    ereignisse,
  };
}

/** Leeres Lagebild — frisch angelegter Einsatz, noch nichts erfasst.
 *  Bewusst NICHT identisch mit dem Fehlerfall (siehe `Datenzustand`). */
export function leeresLagebild(basis: Lagebild): Lagebild {
  return {
    ...basis,
    kennzahlen: basis.kennzahlen.map((k) => ({
      ...k,
      wert: '0',
      zusatz: 'noch nichts erfasst',
      stufe: 'normal',
    })),
    sichtung: basis.sichtung.map((s) => ({ ...s, wert: 0 })),
    betroffeneGesamt: 0,
    vermisst: 0,
    staerke: '0/0/0//0',
    einheiten: 0,
    abschnitte: 0,
    fahrzeugeGebunden: 0,
    fahrzeugeGesamt: 0,
    uhsAktiv: 0,
    uhsGesamt: 0,
    schaedenOffen: 0,
    schaedenGesamt: 0,
    tiereAktiv: 0,
    zonen: 0,
    bericht: null,
    auftraegeOffen: 0,
    auftraegeUeberfaellig: 0,
    meldungenOffen: 0,
    meldungenNeu: 0,
    meldungenUeberfaellig: 0,
    ereignisse: [],
  };
}
