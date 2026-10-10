import { IconChevronHoch, IconKreuz, IconPlus } from '../icons';
import { Alert, App, Breadcrumb, Button, Flex, Spin } from 'antd';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { einsatzKeys } from '../api/queryKeys';
import { ladeEinsatz, ladeMitglieder } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import {
  type AbschlussCursor,
  MELDUNGEN_SEITE,
  abschlussCursor,
  bestaetigeMeldung,
  erteileAuftragAusMeldung,
  ladeMeldung,
  ladeMeldungKennzahlen,
  listeAbgeschlosseneMeldungen,
  listeOffeneMeldungen,
  markiereLagerelevant,
  setzeMeldungStatus,
  weiseBearbeiterZu,
} from '../api/meldungen';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import type { Meldung, MeldungStatus, NeueMeldung, NeuerAuftrag } from '../api/types';
import { erfasseMeldungOfflineFaehig } from '../offline/schreiben';
import { MELDUNG_STATUS, istAbgeschlossen, prioRang } from '../kommunikation';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import MeldungListe from '../meldungen/MeldungListe';
import MeldungFormular from '../meldungen/MeldungFormular';
import AuftragErteilenModal from '../meldungen/AuftragErteilenModal';
import LagerelevantModal, { type LagerelevantDaten } from '../meldungen/LagerelevantModal';
import EinsatzSeite from '../components/EinsatzSeite';
import {
  Augenbraue,
  Kennzahl,
  Kennzahlenband,
  Paneel,
  Segmentleiste,
  useRollen,
} from '../components/instrument';
import type { Speicherung } from '../components/Erfassung';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { GewanderteGruende } from '../components/GewanderteGruende';
import { useZeilenFehler } from '../components/useZeilenFehler';
import { useViewport } from '../components/useViewport';
import { MeldungKennzahlZeile, RichtungFilterKnopf } from '../meldungen/MeldungenSchmal';
import { modulName } from '../einsatz/modulRegistry';
import { useSprungSperre } from '../einsatz/useSprungSperre';

/**
 * Sortierung der Meldungen: Prio (sofort→dringend→normal), dann eskaliert zuerst (Alarm oben), dann
 * Ereigniszeit absteigend. Meldungen haben keine Frist im Auftrags-Sinn; die Gruppierung nach
 * „unbearbeitet" steht in der Seite.
 */
function vergleicheMeldung(a: Meldung, b: Meldung): number {
  const prio = prioRang(a.prioritaet) - prioRang(b.prioritaet);
  if (prio !== 0) return prio;
  const eskaliert = Number(b.eskaliert) - Number(a.eskaliert);
  if (eskaliert !== 0) return eskaliert;
  return (b.ereigniszeit ?? '').localeCompare(a.ereigniszeit ?? '');
}

/** Phase einer Meldung über die gemeinsame Phasen-Semantik. */
function istErledigt(m: Meldung): boolean {
  return istAbgeschlossen(MELDUNG_STATUS[m.status]?.phase ?? 'offen');
}

/** Stabile Vorgabe, damit `memo` an `MeldungKarte` bei fehlenden Mitgliedern greift. */
const KEINE_MITGLIEDER: { benutzer_id: number; anzeigename: string }[] = [];

/** Meldung eines offenen Dialogs samt dem Einsatz, in dem er geöffnet wurde. */
interface DialogAuswahl {
  einsatzId: number;
  meldung: Meldung;
}

/** Schließt nach einem Erfolg nur den Dialog, aus dem er kam, keinen inzwischen geöffneten. */
const ohneDialogZu = (v: { einsatzId: number; meldungId: number }) => (a: DialogAuswahl | null) =>
  a?.einsatzId === v.einsatzId && a.meldung.id === v.meldungId ? null : a;

export default function MeldungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { token } = useRollen();
  // Unter `md` Zeile statt Band und Filterknopf statt Segmentleiste (LFH-974): der Wortlaut der
  // ersten Karte gehört in den ersten Schirm.
  const { istSchmal } = useViewport();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const mitgliederQuery = useQuery({
    queryKey: einsatzKeys.mitglieder(einsatzId),
    queryFn: () => ladeMitglieder(einsatzId),
  });
  // Auftrags-Ziele für das Meldung→Auftrag-Formular.
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });

  const [ansicht, setAnsicht] = useState<'offen' | 'abgeschlossen'>('offen');
  const [richtungFilter, setRichtungFilter] = useState<string | undefined>(undefined);
  const richtungsKey = richtungFilter ?? 'alle';
  const richtungWaehlen = (v: string) => setRichtungFilter(v === 'alle' ? undefined : v);
  // Ein Dialog gehört zu seinem Einsatz: die Route hat keinen `key`, nach einem Wechsel schriebe
  // er sonst mit der Meldung des vorigen Einsatzes in den neuen. Der Wechsel schließt ihn.
  const [auftragAuswahl, setAuftragAuswahl] = useState<DialogAuswahl | null>(null);
  const [lageAuswahl, setLageAuswahl] = useState<DialogAuswahl | null>(null);
  const auftragMeldung = auftragAuswahl?.einsatzId === einsatzId ? auftragAuswahl.meldung : null;
  const lageMeldung = lageAuswahl?.einsatzId === einsatzId ? lageAuswahl.meldung : null;
  // Inline-Erfassen-Formular: per Kopf-Knopf auf-/zugeklappt, kein Drawer.
  const [formOffen, setFormOffen] = useState(false);

  // Offene und abgeschlossene Meldungen getrennt vom Server (LFH-940, design.md D1/D6): die offenen
  // ungeblättert in der Triage-Ordnung, die abgeschlossenen seitenweise und erst in ihrer Ansicht.
  // Jeder Richtungsfilter ist ein eigener Key; beim ersten Wechsel ist er kalt, und ohne Platzhalter
  // zeigte die Seite für die Dauer des Requests „Keine Meldungen" samt „0 offen" — unter Zeitdruck
  // die Sekunde, in der man die Lage falsch abliest.
  const offeneQuery = useQuery({
    queryKey: einsatzKeys.meldungenPhase(einsatzId, 'offen', richtungsKey),
    queryFn: () => listeOffeneMeldungen(einsatzId, richtungFilter),
    placeholderData: (prev) => prev,
  });
  // Zahlen über den ganzen Bestand aus einem eigenen Abruf (D3): die abgeschlossenen liegen nicht
  // mehr vollständig im Client.
  const kennzahlenQuery = useQuery({
    queryKey: einsatzKeys.meldungKennzahlen(einsatzId, richtungsKey),
    queryFn: () => ladeMeldungKennzahlen(einsatzId, richtungFilter),
    placeholderData: (prev) => prev,
  });
  // Kein Seitendeckel (D6): die Kette wächst nur, solange jemand tief in „Abgeschlossen" blättert.
  // Ein Ereignis lädt nur die schon geladenen Seiten neu, die Cursor rechnet TanStack dabei aus den
  // frischen Seiten nach.
  const abgeschlosseneQuery = useInfiniteQuery({
    queryKey: einsatzKeys.meldungenPhase(einsatzId, 'abgeschlossen', richtungsKey),
    queryFn: ({ pageParam }) => listeAbgeschlosseneMeldungen(einsatzId, richtungFilter, pageParam),
    initialPageParam: undefined as AbschlussCursor | undefined,
    getNextPageParam: (letzte) =>
      letzte.length < MELDUNGEN_SEITE ? undefined : abschlussCursor(letzte[letzte.length - 1]),
    enabled: ansicht === 'abgeschlossen',
    placeholderData: (prev) => prev,
  });

  // Ableitungen nur bei geändertem Bestand (D6). `offene` sortiert der Client nach: die
  // optimistische Einfügung nach dem Anlegen steht sonst vorn statt an ihrem Triage-Platz.
  const offene = useMemo(
    () => [...(offeneQuery.data ?? [])].sort(vergleicheMeldung),
    [offeneQuery.data],
  );
  const abgeschlossene = useMemo(() => {
    // Zwischen zwei Seitenabrufen kann sich der Bestand verschieben (neu erledigte oben), dann
    // steht eine Meldung kurz in zwei Seiten; die vordere gilt.
    const gesehen = new Set<number>();
    return (abgeschlosseneQuery.data?.pages ?? []).flat().filter((m) => {
      if (gesehen.has(m.id)) return false;
      gesehen.add(m.id);
      return true;
    });
  }, [abgeschlosseneQuery.data]);
  // Zwei Gruppen in der Offen-Ansicht: die erste Frage der Triage ist „was hat noch niemand
  // angefasst", nicht „was ist am dringendsten". Eine gesichtete Sofortmeldung steht danach unter
  // einer neuen Normalmeldung; das ist gewollt. Innerhalb jeder Gruppe ordnet `vergleicheMeldung` —
  // `offene` ist sortiert, `filter` erhält die Reihenfolge.
  const offeneGruppen = useMemo(() => {
    const neue = offene.filter((m) => MELDUNG_STATUS[m.status]?.unbearbeitet);
    const angefasste = offene.filter((m) => !MELDUNG_STATUS[m.status]?.unbearbeitet);
    return [
      { titel: `Neu (${neue.length})`, meldungen: neue },
      { titel: `In Arbeit (${angefasste.length})`, meldungen: angefasste },
    ].filter((g) => g.meldungen.length > 0);
  }, [offene]);

  // Cross-Modul-Deeplink ?meldung=<id> hebt die Meldung hervor. Liegt sie nicht in den offenen,
  // holt die Seite sie einzeln (D4) und zeigt sie über der abgeschlossenen Liste, bis sie in einer
  // geladenen Seite auftaucht. Kein Blättern bis zur Meldung. Jeder Deeplink zählt für sich, auch
  // ein zweiter auf dieselbe Meldung (`deeplinkNr`).
  const [highlightMeldungId, setHighlightMeldungId] = useState<number | null>(null);
  const [verlinkteId, setVerlinkteId] = useState<number | null>(null);
  const [deeplinkNr, setDeeplinkNr] = useState(0);
  // Scroll einmal je Deeplink, sobald die Karte im DOM steht; nicht bei jedem späteren Nachladen.
  const [scrollZiel, setScrollZiel] = useState<number | null>(null);
  useQueryParamSelektion('meldung', offeneQuery.isSuccess, (mid) => {
    setRichtungFilter(undefined);
    setHighlightMeldungId(mid);
    setScrollZiel(mid);
    setDeeplinkNr((n) => n + 1);
    if ((offeneQuery.data ?? []).some((x) => x.id === mid)) {
      setAnsicht('offen');
      // Kein Einzelabruf mehr beobachten: er hinge sonst an jedem Ereignis mit.
      setVerlinkteId(null);
      return;
    }
    setVerlinkteId(mid);
  });
  const verlinkteQuery = useQuery({
    queryKey: einsatzKeys.meldungEinzeln(einsatzId, verlinkteId ?? 0),
    queryFn: () => ladeMeldung(einsatzId, verlinkteId ?? 0),
    enabled: verlinkteId != null,
  });
  const verlinkte =
    verlinkteId != null && verlinkteQuery.data?.id === verlinkteId
      ? verlinkteQuery.data
      : undefined;
  // Die Ansicht folgt der verlinkten Meldung einmal je Deeplink, nicht jedem späteren Abgleich:
  // sonst risse eine fremde Statusänderung die Ansicht unter der Hand um.
  const [angewandtNr, setAngewandtNr] = useState(0);
  useEffect(() => {
    if (!verlinkte || angewandtNr === deeplinkNr) return;
    setAngewandtNr(deeplinkNr);
    setAnsicht(istErledigt(verlinkte) ? 'abgeschlossen' : 'offen');
  }, [verlinkte, angewandtNr, deeplinkNr]);
  const verlinkteAngeheftet =
    verlinkte && istErledigt(verlinkte) && !abgeschlossene.some((m) => m.id === verlinkte.id)
      ? verlinkte
      : null;
  useEffect(() => {
    if (scrollZiel == null) return;
    const karte = document.querySelector(`[data-meldung-id="${scrollZiel}"]`);
    if (!karte) return;
    karte.scrollIntoView?.({ block: 'center' });
    setScrollZiel(null);
  }, [scrollZiel, ansicht, verlinkteAngeheftet, offene, abgeschlossene]);

  /** Alles Geladene samt verlinkter Meldung, für Rückrufe, die eine Meldung über ihre id
   *  brauchen. */
  const geladene = useMemo(() => {
    const karte = new Map<number, Meldung>();
    if (verlinkte) karte.set(verlinkte.id, verlinkte);
    for (const m of [...offene, ...abgeschlossene]) karte.set(m.id, m);
    return karte;
  }, [offene, abgeschlossene, verlinkte]);
  // Die Rückrufe lesen den Bestand über einen Ref, damit sie über Live-Abgleiche stabil bleiben
  // und `memo` an `MeldungKarte` auch dann trägt, wenn sich nur eine Meldung ändert.
  const geladeneRef = useRef(geladene);
  // Nummer jeder je gezeigten Meldung: eine gewanderte steht oft in keiner geladenen Liste mehr.
  const nummerJe = useRef(new Map<number, number>());
  useLayoutEffect(() => {
    geladeneRef.current = geladene;
    for (const m of geladene.values()) nummerJe.current.set(m.id, m.lfd_nr);
  }, [geladene]);

  const invalidiere = useCallback(
    (eid: number) => qc.invalidateQueries({ queryKey: einsatzKeys.meldungen(eid) }),
    [qc],
  );

  /*
   * Jede Handlung meldet ihre Ablehnung an ihrem Ort, kein Toast (LFH-1077, `frontend/AGENTS.md`,
   * „Rückwege und Fehler“): Erfassen im Paneel, Status, Bearbeiter und Bestätigen an der Karte
   * (ein Speicher, die zuletzt begonnene Aktion zählt), Lage-Übergabe und Auftrag im Dialog,
   * Rückgängig im Seitenhinweis. Jede Aktion trägt ihren Einsatz: die Route hat keinen `key`, eine
   * Antwort nach einem Einsatzwechsel meldet nicht am neuen Ort.
   */
  const kartenFehler = useZeilenFehler<number>();
  const [seitenFehler, setSeitenFehler] = useState<{ einsatzId: number; fehler: unknown } | null>(
    null,
  );
  const einsatzJetzt = useRef(einsatzId);
  useLayoutEffect(() => {
    einsatzJetzt.current = einsatzId;
  });
  const { beginne: beginneKarte, melde: meldeKarte, leere: leereKarten } = kartenFehler;
  useEffect(() => leereKarten(), [einsatzId, leereKarten]);
  // Stabil, damit die Rückrufe an `MeldungKarte` es bleiben.
  const meldeAnKarte = useCallback(
    (eid: number, meldungId: number, e: unknown, fallback: string) => {
      if (eid === einsatzJetzt.current) meldeKarte(meldungId, e, fallback);
    },
    [meldeKarte],
  );

  // Das Inline-Formular bleibt nach dem Senden offen, damit die nächste Meldung ohne Aufklappen
  // folgt; Zuklappen ist ausdrückliche Nutzeraktion. Ein Zuklappen unmountete es samt Serienzähler
  // und Wertübernahme. Kein `onError`: den Grund zeigt das Formular (`speicherung`); Netzfehler
  // merkt die Funktion vor, nur eine fachliche Ablehnung kommt an.
  const anlegenMutation = useMutation({
    // Die Funktion merkt ohne Netz selbst vor; TanStacks Vorgabe hielte die Mutation an
    // (LFH-705, design.md D6).
    networkMode: 'always',
    mutationFn: ({ einsatzId: eid, daten }: { einsatzId: number; daten: NeueMeldung }) => {
      if (!benutzer) throw new Error('Nicht angemeldet');
      return erfasseMeldungOfflineFaehig(benutzer.id, eid, daten);
    },
    onSuccess: (ergebnis, { einsatzId: eid, daten: d }) => {
      if (ergebnis.zustand === 'vorgemerkt') {
        message.warning(`Offline vorgemerkt: Meldung von ${d.absender}`);
        return;
      }
      const meldung = ergebnis.daten;
      // Nur in die Arrays der offenen Listen, deren Richtung passt (D6): die Seitenstruktur der
      // abgeschlossenen, die Kennzahlen und der Einzelabruf haben eine andere Form.
      qc.setQueriesData<Meldung[]>(
        {
          queryKey: einsatzKeys.meldungen(eid),
          predicate: ({ queryKey: k }) =>
            k[2] === 'offen' && (k[3] === 'alle' || k[3] === meldung.richtung),
        },
        (alt) => (alt ? [meldung, ...alt.filter((m) => m.id !== meldung.id)] : alt),
      );
      invalidiere(eid);
      message.success(`Meldung #${meldung.lfd_nr} erfasst`);
    },
  });
  // Nur das Erfassen DIESES Einsatzes gehört ins Paneel; eines aus dem vorigen hält es nicht.
  const diesesAnlegen = anlegenMutation.variables?.einsatzId === einsatzId;
  const anlegenSpeicherung: Speicherung = {
    error: diesesAnlegen ? anlegenMutation.error : null,
    isPending: diesesAnlegen && anlegenMutation.isPending,
    reset: anlegenMutation.reset,
  };
  // Zuklappen hängt das Formular aus; beim Aufklappen räumt die Erfassungshülle den alten Grund.
  /**
   * Der Rückweg aus dem Toast: eigene Mutation, weil sein Grund im Seitenhinweis steht (die Karte
   * ist dann oft gewandert), und ohne eigenen Rückgängig-Toast, sonst schaukelte sich das Paar
   * endlos auf. Die nächste Rücknahme räumt den Grund der vorigen.
   */
  const ruecknahmeMutation = useMutation({
    mutationFn: (v: { einsatzId: number; meldungId: number; status: MeldungStatus }) =>
      setzeMeldungStatus(v.einsatzId, v.meldungId, v.status),
    onMutate: () => setSeitenFehler(null),
    onSuccess: (_daten, v) => invalidiere(v.einsatzId),
    onError: (e, v) => {
      if (v.einsatzId === einsatzJetzt.current)
        setSeitenFehler({ einsatzId: v.einsatzId, fehler: e });
    },
  });
  /**
   * Triage-Schritt. `vorher` ist der Stand vor dem Klick und damit das Ziel des Rückwegs;
   * `setze_status` nimmt jeden gültigen Status an.
   */
  const statusMutation = useMutation({
    mutationFn: (v: {
      einsatzId: number;
      meldungId: number;
      status: MeldungStatus;
      vorher?: MeldungStatus;
    }) => setzeMeldungStatus(v.einsatzId, v.meldungId, v.status),
    onMutate: (v) => beginneKarte(v.meldungId),
    onSuccess: (_daten, { einsatzId: eid, meldungId, status, vorher }) => {
      invalidiere(eid);
      if (!vorher) return;
      zeigeRueckgaengig(message, `Meldung ${MELDUNG_STATUS[status]?.label ?? status}`, () =>
        ruecknahmeMutation.mutate({ einsatzId: eid, meldungId, status: vorher }),
      );
    },
    onError: (e, v) => meldeAnKarte(v.einsatzId, v.meldungId, e, 'Statuswechsel fehlgeschlagen'),
  });
  const zuweisenMutation = useMutation({
    mutationFn: (v: { einsatzId: number; meldungId: number; bearbeiterId: number | null }) =>
      weiseBearbeiterZu(v.einsatzId, v.meldungId, v.bearbeiterId),
    onMutate: (v) => beginneKarte(v.meldungId),
    onSuccess: (_daten, v) => invalidiere(v.einsatzId),
    onError: (e, v) => meldeAnKarte(v.einsatzId, v.meldungId, e, 'Zuweisen fehlgeschlagen'),
  });
  // Der Dialog schließt erst hier; eine Ablehnung steht in ihm (`speicherung`).
  const lageMutation = useMutation({
    mutationFn: (v: { einsatzId: number; meldungId: number; daten: LagerelevantDaten }) =>
      markiereLagerelevant(v.einsatzId, v.meldungId, v.daten),
    onSuccess: (_daten, v) => {
      invalidiere(v.einsatzId);
      qc.invalidateQueries({ queryKey: einsatzKeys.lagemeldungen(v.einsatzId) });
      setLageAuswahl(ohneDialogZu(v));
      message.success('An die Lage übergeben');
    },
  });
  const bestaetigenMutation = useMutation({
    mutationFn: (v: { einsatzId: number; meldungId: number }) =>
      bestaetigeMeldung(v.einsatzId, v.meldungId),
    onMutate: (v) => beginneKarte(v.meldungId),
    onSuccess: (_daten, v) => {
      invalidiere(v.einsatzId);
      message.success('Sofortmeldung bestätigt');
    },
    onError: (e, v) => meldeAnKarte(v.einsatzId, v.meldungId, e, 'Bestätigen fehlgeschlagen'),
  });
  // Der Dialog schließt erst hier; eine Ablehnung steht im Formular (`speicherung`).
  const auftragMutation = useMutation({
    mutationFn: (v: { einsatzId: number; meldungId: number; daten: NeuerAuftrag }) =>
      erteileAuftragAusMeldung(v.einsatzId, v.meldungId, v.daten),
    onSuccess: (_daten, { einsatzId: eid, meldungId }) => {
      invalidiere(eid);
      qc.invalidateQueries({ queryKey: einsatzKeys.auftraege(eid) });
      setAuftragAuswahl(ohneDialogZu({ einsatzId: eid, meldungId }));
      // Wer aus einer Meldung einen Auftrag erteilt, hat sie bearbeitet — sonst stünde sie weiter
      // auf „neu". Der Riegel auf den Ausgangsstatus ist tragend: ohne ihn schriebe die Seite bei
      // einer laufenden Meldung denselben Status noch einmal. Eine Ablehnung steht an der Karte.
      //
      // Bewusst ohne Rückgängig-Toast (`vorher` bleibt leer): ein Rückweg, der nur den
      // Meldungsstatus zurückdreht, ließe den Auftrag stehen und verspräche eine Rücknahme, die
      // keine ist.
      const quelle = geladeneRef.current.get(meldungId);
      if (
        eid === einsatzJetzt.current &&
        quelle &&
        quelle.status !== 'in_bearbeitung' &&
        quelle.status !== 'erledigt'
      ) {
        statusMutation.mutate({ einsatzId: eid, meldungId, status: 'in_bearbeitung' });
      }
      message.success('Auftrag aus Meldung erteilt');
    },
  });
  /** Nur die Mutation DIESES Einsatzes gehört in seine Dialoge. */
  const imEinsatz = (m: {
    variables?: { einsatzId: number };
    error: unknown;
    isPending: boolean;
    reset: () => void;
  }): Speicherung => {
    const dieser = m.variables?.einsatzId === einsatzId;
    return {
      error: dieser ? m.error : null,
      isPending: dieser && m.isPending,
      reset: m.reset,
    };
  };

  // Stabile Rückrufe, sonst wirkt `memo` an `MeldungKarte` nicht (D6). `mutate` ist je Mutation
  // stabil, das Mutationsobjekt nicht.
  const { mutate: statusSetzen } = statusMutation;
  const { mutate: zuweisen } = zuweisenMutation;
  const { mutate: bestaetigen } = bestaetigenMutation;
  const onStatus = useCallback(
    (meldungId: number, status: MeldungStatus) =>
      statusSetzen({
        einsatzId,
        meldungId,
        status,
        vorher: geladeneRef.current.get(meldungId)?.status,
      }),
    [statusSetzen, einsatzId],
  );
  const onZuweisen = useCallback(
    (meldungId: number, bearbeiterId: number | null) =>
      zuweisen({ einsatzId, meldungId, bearbeiterId }),
    [zuweisen, einsatzId],
  );
  const onLagerelevant = useCallback(
    (meldungId: number) => {
      const meldung = geladeneRef.current.get(meldungId);
      setLageAuswahl(meldung ? { einsatzId, meldung } : null);
    },
    [einsatzId],
  );
  const onAuftragErteilen = useCallback(
    (meldung: Meldung) => setAuftragAuswahl({ einsatzId, meldung }),
    [einsatzId],
  );
  const onBestaetigen = useCallback(
    (meldungId: number) => bestaetigen({ einsatzId, meldungId }),
    [bestaetigen, einsatzId],
  );
  const mitglieder = mitgliederQuery.data ?? KEINE_MITGLIEDER;
  // „Auftrag erteilen“ schreibt in die Aufträge: ohne deren Freigabe gesperrt sichtbar (LFH-1051).
  const auftragGesperrt = useSprungSperre(einsatzId)('auftraege');

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
  const darfSchreiben = darfImEinsatzSchreiben(einsatz);

  const lageSpeicherung = imEinsatz(lageMutation);
  const auftragSpeicherung = imEinsatz(auftragMutation);

  const listenProps = {
    einsatzId,
    darfSchreiben,
    mitglieder,
    highlightId: highlightMeldungId,
    onStatus,
    onZuweisen,
    onLagerelevant,
    onBestaetigen,
    onAuftragErteilen,
    auftragGesperrt,
    kartenFehler: kartenFehler.grund,
  };

  const auftragsZiele = {
    abschnitte: (abschnitteQuery.data ?? []).map((a) => ({ id: a.id, name: a.name })),
    einheiten: (einheitenQuery.data ?? []).map((e) => ({ id: e.id, name: e.name })),
  };

  const kennzahlen = kennzahlenQuery.data;
  const offenZahl = kennzahlen ? kennzahlen.unbearbeitet + kennzahlen.in_arbeit : offene.length;
  const abgeschlossenZahl = kennzahlen?.erledigt ?? abgeschlossene.length;
  /*
   * Steht die Karte eines Grundes in der gezeigten Ansicht nicht (Ansicht gewechselt, Karte
   * gewandert), hätte er keinen Ort mehr: dann steht er im Seitenhinweis, schließbar. Solange die
   * Ansicht ohne eigene Daten lädt, hat kein Grund seinen Ort verloren.
   */
  const gezeigt =
    ansicht === 'offen'
      ? offene
      : verlinkteAngeheftet
        ? [verlinkteAngeheftet, ...abgeschlossene]
        : abgeschlossene;
  const ansichtsQuery = ansicht === 'offen' ? offeneQuery : abgeschlosseneQuery;
  const ansichtLaedt = ansichtsQuery.isPending || ansichtsQuery.isPlaceholderData;
  const gewanderte = ansichtLaedt
    ? []
    : kartenFehler.gemeldet().flatMap((mid) => {
        const grund = kartenFehler.grund(mid);
        if (grund == null || gezeigt.some((m) => m.id === mid)) return [];
        const nr = nummerJe.current.get(mid);
        return [{ schluessel: mid, kennung: nr != null ? `Meldung #${nr}` : undefined, grund }];
      });
  const rueckFehler = seitenFehler?.einsatzId === einsatzId ? seitenFehler.fehler : null;

  const kennzahlZustand = kennzahlenQuery.isLoading
    ? 'laden'
    : kennzahlenQuery.isError
      ? 'fehler'
      : 'daten';

  return (
    <EinsatzSeite
      titel={modulName('meldungen')}

      meta={`${offenZahl} offen · ${abgeschlossenZahl} abgeschlossen`}
      dataUpdatedAt={offeneQuery.dataUpdatedAt}
      // Nur mit Inhalt gesetzt: ein leerer Slot rendert in `EinsatzSeite` trotzdem seinen Rahmen.
      hinweis={
        (rueckFehler != null || gewanderte.length > 0) && (
          <Flex vertical gap={token.marginSM}>
            <SeitenHinweise
              fehler={rueckFehler}
              fehlerTitel="Nicht zurückgenommen"
              fehlerFallback="Rücknahme fehlgeschlagen"
            />
            <GewanderteGruende
              gruende={gewanderte}
              onSchliessen={() => gewanderte.forEach((g) => kartenFehler.verwirf(g.schluessel))}
            />
          </Flex>
        )
      }
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('meldungen') },
          ]}
        />
      }
      aktionen={
        darfSchreiben && (
          // Solange eine Meldung unterwegs ist, bleibt das Paneel offen: die Antwort braucht ihren
          // Ort (design.md D3).
          <Button
            type="primary"
            icon={formOffen ? <IconChevronHoch /> : <IconPlus />}
            disabled={formOffen && anlegenSpeicherung.isPending}
            onClick={() => setFormOffen(!formOffen)}
          >
            {formOffen ? 'Formular schließen' : 'Meldung erfassen'}
          </Button>
        )
      }
    >
      {/* Kennzahlen der Triage aus EINER Zählung am Server über dieselben Prädikate wie die Liste
          (LFH-940, D3); „Bestätigung überfällig" quer zur Phase. */}
      {istSchmal ? (
        <div style={{ marginBottom: token.margin }}>
          <MeldungKennzahlZeile kennzahlen={kennzahlen} laedt={kennzahlZustand !== 'daten'} />
        </div>
      ) : (
        <Kennzahlenband beschriftung="Meldungen in Zahlen" style={{ marginBottom: token.margin }}>
          <Kennzahl
            titel="Unbearbeitet"
            groesse="klein"
            wert={kennzahlen?.unbearbeitet ?? 0}
            ton={(kennzahlen?.unbearbeitet ?? 0) > 0 ? 'achtung' : 'neutral'}
            notiz="noch nicht gesichtet"
            zustand={kennzahlZustand}
          />
          <Kennzahl
            titel="In Arbeit"
            groesse="klein"
            wert={kennzahlen?.in_arbeit ?? 0}
            notiz="gesichtet oder in Bearbeitung"
            zustand={kennzahlZustand}
          />
          <Kennzahl
            titel="Bestätigung überfällig"
            groesse="klein"
            wert={kennzahlen?.alarmiert ?? 0}
            ton={(kennzahlen?.alarmiert ?? 0) > 0 ? 'alarm' : 'neutral'}
            notiz="Bestätigungsfrist verstrichen"
            zustand={kennzahlZustand}
          />
          <Kennzahl
            titel="Erledigt"
            groesse="klein"
            wert={kennzahlen?.erledigt ?? 0}
            zustand={kennzahlZustand}
          />
        </Kennzahlenband>
      )}

      {darfSchreiben && formOffen && (
        <Paneel
          titel="Neue Meldung erfassen"
          koerperPolster
          style={{ marginBottom: token.margin }}
          aktion={
            <Button
              type="text"
              icon={<IconKreuz />}
              disabled={anlegenSpeicherung.isPending}
              onClick={() => setFormOffen(false)}
              aria-label="Formular schließen"
            />
          }
        >
          <MeldungFormular
            card={false}
            senden={anlegenSpeicherung.isPending}
            // mutateAsync, nicht mutate: die Erfassungshülle darf die Felder nur leeren, wenn der
            // Datensatz angekommen ist. Den Grund einer Ablehnung zeigt sie über `speicherung`.
            onAnlegen={(daten) => anlegenMutation.mutateAsync({ einsatzId, daten })}
            speicherung={anlegenSpeicherung}
            einheiten={einheitenQuery.data}
            abschnitte={abschnitteQuery.data}
          />
        </Paneel>
      )}

      {(offeneQuery.isError || (ansicht === 'abgeschlossen' && abgeschlosseneQuery.isError)) && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: token.marginSM }}
          title="Meldungen konnten nicht geladen werden"
        />
      )}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: token.marginSM,
          marginBottom: token.margin,
          alignItems: 'center',
        }}
      >
        <Segmentleiste
          beschriftung="Ansicht"
          wert={ansicht}
          onWechsel={setAnsicht}
          optionen={[
            { wert: 'offen', label: `Offen (${offenZahl})` },
            { wert: 'abgeschlossen', label: `Abgeschlossen (${abgeschlossenZahl})` },
          ]}
        />
        {istSchmal ? (
          <RichtungFilterKnopf wert={richtungsKey} onWechsel={richtungWaehlen} />
        ) : (
          <Segmentleiste
            beschriftung="Richtung"
            wert={richtungsKey}
            onWechsel={richtungWaehlen}
            optionen={[
              { wert: 'alle', label: 'Alle Richtungen' },
              { wert: 'intern', label: 'Intern' },
              { wert: 'extern', label: 'Extern' },
            ]}
          />
        )}
      </div>
      {ansicht === 'offen' ? (
        offeneGruppen.length === 0 ? (
          <MeldungListe meldungen={[]} ansicht="offen" {...listenProps} />
        ) : (
          offeneGruppen.map(({ titel, meldungen }) => (
            <div key={titel} style={{ marginBottom: token.margin }}>
              <Augenbraue als="h2" style={{ display: 'block', marginBottom: token.marginXS }}>
                {titel}
              </Augenbraue>
              <MeldungListe meldungen={meldungen} ansicht="offen" {...listenProps} />
            </div>
          ))
        )
      ) : (
        <>
          {verlinkteAngeheftet && (
            <div style={{ marginBottom: token.margin }}>
              <Augenbraue als="h2" style={{ display: 'block', marginBottom: token.marginXS }}>
                Verlinkte Meldung
              </Augenbraue>
              <MeldungListe
                meldungen={[verlinkteAngeheftet]}
                ansicht="abgeschlossen"
                {...listenProps}
              />
            </div>
          )}
          {abgeschlosseneQuery.isPending ? (
            <div style={{ textAlign: 'center', padding: token.paddingLG }}>
              <Spin />
            </div>
          ) : (
            <MeldungListe meldungen={abgeschlossene} ansicht="abgeschlossen" {...listenProps} />
          )}
          {/* Eine volle letzte Seite meldet noch eine Folgeseite; die Zahl der Abgeschlossenen
              sagt, dass es keine gibt. */}
          {abgeschlosseneQuery.hasNextPage &&
            (kennzahlen == null || abgeschlossene.length < kennzahlen.erledigt) && (
              <div style={{ textAlign: 'center', marginTop: token.margin }}>
                <Button
                  onClick={() => void abgeschlosseneQuery.fetchNextPage()}
                  loading={abgeschlosseneQuery.isFetchingNextPage}
                >
                  Ältere laden
                </Button>
                <div style={{ marginTop: token.marginXS, color: token.colorTextSecondary }}>
                  {abgeschlossene.length} von {abgeschlossenZahl} geladen
                </div>
              </div>
            )}
        </>
      )}
      <LagerelevantModal
        offen={lageMeldung !== null}
        meldung={lageMeldung}
        senden={lageSpeicherung.isPending}
        einsatzId={einsatzId}
        onAbbrechen={() => setLageAuswahl(null)}
        onUebergeben={(daten) => {
          if (lageMeldung) lageMutation.mutate({ einsatzId, meldungId: lageMeldung.id, daten });
        }}
        speicherung={lageSpeicherung}
      />
      <AuftragErteilenModal
        einsatzId={einsatzId}
        meldung={auftragMeldung}
        abschnitte={auftragsZiele.abschnitte}
        einheiten={auftragsZiele.einheiten}
        senden={auftragSpeicherung.isPending}
        onAbbrechen={() => setAuftragAuswahl(null)}
        // mutateAsync: die Erfassungshülle darf die Felder nur leeren, wenn der Auftrag angekommen
        // ist.
        onAnlegen={(daten) =>
          auftragMeldung
            ? auftragMutation.mutateAsync({ einsatzId, meldungId: auftragMeldung.id, daten })
            : Promise.reject(new Error('Keine Quellmeldung'))
        }
        speicherung={auftragSpeicherung}
      />
    </EinsatzSeite>
  );
}
