import { IconBericht, IconPlus } from '../../icons';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Breadcrumb, Button, Skeleton } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import EinsatzSeite from '../../components/EinsatzSeite';
import { RechteHinweis } from '../../components/SpeicherHinweis';
import { useAuth } from '../../auth/AuthContext';
import {
  istKeyFreigegeben,
  istSprungGesperrt,
  KEINE_BERECHTIGUNG,
} from '../../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { useModulWahl } from '../../einsatz/useModulWahl';
import {
  Augenbraue,
  Kennzahl,
  Kennzahlenband,
  Paneel,
  StatusZelle,
  Zeitachseneintrag,
  monoStil,
  useRollen,
  type KennzahlZustand,
} from '../../components/instrument';
import { einsatzKeys } from '../../api/queryKeys';
import { schlechtesterZustand, type AbrufZustand } from '../../api/abrufZustand';
import { verfasserText } from '../../etb/verfasser';
import { ladeEinsatz, ladeModulFreigaben } from '../../api/einsaetze';
import { listePersonen } from '../../api/einsatzPerson';
import { listeEinsatzPersonal } from '../../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../../api/einsatzFahrzeuge';
import { listeEinsatzMaterial } from '../../api/einsatzMaterial';
import { listeEinheiten } from '../../api/einheiten';
import { listeAbschnitte } from '../../api/einsatzabschnitte';
import { ladeGefahrengebiete } from '../../api/gefahren';
import { listeAuftraege } from '../../api/auftraege';
import { listeErinnerungen } from '../../api/erinnerungen';
import { listeEtb } from '../../api/etb';
import { holeRueckmeldungen } from '../../api/meldungen';
import { ladeModulZaehler } from '../../api/modulZaehler';
import { NICHT_FREIGEGEBEN, auftragsStand } from '../lage-dashboard/fuehrungsZahlen';
import { pegelAbfrage } from '../../api/pegel';
import { wetterAbfrage } from '../../api/wetter';
import { unwetterLage } from '../../wetter/unwetter';
import { PEGEL_STAND_UNBEKANNT, pegelNotizKurz } from '../../pegel/pegelKennzahl';
import { listeAbloesungen } from '../../api/abloesungen';
import { darfZaehlerZeigen } from '../../einsatz/useModulZaehler';
import {
  auftraegePfad,
  einheitenPfad,
  einsaetzePfad,
  einsatzabschnittePfad,
  erinnerungenPfad,
  etbPfad,
  gefahrenPfad,
  kraefteuebersichtPfad,
  lageberichtePfad,
  personenPfad,
  stabPfad,
  abloesungPfad,
  pegelZielPfad,
  wetterPegelPfad,
} from '../../routing/deeplinks';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { formatUhrzeit, formatUhrzeitMitTag } from '../../anzeige/format';
import { abschnittLagezustand, etbTyp, rollenFarbe } from '../../theme/statusFarben';
import StatusTag from '../../components/StatusTag';
import { useViewport } from '../../components/useViewport';
import {
  abschnittNamen,
  abschnittZeilen,
  auftraegeKennzahl,
  betroffeneKennzahl,
  empfaengerText,
  entscheidungenAuswahl,
  folgeText,
  kraefteKennzahl,
  naechsteMarken,
  offeneAuftraege,
  warnstufeKennzahlVon,
  warnstufeNotiz,
  ueberblickRechteText,
  type AbschnittZeile,
  type Marke,
} from './ueberblickDaten';
import { MARKEN_BREITE, rasterStil, zeilenzielStil } from './ueberblickStil';

/**
 * Führung · Überblick — die Startseite eines Einsatzes. Die Bedeutung jeder Zahl steht in
 * `ueberblickDaten.ts`; hier wird nur verdrahtet und angeordnet.
 *
 * Datenzustände je Block, nicht einer für die Seite: jede Kennzahl und jedes Paneel hängt an seinen
 * Queries und unterscheidet lädt / Fehler / leer. Alle Queries laufen über `einsatzKeys` (live);
 * die Reihenfolgen sind per id-Tiebreak vollständig bestimmt, ein Refetch ordnet nichts um.
 *
 * Pegel-Notiz an der Warnstufe (aus `pegel/pegelKennzahl.ts`): ohne festgelegten Pegel keine Notiz,
 * bei Ausfall „Pegel: Stand unbekannt". Der Pegel-Abruf bestimmt nicht den Zustand der Kennzahl —
 * sie gehört der Warnstufe. Ebenso nimmt ein gescheiterter Pegel-Abruf im Markenpaneel nur die
 * Prognose-Marke weg.
 *
 * Letzte Rückmeldung je Abschnitt: die Quelle hängt am Leserecht auf „Meldungen" und läuft deshalb
 * nicht durch `zustandVon` — ein 403 ist für Rollen ohne das Modul der Normalfall. Solange sie lädt
 * oder scheitert, zeigt die Zeile dazu nichts.
 *
 * Modulgrenze der Quellen (LFH-669, Spec `modul-freigabe`): jede Liste eines fremden Moduls läuft
 * nur, wenn der Server das Modul freigibt — ohne bekannte Freigaben (Laden, Fehler) gar nicht.
 * Gesperrt ist weder Ausfall noch leerer Bestand: eine Kennzahl steht als „—" mit „nicht
 * freigegeben" (wie die Aufträge aus dem Modulzähler), ein Paneel nennt den Grund; Altstand im
 * Cache bleibt unsichtbar. Scheitern die Freigaben selbst, zeigen die gebundenen Blöcke „Stand
 * unbekannt". Nur Beiwerk (Rückmeldungen, Aufträge in der Abschnittszeile, Fristen der Marken)
 * entfällt still, wie die Ablösungsmarken.
 *
 * Keine erfundenen Daten: Lagezustand, Kürzel, fester Auftrag und Fortschritt kommen aus dem
 * Abschnitt selbst und fehlen, solange sie dort nicht gepflegt sind.
 */

/** Der Entscheidungsabruf: nur Typ „Entscheidung", ein Deckel, der die letzte Stunde
 *  eines Großeinsatzes sicher trägt. Konstante, damit der Query-Key stabil bleibt. */
const ETB_ENTSCHEIDUNGEN = { typ: 'entscheidung' as const, limit: 50 };
/** Wie viele offene Aufträge das Paneel zeigt; der Rest steht im Modul. */
const AUFTRAEGE_MAX = 8;

/** `gesperrt`: das Modul der Quelle ist für die Person nicht freigegeben (LFH-669). */
type Zustand = AbrufZustand;

/** Eine Quelle der Seite: ihre Abfrage und ob ihr Modul frei ist (modul-lose Quellen: `true`). */
interface Quelle {
  q: UseQueryResult<unknown>;
  frei: boolean;
}

/** Stand der Freigaben: solange sie fehlen, ist jede gebundene Quelle unbestimmt. */
type FreigabenStand = 'da' | 'laden' | 'fehler';

/**
 * Gesperrt vor Fehler vor Laden (`schlechtesterZustand`): eine halb geladene Fläche mit totem Teil
 * darf nicht vollständig aussehen, und ein gesperrter Teil wird durch Neuladen nicht frei.
 */
function zustandVon(freigaben: FreigabenStand, ...quellen: Quelle[]): Zustand {
  return schlechtesterZustand(
    ...quellen.map(({ q, frei }): Zustand => {
      if (!frei) return freigaben === 'da' ? 'gesperrt' : freigaben;
      if (q.isError) return 'fehler';
      if (q.isLoading) return 'laden';
      return 'daten';
    }),
  );
}

/** Der Zustand, den eine Kennzahl kennt — gesperrt steht als Wert „—" mit Grund da. */
function kennzahlZustand(z: Zustand): KennzahlZustand {
  return z === 'gesperrt' ? 'daten' : z;
}

/** Die Uhr der Seite — tickt alle 30 s, damit „in 60 min" und Fristfarben mitlaufen. */
function useJetzt(intervallMs = 30_000): Dayjs {
  const [jetzt, setJetzt] = useState(() => dayjs());
  useEffect(() => {
    const t = window.setInterval(() => setJetzt(dayjs()), intervallMs);
    return () => window.clearInterval(t);
  }, [intervallMs]);
  return jetzt;
}

/** Icon mit `aria-hidden`-Hülle (Bedien-Leitlinie: der Name kommt aus dem Text). */
function Icon({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" style={{ display: 'inline-flex' }}>
      {children}
    </span>
  );
}

/**
 * Lade-, Fehler- und Leerzustand eines Paneels. `leer` gilt nur im Zustand `daten`: „lädt" und
 * „Stand unbekannt" sind kein Befund.
 */
function Zustandsfeld({
  zustand,
  leer,
  leerText,
  leerAktion,
  onNeuladen,
  children,
}: {
  zustand: Zustand;
  leer: boolean;
  leerText: string;
  leerAktion?: { text: string; ziel: string };
  onNeuladen: () => void;
  children: ReactNode;
}) {
  const { token, rollen } = useRollen();
  const { waehle } = useModulWahl();
  const polster = { padding: token.padding } as const;
  if (zustand === 'laden') {
    // Die Form des Leerzustands (LFH-629): Satzzeile und, wo „leer“ eine Aktion trägt, ihr Platz
    // in Knopfhöhe. Nur der Satz allein war auf dem Handschirm 38 px niedriger als „leer“, und die
    // drei gestapelten Paneele schoben das letzte um über 100 px. Ob die Aktion kommt, steht beim
    // Rendern fest: der Körper der Seite wartet auf den Einsatz und damit auf das Schreibrecht.
    return (
      <div
        aria-busy="true"
        style={{ ...polster, display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <span style={{ fontSize: 12, color: rollen.gedaempft }}>wird abgerufen</span>
        {leerAktion && (
          <span>
            <Skeleton.Button active />
          </span>
        )}
      </div>
    );
  }
  if (zustand === 'gesperrt') {
    // Kein Ausfall (kein `alert`, kein Neuladen) und kein Leerzustand: der Grund steht da.
    return (
      <div style={{ ...polster, fontSize: 12, color: rollen.gedaempft }}>
        Modul nicht freigegeben.
      </div>
    );
  }
  if (zustand === 'fehler') {
    return (
      <div role="alert" style={{ ...polster, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, color: rollen.text2 }}>
          Stand unbekannt — Daten nicht abrufbar. Nicht als Lage melden.
        </span>
        <span>
          <Button onClick={onNeuladen}>Erneut abrufen</Button>
        </span>
      </div>
    );
  }
  if (leer) {
    return (
      <div style={{ ...polster, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, color: rollen.gedaempft }}>{leerText}</span>
        {leerAktion && (
          <span>
            <Button onClick={() => waehle(leerAktion.ziel)}>{leerAktion.text}</Button>
          </span>
        )}
      </div>
    );
  }
  return <>{children}</>;
}

export default function UeberblickPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { waehle, linkFaenger } = useModulWahl();
  const { token, rollen } = useRollen();
  const { abBreite } = useViewport();
  const breit = abBreite('lg');
  const { konventionen } = useAnzeigeKonventionen();
  const jetzt = useJetzt();
  const { benutzer } = useAuth();

  const einsatzQ = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  // Modulgrenze (LFH-669, Dateikopf): die Freigaben vor den Listen, jede gebundene Liste mit
  // `enabled` an ihrem Modul (Keys nach `PFAD_KEY` in `src/einsatz/modul.rs`).
  const freigabenQ = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const freigaben = freigabenQ.data;
  // Ein gescheiterter Neuabruf lässt die alten Freigaben gültig, wie auf der Lagekarte.
  const freigabenStand: FreigabenStand =
    freigaben !== undefined ? 'da' : freigabenQ.isError ? 'fehler' : 'laden';
  const personenFrei = istKeyFreigegeben('personen', freigaben);
  const personalFrei = istKeyFreigegeben('personal', freigaben);
  const fahrzeugeFrei = istKeyFreigegeben('fahrzeuge', freigaben);
  const materialFrei = istKeyFreigegeben('material', freigaben);
  const einheitenFrei = istKeyFreigegeben('einheiten', freigaben);
  const abschnitteFrei = istKeyFreigegeben('einsatzabschnitte', freigaben);
  const gefahrenFrei = istKeyFreigegeben('gefahrenzonen', freigaben);
  const auftraegeFrei = istKeyFreigegeben('auftraege', freigaben);
  const erinnerungenFrei = istKeyFreigegeben('erinnerungen', freigaben);
  const etbFrei = istKeyFreigegeben('etb', freigaben);
  const rueckmeldungenFrei = istKeyFreigegeben('meldungen', freigaben);
  // Sprungziele (LFH-888, design.md D4): Lesart der Navigation — gesperrt nur, wenn der Server
  // es sagt; solange die Freigaben laden, steht kein Knopf gesperrt da.
  const lageberichtGesperrt = istSprungGesperrt('lageberichte', freigaben);
  const etbSprungGesperrt = istSprungGesperrt('etb', freigaben);
  const meldebildGesperrt = istSprungGesperrt('kraefteuebersicht', freigaben);
  const stabGesperrt = istSprungGesperrt('stab', freigaben);

  const personenQ = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
    enabled: personenFrei,
  });
  const personalQ = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
    enabled: personalFrei,
  });
  const fahrzeugeQ = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
    enabled: fahrzeugeFrei,
  });
  const materialQ = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listeEinsatzMaterial(einsatzId),
    enabled: materialFrei,
  });
  const einheitenQ = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: einheitenFrei,
  });
  const abschnitteQ = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: abschnitteFrei,
  });
  const gefahrenQ = useQuery({
    queryKey: einsatzKeys.gefahrengebiete(einsatzId),
    queryFn: () => ladeGefahrengebiete(einsatzId),
    enabled: gefahrenFrei,
  });
  const auftraegeQ = useQuery({
    queryKey: einsatzKeys.auftraege(einsatzId),
    queryFn: () => listeAuftraege(einsatzId),
    enabled: auftraegeFrei,
  });
  // Die Kennzahl „Offene Aufträge" zählt der Server (LFH-550): derselbe Cache wie das Modulpanel.
  // Die Liste darüber speist nur das Paneel und die Fristen.
  const zaehlerQ = useQuery({
    queryKey: einsatzKeys.modulZaehler(einsatzId),
    queryFn: () => ladeModulZaehler(einsatzId),
  });
  const erinnerungenQ = useQuery({
    queryKey: einsatzKeys.erinnerungen(einsatzId),
    queryFn: () => listeErinnerungen(einsatzId, false),
    enabled: erinnerungenFrei,
  });
  // Ablösungsmarken nur, wenn das Modul sichtbar und frei ist — sonst 403 und ein Seitenkanal über
  // ausgeblendete Daten (dieselbe Prüfung wie `darfZaehlerZeigen`).
  const abloesungSichtbar = freigabenQ.isSuccess && darfZaehlerZeigen('abloesung', freigabenQ.data);
  // „Erwarteter Höchststand" führt auf „Wetter & Pegel", wenn das Modul frei ist, sonst auf die
  // Pflege (`pegelZielPfad`).
  const wetterPegelFrei =
    freigabenQ.isSuccess && istKeyFreigegeben('wetter-pegel', freigabenQ.data);
  const abloesungenQ = useQuery({
    queryKey: einsatzKeys.abloesungListe(einsatzId, 'laufend'),
    queryFn: () => listeAbloesungen(einsatzId, 'laufend'),
    enabled: abloesungSichtbar,
  });
  const etbQ = useQuery({
    queryKey: einsatzKeys.etbListe(einsatzId, ETB_ENTSCHEIDUNGEN),
    queryFn: () => listeEtb(einsatzId, ETB_ENTSCHEIDUNGEN),
    enabled: etbFrei,
  });
  const rueckmeldungenQ = useQuery({
    queryKey: einsatzKeys.meldungenRueckmeldungen(einsatzId),
    queryFn: () => holeRueckmeldungen(einsatzId),
    enabled: rueckmeldungenFrei,
  });
  const pegelQ = useQuery(pegelAbfrage(einsatzId));
  // Unwettermarken nur bei freiem Modul — sonst 403 und ein Seitenkanal (LFH-663). Dieselbe
  // Abfrage wie Modulseite und Rahmen, also kein zusätzlicher Abruf.
  const wetterQ = useQuery({ ...wetterAbfrage(einsatzId), enabled: wetterPegelFrei });

  const einsatz = einsatzQ.data;
  /*
   * Schreibwege hängen am Einsatz-Schreibrecht. Solange der Einsatz lädt: gesperrt, aber ohne
   * Hinweis — ein beim Laden aufblitzender Grund wäre falsch.
   */
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);
  // Daten nur aus freien Quellen: der Cache eines gesperrten Moduls kann einen Altstand tragen.
  const personen = personenFrei ? personenQ.data : undefined;
  const personal = personalFrei ? personalQ.data : undefined;
  const fahrzeuge = fahrzeugeFrei ? fahrzeugeQ.data : undefined;
  const material = materialFrei ? materialQ.data : undefined;
  const einheiten = einheitenFrei ? einheitenQ.data : undefined;
  const abschnitte = abschnitteFrei ? abschnitteQ.data : undefined;
  const gefahren = gefahrenFrei ? gefahrenQ.data : undefined;
  const auftraege = auftraegeFrei ? auftraegeQ.data : undefined;
  const erinnerungen = erinnerungenFrei ? erinnerungenQ.data : undefined;
  const etb = etbFrei ? etbQ.data : undefined;
  // Nur ein erfolgreicher Abruf zählt: react-query behält `data` nach einem Fehler, das wäre eine
  // stille Aussage über veraltete Daten.
  const rueckmeldungen =
    !rueckmeldungenFrei || rueckmeldungenQ.isError ? undefined : rueckmeldungenQ.data;

  const betroffene = useMemo(() => betroffeneKennzahl(personen ?? [], jetzt), [personen, jetzt]);
  const kraefte = useMemo(
    () => kraefteKennzahl(personal ?? [], fahrzeuge ?? [], material ?? []),
    [personal, fahrzeuge, material],
  );
  const warnstufe = useMemo(() => warnstufeKennzahlVon(gefahren ?? []), [gefahren]);
  const pegel = pegelQ.data;
  const pegelNotiz = useMemo(
    () =>
      pegelQ.isError
        ? `Pegel: ${PEGEL_STAND_UNBEKANNT}`
        : pegel
          ? pegelNotizKurz(pegel, jetzt.valueOf())
          : null,
    [pegelQ.isError, pegel, jetzt],
  );
  const auftragsstand = auftragsStand(zaehlerQ);
  const auftragszahl =
    auftragsstand.zustand === 'daten' ? auftraegeKennzahl(auftragsstand.zahl) : null;
  const offene = useMemo(() => offeneAuftraege(auftraege ?? []), [auftraege]);
  const zeilen = useMemo(
    () =>
      abschnittZeilen({
        abschnitte: abschnitte ?? [],
        einheiten: einheiten ?? [],
        personal: personal ?? [],
        fahrzeuge: fahrzeuge ?? [],
        material: material ?? [],
        auftraege: auftraege ?? [],
        rueckmeldungen,
      }),
    [abschnitte, einheiten, personal, fahrzeuge, material, auftraege, rueckmeldungen],
  );
  const entscheidungen = useMemo(() => entscheidungenAuswahl(etb ?? [], jetzt), [etb, jetzt]);
  // Ein Wetterfehler macht die Marken NICHT zum Fehlerzustand: dann fehlen nur die Unwettermarken,
  // wie Zähler und Hinweis auch (design.md D8).
  const wetterWarnungen = wetterPegelFrei && wetterQ.isSuccess ? wetterQ.data.warnungen : undefined;
  const angekuendigtesUnwetter = useMemo(
    () => unwetterLage(wetterWarnungen, jetzt.valueOf())?.angekuendigt ?? [],
    [wetterWarnungen, jetzt],
  );
  const marken = useMemo(
    () =>
      naechsteMarken(
        auftraege ?? [],
        erinnerungen ?? [],
        einsatz?.naechste_lagebesprechung_at,
        jetzt,
        pegel ?? [],
        abloesungSichtbar ? (abloesungenQ.data ?? []) : [],
        angekuendigtesUnwetter,
      ),
    [
      auftraege,
      erinnerungen,
      einsatz?.naechste_lagebesprechung_at,
      jetzt,
      pegel,
      abloesungSichtbar,
      abloesungenQ.data,
      angekuendigtesUnwetter,
    ],
  );

  const qEinsatz: Quelle = { q: einsatzQ, frei: true };
  const qPersonen: Quelle = { q: personenQ, frei: personenFrei };
  const qPersonal: Quelle = { q: personalQ, frei: personalFrei };
  const qFahrzeuge: Quelle = { q: fahrzeugeQ, frei: fahrzeugeFrei };
  const qMaterial: Quelle = { q: materialQ, frei: materialFrei };
  const qEinheiten: Quelle = { q: einheitenQ, frei: einheitenFrei };
  const qAbschnitte: Quelle = { q: abschnitteQ, frei: abschnitteFrei };
  const qGefahren: Quelle = { q: gefahrenQ, frei: gefahrenFrei };
  const qAuftraege: Quelle = { q: auftraegeQ, frei: auftraegeFrei };
  const qErinnerungen: Quelle = { q: erinnerungenQ, frei: erinnerungenFrei };
  const qEtb: Quelle = { q: etbQ, frei: etbFrei };
  /** Beiwerk entfällt still, wenn sein Modul gesperrt ist; unbekannt bleibt es unbestimmt. */
  const ohneGesperrte = (...quellen: Quelle[]) =>
    quellen.filter((x) => x.frei || freigabenStand !== 'da');

  const zBetroffene = zustandVon(freigabenStand, qPersonen);
  const zKraefte = zustandVon(freigabenStand, qPersonal, qFahrzeuge, qMaterial);
  const zWarnstufe = zustandVon(freigabenStand, qGefahren);
  const zAuftraege = zustandVon(freigabenStand, qAuftraege);
  const zAbschnitteZahl = zustandVon(freigabenStand, qAbschnitte);
  const zAbschnitte = zustandVon(
    freigabenStand,
    qAbschnitte,
    qEinheiten,
    qPersonal,
    qFahrzeuge,
    qMaterial,
  );
  const zEntscheidungen = zustandVon(freigabenStand, qEtb);
  // Die Marken sammeln Fristen aus mehreren Quellen; eine gesperrte trägt nichts bei (wie die
  // Ablösungen), die Lagebesprechung bleibt.
  const zMarken = zustandVon(freigabenStand, qEinsatz, ...ohneGesperrte(qAuftraege, qErinnerungen));
  /** „Erneut abrufen": gescheiterte Freigaben zuerst, Listen nur freier Module. */
  const nachladen = (...quellen: Quelle[]) => {
    if (freigabenStand === 'fehler') void freigabenQ.refetch();
    for (const { q, frei } of quellen) if (frei) void q.refetch();
  };

  const zeile = zeilenzielStil(rollen, token);
  const uhrzeit = (s: string | null | undefined) => formatUhrzeit(s, konventionen);
  const frist = (s: string | null | undefined) => formatUhrzeitMitTag(s, konventionen);
  const auftraegeFehlen = auftraegeFrei && auftraegeQ.isError;

  /** Ziel einer Marke; die Lagebesprechung führt nur in einen freien Stab (LFH-888). */
  const markenZiel = (m: Marke): string | undefined =>
    m.art === 'auftrag'
      ? auftraegePfad(einsatzId, { auftrag: m.id ?? undefined })
      : m.art === 'erinnerung'
        ? erinnerungenPfad(einsatzId)
        : m.art === 'pegelprognose'
          ? pegelZielPfad(einsatzId, wetterPegelFrei)
          : m.art === 'abloesung'
            ? abloesungPfad(einsatzId)
            : m.art === 'unwetter'
              ? wetterPegelPfad(einsatzId)
              : stabGesperrt
                ? undefined
                : stabPfad(einsatzId);
  const markenFarbe = (m: Marke) =>
    m.ton === 'alarm' ? rollen.alarmText : m.ton === 'achtung' ? rollen.achtungText : rollen.text;

  const ueberfaelligMeta =
    zAuftraege === 'daten' && auftragszahl ? (
      <span
        style={{
          color: auftragszahl.ueberfaellig > 0 ? rollen.achtungText : rollen.schwach,
        }}
      >
        {auftragszahl.ueberfaellig > 0
          ? `${auftragszahl.ueberfaellig} überfällig`
          : 'keine überfällig'}
      </span>
    ) : undefined;

  const entscheidungTitel =
    entscheidungen.modus === 'stunde'
      ? 'Entscheidungen der letzten Stunde'
      : 'Letzte Entscheidungen';

  return (
    // Jeder Link der Seite ist eine Modulwahl für „Zuletzt besucht" (LFH-436, `useModulWahl`).
    // `display: contents`: die Hülle trägt nur den Fänger und nimmt am Layout nicht teil.
    <div style={{ display: 'contents' }} {...linkFaenger}>
      <EinsatzSeite
        titel="Überblick"
        breadcrumb={
          <Breadcrumb
            items={[
              { title: <Link to={einsaetzePfad()}>Einsätze</Link> },
              { title: einsatz?.bezeichnung ?? '…' },
              { title: 'Überblick' },
            ]}
          />
        }
        dataUpdatedAt={einsatzQ.dataUpdatedAt}
        // Bedingt übergeben: ein JSX-Element ist immer truthy und hinterließe ein leeres `div` mit
        // Außenabstand.
        hinweis={
          einsatz != null &&
          !darfSchreiben && <RechteHinweis sichtbar text={ueberblickRechteText(einsatz.status)} />
        }
        aktionen={
          <>
            <Button
              icon={
                <Icon>
                  <IconBericht size={14} />
                </Icon>
              }
              // Gesperrt statt versteckt, mit Grund (M16, LFH-888).
              disabled={lageberichtGesperrt}
              title={lageberichtGesperrt ? KEINE_BERECHTIGUNG : undefined}
              onClick={() => waehle(lageberichtePfad(einsatzId))}
            >
              Lagebericht
            </Button>
            {/* Gesperrt statt versteckt: der Hinweis darüber nennt den Grund. */}
            <Button
              type="primary"
              disabled={!darfSchreiben || etbSprungGesperrt}
              title={etbSprungGesperrt ? KEINE_BERECHTIGUNG : undefined}
              icon={
                <Icon>
                  <IconPlus size={14} />
                </Icon>
              }
              onClick={() => waehle(etbPfad(einsatzId, { neu: true }))}
            >
              Eintrag
            </Button>
          </>
        }
      >
        {/* Der Körper wartet auf den Einsatz (LFH-629): ob über ihm der Rechtehinweis steht und ob
            die Paneele eine Leeraktion tragen, hängt an `meine_rolle` und `status`. Davor
            aufgebaut, rückte der Hinweis für Beobachter alles um 79 px (CLS 0,156 auf 390 px).
            Ein erscheinender Körper verschiebt nichts; ein verschobener schon. Bis dahin steht
            NICHTS im Inhalt, auch kein „wird abgerufen“: jeder sichtbare Platzhalter rückte mit dem
            Hinweis nach unten. Das Laden zeigt der Spinner am Einsatznamen der Kopfleiste. */}
        {einsatzQ.isLoading ? null : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginLG }}>
            {/* Notizplatz wie im Lage-Dashboard: unter `md` Boden (LFH-629), ab `md` drei Zeilen
              Boden und Deckel (LFH-691). */}
            <Kennzahlenband beschriftung="Lage in Zahlen" notizZeilenSchmal={2} notizZeilen={3}>
              {/* Gesperrt: „—" mit Grund und ohne Link, wie die Aufträge aus dem Modulzähler. */}
              <Kennzahl
                titel="Betroffene"
                groesse="gross"
                zustand={kennzahlZustand(zBetroffene)}
                wert={zBetroffene === 'gesperrt' ? '—' : betroffene.anzahl}
                einheit={zBetroffene === 'gesperrt' ? undefined : 'Pers.'}
                notiz={
                  zBetroffene === 'gesperrt' ? NICHT_FREIGEGEBEN : `+${betroffene.neu} in 60 min`
                }
                ziel={zBetroffene === 'gesperrt' ? undefined : personenPfad(einsatzId)}
              />
              <Kennzahl
                titel="Kräfte im Einsatz"
                groesse="gross"
                zustand={kennzahlZustand(zKraefte)}
                wert={zKraefte === 'gesperrt' ? '—' : kraefte.gesamt}
                einheit={zKraefte === 'gesperrt' ? undefined : 'Ges.'}
                notiz={zKraefte === 'gesperrt' ? NICHT_FREIGEGEBEN : `F/UF/M//Σ ${kraefte.text}`}
                ziel={meldebildGesperrt ? undefined : kraefteuebersichtPfad(einsatzId)}
              />
              <Kennzahl
                titel="Warnstufe"
                groesse="gross"
                zustand={kennzahlZustand(zWarnstufe)}
                ton={zWarnstufe === 'gesperrt' ? 'neutral' : warnstufe.ton}
                wert={zWarnstufe === 'gesperrt' ? '—' : warnstufe.wort}
                notiz={
                  zWarnstufe === 'gesperrt'
                    ? [NICHT_FREIGEGEBEN, pegelNotiz].filter(Boolean).join(' · ')
                    : warnstufeNotiz(warnstufe.anzahlAktiv, pegelNotiz)
                }
                ziel={zWarnstufe === 'gesperrt' ? undefined : gefahrenPfad(einsatzId)}
              />
              <Kennzahl
                titel="Offene Aufträge"
                groesse="gross"
                zustand={
                  auftragsstand.zustand === 'laden' || auftragsstand.zustand === 'fehler'
                    ? auftragsstand.zustand
                    : 'daten'
                }
                ton={auftragszahl?.ton ?? 'neutral'}
                wert={auftragszahl?.offen ?? '—'}
                einheit={
                  auftragszahl && auftragszahl.ueberfaellig > 0
                    ? `davon ${auftragszahl.ueberfaellig} ü.`
                    : undefined
                }
                notiz={
                  !auftragszahl
                    ? NICHT_FREIGEGEBEN
                    : auftragszahl.ueberfaellig > 0
                      ? `${auftragszahl.inArbeit} in Arbeit`
                      : `keine über Frist · ${auftragszahl.inArbeit} in Arbeit`
                }
                ziel={auftragsstand.zustand === 'gesperrt' ? undefined : auftraegePfad(einsatzId)}
              />
              <Kennzahl
                titel="Einsatzabschnitte"
                groesse="gross"
                zustand={kennzahlZustand(zAbschnitteZahl)}
                wert={zAbschnitteZahl === 'gesperrt' ? '—' : (abschnitte?.length ?? 0)}
                notiz={
                  zAbschnitteZahl === 'gesperrt'
                    ? NICHT_FREIGEGEBEN
                    : abschnitte && abschnitte.length > 0
                      ? abschnittNamen(abschnitte)
                      : 'noch keine angelegt'
                }
                ziel={zAbschnitteZahl === 'gesperrt' ? undefined : einsatzabschnittePfad(einsatzId)}
              />
            </Kennzahlenband>

            <div style={rasterStil(breit, token.marginLG)}>
              <Paneel
                titel="Einsatzabschnitte"
                meta={
                  zAbschnitte === 'daten'
                    ? `${abschnitte?.length ?? 0} Abschnitte · ${einheiten?.length ?? 0} Einheiten`
                    : undefined
                }
                fuss={
                  zAbschnitte === 'daten' && zeilen.length > 0 ? (
                    <span style={{ ...monoStil(10), color: rollen.schwach }}>
                      Einheiten nach Status: bereit · gebunden · Ausfall
                      {auftraegeFehlen && ' — Aufträge nicht abrufbar, Auftragstexte fehlen'}
                    </span>
                  ) : undefined
                }
              >
                <Zustandsfeld
                  zustand={zAbschnitte}
                  leer={zeilen.length === 0}
                  leerText="Noch keine Abschnitte und keine Kräfte erfasst."
                  leerAktion={
                    darfSchreiben
                      ? { text: 'Abschnitt anlegen', ziel: einsatzabschnittePfad(einsatzId) }
                      : undefined
                  }
                  onNeuladen={() =>
                    nachladen(qAbschnitte, qEinheiten, qPersonal, qFahrzeuge, qMaterial)
                  }
                >
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {zeilen.map((z) => (
                      <li key={z.key}>
                        <AbschnittEintrag
                          zeile={z}
                          zeit={frist}
                          ziel={
                            z.abschnittId != null
                              ? einsatzabschnittePfad(einsatzId, { abschnitt: z.abschnittId })
                              : einheitenPfad(einsatzId)
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </Zustandsfeld>
              </Paneel>

              <Paneel titel="Offene Aufträge" meta={ueberfaelligMeta}>
                <Zustandsfeld
                  zustand={zAuftraege}
                  leer={offene.length === 0}
                  leerText="Keine offenen Aufträge."
                  leerAktion={{ text: 'Zu den Aufträgen', ziel: auftraegePfad(einsatzId) }}
                  onNeuladen={() => nachladen(qAuftraege)}
                >
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {offene.slice(0, AUFTRAEGE_MAX).map((a) => {
                      const farbe = a.ist_ueberfaellig ? rollen.alarmText : rollen.gedaempft;
                      return (
                        <li key={a.id}>
                          <Link
                            to={auftraegePfad(einsatzId, { auftrag: a.id })}
                            data-lfh="ueberblick-auftrag"
                            style={zeile}
                          >
                            <span style={{ ...monoStil(11), color: farbe, flex: '0 0 40px' }}>
                              {uhrzeit(a.erteilt_at)}
                            </span>
                            <span
                              style={{
                                flex: '1 1 auto',
                                minWidth: 0,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 12,
                                  lineHeight: 1.45,
                                  color: rollen.text2,
                                  overflowWrap: 'anywhere',
                                }}
                              >
                                {a.auftrag_text}
                              </span>
                              <span style={{ ...monoStil(10), color: rollen.schwach }}>
                                {[
                                  empfaengerText(a) ? `an ${empfaengerText(a)}` : 'ohne Empfänger',
                                  a.frist_at ? `Frist ${frist(a.frist_at)}` : 'ohne Frist',
                                ].join(' · ')}
                              </span>
                            </span>
                            <span
                              style={{
                                ...monoStil(10),
                                letterSpacing: '0.06em',
                                color: farbe,
                                flex: '0 0 auto',
                              }}
                            >
                              {a.ist_ueberfaellig ? 'überfällig' : 'läuft'}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                  {offene.length > AUFTRAEGE_MAX && (
                    <Link
                      to={auftraegePfad(einsatzId)}
                      style={{ ...zeile, ...monoStil(11), color: rollen.bedien, borderBlockEnd: 0 }}
                    >
                      alle {offene.length} offenen Aufträge ↗
                    </Link>
                  )}
                </Zustandsfeld>
              </Paneel>

              <div
                style={{
                  gridColumn: '1 / -1',
                  display: 'flex',
                  flexDirection: breit ? 'row' : 'column',
                  minWidth: 0,
                }}
              >
                <Paneel
                  titel={entscheidungTitel}
                  style={{ flex: '1 1 auto' }}
                  meta={
                    zEntscheidungen === 'daten' &&
                    entscheidungen.modus === 'zuletzt' &&
                    entscheidungen.eintraege.length > 0
                      ? 'keine in der letzten Stunde'
                      : undefined
                  }
                  aktion={
                    // Kein Sprung ins gesperrte ETB (wie die Kennzahlen ohne Link).
                    zEntscheidungen === 'gesperrt' ? undefined : (
                      <Link
                        to={etbPfad(einsatzId, { typ: 'entscheidung' })}
                        aria-label="Entscheidungen im Einsatztagebuch öffnen"
                        style={{
                          ...monoStil(11),
                          color: rollen.bedien,
                          display: 'inline-flex',
                          alignItems: 'center',
                          minHeight: token.controlHeight,
                          paddingInline: token.paddingXS,
                        }}
                      >
                        ETB ↗
                      </Link>
                    )
                  }
                >
                  <Zustandsfeld
                    zustand={zEntscheidungen}
                    leer={entscheidungen.eintraege.length === 0}
                    leerText="Noch keine Entscheidung im Einsatztagebuch."
                    leerAktion={
                      darfSchreiben
                        ? { text: 'Eintrag erfassen', ziel: etbPfad(einsatzId, { neu: true }) }
                        : undefined
                    }
                    onNeuladen={() => nachladen(qEtb)}
                  >
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {entscheidungen.eintraege.map((e) => {
                        // Aus dem ETB-Eintrag selbst, nicht aus der Auftragsliste — die bekommt nicht,
                        // wer das Aufträge-Modul gesperrt hat.
                        const folgeWort = folgeText(e.folgeauftraege.length);
                        return (
                          <Zeitachseneintrag
                            key={e.id}
                            als="li"
                            typ="entscheidung"
                            typwort={etbTyp.entscheidung.label}
                            zeit={uhrzeit(e.ereigniszeit)}
                            nr={`Nr. ${e.lfd_nr}`}
                            meta={verfasserText(e)}
                            aktionen={
                              folgeWort ? (
                                <span
                                  data-lfh="entscheidung-folge"
                                  style={{
                                    ...monoStil(10),
                                    letterSpacing: '0.06em',
                                    color: rollen.bedien,
                                  }}
                                >
                                  {folgeWort}
                                </span>
                              ) : undefined
                            }
                          >
                            {e.inhalt}
                          </Zeitachseneintrag>
                        );
                      })}
                    </ul>
                  </Zustandsfeld>
                </Paneel>

                <Paneel
                  titel="Nächste Marken"
                  style={
                    breit
                      ? {
                          flex: `0 0 ${MARKEN_BREITE}px`,
                          width: MARKEN_BREITE,
                          borderInlineStart: 0,
                        }
                      : { borderBlockStart: 0 }
                  }
                  meta={
                    zMarken === 'daten' && marken.weitere > 0
                      ? `+${marken.weitere} weitere`
                      : undefined
                  }
                >
                  <Zustandsfeld
                    zustand={zMarken}
                    leer={marken.marken.length === 0}
                    leerText="Keine anstehenden Fristen."
                    onNeuladen={() => nachladen(qEinsatz, qAuftraege, qErinnerungen)}
                  >
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {marken.marken.map((m) => (
                        <li key={m.key}>
                          <MarkenZeile
                            ziel={markenZiel(m)}
                            ton={m.ton}
                            style={{ ...zeile, alignItems: 'baseline', borderBlockEnd: 0 }}
                          >
                            <span
                              style={{
                                flex: '0 0 auto',
                                display: 'flex',
                                flexDirection: 'column',
                                minWidth: 52,
                              }}
                            >
                              <span style={{ ...monoStil(13), color: markenFarbe(m) }}>
                                {frist(m.zeit)}
                              </span>
                              <span style={{ ...monoStil(10), color: markenFarbe(m) }}>
                                {m.wort}
                              </span>
                            </span>
                            <span
                              style={{
                                flex: '1 1 auto',
                                minWidth: 0,
                                fontSize: 12,
                                lineHeight: 1.4,
                                color: rollen.gedaempft,
                                overflowWrap: 'anywhere',
                              }}
                            >
                              {m.text}
                            </span>
                          </MarkenZeile>
                        </li>
                      ))}
                    </ul>
                  </Zustandsfeld>
                </Paneel>
              </div>
            </div>
          </div>
        )}
      </EinsatzSeite>
    </div>
  );
}

/** Visuell verborgen, für Vorleser da — dieselbe Clip-Bauform wie in `instrument/Status`. */
const NUR_VORLESER: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/**
 * Eine Abschnittszeile: Lagekante · Name/Kürzel/Leiter/Einheiten/Lagezustand · fester Auftrag mit
 * Fortschritt (sonst jüngster offener Auftrag) und letzte Rückmeldung · Stärke und Einheiten je
 * Statuskategorie. Die ganze Zeile ist der Link auf den Abschnitt.
 */
function AbschnittEintrag({
  zeile,
  ziel,
  zeit,
}: {
  zeile: AbschnittZeile;
  ziel: string;
  /** Tagesbewusste Uhrzeit — eine Rückmeldung von gestern ist nicht „14:11". */
  zeit: (utc: string | null | undefined) => string;
}) {
  const { token, rollen } = useRollen();
  const [juengster, ...weitere] = zeile.auftraege;
  const { auftragsbilanz } = zeile;
  const verteilung = zeile.einheitenStatus;
  const rueck = zeile.letzteRueckmeldung;
  const lage = zeile.lagezustand ? abschnittLagezustand[zeile.lagezustand] : null;
  const leitung = [zeile.kurzbezeichnung, zeile.leiter].filter(Boolean).join(' · ');
  // Unterzeile: die Zählung, und hat der feste Auftrag Platz, der offene Einzelauftrag dahinter.
  const unterzeile = [
    auftragsbilanz.gesamt > 0
      ? `${auftragsbilanz.erledigt}/${auftragsbilanz.gesamt} Aufträge erledigt`
      : null,
    zeile.abschnittsauftrag && juengster
      ? `${zeile.auftraege.length} offen · ${juengster.auftrag_text}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Link
      to={ziel}
      data-lfh="ueberblick-abschnitt"
      style={{ ...zeilenzielStil(rollen, token), flexWrap: 'wrap', paddingBlock: token.padding }}
    >
      {/* Lagekante: Farbe nur als Rand, das Wort steht im StatusTag daneben. Ohne Beurteilung
          durchsichtig — eine graue Kante sähe aus wie eine Stufe „neutral". */}
      <span
        aria-hidden
        data-lfh="abschnitt-lagekante"
        data-rolle={lage?.rolle}
        style={{
          flex: '0 0 3px',
          alignSelf: 'stretch',
          background: lage ? rollenFarbe(lage.rolle, token) : 'transparent',
        }}
      />
      <span
        style={{ flex: '0 0 158px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <span style={{ fontSize: 14, fontWeight: 500, overflowWrap: 'anywhere' }}>
          {zeile.name}
        </span>
        {leitung && <span style={{ ...monoStil(11), color: rollen.schwach }}>{leitung}</span>}
        <span style={{ ...monoStil(11), color: rollen.gedaempft }}>
          {zeile.einheiten === 1 ? '1 Einheit' : `${zeile.einheiten} Einheiten`}
          {zeile.unterabschnitte > 0 && ` · ${zeile.unterabschnitte} UA`}
        </span>
        {(lage || zeile.unterLage) && (
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            {lage && <StatusTag darstellung={lage} darstellungsart="rand" />}
            {/* Ein schlechter beurteilter Unterabschnitt bekommt dieselbe Form wie der eigene
                Zustand (Rollenrand + Wort), sonst stünde „UA kritisch“ leiser da als ein grünes
                „planmäßig“. */}
            {zeile.unterLage && (
              <StatusTag
                darstellung={{
                  ...abschnittLagezustand[zeile.unterLage],
                  label: `UA ${abschnittLagezustand[zeile.unterLage].label}`,
                }}
                darstellungsart="rand"
              />
            )}
          </span>
        )}
      </span>
      <span
        style={{
          flex: '1 1 160px',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          fontSize: 12,
          lineHeight: 1.45,
          color: rollen.gedaempft,
          overflowWrap: 'anywhere',
        }}
      >
        {zeile.abschnittsauftrag ? (
          <span>{zeile.abschnittsauftrag}</span>
        ) : juengster ? (
          <span>
            {juengster.auftrag_text}
            {weitere.length > 0 && (
              <span style={{ ...monoStil(10), color: rollen.schwach }}>
                {' '}
                · +{weitere.length} weitere offen
              </span>
            )}
          </span>
        ) : null}
        {zeile.fortschritt != null && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {/* Der Balken ist Beiwerk, die Zahl daneben die Aussage — deshalb aria-hidden. */}
            <span
              aria-hidden
              style={{ flex: 1, height: 4, background: rollen.linie, display: 'flex' }}
            >
              <span
                data-lfh="abschnitt-fortschritt"
                style={{
                  width: `${zeile.fortschritt}%`,
                  background: lage ? rollenFarbe(lage.rolle, token) : rollen.gedaempft,
                }}
              />
            </span>
            <span style={{ ...monoStil(11), color: rollen.schwach }}>{zeile.fortschritt} %</span>
          </span>
        )}
        {unterzeile && <span style={{ ...monoStil(10), color: rollen.schwach }}>{unterzeile}</span>}
        {/* Nur wenn die Rückmeldungen feststehen, sonst gar nichts. Der verborgene Vorsatz gibt
            der Zeit im Linknamen ihre Bedeutung. */}
        {zeile.rueckmeldungBekannt && (
          <span
            data-lfh="abschnitt-rueckmeldung"
            style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}
          >
            {rueck ? (
              <>
                <span style={{ ...monoStil(10), color: rollen.schwach, flex: '0 0 auto' }}>
                  <span style={NUR_VORLESER}>Letzte Rückmeldung:</span> {zeit(rueck.ereigniszeit)}
                </span>
                {/* Leerzeichen zwischen den Flex-Kindern: unsichtbar, trennt aber im Linknamen
                    Uhrzeit und Text („14:11 Verbau hält" statt „14:11Verbau hält"). */}{' '}
                <span
                  title={rueck.inhalt}
                  style={{
                    fontSize: 11,
                    color: rollen.schwach,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {rueck.inhalt}
                </span>
              </>
            ) : (
              <span style={{ fontSize: 11, color: rollen.schwach }}>noch keine Rückmeldung</span>
            )}
          </span>
        )}
      </span>
      <span
        style={{
          flex: '0 0 132px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 6,
        }}
      >
        <span style={monoStil(15)}>{zeile.staerkeText}</span>
        <Augenbraue>F/UF/M//Ges</Augenbraue>
        {/* Kein `aria-label` am Raster: im Link bildet sich der Name aus dem Inhalt, ein Label
            ersetzte die Wörter der Zellen. */}
        <span
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 1,
            background: rollen.linie,
            width: '100%',
          }}
        >
          <StatusZelle ton="normal" hoehe={24} wert={verteilung.bereit} wort="bereit" />
          <StatusZelle ton="bedien" hoehe={24} wert={verteilung.gebunden} wort="gebunden" />
          <StatusZelle
            ton={verteilung.ausfall > 0 ? 'alarm' : 'neutral'}
            hoehe={24}
            wert={verteilung.ausfall}
            wort="Ausfall"
          />
        </span>
        {verteilung.ohne > 0 && (
          <span style={{ ...monoStil(10), color: rollen.schwach }}>
            +{verteilung.ohne} ohne Status
          </span>
        )}
      </span>
    </Link>
  );
}

/**
 * Eine Zeile der „Nächsten Marken": mit Ziel ein Link, ohne (Zielmodul gesperrt, LFH-888) dieselbe
 * Zeile als Text — die Frist bleibt eine Aussage, auch wenn sie in kein Modul führt.
 */
function MarkenZeile({
  ziel,
  ton,
  style,
  children,
}: {
  ziel: string | undefined;
  ton: Marke['ton'];
  style: CSSProperties;
  children: ReactNode;
}) {
  return ziel != null ? (
    <Link to={ziel} data-lfh="ueberblick-marke" data-ton={ton} style={style}>
      {children}
    </Link>
  ) : (
    <div data-lfh="ueberblick-marke" data-ton={ton} style={{ ...style, cursor: 'default' }}>
      {children}
    </div>
  );
}
