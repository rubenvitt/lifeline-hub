import { IconChevronHoch, IconKreuz, IconPlus } from '../icons';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { Alert, App, Button, Spin } from 'antd';
import { Select } from '../components/Select';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { einsatzKeys } from '../api/queryKeys';
import { useAuth } from '../auth/AuthContext';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import {
  AUFTRAEGE_SEITE,
  auftragAbschlussCursor,
  ladeAuftrag,
  ladeAuftragKennzahlen,
  legeAuftragAn,
  listeAbgeschlosseneAuftraege,
  listeOffeneAuftraege,
  nimmAb,
  quittiereEmpfaenger,
  setzeVollzug,
} from '../api/auftraege';
import type { AbschlussCursor } from '../api/meldungen';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import type { Auftrag, NeuerAuftrag } from '../api/types';
import {
  AUFTRAG_STATUS,
  GRUPPE_LABEL,
  GRUPPE_ORDNUNG,
  faelligGruppe,
  istAbgeschlossen,
  prioRang,
  type FaelligGruppe,
} from '../kommunikation';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import AuftragListe from './AuftragListe';
import { ersetzeAuftraege, findeAuftrag } from './auftragCache';
import AuftragFormular from './AuftragFormular';
import VollzugMeldenModal from './VollzugMeldenModal';
import Bereichskopf from '../kommunikation/Bereichskopf';
import { Augenbraue, Paneel, Segmentleiste, useRollen } from '../components/instrument';
import { useZeilenFehler } from '../components/useZeilenFehler';

/** Abgeschlossen nach der gemeinsamen Phasen-Semantik. */
function istAuftragAbgeschlossen(a: Auftrag): boolean {
  return istAbgeschlossen(AUFTRAG_STATUS[a.bearbeitungsstatus]?.phase ?? 'offen');
}

/** Offene Aufträge: nach Prio (sofort→dringend→normal), dann Frist (früheste zuerst). */
function vergleicheOffen(a: Auftrag, b: Auftrag): number {
  const prio = prioRang(a.prioritaet) - prioRang(b.prioritaet);
  if (prio !== 0) return prio;
  return (a.frist_at ?? '￿').localeCompare(b.frist_at ?? '￿');
}

export default function AuftraegeListe({
  einsatzId,
  darfSchreiben,
  onSeitenFehler,
}: {
  einsatzId: number;
  darfSchreiben: boolean;
  /**
   * Grund einer abgelehnten Rücknahme für den Hinweis der Seite, `null` räumt ihn. Rückgängig kommt
   * aus dem Toast, die Karte ist dann oft nicht mehr zu sehen (`frontend/AGENTS.md`, „Rückwege und
   * Fehler“).
   */
  onSeitenFehler?: (fehler: unknown) => void;
}) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { benutzer } = useAuth();
  const { token } = useRollen();

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
  // Empfänger-Filter: kodiert als "abschnitt:<id>" bzw. "einheit:<id>".
  const [empfFilter, setEmpfFilter] = useState<string | undefined>(undefined);
  const [empfTyp, empfId] = empfFilter ? empfFilter.split(':') : [undefined, undefined];
  const abschnittId = empfTyp === 'abschnitt' ? Number(empfId) : undefined;
  const einheitId = empfTyp === 'einheit' ? Number(empfId) : undefined;

  const richtungsKey = richtungFilter ?? 'alle';
  const empfaengerKey = empfFilter ?? 'alle';
  const filter = useMemo(
    () => ({ richtung: richtungFilter, abschnittId, einheitId }),
    [richtungFilter, abschnittId, einheitId],
  );

  // Offene und abgeschlossene Aufträge getrennt vom Server (LFH-1071, design.md D1/D5): die offenen
  // ungeblättert, die abgeschlossenen seitenweise und erst in ihrer Ansicht. Ohne Platzhalter
  // zeigte ein Filterwechsel für die Dauer des Requests „Keine Aufträge“.
  const offeneQuery = useQuery({
    queryKey: einsatzKeys.auftraegePhase(einsatzId, 'offen', richtungsKey, empfaengerKey),
    queryFn: () => listeOffeneAuftraege(einsatzId, filter),
    placeholderData: (prev) => prev,
  });
  // Zahlen über den ganzen Bestand aus einem eigenen Abruf (D3).
  const kennzahlenQuery = useQuery({
    queryKey: einsatzKeys.auftragKennzahlen(einsatzId, richtungsKey, empfaengerKey),
    queryFn: () => ladeAuftragKennzahlen(einsatzId, filter),
    placeholderData: (prev) => prev,
  });
  // Ein Ereignis lädt nur die schon geladenen Seiten neu; die Cursor rechnet TanStack dabei aus
  // den frischen Seiten nach.
  const abgeschlosseneQuery = useInfiniteQuery({
    queryKey: einsatzKeys.auftraegePhase(einsatzId, 'abgeschlossen', richtungsKey, empfaengerKey),
    queryFn: ({ pageParam }) => listeAbgeschlosseneAuftraege(einsatzId, filter, pageParam),
    initialPageParam: undefined as AbschlussCursor | undefined,
    getNextPageParam: (letzte) =>
      letzte.length < AUFTRAEGE_SEITE
        ? undefined
        : auftragAbschlussCursor(letzte[letzte.length - 1]),
    enabled: ansicht === 'abgeschlossen',
    placeholderData: (prev) => prev,
  });

  // Deeplink ?auftrag=<id> hebt den Auftrag hervor. Ansicht und Filter werden zurückgesetzt, damit
  // das Ziel sichtbar ist. Liegt er nicht in den offenen, holt das Board ihn einzeln (D4) und
  // zeigt ihn über der abgeschlossenen Liste, bis er in einer geladenen Seite auftaucht. Jeder
  // Deeplink zählt für sich, auch ein zweiter auf denselben Auftrag (`deeplinkNr`).
  const [highlightAuftragId, setHighlightAuftragId] = useState<number | null>(null);
  const [verlinkteId, setVerlinkteId] = useState<number | null>(null);
  const [deeplinkNr, setDeeplinkNr] = useState(0);
  const [scrollZiel, setScrollZiel] = useState<number | null>(null);
  useQueryParamSelektion('auftrag', offeneQuery.isSuccess, (aid) => {
    setRichtungFilter(undefined);
    setEmpfFilter(undefined);
    setHighlightAuftragId(aid);
    setScrollZiel(aid);
    setDeeplinkNr((n) => n + 1);
    if ((offeneQuery.data ?? []).some((x) => x.id === aid)) {
      setAnsicht('offen');
      // Kein Einzelabruf mehr beobachten: er hinge sonst an jedem Ereignis mit.
      setVerlinkteId(null);
      return;
    }
    setVerlinkteId(aid);
  });
  const verlinkteQuery = useQuery({
    queryKey: einsatzKeys.auftragEinzeln(einsatzId, verlinkteId ?? 0),
    queryFn: () => ladeAuftrag(einsatzId, verlinkteId ?? 0),
    enabled: verlinkteId != null,
  });
  const verlinkte =
    verlinkteId != null && verlinkteQuery.data?.id === verlinkteId
      ? verlinkteQuery.data
      : undefined;
  // Die Ansicht folgt dem verlinkten Auftrag einmal je Deeplink, nicht jedem späteren Abgleich.
  const [angewandtNr, setAngewandtNr] = useState(0);
  useEffect(() => {
    if (!verlinkte || angewandtNr === deeplinkNr) return;
    setAngewandtNr(deeplinkNr);
    setAnsicht(istAuftragAbgeschlossen(verlinkte) ? 'abgeschlossen' : 'offen');
  }, [verlinkte, angewandtNr, deeplinkNr]);

  // Inline-Anlegen-Formular: per Kopf-Button auf-/zugeklappt, kein Drawer/Modal.
  const [formOffen, setFormOffen] = useState(false);

  /*
   * Jede Handlung meldet ihre Ablehnung an ihrem Ort, kein Toast (LFH-1077, `frontend/AGENTS.md`,
   * „Rückwege und Fehler“): Anlegen am Paneel, Quittieren an der Empfängerzeile, Statuswechsel und
   * Abnahme an der Karte, Vollzug melden im Dialog. Die Gründe je Karte kommen aus den Callbacks
   * der Mutationen, nicht aus `mutation.variables` (`components/useZeilenFehler.ts`).
   */
  const kartenFehler = useZeilenFehler<number>();
  const quittierFehler = useZeilenFehler<number>();
  const invalidiere = () => qc.invalidateQueries({ queryKey: einsatzKeys.auftraege(einsatzId) });
  // Optimistische Updates treffen jede Form unter dem Prefix, nie die Kennzahlen (D5).
  const aendere = (fn: (a: Auftrag) => Auftrag) =>
    qc.setQueriesData<unknown>({ queryKey: einsatzKeys.auftraege(einsatzId) }, (alt: unknown) =>
      ersetzeAuftraege(alt, fn),
    );

  // Kein `setFormOffen(false)`: das Inline-Formular bleibt nach dem Erteilen offen (Zuklappen ist
  // ausdrückliche Nutzeraktion); ein Unmount verlöre Serienzähler und Wertübernahme.
  const anlegenMutation = useMutation({
    mutationFn: (d: NeuerAuftrag) => legeAuftragAn(einsatzId, d),
    onSuccess: () => {
      invalidiere();
      message.success('Auftrag erteilt');
    },
  });
  // Auf- und Zuklappen räumen den Grund einer Ablehnung (Abbrechen räumt die Hülle); eine laufende
  // Mutation bleibt unberührt.
  const raeumeAnlegen = () => {
    if (!anlegenMutation.isPending && anlegenMutation.error != null) anlegenMutation.reset();
  };
  const schalteFormular = (offen: boolean) => {
    raeumeAnlegen();
    setFormOffen(offen);
  };
  const quittierenMutation = useMutation({
    mutationFn: ({ auftragId, empfaengerId }: { auftragId: number; empfaengerId: number }) =>
      quittiereEmpfaenger(einsatzId, auftragId, empfaengerId),
    onMutate: async ({ auftragId, empfaengerId }) => {
      quittierFehler.beginne(auftragId);
      const queryKey = einsatzKeys.auftraege(einsatzId);
      await qc.cancelQueries({ queryKey });
      const vorher = qc.getQueriesData<unknown>({ queryKey }).flatMap(([cacheKey, daten]) => {
        const auftrag = findeAuftrag(daten, auftragId);
        const empfaenger = auftrag?.empfaenger.find((eintrag) => eintrag.id === empfaengerId);
        return auftrag && empfaenger
          ? [
              {
                cacheKey,
                quittiertAnzahl: auftrag.quittiert_anzahl,
                istUeberfaellig: auftrag.ist_ueberfaellig,
                empfaenger,
              },
            ]
          : [];
      });
      const quittiertAt = new Date().toISOString();
      aendere((auftrag) => {
        if (auftrag.id !== auftragId) return auftrag;
        const ziel = auftrag.empfaenger.find((empfaenger) => empfaenger.id === empfaengerId);
        if (!ziel || ziel.quittiert_at) return auftrag;
        const quittiertAnzahl = Math.min(auftrag.empfaenger_anzahl, auftrag.quittiert_anzahl + 1);
        return {
          ...auftrag,
          quittiert_anzahl: quittiertAnzahl,
          ist_ueberfaellig:
            quittiertAnzahl === auftrag.empfaenger_anzahl ? false : auftrag.ist_ueberfaellig,
          empfaenger: auftrag.empfaenger.map((empfaenger) =>
            empfaenger.id === empfaengerId
              ? {
                  ...empfaenger,
                  quittiert_at: quittiertAt,
                  quittiert_von_id: benutzer?.id ?? null,
                }
              : empfaenger,
          ),
        };
      });
      return { vorher, quittiertAt };
    },
    onSuccess: (serverStand) => {
      aendere((auftrag) => (auftrag.id === serverStand.id ? serverStand : auftrag));
      message.success('Empfang quittiert');
    },
    onError: (e, variablen, kontext) => {
      for (const stand of kontext?.vorher ?? []) {
        qc.setQueryData<unknown>(stand.cacheKey, (aktuell: unknown) =>
          ersetzeAuftraege(aktuell, (auftrag) => {
            if (auftrag.id !== variablen.auftragId) return auftrag;
            const ziel = auftrag.empfaenger.find(
              (empfaenger) => empfaenger.id === variablen.empfaengerId,
            );
            // Ein inzwischen neuerer Stand darf nicht durch den fehlgeschlagenen Request
            // überschrieben werden. Zurückgerollt wird nur unser eigener Optimismus.
            if (!ziel || ziel.quittiert_at !== kontext?.quittiertAt) return auftrag;
            return {
              ...auftrag,
              quittiert_anzahl: stand.quittiertAnzahl,
              ist_ueberfaellig: stand.istUeberfaellig,
              empfaenger: auftrag.empfaenger.map((empfaenger) =>
                empfaenger.id === variablen.empfaengerId ? stand.empfaenger : empfaenger,
              ),
            };
          }),
        );
      }
      quittierFehler.melde(variablen.auftragId, e, 'Quittieren fehlgeschlagen');
    },
    onSettled: invalidiere,
  });
  const [vollzugFuer, setVollzugFuer] = useState<number | null>(null);
  /**
   * Der Rückgängig-Toast erscheint nur bei `in_arbeit`: „Vollzogen" geht ins ETB (append-only) und
   * ist über diese Achse nicht rücknehmbar — ein Knopf dafür liefe in ein 422. Fortschalten,
   * Rücknahme und „Vollzogen“ haben je eine Mutation, weil ihr Fehler an verschiedenen Orten steht:
   * an der Karte, im Seitenhinweis, im Dialog.
   */
  // „Heute fällig“ nach dem Kalendertag der Anzeigezone (LFH-692).
  const { konventionen } = useAnzeigeKonventionen();
  // Die nächste Rücknahme räumt den Grund der vorigen.
  const ruecknahmeMutation = useMutation({
    mutationFn: (auftragId: number) => setzeVollzug(einsatzId, auftragId, 'offen'),
    onMutate: () => onSeitenFehler?.(null),
    onSuccess: invalidiere,
    onError: (e) => onSeitenFehler?.(e),
  });
  const inArbeitMutation = useMutation({
    mutationFn: (auftragId: number) => setzeVollzug(einsatzId, auftragId, 'in_arbeit'),
    onMutate: (auftragId) => kartenFehler.beginne(auftragId),
    onSuccess: (_daten, auftragId) => {
      invalidiere();
      zeigeRueckgaengig(message, 'Auftrag in Bearbeitung', () =>
        ruecknahmeMutation.mutate(auftragId),
      );
    },
    onError: (e, auftragId) => kartenFehler.melde(auftragId, e, 'Statuswechsel fehlgeschlagen'),
  });
  const vollzugMeldenMutation = useMutation({
    mutationFn: ({ auftragId, text }: { auftragId: number; text: string }) =>
      setzeVollzug(einsatzId, auftragId, 'vollzogen', text),
    // Eine neue Handlung an der Karte räumt deren alten Grund.
    onMutate: ({ auftragId }) => kartenFehler.beginne(auftragId),
    // Nur den eigenen Dialog schließen: steht er inzwischen für einen anderen Auftrag, bleibt er.
    onSuccess: (_daten, { auftragId }) => {
      invalidiere();
      setVollzugFuer((f) => (f === auftragId ? null : f));
    },
  });
  const abnahmeMutation = useMutation({
    mutationFn: (auftragId: number) => nimmAb(einsatzId, auftragId),
    onMutate: (auftragId) => kartenFehler.beginne(auftragId),
    onSuccess: invalidiere,
    onError: (e, auftragId) => kartenFehler.melde(auftragId, e, 'Abnahme fehlgeschlagen'),
  });

  /*
   * Gemerkt über den Datenstand (LFH-949, D6): die Karten sind `memo`, und eine je Render neu
   * gefilterte Liste gäbe ihnen nichts zu vergleichen. Die Aufträge selbst bleiben die Objekte aus
   * TanStack Query; dessen `structuralSharing` hält unveränderte identisch.
   */
  const { offene, offeneGruppen } = useMemo(() => {
    // Die Phase trennt der Server; der Filter hält eine optimistisch oder per Abgleich
    // abgeschlossene Karte bis zum nächsten Abruf aus der Offen-Ansicht heraus.
    const offene = (offeneQuery.data ?? []).filter((a) => !istAuftragAbgeschlossen(a));

    // Offen-Ansicht: nach Fälligkeit gruppieren, je Gruppe nach Prio dann Frist.
    const offeneGruppen: { gruppe: FaelligGruppe; auftraege: Auftrag[] }[] = GRUPPE_ORDNUNG.map(
      (gruppe) => ({
        gruppe,
        auftraege: offene
          .filter(
            (a) => faelligGruppe(a.frist_at, a.ist_ueberfaellig, konventionen.zeitzone) === gruppe,
          )
          .sort(vergleicheOffen),
      }),
    ).filter(({ auftraege }) => auftraege.length > 0);

    return { offene, offeneGruppen };
  }, [offeneQuery.data, konventionen.zeitzone]);
  // Abgeschlossen-Ansicht: flach in der Ordnung des Servers, zuletzt abgeschlossen zuerst (D2).
  // Zwischen zwei Seitenabrufen kann sich der Bestand verschieben (neu abgeschlossene oben), dann
  // steht ein Auftrag kurz in zwei Seiten; der vordere gilt.
  const abgeschlossene = useMemo(() => {
    const gesehen = new Set<number>();
    return (abgeschlosseneQuery.data?.pages ?? []).flat().filter((a) => {
      if (gesehen.has(a.id)) return false;
      gesehen.add(a.id);
      return true;
    });
  }, [abgeschlosseneQuery.data]);
  const verlinkteAngeheftet =
    verlinkte &&
    istAuftragAbgeschlossen(verlinkte) &&
    !abgeschlossene.some((a) => a.id === verlinkte.id)
      ? verlinkte
      : null;
  // Scroll einmal je Deeplink, sobald die Karte im DOM steht; nicht bei jedem späteren Nachladen.
  useEffect(() => {
    if (scrollZiel == null) return;
    const karte = document.querySelector(`[data-auftrag-id="${scrollZiel}"]`);
    if (!karte) return;
    karte.scrollIntoView?.({ block: 'center' });
    setScrollZiel(null);
  }, [scrollZiel, ansicht, verlinkteAngeheftet, offene, abgeschlossene]);
  const kennzahlen = kennzahlenQuery.data;
  const offenZahl = kennzahlen?.offen ?? offene.length;
  const abgeschlossenZahl = kennzahlen?.abgeschlossen ?? abgeschlossene.length;

  const abschnitte = (abschnitteQuery.data ?? []).map((a) => ({ id: a.id, name: a.name }));
  const einheiten = (einheitenQuery.data ?? []).map((e) => ({ id: e.id, name: e.name }));
  const empfaengerOptionen = [
    {
      label: 'Einsatzabschnitte',
      options: abschnitte.map((a) => ({ value: `abschnitt:${a.id}`, label: a.name })),
    },
    {
      label: 'Einheiten',
      options: einheiten.map((e) => ({ value: `einheit:${e.id}`, label: e.name })),
    },
  ];

  /*
   * Stabile Handler über einen Ref-Bündel (LFH-949, D6): ein je Render neuer Pfeil machte jede
   * `memo`-Karte bei jedem Render neu. Der Bündel trägt die jüngsten Mutationen.
   */
  const mutationen = useRef({ quittierenMutation, inArbeitMutation, abnahmeMutation });
  useLayoutEffect(() => {
    mutationen.current = { quittierenMutation, inArbeitMutation, abnahmeMutation };
  });
  const onQuittieren = useCallback((auftragId: number, empfaengerId: number) => {
    const m = mutationen.current.quittierenMutation;
    if (!m.isPending) m.mutate({ auftragId, empfaengerId });
  }, []);
  const onInArbeit = useCallback(
    (auftragId: number) => mutationen.current.inArbeitMutation.mutate(auftragId),
    [],
  );
  const onAbnehmen = useCallback(
    (auftragId: number) => mutationen.current.abnahmeMutation.mutate(auftragId),
    [],
  );

  const listenProps = {
    einsatzId,
    darfSchreiben,
    highlightId: highlightAuftragId,
    quittierungLaeuft: quittierenMutation.isPending,
    quittierungZiel: quittierenMutation.variables ?? null,
    onQuittieren,
    onInArbeit,
    onVollzugMelden: setVollzugFuer,
    onAbnehmen,
    kartenFehler: kartenFehler.grund,
    quittierFehler: quittierFehler.grund,
  };

  return (
    <>
      <Bereichskopf
        titel="Aufträge"
        meta={`${offenZahl} offen · ${abgeschlossenZahl} abgeschlossen`}
        dataUpdatedAt={offeneQuery.dataUpdatedAt}
        aktion={
          darfSchreiben && (
            // Solange ein Auftrag unterwegs ist, bleibt das Paneel offen: die Antwort braucht ihren
            // Ort (design.md D3).
            <Button
              type="primary"
              icon={formOffen ? <IconChevronHoch /> : <IconPlus />}
              disabled={formOffen && anlegenMutation.isPending}
              onClick={() => schalteFormular(!formOffen)}
            >
              {formOffen ? 'Formular schließen' : 'Auftrag erteilen'}
            </Button>
          )
        }
      />

      {darfSchreiben && formOffen && (
        <Paneel
          titel="Neuer Auftrag"
          koerperPolster
          style={{ marginBottom: token.margin }}
          aktion={
            <Button
              type="text"
              icon={<IconKreuz />}
              disabled={anlegenMutation.isPending}
              onClick={() => schalteFormular(false)}
              aria-label="Formular schließen"
            />
          }
        >
          <AuftragFormular
            card={false}
            senden={anlegenMutation.isPending}
            abschnitte={abschnitte}
            einheiten={einheiten}
            einsatzId={einsatzId}
            // Serienerfassung: an derselben Lage entstehen mehrere Aufträge hintereinander.
            serie
            // mutateAsync: die Hülle darf die Felder nur leeren, wenn der Auftrag angekommen ist.
            onAnlegen={(d) => anlegenMutation.mutateAsync(d)}
            // Grund einer Ablehnung im Formular, bis zum nächsten Absenden; Abbrechen räumt ihn.
            speicherung={anlegenMutation}
            speicherFehlerTitel="Auftrag nicht erteilt"
            speicherFehlerFallback="Erteilen fehlgeschlagen"
          />
        </Paneel>
      )}

      {(offeneQuery.isError || (ansicht === 'abgeschlossen' && abgeschlosseneQuery.isError)) && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: token.marginSM }}
          title="Aufträge konnten nicht geladen werden"
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
        <Segmentleiste
          beschriftung="Richtung"
          wert={richtungFilter ?? 'alle'}
          onWechsel={(v) => setRichtungFilter(v === 'alle' ? undefined : v)}
          optionen={[
            { wert: 'alle', label: 'Alle Richtungen' },
            { wert: 'intern', label: 'Intern' },
            { wert: 'extern', label: 'Extern' },
          ]}
        />
        <Select
          allowClear
          placeholder="Empfänger filtern"
          style={{ minWidth: 220 }}
          value={empfFilter}
          onChange={(v) => setEmpfFilter(v ?? undefined)}
          options={empfaengerOptionen}
        />
      </div>
      {ansicht === 'offen' ? (
        offeneGruppen.length === 0 ? (
          <AuftragListe auftraege={[]} ansicht="offen" {...listenProps} />
        ) : (
          offeneGruppen.map(({ gruppe, auftraege }) => (
            <div key={gruppe} style={{ marginBottom: token.margin }}>
              <Augenbraue als="h4" style={{ display: 'block', marginBottom: token.marginXS }}>
                {GRUPPE_LABEL[gruppe]} ({auftraege.length})
              </Augenbraue>
              <AuftragListe auftraege={auftraege} ansicht="offen" {...listenProps} />
            </div>
          ))
        )
      ) : (
        <>
          {verlinkteAngeheftet && (
            <div style={{ marginBottom: token.margin }}>
              <Augenbraue als="h4" style={{ display: 'block', marginBottom: token.marginXS }}>
                Verlinkter Auftrag
              </Augenbraue>
              <AuftragListe
                auftraege={[verlinkteAngeheftet]}
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
            <AuftragListe
              auftraege={abgeschlossene}
              ansicht="abgeschlossen"
              fenster
              {...listenProps}
            />
          )}
          {/* Eine volle letzte Seite meldet noch eine Folgeseite; die Zahl der Abgeschlossenen
              sagt, dass es keine gibt. */}
          {abgeschlosseneQuery.hasNextPage &&
            (kennzahlen == null || abgeschlossene.length < kennzahlen.abgeschlossen) && (
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
      <VollzugMeldenModal
        offen={vollzugFuer !== null}
        onAbbrechen={() => setVollzugFuer(null)}
        speicherung={vollzugMeldenMutation}
        // mutateAsync: der Dialog leert seinen Text erst, wenn die Meldung angekommen ist.
        onBestaetigen={(text) =>
          vollzugFuer == null
            ? Promise.resolve()
            : vollzugMeldenMutation.mutateAsync({ auftragId: vollzugFuer, text })
        }
      />
    </>
  );
}
