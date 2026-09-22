/**
 * Datenmodell des Lage-Dashboards (LFH-352 · A0, neu gedacht mit dem Neuentwurf S3).
 *
 * Verdichtet die Queries der Seite auf ein flaches, darstellungsneutrales Lagebild. Die
 * Trennung ist Absicht: die Seite entscheidet über Form, diese Datei über Bedeutung —
 * welche Zahl alarmiert, welcher Wortlaut zu ihr gehört.
 *
 * Gefahrenmatrix, Sichtungsbild und Meldungsstrom haben eigene Ableitungen
 * (`lageVerdichtung.ts`, `meldungsstrom.ts`): sie hängen an eigenen Abfragen mit eigenem
 * Datenzustand und gehören nicht in ein Lagebild, das erst mit dem Einsatz entsteht.
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
  LageberichtStatus,
  Meldung,
  PegelAnzeige,
  Person,
  Schaden,
  Uhs,
  Warnstufe,
} from '../../api/types';
import {
  DEFAULT_KONVENTIONEN,
  formatUhrzeitMitTag,
  inZone,
  type AnzeigeKonventionen,
} from '../../anzeige/format';
import { baueKraeftebild, staerkeText } from '../../kraefte/kraeftebild';
import { LAGEBERICHT_STATUS } from '../../kommunikation/phase';
import { warnstufeKennzahl } from '../../theme/statusFarben';
import type { KennzahlTon } from '../../components/instrument';
import { einsatzEinstellungenPfad } from '../../routing/deeplinks';
import { pegelKennzahl } from '../../pegel/pegelKennzahl';
import {
  neuesterLagebericht,
  verdichteGefahrengebiete,
  verdichtePersonen,
  verdichteSchaeden,
  verdichteUhs,
  type SkVerteilung,
} from './lageVerdichtung';

/** Die Datenzustände, die eine Gestaltungssprache tragen muss. `fehler` und `leer` sind
 *  bewusst getrennt — der Sweep-Befund lautet „Fehler sieht aus wie leer" (LFH-326). */
export type Datenzustand = 'daten' | 'laden' | 'fehler' | 'leer';

/**
 * Die sechs Kennzahl-Etiketten, in fester Reihenfolge (Neuentwurf S3).
 *
 * EINE Quelle für beide Reihen: die Plätze, die die Seite vor dem ersten Einsatz-Abruf
 * stellt (Prüfliste Kriterium 12, CLS ≤ 0,1), und die Kennzahlen aus {@link baueLagebild}.
 * `LageDashboardPage.test.tsx` pinnt beide gegen handgeschriebene Literale.
 *
 * Die Reihenfolge wird NICHT nach Dringlichkeit sortiert: Prüfliste Kriterium 9 verlangt
 * dieselbe Größe an derselben Stelle, in jedem Zustand — wer eine Lage funkt, greift nach
 * der Zahl an ihrem Platz. Die Anzahl ist sechs, weil sie sich 6 → 3 → 2 Spalten ohne Rest
 * teilt.
 *
 * **Pegel steht auf Platz 1 und ersetzt „Höchste Warnstufe"** (LFH-606, Entscheidung des
 * Auftraggebers vom 22.09.2026, wie im Entwurf S3). Die Datenquelle sind die maßgeblichen
 * Pegel des Einsatzes (PEGELONLINE, `api/pegel.ts`); die Ableitung steht in
 * `pegel/pegelKennzahl.ts`. Die Warnstufe verschwindet damit nicht von der Seite: sie steht
 * als Hinweis im Seitenkopf, sobald sie ein Alarmbeitrag ist, und je Gefahrentyp im Paneel
 * Gefahrenmatrix. Ist kein Pegel festgelegt, bleibt der Platz belegt („kein Pegel
 * festgelegt" mit Weg zur Auswahl) — ein wandernder Platz verletzte Kriterium 9.
 * „Evakuiert" aus dem Entwurf fehlt weiterhin: dafür gibt es keine Datenquelle (LFH-607),
 * und eine erfundene Kennzahl wäre schlimmer als eine fehlende.
 */
export const KENNZAHL_ETIKETTEN = [
  'Pegel',
  'Betroffene',
  'Kräfte',
  'Vermisste',
  'Schäden offen',
  'Einsatzdauer',
] as const;

export type KennzahlEtikett = (typeof KENNZAHL_ETIKETTEN)[number];

export interface Kennzahl {
  etikett: KennzahlEtikett;
  wert: string;
  einheit?: string;
  notiz: string;
  ton: KennzahlTon;
  /** Modul-Route für `einsatzModulPfad` (die Seite baut den Pfad über `routing/deeplinks`). */
  route: string;
  /**
   * Fertiger Pfad, wo das Ziel kein Modul-Einstieg ist (Pegel → Einstellungssektion, gebaut
   * über `einsatzEinstellungenPfad`). Hat Vorrang vor {@link Kennzahl.route}.
   */
  zielPfad?: string;
}

/** Der Führungsstand unter den drei Paneelen: was vorher eigene Kacheln hatte. */
export interface Fuehrungsstand {
  auftraegeOffen: number;
  auftraegeUeberfaellig: number;
  meldungenOffen: number;
  meldungenNeu: number;
  meldungenUeberfaellig: number;
  uhsAktiv: number;
  uhsGeplant: number;
  bericht: {
    id: number;
    titel: string;
    statusLabel: string;
    /** `zeitstand` als Wirestring — formatiert wird in der Seite (Zone am Provider). */
    stand: string;
    status: LageberichtStatus;
  } | null;
}

export interface Lagebild {
  kennzahlen: Kennzahl[];
  /** Für das Sichtungsbild: die Verteilung aus derselben Verdichtung wie die Kennzahlen. */
  sk: SkVerteilung;
  betroffeneGesamt: number;
  hoechsteWarnstufe: Warnstufe;
  fuehrung: Fuehrungsstand;
}

/** Warnstufe → Ton, aus {@link warnstufeKennzahl} (nicht `warnstufeKarte`: „keine" ist hier
 *  „kein Alarmbeitrag", nicht „vorsichtshalber Gefahr"). Seit LFH-606 trägt ihn der
 *  Warnstufen-Hinweis im Seitenkopf — die Kennzahl im Band ist dem Pegel gewichen. Rein. */
export function warnstufeTon(w: Warnstufe): KennzahlTon {
  const rolle = warnstufeKennzahl[w].rolle;
  return rolle === 'alarm' ? 'alarm' : rolle === 'achtung' ? 'achtung' : 'neutral';
}

/**
 * Ein Wirestring (UTC ohne Zonenkennung, `YYYY-MM-DD HH:MM:SS`) als Epoche. `NaN` bei
 * Unbrauchbarem. Rein — kein dayjs-Plugin nötig, weil nur die Differenz gebraucht wird.
 */
export function wireAlsEpoche(wire: string): number {
  return Date.parse(`${wire.trim().replace(' ', 'T')}Z`);
}

/**
 * Einsatzdauer als `H:MM` (Stunden laufen über 24 hinaus weiter: „26:05"), gerechnet vom
 * Beginn bis `jetzt` bzw. bis zum Abschluss. Ein Beginn in der Zukunft oder ein
 * unlesbarer Wert ergibt `—:——`, keine negative Dauer. Rein.
 */
export function einsatzdauer(beginn: string, jetzt: number, ende?: string | null): string {
  const von = wireAlsEpoche(beginn);
  const bis = ende ? wireAlsEpoche(ende) : jetzt;
  if (!Number.isFinite(von) || !Number.isFinite(bis) || bis < von) return '—:——';
  const minuten = Math.floor((bis - von) / 60_000);
  return `${Math.floor(minuten / 60)}:${String(minuten % 60).padStart(2, '0')}`;
}

/** „Lagebild 21.09. 14:22" — der Zeitpunkt in der Anzeigezone. Rein. */
export function lagebildZeit(
  jetzt: number,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  return inZone(new Date(jetzt).toISOString(), konv).format('DD.MM. HH:mm');
}

/**
 * Alter des Datenstands als Mono-Meta („Stand vor 40 s"). `0`/ungültig heißt „noch nichts
 * abgerufen". Über einer Stunde steht die Uhrzeit — „vor 184 min" liest niemand. Rein.
 */
export function standText(
  datenstand: number,
  jetzt: number,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  if (!Number.isFinite(datenstand) || datenstand <= 0) return 'Stand wird abgerufen';
  const sekunden = Math.max(0, Math.round((jetzt - datenstand) / 1000));
  if (sekunden < 60) return `Stand vor ${sekunden} s`;
  if (sekunden < 3600) return `Stand vor ${Math.floor(sekunden / 60)} min`;
  return `Stand ${inZone(new Date(datenstand).toISOString(), konv).format('HH:mm')}`;
}

export interface Rohdaten {
  einsatz: EinsatzAnzeige;
  personen: Person[];
  uhs: Uhs[];
  schaeden: Schaden[];
  gefahren: Gefahrengebiet[];
  lageberichte: LageberichtAnzeige[];
  einheiten: Einheit[];
  personal: EinsatzPersonal[];
  fahrzeuge: EinsatzFahrzeug[];
  material: EinsatzMaterial[];
  abschnitte: Einsatzabschnitt[];
  auftraege: Auftrag[];
  meldungen: Meldung[];
  /** Maßgebliche Pegel in Reihenfolge (LFH-606), erster = Leitpegel. */
  pegel: PegelAnzeige[];
}

export function baueLagebild(
  r: Rohdaten,
  jetzt: number,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): Lagebild {
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
  const gefahren = verdichteGefahrengebiete(r.gefahren);
  const bericht = neuesterLagebericht(r.lageberichte);
  const abgeschlossen = r.einsatz.abgeschlossen_at ?? null;
  const pegel = pegelKennzahl(r.pegel, jetzt, konv);

  // Die Reihenfolge ist die von KENNZAHL_ETIKETTEN; ein Etikett, das es dort nicht gibt,
  // bricht über den Typ `KennzahlEtikett` den Build.
  const kennzahlen: Kennzahl[] = [
    {
      // Ziel in JEDEM Fall die Einstellungssektion: dort steht die ganze Liste samt
      // Reihenfolge, und nur dort wird festgelegt. Die Lagekarte zeigte zwar die Stationen,
      // kann aber per Deeplink weder die Ebene einschalten noch eine Station ansteuern.
      etikett: 'Pegel',
      wert: pegel.wert,
      einheit: pegel.einheit,
      notiz: pegel.notiz,
      ton: pegel.ton,
      route: 'einstellungen',
      zielPfad: einsatzEinstellungenPfad(r.einsatz.id, 'pegel'),
    },
    {
      etikett: 'Betroffene',
      wert: String(betroffene.gesamt),
      notiz: `${betroffene.patienten} Patienten`,
      ton: 'neutral',
      route: 'personen',
    },
    {
      // Die Gesamtstärke führt; F/UF/M//Σ steht in der Notiz, damit die BOS-Schreibweise
      // nicht verloren geht, die vorher das Band und die Kräfte-Kachel trugen.
      etikett: 'Kräfte',
      wert: String(kraefte.staerke.gesamt),
      notiz: `${r.einheiten.length} Einheiten · ${staerkeText(kraefte.staerke)}`,
      ton: 'neutral',
      route: 'kraefteuebersicht',
    },
    {
      etikett: 'Vermisste',
      wert: String(betroffene.vermisst),
      notiz: betroffene.vermisst > 0 ? 'als vermisst erfasst' : 'keine offenen Fälle',
      ton: betroffene.vermisst > 0 ? 'alarm' : 'neutral',
      route: 'personen',
    },
    {
      etikett: 'Schäden offen',
      wert: String(schaeden.offen),
      notiz: `von ${schaeden.gesamt} gemeldet`,
      ton: schaeden.offen > 0 ? 'achtung' : 'neutral',
      route: 'schaeden',
    },
    {
      etikett: 'Einsatzdauer',
      wert: einsatzdauer(r.einsatz.begonnen_at, jetzt, abgeschlossen),
      einheit: 'h',
      notiz: abgeschlossen
        ? `beendet ${formatUhrzeitMitTag(abgeschlossen, konv)}`
        : `seit ${formatUhrzeitMitTag(r.einsatz.begonnen_at, konv)}`,
      ton: 'neutral',
      route: 'einsatzdaten',
    },
  ];

  return {
    kennzahlen,
    sk: betroffene.sk,
    betroffeneGesamt: betroffene.gesamt,
    hoechsteWarnstufe: gefahren.hoechste,
    fuehrung: {
      // Dieselbe Statusmenge wie vorher die Aufträge-Kachel: alles außer vollzogen/abgenommen.
      auftraegeOffen: r.auftraege.filter(
        (a) => a.bearbeitungsstatus !== 'vollzogen' && a.bearbeitungsstatus !== 'abgenommen',
      ).length,
      // Unabhängig vom Filter darüber (src/auftrag/repo.rs): ein vollzogener Auftrag mit
      // unquittiertem Empfänger und abgelaufener Frist ist trotzdem überfällig.
      auftraegeUeberfaellig: r.auftraege.filter((a) => a.ist_ueberfaellig).length,
      meldungenOffen: r.meldungen.filter((m) => m.ist_offen).length,
      meldungenNeu: r.meldungen.filter((m) => m.status === 'neu').length,
      meldungenUeberfaellig: r.meldungen.filter((m) => m.ist_ueberfaellig).length,
      uhsAktiv: uhs.aktiv,
      uhsGeplant: uhs.geplant,
      bericht: bericht
        ? {
            id: bericht.id,
            titel: bericht.titel,
            status: bericht.status,
            statusLabel: LAGEBERICHT_STATUS[bericht.status].label,
            stand: bericht.zeitstand,
          }
        : null,
    },
  };
}
