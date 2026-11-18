import { STAERKE_AUSGESCHRIEBEN, STAERKE_SCHREIBWEISE } from '../../anzeige/staerke';
import { IconBericht, IconPlus } from '../../icons';
import { useWasBrennt } from '../../lage/useWasBrennt';
import { alarmZiel } from '../../lage/alarmZiel';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Breadcrumb, Button } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import EinsatzSeite from '../../components/EinsatzSeite';
import { RechteHinweis } from '../../components/SpeicherHinweis';
import {
  istKeyFreigegeben,
  istSprungGesperrt,
  KEINE_BERECHTIGUNG,
  modulRegistry,
  modulName,
} from '../../einsatz/modulRegistry';
import { darfBeantragen, darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { useModulWahl } from '../../einsatz/useModulWahl';
import {
  Augenbraue,
  DashboardFlaeche,
  GliederungsPaneel,
  ListenPaneel,
  NUR_VORLESER,
  PaneelReihe,
  StatusChip,
  StromPaneel,
  Verteilungsliste,
  WarnstufenHinweis,
  AlarmZeile,
  Zeitachseneintrag,
  listenZeileStil,
  monoStil,
  schriftStil,
  useRollen,
  type DashboardZustand,
  type Gliederungszeile,
  type Verteilungszeile,
} from '../../components/instrument';
import { anteil } from '../../components/instrument/Aufgliederung';
import { einsatzKeys } from '../../api/queryKeys';
import { schlechtesterZustand, type AbrufZustand } from '../../api/abrufZustand';
import { verfasserText } from '../../etb/verfasser';
import BerichtigtMarke from '../../etb/BerichtigtMarke';
import { ladeEinsatz, ladeModulFreigaben } from '../../api/einsaetze';
import type { ModulFreigaben } from '../../api/types';
import { listeEinsatzPersonal } from '../../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../../api/einsatzFahrzeuge';
import { listEinsatzMaterial } from '../../api/einsatzMaterial';
import { listeEinheiten } from '../../api/einheiten';
import { listeAbschnitte } from '../../api/einsatzabschnitte';
import { ladeGefahrengebiete } from '../../api/gefahren';
import { listeAuftraege } from '../../api/auftraege';
import { listeNachforderungen } from '../../api/nachforderungen';
import { listeOffeneErinnerungen } from '../../api/erinnerungen';
import { ladeProgrammpunkte } from '../../api/programmpunkte';
import { listeEtb } from '../../api/etb';
import { holeRueckmeldungen, listeOffeneMeldungen } from '../../api/meldungen';
import { useAuth } from '../../auth/AuthContext';
import { ladeModulZaehler } from '../../api/modulZaehler';
import { UNBESTAETIGT } from '../gefahren/beurteilung';
import { pegelAbfrage } from '../../api/pegel';
import { wetterAbfrage } from '../../api/wetter';
import { unwetterLage } from '../../wetter/unwetter';
import { PEGEL_STAND_UNBEKANNT, pegelNotizKurz } from '../../pegel/pegelKennzahl';
import { listeAbloesungen } from '../../api/abloesungen';
import { listeEinheitenPerioden } from '../../api/kraefteZeitachse';
import { findOhneSchicht } from '../../abloesung/ohneSchicht';
import { darfZaehlerZeigen } from '../../einsatz/useModulZaehler';
import {
  auftraegePfad,
  einheitenPfad,
  einsaetzePfad,
  einsatzModulPfad,
  einsatzdatenPfad,
  einsatzabschnittePfad,
  erinnerungenPfad,
  etbPfad,
  lageberichtePfad,
  lagebesprechungPfad,
  abloesungPfad,
  pegelZielPfad,
  wetterPegelPfad,
} from '../../routing/deeplinks';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import {
  abschnittLagezustand,
  etbTyp,
  rollenFarbe,
  statusKategorie,
} from '../../theme/statusFarben';
import StatusTag from '../../components/StatusTag';
import { grundWort } from '../../kraefte/meldebildRaster';
import {
  abschnittGruende,
  abschnittZeilen,
  entscheidungenAuswahl,
  folgeText,
  naechsteMarken,
  warnstufeKennzahlVon,
  ueberblickRechteText,
  type AbschnittZeile,
  type Marke,
} from './ueberblickDaten';
import OffeneVorgaengePaneel from './OffeneVorgaengePaneel';
import StartlistePaneel from './StartlistePaneel';
import {
  startQuelle,
  startliste,
  startlisteOffen,
  type StartPunkt,
  type StartPunktSchluessel,
} from './startliste';
import { isStartlisteAusgeblendet, saveStartlisteAusgeblendet } from './startlisteSpeicher';
import {
  VORGANGS_SICHT_PARAM,
  meineStelle,
  sichtAusUrl,
  type VorgangsSicht,
} from './offeneVorgaenge';
import { leereUhrzeit, zeitKurz } from '../../anzeige/zeitDarstellung';

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
 * unbekannt". Nur Beiwerk (Rückmeldungen, Aufträge in der Abschnittszeile) entfällt still.
 *
 * Ein Block hängt nur an den Quellen, aus denen er rechnet (LFH-887): die Kräfte-Kennzahl am
 * Personal (die Stärke kommt nur von dort), das Abschnittspaneel an Abschnitten, Einheiten und
 * Personal. Fahrzeuge und Material tragen dort nur den Auffangknoten „Ohne Abschnitt" und
 * entfallen gesperrt still. Eine Liste, der eine gesperrte Quelle fehlt, sagt das, statt „keine"
 * zu behaupten (`ohneFreigabeHinweis`): die Marken immer, das Abschnittspaneel im Leerzustand.
 *
 * Keine erfundenen Daten: Lagezustand, Kürzel und fester Auftrag kommen aus dem Abschnitt selbst
 * und fehlen, solange sie dort nicht gepflegt sind.
 */

/** Der Entscheidungsabruf: nur Typ „Entscheidung", ein Deckel, der die letzte Stunde
 *  eines Großeinsatzes sicher trägt. Konstante, damit der Query-Key stabil bleibt. */
const ETB_ENTSCHEIDUNGEN = { typ: 'entscheidung' as const, limit: 50 };

/** Die jüngste Lagefeststellung für die Startliste (LLH-1815, design.md D3): ein Eintrag genügt. */
const ETB_ERSTE_LAGE = { typ: 'lage' as const, limit: 1 };

/** `gesperrt`: das Modul der Quelle ist für die Person nicht freigegeben (LFH-669). */
type Zustand = AbrufZustand;

/** Eine Quelle der Seite: ihre Abfrage und ob ihr Modul frei ist (modul-lose Quellen: `true`). */
interface Quelle {
  q: UseQueryResult<unknown>;
  frei: boolean;
}

/**
 * „Nicht freigegeben: …" für die Quellen einer Liste, deren Modul für die Person gesperrt ist
 * (LFH-887); `null`, wenn keine fehlt oder die Freigaben unbekannt sind (dann ist der Block
 * ohnehin unbestimmt). Ein ausgeblendetes Modul gehört nicht zum Einsatz und fehlt deshalb nicht.
 */
function ohneFreigabeHinweis(
  freigaben: ModulFreigaben | undefined,
  quellen: { key: string; frei: boolean }[],
): string | null {
  if (!freigaben) return null;
  const namen = quellen
    .filter(({ key, frei }) => !frei && freigaben[key]?.sichtbar)
    .map(({ key }) => modulRegistry.find((m) => m.key === key)?.label ?? key);
  return namen.length > 0 ? `Nicht freigegeben: ${namen.join(', ')}.` : null;
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

/** „1 Einheit“, „2 Einheiten“ — Zahl vor Wort, Einzahl und Mehrzahl richtig (LFH-973). */
function anzahlWort(anzahl: number, einzahl: string, mehrzahl: string): string {
  return `${anzahl} ${anzahl === 1 ? einzahl : mehrzahl}`;
}

export default function UeberblickPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { waehle, linkFaenger } = useModulWahl();
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const jetzt = useJetzt();
  const { benutzer } = useAuth();
  // „Offene Vorgänge“ für alle oder meine Stelle (LLH-1145 D5): die Wahl steht in der URL.
  const [suche, setSuche] = useSearchParams();
  const sicht = sichtAusUrl(suche.get(VORGANGS_SICHT_PARAM));
  const waehleSicht = (neu: VorgangsSicht) =>
    setSuche(
      (alt) => {
        const naechste = new URLSearchParams(alt);
        if (neu === 'meine') naechste.set(VORGANGS_SICHT_PARAM, 'meine');
        else naechste.delete(VORGANGS_SICHT_PARAM);
        return naechste;
      },
      { replace: true },
    );

  // Startliste „Einsatz starten“ je Browser ausgeblendet (LLH-1815, design.md D4): erst der State,
  // dann der Speicher; scheitert das Schreiben, bleibt sie bis zum Neuladen weg.
  const [ausgeblendetJetzt, setAusgeblendetJetzt] = useState<ReadonlySet<number>>(new Set());
  const startlisteAusgeblendet = useMemo(
    () => ausgeblendetJetzt.has(einsatzId) || isStartlisteAusgeblendet(einsatzId),
    [ausgeblendetJetzt, einsatzId],
  );
  const blendeStartlisteAus = () => {
    setAusgeblendetJetzt((alt) => new Set(alt).add(einsatzId));
    saveStartlisteAusgeblendet(einsatzId);
  };

  const einsatzQ = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  // Programmpunkte der Veranstaltung (LLH-1570): kein Modul, wie der Einsatzkopf.
  const programmQ = useQuery({
    queryKey: einsatzKeys.programmpunkte(einsatzId),
    queryFn: () => ladeProgrammpunkte(einsatzId),
  });
  // Modulgrenze (LFH-669, Dateikopf): die Freigaben vor den Listen, jede gebundene Liste mit
  // `enabled` an ihrem Modul (Keys nach `PFAD_KEY` in `src/einsatz/modul.rs`).
  const freigabenQ = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const freigaben = freigabenQ.data;
  // Alarmzeile „Was brennt“ (LLH-1743): derselbe Hook wie im Lagebild, gegen die Uhr der Seite.
  const wasBrenntDaten = useWasBrennt(einsatzId, jetzt);
  // Ein gescheiterter Neuabruf lässt die alten Freigaben gültig, wie auf der Lagekarte.
  const freigabenStand: FreigabenStand =
    freigaben !== undefined ? 'da' : freigabenQ.isError ? 'fehler' : 'laden';
  const personalFrei = istKeyFreigegeben('personal', freigaben);
  const fahrzeugeFrei = istKeyFreigegeben('fahrzeuge', freigaben);
  const materialFrei = istKeyFreigegeben('material', freigaben);
  const einheitenFrei = istKeyFreigegeben('einheiten', freigaben);
  const abschnitteFrei = istKeyFreigegeben('einsatzabschnitte', freigaben);
  const gefahrenFrei = istKeyFreigegeben('gefahrenzonen', freigaben);
  const auftraegeFrei = istKeyFreigegeben('auftraege', freigaben);
  const nachforderungenFrei = istKeyFreigegeben('nachforderungen', freigaben);
  const erinnerungenFrei = istKeyFreigegeben('erinnerungen', freigaben);
  const etbFrei = istKeyFreigegeben('etb', freigaben);
  const rueckmeldungenFrei = istKeyFreigegeben('meldungen', freigaben);
  // Sprungziele (LFH-888, design.md D4): Lesart der Navigation — gesperrt nur, wenn der Server
  // es sagt; solange die Freigaben laden, steht kein Knopf gesperrt da.
  const lageberichtGesperrt = istSprungGesperrt('lageberichte', freigaben);
  const etbSprungGesperrt = istSprungGesperrt('etb', freigaben);
  const lagebesprechungGesperrt = istSprungGesperrt('lagebesprechung', freigaben);

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
    queryFn: () => listEinsatzMaterial(einsatzId),
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
  // Abschnitt „Nachforderungen“ der offenen Vorgänge (LLH-1078, LLH-1145): dasselbe Fach wie die
  // Modulseite; die Zahlen kommen aus dem Modulzähler, die Liste nennt nur die dringendsten.
  const nachforderungenQ = useQuery({
    queryKey: einsatzKeys.nachforderungen(einsatzId),
    queryFn: () => listeNachforderungen(einsatzId, {}),
    enabled: nachforderungenFrei,
  });
  // Die Zahlen der offenen Vorgänge zählt der Server (LFH-550): derselbe Cache wie das Modulpanel.
  // Die Liste darüber speist nur das Paneel und die Fristen.
  const zaehlerQ = useQuery({
    queryKey: einsatzKeys.modulZaehler(einsatzId),
    queryFn: () => ladeModulZaehler(einsatzId),
  });
  // Nur offene (LFH-940): die Marken zeigen nur offene Fälligkeiten. Dasselbe Fach wie die offene
  // Liste der Erinnerungsseite.
  const erinnerungenQ = useQuery({
    queryKey: einsatzKeys.erinnerungenPhase(einsatzId, 'offen'),
    queryFn: () => listeOffeneErinnerungen(einsatzId),
    enabled: erinnerungenFrei,
  });
  // Ablösungsmarken nur, wenn das Modul sichtbar und frei ist — sonst 403 und ein Seitenkanal über
  // ausgeblendete Daten (dieselbe Prüfung wie `darfZaehlerZeigen`). Aus denselben Freigaben wie
  // die übrigen Quellen: ein gescheiterter Neuabruf lässt sie gültig.
  const abloesungSichtbar = darfZaehlerZeigen('abloesung', freigaben);
  // „Erwarteter Höchststand" führt auf „Wetter & Pegel", wenn das Modul frei ist, sonst auf die
  // Pflege (`pegelZielPfad`).
  const wetterPegelFrei = istKeyFreigegeben('wetter-pegel', freigaben);
  const abloesungenQ = useQuery({
    queryKey: einsatzKeys.abloesungListe(einsatzId, 'laufend'),
    queryFn: () => listeAbloesungen(einsatzId, 'laufend'),
    enabled: abloesungSichtbar,
  });
  // „n ohne Schicht ↗“ (LLH-1312): dieselbe Menge wie das Segment der Seite Ablösung, aus
  // denselben Fächern (`findOhneSchicht`, Regel „Eine Heimat je Zahl“). Die Zeitachse gehört dem
  // Modul Einheiten: ohne dessen Freigabe keine Anfrage und kein Sprung.
  const ohneSchichtFrei = abloesungSichtbar && einheitenFrei;
  const periodenQ = useQuery({
    queryKey: einsatzKeys.kraefteZeitachseEinheiten(einsatzId),
    queryFn: () => listeEinheitenPerioden(einsatzId),
    enabled: ohneSchichtFrei,
  });
  // Nur ein erfolgreicher Abruf zählt (wie bei den Rückmeldungen): react-query behält `data` nach
  // einem gescheiterten Neuabruf, der Sprung nennte sonst eine veraltete Zahl.
  const ohneSchichtQuellenFehler = einheitenQ.isError || periodenQ.isError || abloesungenQ.isError;
  const ohneSchichtZahl = useMemo(
    () =>
      ohneSchichtFrei &&
      !ohneSchichtQuellenFehler &&
      einheitenQ.data &&
      periodenQ.data &&
      abloesungenQ.data
        ? findOhneSchicht(einheitenQ.data, periodenQ.data, abloesungenQ.data).length
        : null,
    [ohneSchichtFrei, ohneSchichtQuellenFehler, einheitenQ.data, periodenQ.data, abloesungenQ.data],
  );
  const etbQ = useQuery({
    queryKey: einsatzKeys.etbListe(einsatzId, ETB_ENTSCHEIDUNGEN),
    queryFn: () => listeEtb(einsatzId, ETB_ENTSCHEIDUNGEN),
    enabled: etbFrei,
  });
  // Abschnitt „Meldungen“ der offenen Vorgänge (LLH-1145): dasselbe Fach wie die offene Liste der
  // Meldungsseite (alle Richtungen). Nicht auf der Platte (LFH-940): ohne Netz „nicht geladen“.
  const meldungenOffenQ = useQuery({
    queryKey: einsatzKeys.meldungenPhase(einsatzId, 'offen', 'alle'),
    queryFn: () => listeOffeneMeldungen(einsatzId),
    enabled: rueckmeldungenFrei,
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
  const darfSchreiben = darfImEinsatzSchreiben(einsatz);
  // Startliste (LLH-1815, Spec `ueberblick-startliste`): nur mit Schreibrecht am aktiven Einsatz
  // (nicht am Spiegel, `darfImEinsatzSchreiben`) und solange nicht ausgeblendet. Nur dann fragt die
  // Seite die jüngste Lagefeststellung ab (design.md, Risiken).
  const startlisteMoeglich = darfSchreiben && !startlisteAusgeblendet;
  const ersteLageQ = useQuery({
    queryKey: einsatzKeys.etbListe(einsatzId, ETB_ERSTE_LAGE),
    queryFn: () => listeEtb(einsatzId, ETB_ERSTE_LAGE),
    enabled: startlisteMoeglich && etbFrei,
  });
  // Ein ETB-Eintrag ist am Spiegel ein Antrag (LLH-1492, D13).
  const darfEtbErfassen = darfBeantragen(einsatz);
  // Daten nur aus freien Quellen: der Cache eines gesperrten Moduls kann einen Altstand tragen.
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
  const stelle = useMemo(() => meineStelle(einsatz, benutzer?.id), [einsatz, benutzer?.id]);
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
        programmQ.data ?? [],
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
      programmQ.data,
    ],
  );

  const qEinsatz: Quelle = { q: einsatzQ, frei: true };
  const qProgramm: Quelle = { q: programmQ, frei: true };
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

  const zWarnstufe = zustandVon(freigabenStand, qGefahren);
  const zAbschnitte = zustandVon(
    freigabenStand,
    qAbschnitte,
    qEinheiten,
    qPersonal,
    ...ohneGesperrte(qFahrzeuge, qMaterial),
  );
  // Ohne Fahrzeuge oder Material ist „keine Kräfte" keine Aussage (LFH-887, Dateikopf).
  const abschnitteHinweis = ohneFreigabeHinweis(freigaben, [
    { key: 'fahrzeuge', frei: fahrzeugeFrei },
    { key: 'material', frei: materialFrei },
  ]);
  const zEntscheidungen = zustandVon(freigabenStand, qEtb);
  // Die offenen Vorgänge tragen ihre Stände je Abschnitt; das Paneel selbst nur die Freigaben.
  const zVorgaenge = freigabenStand === 'da' ? 'daten' : freigabenStand;
  // Die Marken sammeln Fristen aus mehreren Quellen; eine gesperrte trägt nichts bei, die
  // Lagebesprechung bleibt. Was fehlt, nennt der Hinweis — sonst läse sich die Liste vollständig.
  const zMarken = zustandVon(
    freigabenStand,
    qEinsatz,
    qProgramm,
    ...ohneGesperrte(qAuftraege, qErinnerungen),
  );
  const markenHinweis = ohneFreigabeHinweis(freigaben, [
    { key: 'auftraege', frei: auftraegeFrei },
    { key: 'erinnerungen', frei: erinnerungenFrei },
    { key: 'abloesung', frei: abloesungSichtbar },
    { key: 'wetter-pegel', frei: wetterPegelFrei },
  ]);
  /** „Erneut abrufen": gescheiterte Freigaben zuerst, Listen nur freier Module. */
  const nachladen = (...quellen: Quelle[]) => {
    if (freigabenStand === 'fehler') void freigabenQ.refetch();
    for (const { q, frei } of quellen) if (frei) void q.refetch();
  };

  // Die Paneelreihen warten auf die Quellen der Gliederung (LLH-1481): wie viele Zeilen das Paneel
  // „Einsatzabschnitte“ bekommt (oberste Abschnitte, „Ohne Abschnitt“ aus Einheiten, Personal,
  // Fahrzeugen und Material) und wie hoch sie werden, sagt keine Zahl vorher. Mit einer Ladezeile
  // wuchs es um jede Zeile (auf 390 px rund 140 px) und schob alles darunter. Unter Alarmzeile und
  // Startliste steht bis dahin nichts; was dort erscheint, verschiebt nichts. Wie beim Körper
  // zählt nur das erste Laden: Fehler, „ohne Netz“ und gesperrte Module halten nichts auf.
  const gliederungLaedt = [abschnitteQ, einheitenQ, personalQ, fahrzeugeQ, materialQ].some(
    (q) => q.isLoading,
  );
  // Ebenso die Quellen der Marken (LLH-1748, Change `wf7l9axn-ueberblick-ohne-band`, D3):
  // „Nächste Marken“ steht seit dem Wegfall des Bands zuoberst, am Handy als erstes Paneel. Wie
  // viele Marken kommen, sagt keine Zahl vorher; aus „wird abgerufen“ wuchs das Paneel und schob
  // „Offene Vorgänge“ und alles darunter (390 px: CLS 0,12 bis 0,20). Eine abgeschaltete Quelle
  // (gesperrtes Modul) lädt nicht und hält nichts auf.
  const markenLaedt = [auftraegeQ, erinnerungenQ, abloesungenQ, programmQ, pegelQ, wetterQ].some(
    (q) => q.isLoading,
  );
  const reihenLaden = gliederungLaedt || markenLaedt;

  // Startliste (LLH-1815, design.md D1/D3). Sie steht ÜBER den Paneelreihen: erschiene sie nach
  // ihnen, schöbe sie die Reihen nach unten. Deshalb warten beim ersten Aufbau beide auf ihre
  // Quellen, solange sie erscheinen kann (`startlisteSchranke`); die Alarmzeile
  // darüber hat eine feste Höhe und steht sofort. Die Paneelreihen warten zusätzlich auf die
  // Gliederung. Wie dort zählt nur das erste Laden einer Quelle (`isLoading`). Die Freigaben hält
  // der Rahmen vor dem ersten Bild der Seite bereit (`EinsatzLayout`); fehlen sie doch, steht die
  // Liste erst mit ihnen (unten).
  const startlisteLaedt =
    startlisteMoeglich && [abschnitteQ, einheitenQ, personalQ, ersteLageQ].some((q) => q.isLoading);
  // Die gemeinsame Schranke gilt nur beim ersten Aufbau der Seite je Einsatz (Review LLH-1815,
  // Befund 8). Startet eine Quelle der Startliste erst mitten in der Sitzung (Schreibrecht kommt
  // live dazu, der Einsatz wird wiedereröffnet, ein Modul wird freigegeben), hinge die Schranke
  // sonst Band und alle Paneelreihen für einen Abruf aus, und die Seite spränge in der Höhe.
  // Danach hält die Startliste stattdessen ihren letzten Stand (`startlisteStand`), bis die Quelle
  // geladen hat: kein „nicht geladen“, das gleich wieder verschwindet.
  const aufgebautFuer = useRef<number | null>(null);
  if (
    aufgebautFuer.current !== einsatzId &&
    !einsatzQ.isLoading &&
    !zaehlerQ.isLoading &&
    freigabenStand !== 'laden' &&
    !startlisteLaedt
  ) {
    aufgebautFuer.current = einsatzId;
  }
  const startlisteSchranke = startlisteLaedt && aufgebautFuer.current !== einsatzId;
  const startPunkte = useMemo(
    () =>
      startliste({
        einsatzId,
        einsatz: einsatz ? { zustand: 'daten', daten: einsatz } : { zustand: 'laden' },
        abschnitte: startQuelle(abschnitteQ, abschnitteFrei || freigabenStand !== 'da'),
        einheiten: startQuelle(einheitenQ, einheitenFrei || freigabenStand !== 'da'),
        personal: startQuelle(personalQ, personalFrei || freigabenStand !== 'da'),
        lage: startQuelle(ersteLageQ, etbFrei || freigabenStand !== 'da'),
        freigaben,
      }),
    [
      einsatzId,
      einsatz,
      abschnitteQ,
      einheitenQ,
      personalQ,
      ersteLageQ,
      abschnitteFrei,
      einheitenFrei,
      personalFrei,
      etbFrei,
      freigabenStand,
      freigaben,
    ],
  );
  // Ohne bekannte Freigaben (sie laden noch) steht die Liste nicht: ihre gebundenen Quellen fragen
  // dann gar nicht und wären „unbekannt“. Gescheiterte Freigaben zeigen sie mit „nicht geladen“.
  const startlisteEntschieden =
    startlisteMoeglich && freigabenStand !== 'laden' && startlisteOffen(startPunkte);
  // Letzter Stand ohne ladende Quelle; gilt, solange eine Quelle nach dem ersten Aufbau zum ersten
  // Mal lädt (siehe `startlisteSchranke`).
  const startlisteStand = useRef<{ punkte: StartPunkt[]; zeigen: boolean } | null>(null);
  if (!startlisteLaedt)
    startlisteStand.current = { punkte: startPunkte, zeigen: startlisteEntschieden };
  const startlisteGehalten = startlisteLaedt ? startlisteStand.current : null;
  const zeigeStartliste = startlisteGehalten?.zeigen ?? startlisteEntschieden;
  const startlistePunkte = startlisteGehalten?.punkte ?? startPunkte;
  /** „Erneut abrufen“ an einem unbekannten Punkt: nur seine Quellen (gescheiterte Freigaben zuerst). */
  const startlisteNachladen = (schluessel: StartPunktSchluessel) => {
    switch (schluessel) {
      case 'einsatzort':
      case 'einsatzleiter':
        return nachladen(qEinsatz);
      case 'einsatzabschnitte':
        return nachladen(qAbschnitte);
      case 'kraefte':
        return nachladen(qEinheiten, qPersonal);
      case 'lage':
        return nachladen({ q: ersteLageQ, frei: etbFrei });
    }
  };

  const zeile = listenZeileStil(rollen, token);
  // Rolle „kurz“ (LLH-1061): die Liste reicht über Mitternacht; eine Lücke hält Ziffernbreite.
  const kurz = (s: string | null | undefined) =>
    zeitKurz(s, konventionen) || leereUhrzeit(konventionen);
  const auftraegeFehlen = auftraegeFrei && auftraegeQ.isError;

  /** Ziel einer Marke; die Lagebesprechung führt nur in ein freies Modul (LFH-888, LLH-1111). */
  const markenZiel = (m: Marke): string | undefined =>
    m.art === 'auftrag'
      ? auftraegePfad(einsatzId, { auftrag: m.id ?? undefined })
      : m.art === 'erinnerung'
        ? erinnerungenPfad(einsatzId, { erinnerung: m.id ?? undefined })
        : m.art === 'pegelprognose'
          ? pegelZielPfad(einsatzId, wetterPegelFrei)
          : m.art === 'abloesung'
            ? abloesungPfad(einsatzId, { ansicht: 'laufend' })
            : m.art === 'unwetter'
              ? wetterPegelPfad(einsatzId)
              : m.art === 'programmpunkt'
                ? einsatzdatenPfad(einsatzId)
                : lagebesprechungGesperrt
                  ? undefined
                  : lagebesprechungPfad(einsatzId);
  const markenFarbe = (m: Marke) =>
    m.ton === 'alarm' ? rollen.alarmText : m.ton === 'achtung' ? rollen.achtungText : rollen.text;

  const entscheidungTitel =
    entscheidungen.modus === 'stunde'
      ? 'Entscheidungen der letzten Stunde'
      : 'Letzte Entscheidungen';

  // ── Seitenkopf: Warnstufe wie im Lagebild (Dashboard-Baukasten, LLH-1140) ── Sie ist keine
  // Kennzahl: der Hinweis steht nur bei Ton achtung/alarm. Was die Kennzahl außerdem trug, steht
  // daneben: unbestätigte Gebiete (LLH-1090, Offenes sieht nicht wie Entwarnung aus) und die
  // Pegel-Notiz (LFH-606).
  const warnTon =
    zWarnstufe === 'daten' && (warnstufe.ton === 'alarm' || warnstufe.ton === 'achtung')
      ? warnstufe.ton
      : null;
  const nichtBeurteilt =
    zWarnstufe === 'daten' && warnstufe.nichtBeurteilt > 0
      ? `${warnstufe.nichtBeurteilt} ${UNBESTAETIGT}`
      : null;
  const kopfLage =
    warnTon || nichtBeurteilt || pegelNotiz ? (
      <span
        data-lfh="ueberblick-lage-kopf"
        style={{
          display: 'inline-flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: token.padding,
        }}
      >
        {warnTon && <WarnstufenHinweis ton={warnTon}>Warnstufe {warnstufe.wort}</WarnstufenHinweis>}
        {nichtBeurteilt && (
          <span data-lfh="warnstufe-offen" style={{ color: rollen.achtungText }}>
            {nichtBeurteilt}
          </span>
        )}
        {pegelNotiz && <span data-lfh="kopf-pegel">{pegelNotiz}</span>}
      </span>
    ) : undefined;

  const lagebildZiel = einsatzModulPfad(einsatzId, 'lage-dashboard');
  const lagebildGesperrt = istSprungGesperrt('lage-dashboard', freigaben);

  return (
    // Jeder Link der Seite ist eine Modulwahl für „Zuletzt besucht" (LFH-436, `useModulWahl`).
    // `display: contents`: die Hülle trägt nur den Fänger und nimmt am Layout nicht teil.
    <div style={{ display: 'contents' }} {...linkFaenger}>
      <EinsatzSeite
        titel={modulName('ueberblick')}
        breadcrumb={
          <Breadcrumb
            items={[
              { title: <Link to={einsaetzePfad()}>Einsätze</Link> },
              { title: einsatz?.bezeichnung ?? '…' },
              { title: modulName('ueberblick') },
            ]}
          />
        }
        meta={kopfLage}
        dataUpdatedAt={einsatzQ.dataUpdatedAt}
        // Bedingt übergeben: ein JSX-Element ist immer truthy und hinterließe ein leeres `div` mit
        // Außenabstand.
        hinweis={
          einsatz != null &&
          !darfSchreiben && <RechteHinweis sichtbar text={ueberblickRechteText(einsatz)} />
        }
        aktionen={
          <>
            {/* Die Übersichten verweisen aufeinander (LLH-1743, Spec `lage-verdichtung`). */}
            <Button
              disabled={lagebildGesperrt}
              title={lagebildGesperrt ? KEINE_BERECHTIGUNG : undefined}
              onClick={() => waehle(lagebildZiel)}
            >
              {modulName('lage-dashboard')}
            </Button>
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
              disabled={!darfEtbErfassen || etbSprungGesperrt}
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
            Hinweis nach unten. Das Laden zeigt der Spinner am Einsatznamen der Kopfleiste.
            Ebenso auf den Modulzähler (LLH-1430): aus ihm wissen die „Offenen Vorgänge“, wie viele
            Platzhalterzeilen sie beim Laden halten. Kam er nach dem Körper, wuchsen die Abschnitte
            von einer Zeile auf ihre Platzhalter, derselbe Sprung wie ohne sie. Der Rahmen ruft ihn
            ohnehin (Rail); ein Fehler oder „ohne Netz“ hält den Körper nicht auf (`isLoading`).
            Die Paneelreihen unter der Alarmzeile warten zusätzlich auf die Gliederung
            (`gliederungLaedt`, LLH-1481) und die Quellen der Marken (`markenLaedt`, LLH-1748),
            Startliste und Paneelreihen beim ersten Aufbau auf die Quellen der Startliste
            (`startlisteSchranke`, LLH-1815). */}
        {einsatzQ.isLoading || zaehlerQ.isLoading ? null : (
          <DashboardFlaeche kennung="ueberblick">
            {/* Die Alarmzeile „Was brennt“ steht als erstes unter dem Seitenkopf, auf Überblick,
              Lagebild und Lagemonitor dieselbe (LLH-1743, Spec `lage-alarmzeile`). */}
            <AlarmZeile daten={wasBrenntDaten} ziel={(e) => alarmZiel(e, einsatzId, freigaben)} />
            {startlisteSchranke ? null : (
              <>
                {/* Startliste „Einsatz starten“ (LLH-1815): eine eigene Reihe nur mit diesem Paneel
              zwischen Alarmzeile und Paneelreihen; fehlt sie, fehlt die ganze Reihe. */}
                {zeigeStartliste && (
                  <PaneelReihe kennung="ueberblick-startliste">
                    <StartlistePaneel
                      punkte={startlistePunkte}
                      onAusblenden={blendeStartlisteAus}
                      onNeuladen={startlisteNachladen}
                    />
                  </PaneelReihe>
                )}
                {reihenLaden ? null : (
                  <>
                    {/* Kein Band (LLH-1748, Spec `lage-verdichtung`): Reihe 1 trägt die Fristen und die
                        offenen Vorgänge, Reihe 2 die Gliederung und die Entscheidungen. Gestapelt (unter `lg`)
                        stehen die Fristen damit direkt unter Alarmzeile und Startliste. */}
                    <PaneelReihe kennung="ueberblick-paneele">
                      <ListenPaneel
                        titel="Nächste Marken"
                        zustand={zMarken}
                        // Die Marken kommen aus mehreren Modulen: kein Sprung, die Zahl der weiteren als
                        // Meta (`naechsteMarken` kürzt selbst).
                        meta={
                          zMarken === 'daten' && marken.weitere > 0
                            ? `+${marken.weitere} weitere`
                            : undefined
                        }
                        fuss={
                          // Im Leerzustand steht der Hinweis im Leertext.
                          zMarken === 'daten' && marken.marken.length > 0 && markenHinweis ? (
                            <span style={{ fontSize: 12, color: rollen.gedaempft }}>
                              {markenHinweis}
                            </span>
                          ) : undefined
                        }
                        leerText={
                          markenHinweis
                            ? `Keine sichtbaren Fristen. ${markenHinweis}`
                            : 'Keine anstehenden Fristen.'
                        }
                        gesperrtText={GESPERRT}
                        onNeuladen={() => nachladen(qEinsatz, qProgramm, qAuftraege, qErinnerungen)}
                        eintraege={marken.marken}
                        max={marken.marken.length}
                        schluessel={(m) => m.key}
                        zeile={(m) => (
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
                              <span style={{ ...monoStil(14), color: markenFarbe(m) }}>
                                {kurz(m.zeit)}
                              </span>
                              <span
                                style={{
                                  ...schriftStil('meta'),
                                  fontSize: 11,
                                  color: markenFarbe(m),
                                }}
                              >
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
                        )}
                      />

                      <OffeneVorgaengePaneel
                        einsatzId={einsatzId}
                        jetzt={jetzt.valueOf()}
                        zustand={zVorgaenge}
                        zaehler={zaehlerQ}
                        meldungen={{ q: meldungenOffenQ, frei: rueckmeldungenFrei }}
                        auftraege={{ q: auftraegeQ, frei: auftraegeFrei }}
                        nachforderungen={{ q: nachforderungenQ, frei: nachforderungenFrei }}
                        erinnerungen={{ q: erinnerungenQ, frei: erinnerungenFrei }}
                        abloesungen={{ q: abloesungenQ, frei: abloesungSichtbar }}
                        ohneSchicht={ohneSchichtZahl}
                        stelle={stelle}
                        sicht={sicht}
                        onSicht={waehleSicht}
                        onNeuladen={() => void freigabenQ.refetch()}
                      />
                    </PaneelReihe>

                    <PaneelReihe kennung="ueberblick-paneele-gliederung">
                      <GliederungsPaneel
                        titel="Einsatzabschnitte"
                        kennung="ueberblick-abschnitt"
                        zustand={mitLeer(zAbschnitte, zeilen.length === 0)}
                        // Beim Laden hält ein unsichtbares Meta seinen Platz (Muster `Datenstand
                        // platzHalten`): auf 390 px bricht der Kopf mit dem Meta um (38 → 52 px), und
                        // das erst mit den Daten zu tun, schöbe alles darunter (LFH-883). Seit LLH-1481
                        // lädt das Paneel hier nur noch, solange die Freigaben fehlen (`gliederungLaedt`).
                        meta={
                          zAbschnitte === 'daten' ? (
                            // Einzahl und Mehrzahl richtig (LFH-973): „1 Abschnitt“, nicht „1 Abschnitte“.
                            `${anzahlWort(abschnitte?.length ?? 0, 'Abschnitt', 'Abschnitte')} · ${anzahlWort(einheiten?.length ?? 0, 'Einheit', 'Einheiten')}`
                          ) : zAbschnitte === 'laden' ? (
                            <span
                              data-lfh="paneel-meta-platzhalter"
                              aria-hidden="true"
                              style={{ visibility: 'hidden' }}
                            >
                              0 Abschnitte · 0 Einheiten
                            </span>
                          ) : undefined
                        }
                        sprung={{
                          label: modulName('einsatzabschnitte'),
                          onKlick: () => waehle(einsatzabschnittePfad(einsatzId)),
                        }}
                        fuss={
                          zAbschnitte === 'daten' && zeilen.length > 0 && auftraegeFehlen ? (
                            <span
                              style={{
                                ...schriftStil('meta'),
                                fontSize: 11,
                                color: rollen.schwach,
                              }}
                            >
                              Aufträge nicht abrufbar, Auftragstexte fehlen
                            </span>
                          ) : undefined
                        }
                        leerText={
                          abschnitteHinweis
                            ? `Noch keine Abschnitte, Einheiten oder Personal erfasst. ${abschnitteHinweis}`
                            : 'Noch keine Abschnitte und keine Kräfte erfasst.'
                        }
                        gesperrtText={GESPERRT}
                        leerAktion={
                          darfSchreiben
                            ? {
                                label: 'Abschnitt anlegen',
                                // Öffnet die Erfassung direkt (LLH-1815), nicht nur die Seite.
                                onKlick: () =>
                                  waehle(einsatzabschnittePfad(einsatzId, { neu: true })),
                              }
                            : undefined
                        }
                        onNeuladen={() =>
                          nachladen(qAbschnitte, qEinheiten, qPersonal, qFahrzeuge, qMaterial)
                        }
                        zeilen={zeilen.map((z) =>
                          abschnittGliederung(z, einsatzId, kurz, token, rollen, jetzt),
                        )}
                      />

                      <StromPaneel
                        titel={entscheidungTitel}
                        zustand={mitLeer(zEntscheidungen, entscheidungen.eintraege.length === 0)}
                        meta={
                          zEntscheidungen === 'daten' &&
                          entscheidungen.modus === 'zuletzt' &&
                          entscheidungen.eintraege.length > 0
                            ? 'keine in der letzten Stunde'
                            : undefined
                        }
                        sprung={{
                          label: 'ETB',
                          onKlick: () => waehle(etbPfad(einsatzId, { typ: 'entscheidung' })),
                        }}
                        leerText="Noch keine Entscheidung im Einsatztagebuch."
                        gesperrtText={GESPERRT}
                        leerAktion={
                          darfEtbErfassen
                            ? {
                                label: 'Eintrag erfassen',
                                onKlick: () => waehle(etbPfad(einsatzId, { neu: true })),
                              }
                            : undefined
                        }
                        onNeuladen={() => nachladen(qEtb)}
                        listeName="Entscheidungen"
                        // Die Auswahl rechnet die Seite je Takt neu (letzte Stunde); einen Zufluss mit
                        // Wassermarke hat sie nicht, also kein Banner.
                        neu={0}
                        bannerText=""
                        onAnzeigen={() => undefined}
                      >
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
                              zeit={kurz(e.ereigniszeit)}
                              nr={`Nr. ${e.lfd_nr}`}
                              // Eine berichtigte Entscheidung trägt dieselbe Marke wie in der Zeitachse
                              // (LLH-1321): sonst gälte hier die überholte Fassung.
                              meta={
                                <BerichtigtMarke einsatzId={einsatzId} eintrag={e}>
                                  {verfasserText(e)}
                                </BerichtigtMarke>
                              }
                              aktionen={
                                folgeWort ? (
                                  <span
                                    data-lfh="entscheidung-folge"
                                    style={{
                                      ...schriftStil('meta'),
                                      fontSize: 11,
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
                      </StromPaneel>
                    </PaneelReihe>
                  </>
                )}
              </>
            )}
          </DashboardFlaeche>
        )}
      </EinsatzSeite>
    </div>
  );
}

/** Grund im Zustand `gesperrt`: das Modul einer Quelle ist für die Person nicht freigegeben. */
const GESPERRT = 'Modul nicht freigegeben.';

/** Abrufzustand → Paneelzustand; `leer` gilt nur im Zustand `daten`. */
function mitLeer(z: Zustand, leer: boolean): DashboardZustand {
  return z === 'daten' && leer ? 'leer' : z;
}

/**
 * Eine Abschnittszeile für das `GliederungsPaneel`: Lagekante · Name/Kürzel/Leiter/Einheiten/
 * Lagezustand · fester Auftrag (sonst jüngster offener Auftrag) mit Auftragszählung und letzter
 * Rückmeldung · Stärke und Einheiten je Statuskategorie als Verteilung (Zahl + Balken mit Wort).
 * Die ganze Zeile ist der Link auf den Abschnitt.
 */
function abschnittGliederung(
  zeile: AbschnittZeile,
  einsatzId: number,
  /** Tagesbewusste Uhrzeit — eine Rückmeldung von gestern ist nicht „14:11". */
  zeit: (utc: string | null | undefined) => string,
  token: Parameters<typeof rollenFarbe>[1],
  rollen: ReturnType<typeof useRollen>['rollen'],
  /** Seitenuhr: das Urteil über die Rückmeldung schlägt ohne neue Daten um (LLH-1739). */
  jetzt: Dayjs,
): Gliederungszeile {
  const [juengster, ...weitere] = zeile.auftraege;
  // Was brennt (LLH-1739): Ausfall und Rückmeldung wie im Meldebild, als Etikett in Alarmrolle
  // direkt neben dem Lagezustand. Der gepflegte Zustand bleibt stehen (Beurteilung, LFH-608).
  const gruende = abschnittGruende(zeile, jetzt);
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
  const summe =
    verteilung.bereit + verteilung.gebunden + verteilung.nichtVerfuegbar + verteilung.ohne;
  const status: Verteilungszeile[] = (
    [
      ['bereit', verteilung.bereit, 'normal'],
      // Rolle aus der Kategorie, nie fest: „gebunden“ ist überall dieselbe (Spec `statusrollen`).
      ['gebunden', verteilung.gebunden, statusKategorie.gebunden.rolle],
      // Nicht „Ausfall“: den zählt das Meldebild an den Mitteln, er steht als Etikett im Kopf.
      ['nicht verfügbar', verteilung.nichtVerfuegbar, 'alarm'],
    ] as const
  ).map(([wort, wert, rolle]) => ({
    schluessel: wort,
    wort,
    wert,
    anteil: anteil(wert, summe),
    balkenFarbe: rollenFarbe(rolle, token),
  }));
  return {
    schluessel: zeile.key,
    ziel:
      zeile.abschnittId != null
        ? einsatzabschnittePfad(einsatzId, { abschnitt: zeile.abschnittId })
        : einheitenPfad(einsatzId),
    // Lagekante: Farbe nur als Rand, das Wort steht im StatusTag daneben.
    kante: lage ? { farbe: rollenFarbe(lage.rolle, token), rolle: lage.rolle } : null,
    kopf: (
      <>
        <span style={{ fontSize: 14, fontWeight: 500, overflowWrap: 'anywhere' }}>
          {zeile.name}
        </span>
        {leitung && <span style={{ ...monoStil(11), color: rollen.schwach }}>{leitung}</span>}
        <span style={{ ...monoStil(11), color: rollen.gedaempft }}>
          {/* Was gezählt wird, steht dran (LFH-973): hier der ganze Teilbaum, im Abschnittsbaum
              nur die direkt zugeordneten. */}
          {anzahlWort(zeile.einheiten, 'Einheit', 'Einheiten')}
          {/* Ausgeschrieben statt „UA“ (LLH-1750, Spec `bedien-wortlaut`, „Kürzel sind eingeführt
              oder erklärt“). */}
          {zeile.unterabschnitte > 0 &&
            ` inkl. Unterabschnitte · ${anzahlWort(zeile.unterabschnitte, 'Unterabschnitt', 'Unterabschnitte')}`}
        </span>
        {(lage || zeile.unterLage || gruende.length > 0) && (
          <span
            data-lfh="abschnitt-zustand"
            style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: token.marginSM }}
          >
            {lage && <StatusTag darstellung={lage} darstellungsart="rand" />}
            {/* Ein schlechter beurteilter Unterabschnitt bekommt dieselbe Form wie der eigene
                Zustand (Rollenrand + Wort), sonst stünde „Unterabschnitt kritisch“ leiser da als ein grünes
                „planmäßig“. */}
            {zeile.unterLage && (
              <StatusTag
                darstellung={{
                  ...abschnittLagezustand[zeile.unterLage],
                  label: `Unterabschnitt ${abschnittLagezustand[zeile.unterLage].label}`,
                }}
                darstellungsart="rand"
              />
            )}
            {gruende.map((g) => (
              <StatusChip key={g.art} ton="alarm" wort={grundWort(g)} />
            ))}
          </span>
        )}
      </>
    ),
    inhalt: (
      <>
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
        {unterzeile && <span style={{ ...monoStil(10), color: rollen.schwach }}>{unterzeile}</span>}
        {/* Nur wenn die Rückmeldungen feststehen, sonst gar nichts. Der verborgene Vorsatz gibt
            der Zeit im Linknamen ihre Bedeutung. */}
        {zeile.rueckmeldungBekannt && (
          <span
            data-lfh="abschnitt-rueckmeldung"
            style={{ display: 'flex', alignItems: 'baseline', gap: token.margin, minWidth: 0 }}
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
      </>
    ),
    zahl: (
      <>
        <span style={monoStil(15)} title={STAERKE_AUSGESCHRIEBEN}>
          {zeile.staerkeText}
        </span>
        <Augenbraue>{STAERKE_SCHREIBWEISE}</Augenbraue>
        {/* Einheiten je Status als Verteilung: Wort, Zahl, Balken (Dashboard-Baukasten). Kein
            `aria-label` an der Liste: im Link bildet sich der Name aus dem Inhalt. */}
        <Verteilungsliste kennung="abschnitt-status" dichte="zeile" zeilen={status} />
        {verteilung.ohne > 0 && (
          <span style={{ ...monoStil(10), color: rollen.schwach }}>
            +{verteilung.ohne} ohne Status
          </span>
        )}
      </>
    ),
  };
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
