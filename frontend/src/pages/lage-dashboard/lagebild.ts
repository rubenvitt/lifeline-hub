/**
 * Datenmodell des Lage-Dashboards (LFH-352 · A0).
 *
 * Verdichtet die 15 Queries der Seite auf ein flaches, darstellungsneutrales
 * Lagebild. Die Trennung ist Absicht: die Seite entscheidet über Form, diese
 * Datei über Bedeutung — welche Zahl alarmiert, welcher Wortlaut zu ihr gehört.
 *
 * Entstanden als Datenschicht der Variantenrunde; sie hat den Vergleich der
 * Entwürfe ehrlich gehalten (gleiche Zahlen, verschiedene Gestaltung) und ist
 * mit der Entscheidung in die Referenzseite übergegangen.
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
import {
  DEFAULT_KONVENTIONEN,
  formatUhrzeit,
  formatUhrzeitMitTag,
  type AnzeigeKonventionen,
} from '../../anzeige/format';
import { baueKraeftebild, staerkeText } from '../../kraefte/kraeftebild';
import { warnstufeKennzahl, type Dringlichkeit, type Statusrolle } from '../../theme/statusFarben';
import {
  neuesterLagebericht,
  verdichteGefahrengebiete,
  verdichtePersonen,
  verdichteSchaeden,
  verdichteTiere,
  verdichteUhs,
} from './lageVerdichtung';

/** Die vier Datenzustände, die eine Gestaltungssprache tragen muss.
 *  `fehler` und `leer` sind bewusst getrennt — der Sweep-Befund lautet
 *  „Fehler sieht aus wie leer" (LFH-326), und genau das soll jede Variante lösen. */
export type Datenzustand = 'daten' | 'laden' | 'fehler' | 'leer';

/** Rolle → Dringlichkeit. `Record` über die VOLLE `Statusrolle`, damit eine siebte
 *  Rolle im Vertrag hier den Build bricht statt still auf `normal` zu fallen. Die drei
 *  übrigen A0-Rollen tragen keine Dringlichkeit: `neutral` ist die bewusste
 *  Nichtmeldung, `bedien` und `marke` sind Bedienung bzw. Herkunft — im Lagebild also
 *  allesamt „kein Alarmbeitrag". */
const ROLLE_ALS_DRINGLICHKEIT: Record<Statusrolle, Dringlichkeit> = {
  alarm: 'alarm',
  achtung: 'achtung',
  normal: 'normal',
  neutral: 'normal',
  bedien: 'normal',
  marke: 'normal',
};

/** Eine Meldung als Kurzlisten-Zeile des Dashboards (LFH-336 · Befund H5). */
export interface Meldungszeile {
  id: number;
  lfdNr: number;
  zeit: string;
  absender: string;
  text: string;
  stufe: Dringlichkeit;
}

/** Ein Auftrag als Kurzlisten-Zeile des Dashboards (LFH-336 · Befund H5). */
export interface Auftragszeile {
  id: number;
  lfdNr: number | null;
  /** Ortszeit der Frist (`14:30`) oder `null`, wenn keine gesetzt ist. */
  frist: string | null;
  text: string;
  stufe: Dringlichkeit;
}

/** Wie viele Zeilen eine Kurzliste trägt.
 *  Drei, weil die Kachel darunter noch Kopfzahl und Fußnote hält — eine vierte
 *  Zeile drückt die Kachelreihe auf dem 13"-Fükw-Schirm in den Umbruch. */
const KURZLISTE_MAX = 3;

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
  bericht: {
    titel: string;
    status: string;
    stand: string;
    von: string;
    auszug: string | null;
  } | null;
  meldungszeilen: Meldungszeile[];
  auftragszeilen: Auftragszeile[];
  auftraegeOffen: number;
  auftraegeUeberfaellig: number;
  meldungenOffen: number;
  meldungenNeu: number;
  meldungenUeberfaellig: number;
}

/**
 * Warnstufe → Dringlichkeit der Kennzahl. Ableitung aus dem Statusfarb-Vertrag, keine
 * zweite Liste (LFH-328/A2) — sonst käme neben `warnstufeKarte` und `warnstufeKennzahl`
 * noch eine Lesart desselben Enums dazu.
 *
 * Es GIBT eine dritte — die FLÄCHE der Gefahrenmatrix —, und sie liegt seit LFH-368
 * nicht mehr draußen: `theme/statusFarben.ts:warnstufeFlaeche` bildet die Stufen auf
 * die Füllungsrollen ab, `flaechenFarbe` löst sie je Modus auf. Alle drei Lesarten
 * stehen damit im selben Vertrag; welche gilt, entscheidet die Darstellungssorte
 * (Kennzahl · Objektsignatur · Fläche), nicht der Aufrufort.
 *
 * Gelesen wird ausdrücklich {@link warnstufeKennzahl} und NICHT `warnstufeKarte`: die
 * Karte zeigt ein OBJEKT (dieses eine Gebiet ist unbewertet ⇒ vorsichtshalber Gefahr,
 * `keine` → `alarm`), das Dashboard eine KENNZAHL (nichts gemeldet ⇒ kein
 * Alarmbeitrag, `keine` → `normal`). Wer hier auf `warnstufeKarte` umstellt, färbt
 * einen Einsatz ohne jedes Gefahrengebiet rot.
 */
function warnstufeStufe(w: Warnstufe): Dringlichkeit {
  return ROLLE_ALS_DRINGLICHKEIT[warnstufeKennzahl[w].rolle];
}

/** Tag + Ortszeit als DTG-Kurzform (`261432`), wie im Funkverkehr gesprochen.
 *  Bewusst aus den LOKALEN Feldern des Date gebaut, nicht aus `toISOString()` —
 *  das läge in UTC und würde im Sommer eine Stunde danebenliegen. */
export function dtgKurz(d: Date): string {
  const zz = (n: number) => String(n).padStart(2, '0');
  return `${zz(d.getDate())}${zz(d.getHours())}${zz(d.getMinutes())}`;
}

/** DTG des Aufrufzeitpunkts. Eigene Funktion, damit Tests sie stellen können —
 *  ein Instrumentenband mit stehengebliebener Uhr wäre im Einsatz ein Fehler,
 *  und ein Test, der `new Date()` nicht kontrollieren kann, ist flaky. */
export function dtgJetzt(): string {
  return dtgKurz(new Date());
}

/**
 * Die jüngsten OFFENEN Meldungen als Kurzliste.
 *
 * Sortiert nach EREIGNISZEIT, nicht nach Eingangszeit: im Meldebild zählt,
 * wann es passiert ist, nicht wann es jemand eingetippt hat.
 *
 * Gefiltert auf `ist_offen`, weil die Kopfzahl der Kachel offene Meldungen zählt.
 * Eine Liste, die erledigte mitzeigt, widerspräche der Zahl über ihr.
 */
export function meldungszeilen(
  meldungen: Meldung[],
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): Meldungszeile[] {
  return [...meldungen]
    .filter((m) => m.ist_offen)
    .sort((a, b) => (a.ereigniszeit < b.ereigniszeit ? 1 : -1))
    .slice(0, KURZLISTE_MAX)
    .map((m) => ({
      id: m.id,
      lfdNr: m.lfd_nr,
      zeit: formatUhrzeit(m.ereigniszeit, konv),
      absender: m.absender,
      text: m.inhalt,
      stufe: m.ist_ueberfaellig ? 'alarm' : m.status === 'neu' ? 'achtung' : 'normal',
    }));
}

/**
 * Die fristnächsten OFFENEN Aufträge als Kurzliste.
 *
 * Ein Auftrag ohne Frist sortiert ans ENDE, nicht an den Anfang. Ein leerer
 * String verglichen sich lexikographisch vor jedes Datum — der fristlose Auftrag
 * verdrängte dann den überfälligen aus der Dreierliste. Unbestimmt ist nicht
 * dringend.
 *
 * Die Statusmenge ist dieselbe wie bei `auftraegeOffen` weiter unten: alles außer
 * `vollzogen` und `abgenommen`.
 *
 * `frist` nutzt `formatUhrzeitMitTag`, NICHT `formatUhrzeit` — eine reine
 * `HH:mm` ist optisch nicht von „in 20 Minuten" zu „morgen früh" zu unterscheiden,
 * und eine Frist ist der Fall, nach dem jemand handelt (LFH-336, Fix-Runde 1 zu
 * Task 3). `meldungszeilen` oben bleibt bewusst bei `formatUhrzeit`: eine Meldung zeigt
 * Vergangenes und steht als „die drei jüngsten" ohnehin im Jetzt, keine Deadline.
 */
export function auftragszeilen(
  auftraege: Auftrag[],
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): Auftragszeile[] {
  const offen = auftraege.filter(
    (a) => a.bearbeitungsstatus !== 'vollzogen' && a.bearbeitungsstatus !== 'abgenommen',
  );
  return [...offen]
    .sort((a, b) => {
      if (!a.frist_at && !b.frist_at) return 0;
      if (!a.frist_at) return 1;
      if (!b.frist_at) return -1;
      return a.frist_at < b.frist_at ? -1 : 1;
    })
    .slice(0, KURZLISTE_MAX)
    .map((a) => ({
      id: a.id,
      lfdNr: a.lfd_nr ?? null,
      frist: a.frist_at ? formatUhrzeitMitTag(a.frist_at, konv) : null,
      text: a.auftrag_text,
      stufe: a.ist_ueberfaellig ? 'alarm' : 'normal',
    }));
}

/**
 * Welcher Abschnitt eines Lageberichts DIE LAGE trägt — je Vorlage ein anderer.
 *
 * Es gibt keinen Abschnitt namens „lage" (gemessen gegen `src/lagebericht/mod.rs`,
 * gespiegelt in `lageberichte/vorlagen.ts`). Deshalb eine Vorrangliste über alle
 * drei Vorlagen statt einer Fallunterscheidung — die Schlüssel sind eindeutig,
 * eine Vorlage kann keine zwei davon tragen.
 */
const LAGE_ABSCHNITTE = ['gefahren_schadenlage', 'beurteilung_schadenlage', 'text'] as const;

/** Wie viel Lagetext die Kachel trägt. 240 Zeichen sind rund drei Zeilen auf
 *  Kachelbreite — mehr sprengt das Raster, weniger sagt nichts. */
const AUSZUG_MAX = 240;

/**
 * Der Lageabschnitt eines Berichts, gekürzt — oder `null`, wenn er nichts hergibt.
 *
 * Fällt auf den ersten nicht-leeren Abschnitt zurück: ein leerer Vorrangabschnitt
 * darf die Kachel nicht verstummen lassen, obwohl der Bericht Inhalt hat.
 */
export function lageauszug(bericht: LageberichtAnzeige | null): string | null {
  if (!bericht) return null;
  const gefuellt = (s: string | undefined) => (s ?? '').trim().length > 0;
  const vorrang = LAGE_ABSCHNITTE.map((k) =>
    bericht.abschnitte.find((a) => a.schluessel === k),
  ).find((a) => gefuellt(a?.text));
  const gewaehlt = vorrang ?? bericht.abschnitte.find((a) => gefuellt(a.text));
  if (!gewaehlt) return null;
  const text = gewaehlt.text.trim();
  return text.length > AUSZUG_MAX ? `${text.slice(0, AUSZUG_MAX)}…` : text;
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

  return {
    bezeichnung: r.einsatz.bezeichnung,
    stichwort: r.einsatz.stichwort ?? null,
    org: r.einsatz.org_name ?? null,
    status: r.einsatz.status,
    // SECHS Kennzahlen, feste Reihenfolge (LFH-329 · B1).
    //
    // Die Anzahl ist eine Entscheidung, keine Zufälligkeit: am Handschirm stehen
    // sie in 2 Spalten, sechs ergeben also genau 3 Zeilen. Eine siebte — der
    // Kandidat waren die überfälligen Aufträge — machte daraus 4 Zeilen. Die
    // überfälligen Aufträge tragen deshalb weiterhin die Alarm-Plakette IHRER
    // Kachel; der Punkt ist erfüllt, nur an anderer Stelle.
    //
    // Die Reihenfolge wird NICHT nach Dringlichkeit sortiert. Prüfliste
    // Kriterium 9 verlangt dieselbe Größe an derselben Stelle, in jedem Zustand —
    // wer eine Lage funkt, greift nach der Zahl an ihrem Platz. Zweitens hängt an
    // dieser Liste eine zweite in `LageDashboardPage.tsx` (Kennzahl ↔ Datenzustand),
    // die stumm aus dem Takt liefe; beide pinnt `LageDashboardPage.test.tsx`.
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
        wert: warnstufeKennzahl[gefahren.hoechste].label,
        zusatz: `${gefahren.anzahlAktiv} Gefahrengebiete aktiv`,
        stufe: warnstufeStufe(gefahren.hoechste),
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
          auszug: lageauszug(bericht),
        }
      : null,
    meldungszeilen: meldungszeilen(r.meldungen),
    auftragszeilen: auftragszeilen(r.auftraege),
    auftraegeOffen,
    auftraegeUeberfaellig,
    meldungenOffen,
    meldungenNeu,
    meldungenUeberfaellig,
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
    meldungszeilen: [],
    auftragszeilen: [],
    auftraegeOffen: 0,
    auftraegeUeberfaellig: 0,
    meldungenOffen: 0,
    meldungenNeu: 0,
    meldungenUeberfaellig: 0,
  };
}
