import { IconStift } from '../icons';
import { Alert, App, Breadcrumb, Button, Flex, Spin, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLinkClickHandler, useParams } from 'react-router';
import {
  aendereSchicht,
  beginneSchicht,
  fetchEinsatzSchichtmodell,
  listeAbloesungen,
  listeAbloesungVorgaben,
  nimmVollzugZurueck,
  setzeAbloesungVorgabe,
  vollzieheAbloesung,
} from '../api/abloesungen';
import { ladeEinsatz, ladeModulFreigaben } from '../api/einsaetze';
import { listeEinheiten } from '../api/einheiten';
import { listeBr } from '../api/einsatzBereitstellungsraum';
import { listeEinheitenPerioden } from '../api/kraefteZeitachse';
import { einsatzKeys } from '../api/queryKeys';
import type { Abloesung, AbloesungStatus, AbloesungVorgabe } from '../api/types';
import AbloesungKarte from '../abloesung/AbloesungKarte';
import { abloeserIds, abloeserOptionen, abloeserText } from '../abloesung/abloeser';
import { buildAbloeserStand, type AbloeserStand } from '../abloesung/abloeserStand';
import { besatzungOptionen, besatzungText, bisherigeBesatzung } from '../abloesung/besatzung';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import OhneSchichtKarte from '../abloesung/OhneSchichtKarte';
import {
  AbloeserDialog,
  RhythmusDialog,
  SchichtBeginnenDialog,
  VollzugDialog,
  type EinheitAuswahl,
} from '../abloesung/AbloesungDialoge';
import { formatDauer } from '../abloesung/dauer';
import { planungWarnungText } from '../abloesung/planungWarnung';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { countFaellige } from '../abloesung/einstufung';
import {
  BEGINN_DER_PERIODE,
  findOhneSchicht,
  ohneSchichtZuflussText,
  type OhneSchicht,
} from '../abloesung/ohneSchicht';
import { formatRegel, formatRegelKurz } from '../abloesung/schichtmodellText';
import { useUhr } from '../abloesung/useUhr';
import {
  eingeordnet,
  freigegeben,
  freigegebenNach,
  LEERER_ZUFLUSSSTAND,
  nachgefuehrt,
  nachgefuehrtNach,
  teileZufluss,
  teileZuflussNach,
  zuflussText,
  type Zuflussstand,
} from '../abloesung/zufluss';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { useZeilenFehler } from '../components/useZeilenFehler';
import { SeitenLeer } from '../components/SeitenZustand';
import {
  Paneel,
  PaneelZeile,
  Sammelbanner,
  sammelbannerKurz,
  Segmentleiste,
  useRollen,
} from '../components/instrument';
import { useViewport } from '../components/useViewport';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import {
  einsatzRechteGrund,
  MODUL_EINHEITEN_GESPERRT,
  MODUL_PERSONAL_GESPERRT,
} from '../components/nurAnsicht';
import { abschnittVorgabe, einsatzVorgabe } from '../components/vorgabeText';
import { einsatzEinstellungenPfad } from '../routing/deeplinks';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';

const { Text } = Typography;

/** Grund der fehlenden Schreibberechtigung (`components/nurAnsicht.ts`). */
const abloesungRechteText = einsatzRechteGrund;

/**
 * Die Ansichten der Seite (LLH-1128): laufende Schichten, Einheiten im Einsatz ohne Schicht und
 * die vergangenen Schichten. „Vergangen“ teilt sich in abgelöste und beendete; ein eigenes
 * Segment je Status trüge die Werkzeugzeile auf 390 px im Handschuh-Betrieb nicht neben dem
 * Sammelbanner (gemessen in `e2e/gate1-ueberlauf.spec.ts`).
 */
type Ansicht = 'laufend' | 'ohne' | 'vergangen';
type Vergangen = 'abgeloest' | 'beendet';

type Rhythmusziel =
  /** `vorgabe`: was bei leerem Feld gilt, schon als Platzhalter (Abschnitt vor Einsatz). */
  | { art: 'schicht'; schicht: Abloesung; vorgabe: string | undefined }
  | { art: 'abschnitt'; vorgabe: AbloesungVorgabe };

/**
 * So lange trägt eine per `?schicht=` angesprungene Karte die Hervorhebung (LLH-1131 Teil II):
 * lang genug, sie nach dem Bildlauf zu finden, danach steht sie wie jede andere. Sie geht ohne
 * Übergang an und aus, einmal; nichts blinkt.
 */
export const SCHICHT_HERVORHEBUNG_MS = 8_000;

/** Leerzustand und Name der Schichtliste je Status. */
const LEER: Record<AbloesungStatus, string> = {
  laufend: 'Keine laufenden Schichten',
  abgeloest: 'Noch keine Ablösung vollzogen',
  beendet: 'Keine beendete Schicht',
};
const BEREICH: Record<AbloesungStatus, string> = {
  laufend: 'Laufende Schichten',
  abgeloest: 'Abgelöste Schichten',
  beendet: 'Beendete Schichten',
};

/**
 * Fachmodul Ablösung (LFH-635): Schichten der Einheiten, nach Fälligkeit geordnet.
 *
 * Form: eine Liste, keine Tabelle — die Frage ist „was ist mit dieser Einheit?", und die Ordnung
 * ist die Fälligkeit, die der Server festlegt. Neue Schichten landen an ihrem Fälligkeitsplatz,
 * auch oberhalb gezeigter Karten; fremde Neuzugänge warten deshalb hinter dem Sammelbanner, eigene
 * stehen sofort (LFH-647). Die Folge der gezeigten Karten ist eingefroren, ihr Inhalt frisch: eine
 * fremde Änderung von Rhythmus oder Beginn ordnet erst mit dem Banner um, eine eigene sofort
 * (LFH-660). Regeln in `abloesung/zufluss.ts`.
 *
 * Das Banner nimmt keine eigene Zeile: es steht in der immer gerenderten Segmentzeile, deren Höhe
 * es nicht ändert — sonst schöbe es die Karten weg, die es schützen soll. Kein `sticky`-Overlay: es
 * verdeckte die oberste, also dringlichste Karte. Die Höhe misst `e2e/abloesung-zufluss.spec.ts`.
 * Auf dem Handschirm (unter `md`) bleibt neben der Segmentleiste kein Platz für Satz und Knopf
 * (LFH-694: im Handschuh-Betrieb 0 px Text); dort steht die Kurzform „1 neu" als ein Knopf, der
 * volle Satz bleibt für Hilfstechnik im Status. Gemessen in `e2e/gate1-ueberlauf.spec.ts`.
 *
 * Die Uhr tickt alle 30 s (`useUhr`): Einstufung und „in x min" laufen ohne Abruf mit. Nichts
 * blinkt; der Hinweis bei Fälligkeit kommt einmalig über die AlarmZentrale.
 *
 * „Ohne Schicht“ (LLH-1128) zeigt die Einheiten im Einsatz, die weder eine eigene laufende Schicht
 * haben noch eine erben (`abloesung/ohneSchicht.ts`), mit „Schicht beginnen“ je Zeile. Die Liste
 * hat ihre eigene Schleuse nach denselben Regeln; Zähler und Kopf rechnen mit der vollen Menge.
 * Ohne das Modul Einheiten fehlen Einheiten und Zeitachse, das Segment steht dann gesperrt mit
 * Grund. Auf dem Handschirm tragen die Segmente keine Zahl, der Kopf nennt sie.
 *
 * Hinweise an die Führung (LLH-1131 Teil II): Die Karte einer laufenden Schicht nennt den Stand
 * ihrer geplanten Ablöser aus der Kräfte-Zeitachse (`abloesung/abloeserStand.ts`; der Raum aus der
 * Raumliste, nur mit Freigabe der Bereitstellungsräume) und die Warnungen zur Planung. Live kommt
 * beides über die bestehenden Ereignisse (`einheit`, `fahrzeug`, `abloesung`,
 * `bereitstellungsraum`). `?schicht=<id>` (Toasts der AlarmZentrale) wählt die Ansicht mit der
 * Schicht, gibt Zurückgehaltenes frei, rollt die Karte ins Bild und hebt sie
 * {@link SCHICHT_HERVORHEBUNG_MS} lang hervor; der Parameter wird geräumt. Steht die Schicht nicht
 * unter den laufenden, sucht die Seite sie unter den abgelösten und beendeten; eine unbekannte
 * Kennung ändert nichts.
 */
export default function AbloesungPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const { konventionen } = useAnzeigeKonventionen();
  const qc = useQueryClient();
  const { token } = useRollen();
  const jetzt = useUhr();
  const { istSchmal } = useViewport();

  const [ansicht, setAnsicht] = useState<Ansicht>('laufend');
  const [vergangen, setVergangen] = useState<Vergangen>('abgeloest');
  const [beginnenOffen, setBeginnenOffen] = useState(false);
  // Aus einer Zeile „Ohne Schicht“: die Einheit steht im Dialog schon gewählt.
  const [beginnenVorbelegt, setBeginnenVorbelegt] = useState<number | undefined>(undefined);
  const [vollzugSchicht, setVollzugSchicht] = useState<Abloesung | null>(null);
  const [abloeserSchicht, setAbloeserSchicht] = useState<Abloesung | null>(null);
  const [rhythmusZiel, setRhythmusZiel] = useState<Rhythmusziel | null>(null);
  // Sprung `?schicht=` (LLH-1131 Teil II): die gesuchte vergangene Schicht, die angesprungene
  // Karte (ein neues Objekt je Sprung, damit ein zweiter Sprung die Frist neu beginnt) und die
  // Karte, die noch ins Bild gerollt werden muss.
  const [sucheSchicht, setSucheSchicht] = useState<number | null>(null);
  const [hervorhebung, setHervorhebung] = useState<{ id: number } | null>(null);
  const [scrollZiel, setScrollZiel] = useState<number | null>(null);
  // An den Einsatz gebunden: wechselt die Route den Einsatz bei stehender Komponente, wären sonst
  // alle Schichten des neuen Einsatzes „fremde Neuzugänge".
  const [zuflussZustand, setZuflussZustand] = useState<{ einsatzId: number } & Zuflussstand>({
    einsatzId,
    ...LEERER_ZUFLUSSSTAND,
  });
  // Eine zweite Schleuse für „Ohne Schicht“, nach demselben Muster (`abloesung/zufluss.ts`).
  const [ohneZustand, setOhneZustand] = useState<{ einsatzId: number } & Zuflussstand>({
    einsatzId,
    ...LEERER_ZUFLUSSSTAND,
  });

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const laufendQuery = useQuery({
    queryKey: einsatzKeys.abloesungListe(einsatzId, 'laufend'),
    queryFn: () => listeAbloesungen(einsatzId, 'laufend'),
  });
  const abgeloestQuery = useQuery({
    queryKey: einsatzKeys.abloesungListe(einsatzId, 'abgeloest'),
    queryFn: () => listeAbloesungen(einsatzId, 'abgeloest'),
    enabled: (ansicht === 'vergangen' && vergangen === 'abgeloest') || sucheSchicht != null,
  });
  // Beendet ohne Ablösung (LLH-1128): mit der Entlassung oder beim Auflösen der Einheit.
  const beendetQuery = useQuery({
    queryKey: einsatzKeys.abloesungListe(einsatzId, 'beendet'),
    queryFn: () => listeAbloesungen(einsatzId, 'beendet'),
    enabled: (ansicht === 'vergangen' && vergangen === 'beendet') || sucheSchicht != null,
  });
  const vorgabenQuery = useQuery({
    queryKey: einsatzKeys.abloesungVorgaben(einsatzId),
    queryFn: () => listeAbloesungVorgaben(einsatzId),
  });
  // Vorgabe des Einsatzes (LLH-1122): gesetzt wird sie in den Einsatz-Einstellungen, hier gilt sie
  // als letzte Stufe der Rangfolge (Platzhalter, leeres Rhythmusfeld) und steht im Paneel.
  const einsatzVorgabeQuery = useQuery({
    queryKey: einsatzKeys.abloesungEinsatzVorgabe(einsatzId),
    queryFn: () => fetchEinsatzSchichtmodell(einsatzId),
  });
  const einsatzModell = einsatzVorgabeQuery.data?.schichtmodell ?? null;
  const einsatzVorgabeKurz = einsatzModell
    ? formatRegelKurz(einsatzModell, konventionen)
    : undefined;
  const einsatzVorgabePfad = einsatzEinstellungenPfad(einsatzId, 'abloesung');
  const zurEinsatzVorgabe = useLinkClickHandler<HTMLElement>(einsatzVorgabePfad);
  const darfSchreiben = einsatzQuery.data ? darfImEinsatzSchreiben(einsatzQuery.data) : false;

  // Einheiten und ihre Zeitachse gehören dem Modul Einheiten: ohne dessen Freigabe keine Anfrage
  // (Spec `modul-freigabe`). Sie tragen „Ohne Schicht“ (LLH-1128) und den Platzhalter „Im Einsatz
  // seit“ des Beginnen-Dialogs (LFH-1078); ohne sie ist das Segment gesperrt und der Platzhalter
  // leer. Live kommen beide über `einheit`, `fahrzeug` und `abloesung` (`api/queryKeys.ts`).
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const einheitenFrei = istKeyFreigegeben('einheiten', freigabenQuery.data);
  // Gesperrt erst, wenn die Freigaben da sind: beim Laden steht das Segment offen, ohne Zahl.
  const einheitenGesperrt = freigabenQuery.data != null && !einheitenFrei;
  // Die Einheiten braucht, wer Schichten beginnen oder Ablöser wählen darf, und „Ohne Schicht“.
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: darfSchreiben || einheitenFrei,
  });
  const periodenQuery = useQuery({
    queryKey: einsatzKeys.kraefteZeitachseEinheiten(einsatzId),
    queryFn: () => listeEinheitenPerioden(einsatzId),
    enabled: einheitenFrei,
  });
  // Besatzungswechsel (LLH-1150): die neue Besatzung kommt aus dem Personal des Einsatzes (Modul
  // Personal), geladen erst mit offenem Vollzug-Dialog. Der Wechsel schreibt die Zuordnung, die
  // sonst das Modul Einheiten schreibt; ohne eine der beiden Freigaben ist er gesperrt mit Grund.
  const personalFrei = istKeyFreigegeben('personal', freigabenQuery.data);
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
    enabled: personalFrei && vollzugSchicht != null,
  });
  const besatzungGesperrt =
    freigabenQuery.data == null
      ? undefined
      : !einheitenFrei
        ? MODUL_EINHEITEN_GESPERRT
        : !personalFrei
          ? MODUL_PERSONAL_GESPERRT
          : undefined;

  const laufende = useMemo(() => laufendQuery.data ?? [], [laufendQuery.data]);

  // Stand der geplanten Ablöser (LLH-1131 Teil II): Zeitpunkte aus der Zeitachse, der Raum aus
  // `aktueller_br_id` der Einheit und dem Namen in der Raumliste. Die Liste der Räume gehört dem
  // Modul Bereitstellungsräume und wird nur geholt, wenn ein Ablöser gerade in einem Raum steht.
  const brFrei = istKeyFreigegeben('bereitstellungsraeume', freigabenQuery.data);
  const abloeserImBr = useMemo(() => {
    const ids = new Set(laufende.flatMap(abloeserIds));
    return (einheitenQuery.data ?? []).some((e) => ids.has(e.id) && e.aktueller_br_id != null);
  }, [laufende, einheitenQuery.data]);
  const brQuery = useQuery({
    queryKey: einsatzKeys.br(einsatzId),
    queryFn: () => listeBr(einsatzId),
    enabled: brFrei && abloeserImBr,
  });
  const standJeSchicht = useMemo(() => {
    const m = new Map<number, AbloeserStand[]>();
    if (!periodenQuery.data) return m;
    const brNamen = brQuery.data
      ? new Map(brQuery.data.map((b) => [b.id, b.bezeichnung]))
      : undefined;
    for (const s of laufende) {
      const stand = buildAbloeserStand(s, {
        perioden: periodenQuery.data,
        einheiten: einheitenQuery.data,
        brNamen,
      });
      if (stand) m.set(s.id, stand);
    }
    return m;
  }, [laufende, periodenQuery.data, einheitenQuery.data, brQuery.data]);
  const vorgaben = useMemo(() => vorgabenQuery.data ?? [], [vorgabenQuery.data]);
  // Erst mit allen drei Quellen: ohne die laufenden stünde jede Einheit kurz „ohne Schicht“.
  const ohneSchicht = useMemo(
    () =>
      einheitenFrei && einheitenQuery.data && periodenQuery.data && laufendQuery.data
        ? findOhneSchicht(einheitenQuery.data, periodenQuery.data, laufendQuery.data)
        : null,
    [einheitenFrei, einheitenQuery.data, periodenQuery.data, laufendQuery.data],
  );

  // ── Live-Zufluss ── Nur die gerenderte Liste nimmt `sichtbar`. Kopfzeile, Zähler,
  // Fälligkeitszahl und freie Einheiten rechnen mit der vollen Menge: die Zahlen dürfen nicht
  // lügen, und „Schicht beginnen" für eine Einheit mit nur zurückgehaltener Schicht lehnte der
  // Server ab.
  const zufluss: Zuflussstand =
    zuflussZustand.einsatzId === einsatzId ? zuflussZustand : LEERER_ZUFLUSSSTAND;
  const { sichtbar, zurueckgehalten, umgeordnet } = teileZufluss(laufende, zufluss);
  // Nachführen im Render (Muster `EtbZeitachse`), nicht im Effekt: der ließe einen Bildaufbau mit
  // veraltetem Stand durch. `nachgefuehrt` liefert `null`, wenn nichts zu tun ist — der Riegel
  // gegen die Schleife.
  if (laufendQuery.data) {
    const neu = nachgefuehrt(zufluss, sichtbar, umgeordnet);
    if (neu || zuflussZustand.einsatzId !== einsatzId) {
      setZuflussZustand({ einsatzId, ...(neu ?? zufluss) });
    }
  }
  const merkeEigene = (id: number) =>
    setZuflussZustand((z) => {
      const basis = z.einsatzId === einsatzId ? z : { einsatzId, ...LEERER_ZUFLUSSSTAND };
      return { ...basis, eigene: new Set([...basis.eigene, id]) };
    });
  // Eine eigene Änderung ordnet ihre Karten sofort ein. Gerufen nach dem Refetch mit dessen Daten;
  // `laufende` ist dann veraltet.
  const ordneEin = (auswahl: (s: Abloesung) => boolean) => {
    const frisch =
      qc.getQueryData<Abloesung[]>(einsatzKeys.abloesungListe(einsatzId, 'laufend')) ?? [];
    setZuflussZustand((z) =>
      z.einsatzId === einsatzId ? { einsatzId, ...eingeordnet(z, frisch.filter(auswahl)) } : z,
    );
  };
  // Funktional: eine gerade eingereihte Vormerkung (`merkeEigene`) darf die Freigabe nicht
  // überschreiben.
  const gibFrei = () =>
    setZuflussZustand((z) => ({
      einsatzId,
      ...freigegeben(z.einsatzId === einsatzId ? z : LEERER_ZUFLUSSSTAND, laufende),
    }));

  // ── Zufluss „Ohne Schicht“ ── Gleiche Regeln: neue Einheiten warten hinter dem Banner, eine
  // Einheit, die eine Schicht bekommt, fällt sofort weg, die Folge bleibt eingefroren. Eigene
  // Neuzugänge gibt es nicht: die Seite legt keine Einheit an. Der Zähler rechnet mit der vollen
  // Menge.
  const ohneStand: Zuflussstand =
    ohneZustand.einsatzId === einsatzId ? ohneZustand : LEERER_ZUFLUSSSTAND;
  const ohneGeteilt = teileZuflussNach(ohneSchicht ?? [], ohneStand, BEGINN_DER_PERIODE);
  if (ohneSchicht) {
    const neu = nachgefuehrtNach(
      ohneStand,
      ohneGeteilt.sichtbar,
      ohneGeteilt.umgeordnet,
      BEGINN_DER_PERIODE,
    );
    if (neu || ohneZustand.einsatzId !== einsatzId) {
      setOhneZustand({ einsatzId, ...(neu ?? ohneStand) });
    }
  }
  const gibOhneFrei = () =>
    setOhneZustand((z) => ({
      einsatzId,
      ...freigegebenNach(
        z.einsatzId === einsatzId ? z : LEERER_ZUFLUSSSTAND,
        ohneSchicht ?? [],
        BEGINN_DER_PERIODE,
      ),
    }));

  // ── Sprung `?schicht=<id>` (LLH-1131 Teil II, `frontend/AGENTS.md` „Deeplink-Muster“) ──
  // Ein Sprung ist wie ein Ansichtswechsel die Bitte, den aktuellen Stand zu sehen: er gibt die
  // zurückgehaltenen Schichten frei, auch die gesuchte.
  const springeZu = (id: number) => {
    setHervorhebung({ id });
    setScrollZiel(id);
  };
  useQueryParamSelektion('schicht', laufendQuery.isSuccess && einsatzQuery.isSuccess, (id) => {
    if (laufende.some((x) => x.id === id)) {
      gibFrei();
      gibOhneFrei();
      setAnsicht('laufend');
      springeZu(id);
    } else {
      setSucheSchicht(id);
    }
  });
  // Nicht unter den laufenden: die vergangenen beider Status laden, dann entscheiden. Erst wenn
  // beide frisch stehen, sonst entschiede ein alter Stand.
  const vergangenBereit = (q: { isFetched: boolean; isFetching: boolean }) =>
    q.isFetched && !q.isFetching;
  const abgeloestBereit = vergangenBereit(abgeloestQuery);
  const beendetBereit = vergangenBereit(beendetQuery);
  useEffect(() => {
    if (sucheSchicht == null || !abgeloestBereit || !beendetBereit) return;
    const status: Vergangen | null = abgeloestQuery.data?.some((x) => x.id === sucheSchicht)
      ? 'abgeloest'
      : beendetQuery.data?.some((x) => x.id === sucheSchicht)
        ? 'beendet'
        : null;
    if (status) {
      setAnsicht('vergangen');
      setVergangen(status);
      setHervorhebung({ id: sucheSchicht });
      setScrollZiel(sucheSchicht);
    }
    setSucheSchicht(null);
  }, [sucheSchicht, abgeloestBereit, beendetBereit, abgeloestQuery.data, beendetQuery.data]);
  // Einmal ins Bild rollen, sobald die Karte steht (nach dem Ansichtswechsel).
  useEffect(() => {
    if (scrollZiel == null) return;
    const karte = document.querySelector(
      `[data-lfh="abloesung-karte"][data-schicht-id="${scrollZiel}"]`,
    );
    if (!karte) return;
    karte.scrollIntoView?.({ block: 'center' });
    setScrollZiel(null);
    // Die Karte erscheint mit der Ansicht, mit den Daten ihrer Liste oder mit der Freigabe.
  }, [
    scrollZiel,
    ansicht,
    vergangen,
    laufendQuery.data,
    abgeloestQuery.data,
    beendetQuery.data,
    zuflussZustand,
  ]);
  useEffect(() => {
    if (!hervorhebung) return;
    const frist = window.setTimeout(() => setHervorhebung(null), SCHICHT_HERVORHEBUNG_MS);
    return () => window.clearTimeout(frist);
  }, [hervorhebung]);

  // Einheiten ohne laufende Schicht — nur sie können beginnen oder ablösen.
  const freieEinheiten: EinheitAuswahl[] = useMemo(() => {
    const belegt = new Set(laufende.map((a) => a.einheit_id));
    return (einheitenQuery.data ?? [])
      .filter((e) => !belegt.has(e.id))
      .map((e) => ({ value: e.id, label: e.name }));
  }, [einheitenQuery.data, laufende]);
  const vorgabeJeEinheit = useMemo(() => {
    const jeAbschnitt = new Map(
      vorgaben
        .filter((v) => v.rhythmus_minuten != null)
        .map((v) => [v.abschnitt_id, v.rhythmus_minuten!]),
    );
    const m = new Map<number, number>();
    for (const e of einheitenQuery.data ?? []) {
      const v = e.abschnitt_id != null ? jeAbschnitt.get(e.abschnitt_id) : undefined;
      if (v != null) m.set(e.id, v);
    }
    return m;
  }, [einheitenQuery.data, vorgaben]);
  // Wie `offenes_eintreffen` im Server: das Eintreffen der letzten, noch offenen Periode.
  const eintreffenJeEinheit = useMemo(() => {
    if (!periodenQuery.data) return null;
    const m = new Map<number, string>();
    for (const { einheit_id, perioden } of periodenQuery.data) {
      const letzte = perioden[perioden.length - 1];
      if (letzte && !letzte.ende_at && letzte.eintreffen_at)
        m.set(einheit_id, letzte.eintreffen_at);
    }
    return m;
  }, [periodenQuery.data]);

  const invalidiere = () => qc.invalidateQueries({ queryKey: einsatzKeys.abloesungen(einsatzId) });
  // Vollzug und Rücknahme können den Abschnitt von Einheiten ändern (LLH-1132); das Ereignis
  // `einheit` kommt live, der eigene Tab gleicht sofort ab.
  const invalidiereEinheiten = () =>
    qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
  const invalidiereBesatzung = () => {
    invalidiereEinheiten();
    qc.invalidateQueries({ queryKey: einsatzKeys.personal(einsatzId) });
  };

  // Fehler stehen im jeweiligen Dialog (SpeicherFehler); `mutateAsync` lehnt ab, die Hülle lässt
  // die Felder stehen.
  const beginnenMut = useMutation({
    mutationFn: (body: Parameters<typeof beginneSchicht>[1]) => beginneSchicht(einsatzId, body),
    onSuccess: (a) => {
      merkeEigene(a.id);
      invalidiere();
      message.success(`Schicht von ${a.einheit_name} begonnen`);
    },
  });
  /*
   * Die Rücknahme hat zwei Wege mit je eigenem Fehlerort (LFH-1077, `frontend/AGENTS.md`,
   * „Rückwege und Fehler“): der Knopf an der abgelösten Karte meldet an der Karte, Rückgängig aus
   * dem Toast im Hinweis der Seite — die Karte ist dann meist nicht zu sehen. Beide Gründe kommen
   * aus den Callbacks, nicht aus `mutation.error`: der kennt nur den letzten Aufruf.
   */
  const kartenFehler = useZeilenFehler<number>();
  const [rueckgaengigFehler, setRueckgaengigFehler] = useState<unknown>(null);
  const ruecknahmeErfolg = (a: Abloesung) => {
    // Die zurückgenommene Schicht kehrt in die laufenden zurück — als eigene Handlung.
    merkeEigene(a.id);
    invalidiere();
    invalidiereBesatzung();
    message.success(`Vollzug der Ablösung ${a.einheit_name} zurückgenommen`);
  };
  const zuruecknehmenMut = useMutation({
    mutationFn: (abloesungId: number) => nimmVollzugZurueck(einsatzId, abloesungId),
    onMutate: (abloesungId) => kartenFehler.beginne(abloesungId),
    onSuccess: ruecknahmeErfolg,
    onError: (e, abloesungId) => {
      kartenFehler.melde(abloesungId, e, 'Rücknahme fehlgeschlagen');
      invalidiere();
    },
  });
  // Die nächste Rücknahme aus dem Toast räumt den Grund der vorigen.
  const rueckgaengigMut = useMutation({
    mutationFn: (abloesungId: number) => nimmVollzugZurueck(einsatzId, abloesungId),
    onMutate: () => setRueckgaengigFehler(null),
    onSuccess: ruecknahmeErfolg,
    onError: (e) => {
      setRueckgaengigFehler(e);
      invalidiere();
    },
  });
  const vollzugMut = useMutation({
    mutationFn: ({
      abloesungId,
      body,
    }: {
      abloesungId: number;
      body: Parameters<typeof vollzieheAbloesung>[2];
    }) => vollzieheAbloesung(einsatzId, abloesungId, body),
    // Der Vollzug hat einen serverseitigen Rückweg → Rückgängig-Toast statt Rückfrage. Der Dialog
    // davor erfasst Zeitpunkt und Ablöser, er ist keine Rückfrage.
    onSuccess: (v) => {
      // Je Ablöser eine Folgeschicht (LLH-1132): jede ist eine eigene Handlung.
      for (const f of v.folgeschichten) merkeEigene(f.id);
      invalidiere();
      if (v.abgeloest.abschnitt_uebergeben) invalidiereEinheiten();
      // Der Besatzungswechsel (LLH-1150) hängt Personen um: Einheiten und Personal gleichen ab.
      const wechsel = v.abgeloest.art === 'besatzung';
      if (wechsel) invalidiereBesatzung();
      const durch = abloeserText(v.abgeloest);
      const text = wechsel
        ? `Besatzungswechsel vollzogen: ${v.abgeloest.einheit_name}, neu ${besatzungText(v.abgeloest, 'neu') ?? ''}`
        : durch
          ? `Ablösung vollzogen: ${v.abgeloest.einheit_name} durch ${durch}`
          : `Ablösung vollzogen: ${v.abgeloest.einheit_name}`;
      zeigeRueckgaengig(message, text, () => rueckgaengigMut.mutate(v.abgeloest.id));
    },
  });
  const aendernMut = useMutation({
    mutationFn: ({
      abloesungId,
      body,
    }: {
      abloesungId: number;
      body: Parameters<typeof aendereSchicht>[2];
    }) => aendereSchicht(einsatzId, abloesungId, body),
    // Rhythmus oder Beginn verschieben die Fälligkeit: die eigene Karte rückt erst nach dem Refetch
    // an ihren Platz, sonst stünde sie mit altem Inhalt am neuen. Trifft der Live-Refetch vor der
    // eigenen Antwort ein, meldet das Banner diese eine Rundreise lang „Reihenfolge geändert".
    // Scheitert der Refetch, zeigt der nächste Abruf die Änderung wie eine fremde hinter dem
    // Banner.
    onSuccess: async (a, { body }) => {
      message.success('Schicht geändert');
      // Plausibilität beim Planen (LLH-1131): die Planung gilt, der Server warnt nur.
      // Geplant wird als Liste (LLH-1132); die Einzelangabe ist Bestand.
      if (body.abloesende_einheit_id != null || (body.abloeser_ids?.length ?? 0) > 0) {
        for (const w of a.planung_warnungen) {
          message.warning(planungWarnungText(w, konventionen));
        }
      }
      if (body.rhythmus_minuten === undefined && body.beginn_at === undefined) {
        void invalidiere();
        return;
      }
      await invalidiere();
      ordneEin((s) => s.id === a.id);
    },
  });
  const vorgabeMut = useMutation({
    mutationFn: ({ abschnittId, minuten }: { abschnittId: number; minuten: number | null }) =>
      setzeAbloesungVorgabe(einsatzId, abschnittId, minuten),
    // Eine neue Vorgabe schreibt der Server nur in die Schichten ihres Abschnitts, die ihr folgen
    // (`rhythmus_quelle = 'abschnitt'`); eine entfernte lässt jede Schicht stehen. Genau diese
    // werden eingeordnet — eine fremd umgeordnete Schicht mit eigenem Rhythmus bleibt eingefroren.
    // Nach dem Refetch, wie bei `aendernMut`.
    onSuccess: async (_, { abschnittId, minuten }) => {
      message.success('Rhythmus-Vorgabe gespeichert');
      if (minuten == null) {
        void invalidiere();
        return;
      }
      await invalidiere();
      ordneEin((s) => s.abschnitt_id === abschnittId && s.rhythmus_quelle === 'abschnitt');
    },
  });

  if (einsatzQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const faellig = countFaellige(laufende, jetzt);
  // Ist „Ohne Schicht“ gesperrt, gilt die Ansicht nicht, auch wenn die Sperre erst später kam.
  const wirksam: Ansicht = ansicht === 'ohne' && einheitenGesperrt ? 'laufend' : ansicht;
  const vergangenQuery = vergangen === 'abgeloest' ? abgeloestQuery : beendetQuery;
  const listenArt = wirksam === 'laufend' ? 'laufend' : vergangen;
  const listenQuery = wirksam === 'laufend' ? laufendQuery : vergangenQuery;
  const liste =
    wirksam === 'laufend' ? sichtbar : wirksam === 'vergangen' ? (vergangenQuery.data ?? []) : [];
  const banner =
    wirksam === 'laufend'
      ? {
          zeigen: zurueckgehalten.length > 0 || umgeordnet,
          text: zuflussText(zurueckgehalten, jetzt, umgeordnet ? sichtbar : null),
          kurz: sammelbannerKurz(zurueckgehalten.length, umgeordnet),
          onKlick: gibFrei,
        }
      : wirksam === 'ohne'
        ? {
            zeigen: ohneGeteilt.zurueckgehalten.length > 0 || ohneGeteilt.umgeordnet,
            text: ohneSchichtZuflussText(
              ohneGeteilt.zurueckgehalten.length,
              ohneGeteilt.umgeordnet,
            ),
            kurz: sammelbannerKurz(ohneGeteilt.zurueckgehalten.length, ohneGeteilt.umgeordnet),
            onKlick: gibOhneFrei,
          }
        : null;
  const oeffneBeginnen = (vorbelegt?: number) => {
    beginnenMut.reset();
    setBeginnenVorbelegt(vorbelegt);
    setBeginnenOffen(true);
  };
  const ohneZahl = ohneSchicht?.length;
  // Jede der drei Quellen kann scheitern; dann steht der Fehler statt eines ewigen Ladens.
  const ohneFehler = einheitenQuery.isError || periodenQuery.isError || laufendQuery.isError;
  // Auf dem Handschirm tragen die Segmente keine Zahl (Platz neben dem Banner, LLH-1128); der
  // Kopf nennt sie dort wie überall. Im Handschuh-Betrieb bricht „Ohne Schicht“ zudem in zwei
  // Zeilen: das Segment ist dort 72 px hoch, und einzeilig bliebe neben drei Segmenten kein Platz
  // für „1 neu“ (gemessen in `e2e/gate1-ueberlauf.spec.ts`).
  const segmentZahl = (n: number | undefined) => (istSchmal || n == null ? '' : ` (${n})`);
  const ohneWort = istSchmal && token.controlHeight >= 72 ? 'Ohne\nSchicht' : 'Ohne Schicht';

  return (
    <EinsatzSeite
      titel="Ablösung"
      meta={`${laufende.length} laufend · ${faellig} fällig${ohneZahl ? ` · ${ohneZahl} ohne Schicht` : ''}`}
      dataUpdatedAt={laufendQuery.dataUpdatedAt}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Ablösung' },
          ]}
        />
      }
      // Gesperrt statt versteckt: der Hinweis darunter nennt den Grund.
      aktionen={
        <Button type="primary" disabled={!darfSchreiben} onClick={() => oeffneBeginnen()}>
          Schicht beginnen
        </Button>
      }
      neueZeile={darfSchreiben ? () => oeffneBeginnen() : undefined}
      // Nur mit Inhalt gesetzt: ein leerer Slot rendert in `EinsatzSeite` trotzdem seinen Rahmen.
      hinweis={
        (!darfSchreiben || rueckgaengigFehler != null) && (
          <SeitenHinweise
            rechteFehlt={!darfSchreiben}
            rechteText={abloesungRechteText(einsatz.status)}
            fehler={rueckgaengigFehler}
            fehlerTitel="Nicht zurückgenommen"
            fehlerFallback="Rücknahme fehlgeschlagen"
          />
        )
      }
    >
      {/* Die Werkzeugzeile: immer gerendert, `nowrap`, Mindesthöhe = Steuerhöhe + 2 px Rahmen
          (Segmentleiste und Banner tragen beide einen 1-px-Rand). Das Banner ändert ihre Höhe
          nicht, also verschiebt es keine Karte. */}
      <Flex
        // Schmal nur `marginXS` (Muster Verpflegung, LLH-1040): die Segmente rücken in ihrer Zelle
        // um den Zielabstand ein, die Ziele stehen so weiter ≥ 16 px auseinander.
        gap={istSchmal ? token.marginXS : token.marginSM}
        align="center"
        data-lfh="abloesung-werkzeugzeile"
        style={{ marginBottom: token.margin, minHeight: token.controlHeight + 2 }}
      >
        <Segmentleiste
          beschriftung="Ansicht"
          wert={wirksam}
          onWechsel={(w) => {
            // Ein Ansichtswechsel ist die Bitte, den aktuellen Stand zu sehen.
            gibFrei();
            gibOhneFrei();
            setAnsicht(w);
          }}
          optionen={[
            { wert: 'laufend', label: `Laufend${segmentZahl(laufende.length)}` },
            {
              wert: 'ohne',
              label: `${ohneWort}${segmentZahl(ohneZahl)}`,
              gesperrt: einheitenGesperrt ? MODUL_EINHEITEN_GESPERRT : undefined,
            },
            { wert: 'vergangen', label: 'Vergangen' },
          ]}
          style={{ flex: 'none' }}
        />
        {banner?.zeigen && (
          <Sammelbanner
            aktion={{ label: 'anzeigen', onKlick: banner.onKlick }}
            kurz={istSchmal ? banner.kurz : undefined}
            style={{ flex: '1 1 0', minWidth: 0, flexWrap: 'nowrap', paddingBlock: 0 }}
          >
            <span
              title={banner.text}
              style={{
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {banner.text}
            </span>
          </Sammelbanner>
        )}
      </Flex>
      {/* Die vergangenen Schichten nach Status (LLH-1128). Eine eigene Zeile: in dieser Ansicht
          steht kein Banner, und neben der Ansichtsleiste fehlte auf dem Handschirm der Platz. */}
      {wirksam === 'vergangen' && (
        <Segmentleiste
          beschriftung="Vergangene Schichten"
          wert={vergangen}
          onWechsel={setVergangen}
          optionen={[
            { wert: 'abgeloest', label: 'Abgelöst' },
            { wert: 'beendet', label: 'Beendet' },
          ]}
          style={{ marginBottom: token.margin }}
        />
      )}

      {wirksam === 'ohne' ? (
        <>
          {ohneFehler && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: token.marginSM }}
              title="Einheiten ohne Schicht konnten nicht geladen werden"
            />
          )}
          {ohneSchicht == null ? (
            !ohneFehler && <Spin />
          ) : ohneSchicht.length === 0 ? (
            <SeitenLeer titel="Keine Einheit ohne Schicht" />
          ) : (
            <section aria-label="Einheiten ohne Schicht">
              {ohneGeteilt.sichtbar.map((e: OhneSchicht) => (
                <OhneSchichtKarte
                  key={e.id}
                  eintrag={e}
                  darfSchreiben={darfSchreiben}
                  onBeginnen={(x) => oeffneBeginnen(x.id)}
                />
              ))}
            </section>
          )}
        </>
      ) : (
        <>
          {listenQuery.isError && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: token.marginSM }}
              title="Ablösungen konnten nicht geladen werden"
            />
          )}
          {listenQuery.isLoading ? (
            <Spin />
          ) : liste.length === 0 ? (
            <SeitenLeer titel={LEER[listenArt]} />
          ) : (
            <section aria-label={BEREICH[listenArt]}>
              {liste.map((s) => (
                <AbloesungKarte
                  key={s.id}
                  schicht={s}
                  jetzt={jetzt}
                  darfSchreiben={darfSchreiben}
                  onVollziehen={(x) => {
                    vollzugMut.reset();
                    setVollzugSchicht(x);
                  }}
                  onAbloeserPlanen={(x) => {
                    aendernMut.reset();
                    setAbloeserSchicht(x);
                  }}
                  onRhythmusAendern={(x) => {
                    aendernMut.reset();
                    const v = vorgaben.find(
                      (g) => g.abschnitt_id === x.abschnitt_id,
                    )?.rhythmus_minuten;
                    // Rangfolge wie im Server: Abschnitt vor Einsatz (LLH-1122).
                    const vorgabe =
                      v != null
                        ? abschnittVorgabe(formatDauer(v))
                        : einsatzVorgabeKurz != null
                          ? einsatzVorgabe(einsatzVorgabeKurz)
                          : undefined;
                    setRhythmusZiel({ art: 'schicht', schicht: x, vorgabe });
                  }}
                  onZuruecknehmen={(x) => zuruecknehmenMut.mutate(x.id)}
                  fehlerGrund={kartenFehler.grund(s.id)}
                  abloeserStand={standJeSchicht.get(s.id) ?? null}
                  hervorgehoben={hervorhebung?.id === s.id}
                />
              ))}
            </section>
          )}
        </>
      )}

      <Paneel titel="Rhythmus je Abschnitt" style={{ marginTop: token.marginLG }}>
        {vorgaben.length === 0 ? (
          <Text type="secondary" style={{ display: 'block', padding: token.paddingSM }}>
            Keine Einsatzabschnitte
          </Text>
        ) : (
          vorgaben.map((v) => (
            <PaneelZeile key={v.abschnitt_id}>
              <Flex
                justify="space-between"
                align="center"
                gap={token.marginXS}
                wrap
                style={{ width: '100%' }}
              >
                <span>
                  <Text strong>{v.abschnitt_name}</Text>{' '}
                  <Text type="secondary">
                    {v.rhythmus_minuten != null
                      ? `Rhythmus ${formatDauer(v.rhythmus_minuten)}`
                      : 'keine Vorgabe'}
                    {v.laufende_schichten > 0 ? ` · ${v.laufende_schichten} laufend` : ''}
                  </Text>
                </span>
                {darfSchreiben && (
                  <Button
                    type="text"
                    icon={<IconStift />}
                    aria-label={`Rhythmus-Vorgabe ${v.abschnitt_name} ändern`}
                    onClick={() => {
                      vorgabeMut.reset();
                      setRhythmusZiel({ art: 'abschnitt', vorgabe: v });
                    }}
                  />
                )}
              </Flex>
            </PaneelZeile>
          ))
        )}
      </Paneel>

      {/* Unter den Abschnitten, wie in der Rangfolge: sie gilt, wo der Abschnitt keine hat. */}
      <Paneel titel="Vorgabe des Einsatzes" style={{ marginTop: token.marginLG }}>
        <PaneelZeile>
          <Flex
            justify="space-between"
            align="center"
            gap={token.marginXS}
            wrap
            style={{ width: '100%' }}
            data-lfh="abloesung-einsatzvorgabe"
          >
            {einsatzModell ? (
              <span>
                <Text strong>{einsatzModell.bezeichnung}</Text>{' '}
                <Text type="secondary">
                  {formatRegel(einsatzModell, konventionen)} · Vorwarnung{' '}
                  {formatDauer(einsatzModell.vorwarnung_minuten)}
                  {einsatzVorgabeQuery.data && einsatzVorgabeQuery.data.laufende_schichten > 0
                    ? ` · ${einsatzVorgabeQuery.data.laufende_schichten} laufend`
                    : ''}
                </Text>
              </span>
            ) : (
              <Text type="secondary">
                {einsatzVorgabeQuery.isError ? 'nicht geladen' : 'keine Vorgabe'}
              </Text>
            )}
            {darfSchreiben && (
              // Ein Sprung, keine Handlung (LFH-616): gesetzt wird in den Einsatz-Einstellungen.
              // Als Knopf mit `href`, damit das Ziel die Steuerhöhe trägt (LFH-365).
              <Button
                type="text"
                icon={<IconStift />}
                href={einsatzVorgabePfad}
                onClick={zurEinsatzVorgabe}
                aria-label="Vorgabe des Einsatzes ändern"
              />
            )}
          </Flex>
        </PaneelZeile>
      </Paneel>

      {/* Dialoge werden je Ziel frisch montiert: `initialValues` greift nur beim Einhängen, und
          der Speicher von rc-field-form überlebt sonst ein Schließen. */}
      {beginnenOffen && (
        <SchichtBeginnenDialog
          offen
          einheiten={freieEinheiten}
          vorbelegt={beginnenVorbelegt}
          vorgabeJeEinheit={vorgabeJeEinheit}
          einsatzVorgabe={einsatzVorgabeKurz}
          eintreffenJeEinheit={eintreffenJeEinheit}
          laeuft={beginnenMut.isPending}
          fehler={beginnenMut.error}
          onErfassen={(body) => beginnenMut.mutateAsync(body)}
          onSchliessen={() => setBeginnenOffen(false)}
        />
      )}
      {vollzugSchicht && (
        <VollzugDialog
          key={vollzugSchicht.id}
          schicht={vollzugSchicht}
          einheiten={abloeserOptionen(einheitenQuery.data ?? [], laufende, vollzugSchicht)}
          // Der Abschnitt der Einheit, wie die Einheitenliste ihn führt; ohne sie (Modul gesperrt)
          // der der Schicht, damit die gesperrte Option mit Grund sichtbar bleibt.
          abschnittName={
            einheitenQuery.data
              ? (einheitenQuery.data.find((e) => e.id === vollzugSchicht.einheit_id)
                  ?.abschnitt_name ?? null)
              : (vollzugSchicht.abschnitt_name ?? null)
          }
          uebergabeGesperrt={einheitenGesperrt ? MODUL_EINHEITEN_GESPERRT : undefined}
          bisherigeBesatzung={bisherigeBesatzung(vollzugSchicht, einheitenQuery.data)}
          personen={besatzungOptionen(
            personalQuery.data ?? [],
            einheitenQuery.data ?? [],
            vollzugSchicht,
          )}
          besatzungGesperrt={besatzungGesperrt}
          laeuft={vollzugMut.isPending}
          fehler={vollzugMut.error}
          onErfassen={(body) => vollzugMut.mutateAsync({ abloesungId: vollzugSchicht.id, body })}
          onSchliessen={() => setVollzugSchicht(null)}
        />
      )}
      {abloeserSchicht && (
        <AbloeserDialog
          key={abloeserSchicht.id}
          schicht={abloeserSchicht}
          einheiten={abloeserOptionen(einheitenQuery.data ?? [], laufende, abloeserSchicht)}
          laeuft={aendernMut.isPending}
          fehler={aendernMut.error}
          onErfassen={(abloeserIds) =>
            aendernMut.mutateAsync({
              abloesungId: abloeserSchicht.id,
              body: { abloeser_ids: abloeserIds },
            })
          }
          onSchliessen={() => setAbloeserSchicht(null)}
        />
      )}
      {rhythmusZiel?.art === 'schicht' && (
        <RhythmusDialog
          key={`s-${rhythmusZiel.schicht.id}`}
          offen
          titel={`Rhythmus ${rhythmusZiel.schicht.einheit_name}`}
          // Folgt die Schicht der Vorgabe, bleibt das Feld leer — sonst machte ein unverändertes
          // Speichern aus der Vorgabe still einen eigenen Wert.
          minuten={
            rhythmusZiel.schicht.rhythmus_quelle === 'einheit'
              ? rhythmusZiel.schicht.rhythmus_minuten
              : null
          }
          leerErlaubt={rhythmusZiel.vorgabe != null}
          platzhalter={rhythmusZiel.vorgabe}
          laeuft={aendernMut.isPending}
          fehler={aendernMut.error}
          onErfassen={(minuten) =>
            aendernMut.mutateAsync({
              abloesungId: rhythmusZiel.schicht.id,
              body: { rhythmus_minuten: minuten },
            })
          }
          onSchliessen={() => setRhythmusZiel(null)}
        />
      )}
      {rhythmusZiel?.art === 'abschnitt' && (
        <RhythmusDialog
          key={`a-${rhythmusZiel.vorgabe.abschnitt_id}`}
          offen
          titel={`Rhythmus-Vorgabe ${rhythmusZiel.vorgabe.abschnitt_name}`}
          minuten={rhythmusZiel.vorgabe.rhythmus_minuten ?? null}
          leerErlaubt
          platzhalter="keine Vorgabe"
          laeuft={vorgabeMut.isPending}
          fehler={vorgabeMut.error}
          onErfassen={(minuten) =>
            vorgabeMut.mutateAsync({ abschnittId: rhythmusZiel.vorgabe.abschnitt_id, minuten })
          }
          onSchliessen={() => setRhythmusZiel(null)}
        />
      )}
    </EinsatzSeite>
  );
}
