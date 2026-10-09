import { IconChevronHoch, IconKreuz, IconPlus } from '../icons';
import { Alert, App, Breadcrumb, Button, Spin } from 'antd';
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
import { useFehlerMeldung } from '../components/useFehlerMeldung';
import { useViewport } from '../components/useViewport';
import { MeldungKennzahlZeile, RichtungFilterKnopf } from '../meldungen/MeldungenSchmal';
import { modulName } from '../einsatz/modulRegistry';

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
  const [auftragMeldung, setAuftragMeldung] = useState<Meldung | null>(null);
  const [lageMeldung, setLageMeldung] = useState<Meldung | null>(null);
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
  useLayoutEffect(() => {
    geladeneRef.current = geladene;
  }, [geladene]);

  const fehler = useFehlerMeldung();
  const invalidiere = useCallback(
    () => qc.invalidateQueries({ queryKey: einsatzKeys.meldungen(einsatzId) }),
    [qc, einsatzId],
  );

  // Das Inline-Formular bleibt nach dem Senden offen, damit die nächste Meldung ohne Aufklappen
  // folgt; Zuklappen ist ausdrückliche Nutzeraktion. Ein Zuklappen unmountete es samt Serienzähler
  // und Wertübernahme.
  const anlegenMutation = useMutation({
    // Die Funktion merkt ohne Netz selbst vor; TanStacks Vorgabe hielte die Mutation an
    // (LFH-705, design.md D6).
    networkMode: 'always',
    mutationFn: (d: NeueMeldung) => {
      if (!benutzer) throw new Error('Nicht angemeldet');
      return erfasseMeldungOfflineFaehig(benutzer.id, einsatzId, d);
    },
    onSuccess: (ergebnis, d) => {
      if (ergebnis.zustand === 'vorgemerkt') {
        message.warning(`Offline vorgemerkt: Meldung von ${d.absender}`);
        return;
      }
      const meldung = ergebnis.daten;
      // Nur in die Arrays der offenen Listen, deren Richtung passt (D6): die Seitenstruktur der
      // abgeschlossenen, die Kennzahlen und der Einzelabruf haben eine andere Form.
      qc.setQueriesData<Meldung[]>(
        {
          queryKey: einsatzKeys.meldungen(einsatzId),
          predicate: ({ queryKey: k }) =>
            k[2] === 'offen' && (k[3] === 'alle' || k[3] === meldung.richtung),
        },
        (alt) => (alt ? [meldung, ...alt.filter((m) => m.id !== meldung.id)] : alt),
      );
      invalidiere();
      message.success(`Meldung #${meldung.lfd_nr} erfasst`);
    },
    onError: fehler,
  });
  /**
   * Triage-Schritt und Rücknahme laufen durch dieselbe Mutation. `vorher` ist der Stand vor dem
   * Klick und damit das Ziel des Rückwegs; `setze_status` nimmt jeden gültigen Status an.
   *
   * `zurueck` unterscheidet die Richtungen: die Rücknahme darf keinen eigenen Rückgängig-Toast
   * erzeugen, sonst schaukelte sich das Paar endlos auf.
   */
  const statusMutation = useMutation({
    mutationFn: ({
      meldungId,
      status,
    }: {
      meldungId: number;
      status: MeldungStatus;
      vorher?: MeldungStatus;
      zurueck?: boolean;
    }) => setzeMeldungStatus(einsatzId, meldungId, status),
    onSuccess: (_daten, { meldungId, status, vorher, zurueck }) => {
      invalidiere();
      if (zurueck || !vorher) return;
      zeigeRueckgaengig(message, `Meldung ${MELDUNG_STATUS[status]?.label ?? status}`, () =>
        statusMutation.mutate({ meldungId, status: vorher, zurueck: true }),
      );
    },
    onError: fehler,
  });
  const zuweisenMutation = useMutation({
    mutationFn: ({ meldungId, bearbeiterId }: { meldungId: number; bearbeiterId: number | null }) =>
      weiseBearbeiterZu(einsatzId, meldungId, bearbeiterId),
    onSuccess: invalidiere,
    onError: fehler,
  });
  const lageMutation = useMutation({
    mutationFn: ({ meldungId, daten }: { meldungId: number; daten: LagerelevantDaten }) =>
      markiereLagerelevant(einsatzId, meldungId, daten),
    onSuccess: () => {
      invalidiere();
      qc.invalidateQueries({ queryKey: einsatzKeys.lagemeldungen(einsatzId) });
      setLageMeldung(null);
      message.success('An die Lage übergeben');
    },
    onError: fehler,
  });
  const bestaetigenMutation = useMutation({
    mutationFn: (meldungId: number) => bestaetigeMeldung(einsatzId, meldungId),
    onSuccess: () => {
      invalidiere();
      message.success('Sofortmeldung bestätigt');
    },
    onError: fehler,
  });
  const auftragMutation = useMutation({
    mutationFn: ({ meldungId, daten }: { meldungId: number; daten: NeuerAuftrag }) =>
      erteileAuftragAusMeldung(einsatzId, meldungId, daten),
    onSuccess: (_daten, { meldungId }) => {
      invalidiere();
      qc.invalidateQueries({ queryKey: einsatzKeys.auftraege(einsatzId) });
      setAuftragMeldung(null);
      // Wer aus einer Meldung einen Auftrag erteilt, hat sie bearbeitet — sonst stünde sie weiter
      // auf „neu". Der Riegel auf den Ausgangsstatus ist tragend: ohne ihn schriebe die Seite bei
      // einer laufenden Meldung denselben Status noch einmal.
      //
      // Bewusst ohne Rückgängig-Toast (`vorher` bleibt leer): ein Rückweg, der nur den
      // Meldungsstatus zurückdreht, ließe den Auftrag stehen und verspräche eine Rücknahme, die
      // keine ist.
      const quelle = geladeneRef.current.get(meldungId);
      if (quelle && quelle.status !== 'in_bearbeitung' && quelle.status !== 'erledigt') {
        statusMutation.mutate({ meldungId, status: 'in_bearbeitung' });
      }
      message.success('Auftrag aus Meldung erteilt');
    },
    onError: fehler,
  });

  // Stabile Rückrufe, sonst wirkt `memo` an `MeldungKarte` nicht (D6). `mutate` ist je Mutation
  // stabil, das Mutationsobjekt nicht.
  const { mutate: statusSetzen } = statusMutation;
  const { mutate: zuweisen } = zuweisenMutation;
  const { mutate: bestaetigen } = bestaetigenMutation;
  const onStatus = useCallback(
    (meldungId: number, status: MeldungStatus) =>
      statusSetzen({ meldungId, status, vorher: geladeneRef.current.get(meldungId)?.status }),
    [statusSetzen],
  );
  const onZuweisen = useCallback(
    (meldungId: number, bearbeiterId: number | null) => zuweisen({ meldungId, bearbeiterId }),
    [zuweisen],
  );
  const onLagerelevant = useCallback(
    (meldungId: number) => setLageMeldung(geladeneRef.current.get(meldungId) ?? null),
    [],
  );
  const onBestaetigen = useCallback((meldungId: number) => bestaetigen(meldungId), [bestaetigen]);
  const mitglieder = mitgliederQuery.data ?? KEINE_MITGLIEDER;

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

  const listenProps = {
    einsatzId,
    darfSchreiben,
    mitglieder,
    highlightId: highlightMeldungId,
    onStatus,
    onZuweisen,
    onLagerelevant,
    onBestaetigen,
    onAuftragErteilen: setAuftragMeldung,
  };

  const auftragsZiele = {
    abschnitte: (abschnitteQuery.data ?? []).map((a) => ({ id: a.id, name: a.name })),
    einheiten: (einheitenQuery.data ?? []).map((e) => ({ id: e.id, name: e.name })),
  };

  const kennzahlen = kennzahlenQuery.data;
  const offenZahl = kennzahlen ? kennzahlen.unbearbeitet + kennzahlen.in_arbeit : offene.length;
  const abgeschlossenZahl = kennzahlen?.erledigt ?? abgeschlossene.length;
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
          <Button
            type="primary"
            icon={formOffen ? <IconChevronHoch /> : <IconPlus />}
            onClick={() => setFormOffen((o) => !o)}
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
              onClick={() => setFormOffen(false)}
              aria-label="Formular schließen"
            />
          }
        >
          <MeldungFormular
            card={false}
            senden={anlegenMutation.isPending}
            // mutateAsync, nicht mutate: die Erfassungshülle darf die Felder nur leeren, wenn der
            // Datensatz angekommen ist. Den Fehler-Toast wirft `onError`.
            onAnlegen={(d) => anlegenMutation.mutateAsync(d)}
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
        senden={lageMutation.isPending}
        einsatzId={einsatzId}
        onAbbrechen={() => setLageMeldung(null)}
        onUebergeben={(daten) => {
          if (lageMeldung) lageMutation.mutate({ meldungId: lageMeldung.id, daten });
        }}
      />
      <AuftragErteilenModal
        einsatzId={einsatzId}
        meldung={auftragMeldung}
        abschnitte={auftragsZiele.abschnitte}
        einheiten={auftragsZiele.einheiten}
        senden={auftragMutation.isPending}
        onAbbrechen={() => setAuftragMeldung(null)}
        // mutateAsync: die Erfassungshülle darf die Felder nur leeren, wenn der Auftrag angekommen
        // ist.
        onAnlegen={(daten) =>
          auftragMeldung
            ? auftragMutation.mutateAsync({ meldungId: auftragMeldung.id, daten })
            : Promise.reject(new Error('Keine Quellmeldung'))
        }
      />
    </EinsatzSeite>
  );
}
