/**
 * Datenmodell des Lage-Dashboards: verdichtet die Queries der Seite auf ein flaches,
 * darstellungsneutrales Lagebild. Die Seite entscheidet über Form, diese Datei über Bedeutung —
 * welche Zahl alarmiert, welcher Wortlaut zu ihr gehört.
 *
 * Gefahrenmatrix, Sichtungsbild und Meldungsstrom haben eigene Ableitungen (`lageVerdichtung.ts`,
 * `meldungsstrom.ts`), weil sie an eigenen Abfragen mit eigenem Datenzustand hängen.
 */
import type {
  Einheit,
  EinsatzAnzeige,
  EinsatzFahrzeug,
  EinsatzMaterial,
  EinsatzPersonal,
  Einsatzabschnitt,
  Gefahrengebiet,
  Lagekennzahl,
  LageberichtAnzeige,
  LageberichtStatus,
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
import { staerkeText } from '../../anzeige/staerke';
import { baueKraeftebild } from '../../kraefte/kraeftebild';
import { LAGEBERICHT_STATUS } from '../../kommunikation/phase';
import { warnstufeKennzahl } from '../../theme/statusFarben';
import type { KennzahlTon } from '../../components/instrument';
import { einsatzEinstellungenPfad } from '../../routing/deeplinks';
import { pegelKennzahl } from '../../pegel/pegelKennzahl';
import { transportBilanz } from '../../personen/personenBilanz';
import type { EvakuierungKennzahl } from '../../betreuung/evakuierungKennzahl';
import type { EvakuierungKennzahlZustand } from '../../betreuung/useEvakuierungKennzahl';
import { kennzahlTeile } from '../../betreuung/betreuungText';
import {
  neuesterLagebericht,
  verdichteGefahrengebiete,
  verdichtePersonen,
  verdichteSchaeden,
  verdichteUhs,
  type SkVerteilung,
} from './lageVerdichtung';

/**
 * Die Datenzustände einer Fläche. `fehler` und `leer` sind bewusst getrennt: Fehler darf nicht
 * aussehen wie leer.
 */
export type Datenzustand = 'daten' | 'laden' | 'fehler' | 'leer';

/**
 * Datenzustand einer Fläche, deren Quelle an einem Modul hängt. `gesperrt` heißt: das Modul ist
 * für die Person nicht freigegeben (LFH-669, `useLagebild`). Das ist kein Ausfall und kein leerer
 * Bestand — die Fläche nennt den Grund statt einer Zahl.
 */
export type Quellzustand = Datenzustand | 'gesperrt';

/**
 * Alle Kennzahl-Etiketten, die das Band tragen kann; die Reihe eines Einsatzes wählt sechs davon
 * ({@link kennzahlReihe}).
 */
export const KENNZAHL_ETIKETTEN = [
  'Pegel',
  'Verbleib offen',
  'Betroffene',
  'Evakuiert',
  'Schäden offen',
  'Kräfte',
  'Vermisste',
  'Einsatzdauer',
] as const;

export type KennzahlEtikett = (typeof KENNZAHL_ETIKETTEN)[number];

/**
 * Die Reihe hat immer sechs Plätze (Spec
 * `docs/superpowers/specs/2026-09-23-lfh-640-lagebezogene-kennzahlreihe-design.md`): sechs teilen
 * sich 6 → 3 → 2 Spalten ohne Rest, und die Platzzahl steht vor jeder Abfrage fest, damit die
 * Ladeplätze die Bandhöhe halten.
 */
export const KENNZAHL_PLAETZE = 6;

type Lageplatz = 'A' | 'B';

/**
 * Heimatplatz und Rang jeder Lagekennzahl. Jede Kennzahl hat genau einen Platz und rutscht nie
 * (Kriterium 9) — deshalb füllt die Reihe nicht nach Rang auf, sonst änderte eine Entscheidung zwei
 * Plätze. Konkurrieren zwei aktive Kandidaten, gewinnt der kleinere Rang. Der `Record` bricht den
 * Build bei einer neuen `Lagekennzahl`-Variante.
 *
 * „Evakuiert" ist aktiv, sobald eine Evakuierung angeordnet ist (`src/einsatz/lagekennzahl.rs`),
 * nie abhängig von der Zahl der Evakuierten.
 */
const LAGEKENNZAHL: Record<
  Lagekennzahl,
  { etikett: KennzahlEtikett; platz: Lageplatz; rang: number }
> = {
  pegel: { etikett: 'Pegel', platz: 'A', rang: 0 },
  evakuiert: { etikett: 'Evakuiert', platz: 'B', rang: 0 },
};

/**
 * Was ein Lageplatz ohne aktiven Kandidaten trägt — echte Daten, nie ein Platzhalter. Platz A ist
 * frei, wenn kein Pegel festgelegt ist (MANV, Brand, Unfall): dort ist der offene Verbleib die
 * Führungsfrage. Platz B ist frei ohne Evakuierung; ein Hochwasser behält so „Schäden offen".
 */
const FUELLUNG: Record<Lageplatz, KennzahlEtikett> = {
  A: 'Verbleib offen',
  B: 'Schäden offen',
};

/**
 * Die sechs Etiketten eines Einsatzes aus seinen aktiven Lagekennzahlen. Plätze 2, 4, 5, 6 sind der
 * Kern, 1 und 3 die Lageplätze A und B. Rein.
 */
export function kennzahlReihe(aktiv: readonly Lagekennzahl[]): KennzahlEtikett[] {
  const belegung = (platz: Lageplatz): KennzahlEtikett => {
    const kandidaten = aktiv
      .map((k) => LAGEKENNZAHL[k])
      .filter((k) => k.platz === platz)
      .sort((a, b) => a.rang - b.rang);
    return kandidaten[0]?.etikett ?? FUELLUNG[platz];
  };
  return [belegung('A'), 'Betroffene', belegung('B'), 'Kräfte', 'Vermisste', 'Einsatzdauer'];
}

/**
 * Wortlaut des Sammelbanners, wenn ein neuer Zuschnitt während der Betrachtung ankommt:
 * „Pegel statt Verbleib offen" je geändertem Platz. `null` bei gleicher Reihe. Rein.
 */
export function reihenWechsel(
  alt: readonly KennzahlEtikett[],
  neu: readonly KennzahlEtikett[],
): string | null {
  const teile = neu.flatMap((e, i) => (e === alt[i] ? [] : [`${e} statt ${alt[i]}`]));
  return teile.length > 0 ? teile.join(' · ') : null;
}

interface Kennzahl {
  etikett: KennzahlEtikett;
  wert: string;
  einheit?: string;
  notiz: string;
  ton: KennzahlTon;
  /** Modul-Route für `einsatzModulPfad` (die Seite baut den Pfad über `routing/deeplinks`). */
  route: string;
  /** Fertiger Pfad, wo das Ziel kein Modul-Einstieg ist. Hat Vorrang vor {@link Kennzahl.route}. */
  zielPfad?: string;
  /** Die Zelle führt nirgends hin — ihr Modul ist nicht frei oder das steht noch nicht fest. */
  ohneZiel?: boolean;
}

/**
 * Der Führungsstand unter den drei Paneelen, soweit er aus den Listen kommt. Aufträge und Meldungen
 * zählt er NICHT: die kommen aus dem Modulzähler (`fuehrungsZahlen.ts`, LFH-550).
 */
interface Fuehrungsstand {
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
  /** Gebiete mit Warnstufe — aus derselben Verdichtung wie `hoechsteWarnstufe`. */
  gebieteMitWarnstufe: number;
  fuehrung: Fuehrungsstand;
}

/**
 * Warnstufe → Ton aus {@link warnstufeKennzahl} (nicht `warnstufeKarte`: „keine" ist hier „kein
 * Alarmbeitrag", nicht „vorsichtshalber Gefahr"). Trägt den Warnstufen-Hinweis im Seitenkopf. Rein.
 */
export function warnstufeTon(w: Warnstufe): KennzahlTon {
  const rolle = warnstufeKennzahl[w].rolle;
  return rolle === 'alarm' ? 'alarm' : rolle === 'achtung' ? 'achtung' : 'neutral';
}

/**
 * Ein Wirestring (UTC ohne Zonenkennung) als Epoche, `NaN` bei Unbrauchbarem. Rein — nur die
 * Differenz wird gebraucht.
 */
export function wireAlsEpoche(wire: string): number {
  return Date.parse(`${wire.trim().replace(' ', 'T')}Z`);
}

/**
 * Einsatzdauer als `H:MM` (Stunden laufen über 24 weiter: „26:05"), bis `jetzt` bzw. zum Abschluss.
 * Ein Beginn in der Zukunft oder ein unlesbarer Wert ergibt `—:——`. Rein.
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

/** Schwelle der Notiz „n seit über 4 h" an „Vermisste" — gesetzt im Neuentwurf S3, keine Norm. */
export const VERMISST_LANG_MS = 4 * 60 * 60_000;

/**
 * Wie viele Vermisste sind länger als {@link VERMISST_LANG_MS} vermisst? Die Seite reicht ihren
 * Uhr-Takt durch, damit die Notiz ohne neue Daten nachzieht. Fehlendes `vermisst_seit` zählt nicht.
 * Rein.
 */
export function langeVermisst(
  personen: readonly Pick<Person, 'status' | 'vermisst_seit'>[],
  jetzt: number,
): number {
  let n = 0;
  for (const p of personen) {
    if (p.status !== 'vermisst' || !p.vermisst_seit) continue;
    const seit = wireAlsEpoche(p.vermisst_seit);
    if (Number.isFinite(seit) && jetzt - seit > VERMISST_LANG_MS) n++;
  }
  return n;
}

/** Notiz der Kennzahl „Vermisste". Rein. */
export function vermisstNotiz(vermisst: number, lang: number): string {
  if (vermisst === 0) return 'keine offenen Fälle';
  return lang > 0 ? `${lang} seit über 4 h` : 'als vermisst erfasst';
}

/**
 * Was die Seite über die Evakuierung weiß. Vier Fälle, weil der Abruf am Modulrecht hängt:
 * - `laden` / `fehler` — Zustand ihrer Abfrage; „····" bzw. „?".
 * - `kein-zugriff` — Betreuung ist ausgeblendet oder gesperrt, es wird nicht abgerufen. Die Zelle
 *   bleibt auf ihrem Platz (Kriterium 9) und nennt den Grund statt einer Zahl.
 * - `daten` — die Kennzahl, oder `null`, wenn kein aktiver Bezirk da ist, der (nicht live
 *   gehaltene) Einsatz den Auslöser aber noch trägt.
 */
export type EvakuierungStand =
  | { zustand: 'laden' }
  | { zustand: 'fehler' }
  | { zustand: 'kein-zugriff' }
  | { zustand: 'daten'; kennzahl: EvakuierungKennzahl | null };

/**
 * Hook-Zustand → {@link EvakuierungStand}. `aus` heißt „kein Zugriff"; vor `bereit` liefert der
 * Hook `laden`. Rein.
 */
export function evakuierungStand(z: EvakuierungKennzahlZustand): EvakuierungStand {
  switch (z.zustand) {
    case 'aus':
      return { zustand: 'kein-zugriff' };
    case 'laden':
      return { zustand: 'laden' };
    case 'fehler':
      return { zustand: 'fehler' };
    case 'daten':
      return { zustand: 'daten', kennzahl: z.kennzahl };
  }
}

/** Datenzustand der Zelle „Evakuiert": `laden`/`fehler` reichen durch, sonst Daten. Rein. */
export function evakuierungDatenzustand(e: EvakuierungStand): Datenzustand {
  return e.zustand === 'laden' || e.zustand === 'fehler' ? e.zustand : 'daten';
}

/** Wert und Notiz der Zelle „Evakuiert" aus dem Stand. Rein. */
function evakuiertZelle(e: EvakuierungStand): Pick<Kennzahl, 'wert' | 'notiz'> {
  switch (e.zustand) {
    case 'laden':
    case 'fehler':
      return { wert: '', notiz: '' };
    case 'kein-zugriff':
      return { wert: '—', notiz: 'Modul Betreuung nicht freigegeben' };
    case 'daten': {
      if (e.kennzahl == null) return { wert: '—', notiz: 'keine geplante Evakuierung' };
      // Formatierung wie der Blockkopf der Modulseite (`betreuungText.ts`). Ohne Meldung „—" statt
      // 0: „nichts gemeldet" ist nicht „niemand evakuiert".
      const { evakuiert, notiz } = kennzahlTeile(e.kennzahl);
      return { wert: evakuiert ?? '—', notiz };
    }
  }
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
  /** Maßgebliche Pegel in Reihenfolge, erster = Leitpegel. */
  pegel: PegelAnzeige[];
  /**
   * Ziel der Pegel-Kennzahl: „Wetter & Pegel", wenn frei (`pegelZielPfad`), sonst die Pflege in
   * Einstellungen › Pegel. Entscheidet die Seite — diese Datei kennt weder Benutzer noch Modulfreigaben.
   */
  pegelZiel?: string;
  /** Stand der Evakuierungskennzahl, siehe {@link evakuierungStand}. */
  evakuierung: EvakuierungStand;
  /**
   * Ziel der Zelle „Evakuiert": die Modulseite Betreuung, nur wenn feststeht, dass sie frei ist.
   * Ohne Angabe führt die Zelle nirgends hin, auch beim Laden.
   */
  evakuierungZiel?: string;
}

/**
 * `reihe` ist die Kennzahlreihe, die die Seite gerade zeigt (sie hält ihren Zuschnitt, siehe
 * `LageDashboardPage`). Ohne Angabe gilt die Reihe des Einsatzes.
 */
export function baueLagebild(
  r: Rohdaten,
  jetzt: number,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
  reihe: readonly KennzahlEtikett[] = kennzahlReihe(r.einsatz.lagekennzahlen),
): Lagebild {
  const kraefte = baueKraeftebild(
    r.abschnitte,
    r.einheiten,
    r.personal,
    r.fahrzeuge,
    r.material,
  ).verdichtung;
  const betroffene = verdichtePersonen(r.personen);
  const lang = langeVermisst(r.personen, jetzt);
  const uhs = verdichteUhs(r.uhs);
  const schaeden = verdichteSchaeden(r.schaeden);
  const gefahren = verdichteGefahrengebiete(r.gefahren);
  const bericht = neuesterLagebericht(r.lageberichte);
  const abgeschlossen = r.einsatz.abgeschlossen_at ?? null;
  const pegel = pegelKennzahl(r.pegel, jetzt, konv);
  const transport = transportBilanz(r.personen);

  // Jede Kennzahl, die das Band tragen kann; die Reihe wählt sechs davon. Der `Record` über
  // `KennzahlEtikett` erzwingt, dass jedes Etikett gebaut wird.
  const alle: Record<KennzahlEtikett, Kennzahl> = {
    Pegel: {
      // Ziel: „Wetter & Pegel" mit Verlauf, wenn frei, sonst die Einstellungssektion. Die Lagekarte
      // taugt nicht: per Deeplink kann sie die Ebene weder einschalten noch eine Station ansteuern.
      etikett: 'Pegel',
      wert: pegel.wert,
      einheit: pegel.einheit,
      notiz: pegel.notiz,
      ton: pegel.ton,
      route: 'einstellungen',
      zielPfad: r.pegelZiel ?? einsatzEinstellungenPfad(r.einsatz.id, 'pegel'),
    },
    'Verbleib offen': {
      // Angetroffene ohne Verbleib — dieselbe Zählung wie „Transportiert / offen" im
      // Sichtungspaneel.
      etikett: 'Verbleib offen',
      wert: String(transport.offen),
      notiz: `${transport.transportiert} transportiert`,
      ton: transport.offen > 0 ? 'achtung' : 'neutral',
      route: 'personen',
    },
    Betroffene: {
      etikett: 'Betroffene',
      wert: String(betroffene.gesamt),
      notiz: `${betroffene.patienten} Patienten`,
      ton: 'neutral',
      route: 'personen',
    },
    Kräfte: {
      // Die Gesamtstärke führt; F/UF/M//Σ steht in der Notiz, damit die BOS-Schreibweise erhalten
      // bleibt.
      etikett: 'Kräfte',
      wert: String(kraefte.staerke.gesamt),
      notiz: `${r.einheiten.length} Einheiten · ${staerkeText(kraefte.staerke)}`,
      ton: 'neutral',
      route: 'kraefteuebersicht',
    },
    Vermisste: {
      etikett: 'Vermisste',
      wert: String(betroffene.vermisst),
      notiz: vermisstNotiz(betroffene.vermisst, lang),
      ton: betroffene.vermisst > 0 ? 'alarm' : 'neutral',
      route: 'personen',
    },
    Evakuiert: {
      // Kein Ton: für „Evakuiert" gibt es keine Schwelle; mehr als geplant ist keine Alarmlage.
      etikett: 'Evakuiert',
      ...evakuiertZelle(r.evakuierung),
      ton: 'neutral',
      route: 'betreuung',
      zielPfad: r.evakuierungZiel,
      ohneZiel: r.evakuierungZiel == null,
    },
    'Schäden offen': {
      etikett: 'Schäden offen',
      wert: String(schaeden.offen),
      notiz: `von ${schaeden.gesamt} gemeldet`,
      ton: schaeden.offen > 0 ? 'achtung' : 'neutral',
      route: 'schaeden',
    },
    Einsatzdauer: {
      etikett: 'Einsatzdauer',
      wert: einsatzdauer(r.einsatz.begonnen_at, jetzt, abgeschlossen),
      einheit: 'h',
      notiz: abgeschlossen
        ? `beendet ${formatUhrzeitMitTag(abgeschlossen, konv)}`
        : `seit ${formatUhrzeitMitTag(r.einsatz.begonnen_at, konv)}`,
      ton: 'neutral',
      route: 'einsatzdaten',
    },
  };
  const kennzahlen = reihe.map((e) => alle[e]);

  return {
    kennzahlen,
    sk: betroffene.sk,
    betroffeneGesamt: betroffene.gesamt,
    hoechsteWarnstufe: gefahren.hoechste,
    gebieteMitWarnstufe: gefahren.anzahlAktiv,
    fuehrung: {
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
