import { IconChevronHoch, IconKreuz, IconPlus } from '../icons';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { Alert, App, Breadcrumb, Button, Flex, Spin } from 'antd';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { einsatzKeys } from '../api/queryKeys';
import {
  ERINNERUNGEN_SEITE,
  erinnerungCursor,
  erledigeErinnerung,
  ladeErinnerungKennzahlen,
  legeErinnerungAn,
  listeAbgeschlosseneErinnerungen,
  listeOffeneErinnerungen,
  oeffneErinnerung,
  quittiereErinnerung,
} from '../api/erinnerungen';
import type { AbschlussCursor } from '../api/meldungen';
import type { Erinnerung, NeueErinnerung } from '../api/types';
import { GRUPPE_LABEL, GRUPPE_ORDNUNG, faelligGruppe, type FaelligGruppe } from '../kommunikation';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import ErinnerungListe from '../erinnerung/ErinnerungListe';
import ErinnerungFormular from '../erinnerung/ErinnerungFormular';
import EinsatzSeite from '../components/EinsatzSeite';
import { Augenbraue, Paneel, Segmentleiste, useRollen } from '../components/instrument';
import type { Speicherung } from '../components/Erfassung';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { GewanderteGruende } from '../components/GewanderteGruende';
import { useZeilenFehler } from '../components/useZeilenFehler';
import { modulName } from '../einsatz/modulRegistry';

export default function ErinnerungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { token } = useRollen();

  const [ansicht, setAnsicht] = useState<'offen' | 'abgeschlossen'>('offen');
  // Inline-Anlegen-Formular: per Kopf-Button auf-/zugeklappt, kein Drawer.
  const [formOffen, setFormOffen] = useState(false);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  // Offene ungeblättert, abgeschlossene seitenweise erst in ihrer Ansicht, Zahlen aus einem
  // eigenen Abruf (LFH-940, design.md D7). Ordnung der abgeschlossenen am Server: zuletzt
  // abgeschlossen zuerst.
  const offeneQuery = useQuery({
    queryKey: einsatzKeys.erinnerungenPhase(einsatzId, 'offen'),
    queryFn: () => listeOffeneErinnerungen(einsatzId),
  });
  const kennzahlenQuery = useQuery({
    queryKey: einsatzKeys.erinnerungKennzahlen(einsatzId),
    queryFn: () => ladeErinnerungKennzahlen(einsatzId),
  });
  const abgeschlosseneQuery = useInfiniteQuery({
    queryKey: einsatzKeys.erinnerungenPhase(einsatzId, 'abgeschlossen'),
    queryFn: ({ pageParam }) => listeAbgeschlosseneErinnerungen(einsatzId, pageParam),
    initialPageParam: undefined as AbschlussCursor | undefined,
    getNextPageParam: (letzte) =>
      letzte.length < ERINNERUNGEN_SEITE ? undefined : erinnerungCursor(letzte[letzte.length - 1]),
    enabled: ansicht === 'abgeschlossen',
  });
  const abgeschlossene = useMemo(() => {
    const gesehen = new Set<number>();
    return (abgeschlosseneQuery.data?.pages ?? []).flat().filter((e) => {
      if (gesehen.has(e.id)) return false;
      gesehen.add(e.id);
      return true;
    });
  }, [abgeschlosseneQuery.data]);

  // „Heute fällig“ nach dem Kalendertag der Anzeigezone (LFH-692).
  const { konventionen } = useAnzeigeKonventionen();
  const invalidiere = (eid: number) =>
    qc.invalidateQueries({ queryKey: einsatzKeys.erinnerungen(eid) });

  /*
   * Jede Handlung meldet ihre Ablehnung an ihrem Ort, kein Toast (LFH-1077, `frontend/AGENTS.md`,
   * „Rückwege und Fehler“): Anlegen im Paneel, Erledigt und Erübrigt an der Karte (ein Speicher,
   * die zuletzt begonnene Aktion zählt), Rückgängig aus dem Toast im Seitenhinweis. Jede Aktion
   * trägt ihren Einsatz: die Route hat keinen `key`, eine Antwort nach einem Einsatzwechsel meldet
   * nicht am neuen Ort.
   */
  const kartenFehler = useZeilenFehler<number>();
  const [seitenFehler, setSeitenFehler] = useState<{ einsatzId: number; fehler: unknown } | null>(
    null,
  );
  const einsatzJetzt = useRef(einsatzId);
  useLayoutEffect(() => {
    einsatzJetzt.current = einsatzId;
  });
  const nochDa = (eid: number) => eid === einsatzJetzt.current;
  const { leere: leereKarten } = kartenFehler;
  useEffect(() => leereKarten(), [einsatzId, leereKarten]);
  // Titel jeder je gezeigten Karte: eine gewanderte steht oft in keiner geladenen Liste mehr.
  const titelJe = useRef(new Map<number, string>());
  useLayoutEffect(() => {
    for (const e of [...(offeneQuery.data ?? []), ...abgeschlossene]) {
      titelJe.current.set(e.id, e.titel);
    }
  }, [offeneQuery.data, abgeschlossene]);

  const anlegenMutation = useMutation({
    mutationFn: (v: { einsatzId: number; daten: NeueErinnerung }) =>
      legeErinnerungAn(v.einsatzId, v.daten),
    // Das Inline-Formular bleibt nach dem Anlegen offen, damit die nächste Erinnerung ohne
    // Aufklappen folgt; ein Schließen unmountete es samt Serienzähler und Wertübernahme.
    onSuccess: (_daten, v) => {
      invalidiere(v.einsatzId);
      message.success('Erinnerung angelegt');
    },
  });
  // Nur das Anlegen DIESES Einsatzes gehört ins Paneel; eines aus dem vorigen hält es nicht.
  const diesesAnlegen = anlegenMutation.variables?.einsatzId === einsatzId;
  const anlegenSpeicherung: Speicherung = {
    error: diesesAnlegen ? anlegenMutation.error : null,
    isPending: diesesAnlegen && anlegenMutation.isPending,
    reset: anlegenMutation.reset,
  };
  // Zuklappen hängt das Formular aus; beim Aufklappen räumt die Erfassungshülle den alten Grund.
  /**
   * Der Rückweg beider Abschluss-Aktionen: „Erledigt" und „Erübrigt" schalten mit einem Klick
   * statt mit Rückfrage; `POST …/erinnerungen/{eid}/oeffnen` räumt dafür alle drei Achsen (Status,
   * Vollzug, Quittung). Die nächste Rücknahme räumt den Grund der vorigen.
   */
  const oeffnenMutation = useMutation({
    mutationFn: (v: { einsatzId: number; eid: number }) => oeffneErinnerung(v.einsatzId, v.eid),
    onMutate: () => setSeitenFehler(null),
    onSuccess: (_daten, v) => invalidiere(v.einsatzId),
    onError: (e, v) => {
      if (nochDa(v.einsatzId)) setSeitenFehler({ einsatzId: v.einsatzId, fehler: e });
    },
  });
  const erledigenMutation = useMutation({
    mutationFn: (v: { einsatzId: number; eid: number }) => erledigeErinnerung(v.einsatzId, v.eid),
    onMutate: (v) => kartenFehler.beginne(v.eid),
    onSuccess: (_daten, v) => {
      invalidiere(v.einsatzId);
      zeigeRueckgaengig(message, 'Erinnerung erledigt', () => oeffnenMutation.mutate(v));
    },
    onError: (e, v) => {
      if (nochDa(v.einsatzId)) kartenFehler.melde(v.eid, e, 'Erledigen fehlgeschlagen');
    },
  });
  const quittierenMutation = useMutation({
    mutationFn: (v: { einsatzId: number; eid: number }) => quittiereErinnerung(v.einsatzId, v.eid),
    onMutate: (v) => kartenFehler.beginne(v.eid),
    onSuccess: (_daten, v) => {
      invalidiere(v.einsatzId);
      zeigeRueckgaengig(message, 'Erinnerung erübrigt', () => oeffnenMutation.mutate(v));
    },
    onError: (e, v) => {
      if (nochDa(v.einsatzId)) kartenFehler.melde(v.eid, e, 'Erübrigen fehlgeschlagen');
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
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);
  const offene = offeneQuery.data ?? [];
  const offenZahl = kennzahlenQuery.data?.offen ?? offene.length;
  const abgeschlossenZahl = kennzahlenQuery.data?.abgeschlossen ?? abgeschlossene.length;

  // Offen-Ansicht: nach Fälligkeit gruppieren, je Gruppe nach faellig_at aufsteigend.
  const offeneGruppen: { gruppe: FaelligGruppe; erinnerungen: Erinnerung[] }[] = GRUPPE_ORDNUNG.map(
    (gruppe) => ({
      gruppe,
      erinnerungen: offene
        .filter((e) => faelligGruppe(e.faellig_at, e.ist_faellig, konventionen.zeitzone) === gruppe)
        .sort((a, b) => (a.faellig_at ?? '￿').localeCompare(b.faellig_at ?? '￿')),
    }),
  ).filter(({ erinnerungen }) => erinnerungen.length > 0);

  const listenProps = {
    darfSchreiben,
    onErledigen: (eid: number) => erledigenMutation.mutate({ einsatzId, eid }),
    onQuittieren: (eid: number) => quittierenMutation.mutate({ einsatzId, eid }),
    zeilenFehler: kartenFehler.grund,
  };
  /*
   * Steht die Karte eines Grundes in der gezeigten Ansicht nicht (Ansicht gewechselt, Karte
   * gewandert), hätte er keinen Ort mehr: dann steht er im Seitenhinweis, schließbar. Solange die
   * Ansicht noch lädt, hat kein Grund seinen Ort verloren.
   */
  const gezeigt = ansicht === 'offen' ? offene : abgeschlossene;
  const ansichtLaedt = ansicht === 'offen' ? offeneQuery.isPending : abgeschlosseneQuery.isPending;
  const gewanderte = ansichtLaedt
    ? []
    : kartenFehler.gemeldet().flatMap((eid) => {
        const grund = kartenFehler.grund(eid);
        if (grund == null || gezeigt.some((e) => e.id === eid)) return [];
        const titel = titelJe.current.get(eid);
        return [{ schluessel: eid, kennung: titel ? `„${titel}“` : undefined, grund }];
      });
  const rueckFehler = seitenFehler?.einsatzId === einsatzId ? seitenFehler.fehler : null;

  return (
    <EinsatzSeite
      titel={modulName('erinnerungen')}

      meta={`${offenZahl} offen · ${abgeschlossenZahl} abgeschlossen`}
      dataUpdatedAt={offeneQuery.dataUpdatedAt}
      // Nur mit Inhalt gesetzt: ein leerer Slot rendert in `EinsatzSeite` trotzdem seinen Rahmen.
      hinweis={
        (rueckFehler != null || gewanderte.length > 0) && (
          <Flex vertical gap={token.marginSM}>
            <SeitenHinweise
              fehler={rueckFehler}
              fehlerTitel="Nicht wieder geöffnet"
              fehlerFallback="Öffnen fehlgeschlagen"
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
            { title: modulName('erinnerungen') },
          ]}
        />
      }
      aktionen={
        darfSchreiben && (
          // Solange eine Erinnerung unterwegs ist, bleibt das Paneel offen: die Antwort braucht
          // ihren Ort (design.md D3).
          <Button
            type="primary"
            icon={formOffen ? <IconChevronHoch /> : <IconPlus />}
            disabled={formOffen && anlegenSpeicherung.isPending}
            onClick={() => setFormOffen(!formOffen)}
          >
            {formOffen ? 'Formular schließen' : 'Erinnerung anlegen'}
          </Button>
        )
      }
    >
      {darfSchreiben && formOffen && (
        <Paneel
          titel="Neue Erinnerung"
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
          {/* mutateAsync: die Erfassungshülle darf die Felder nur leeren, wenn die Erinnerung
              angekommen ist. */}
          <ErinnerungFormular
            einsatzId={einsatzId}
            card={false}
            senden={anlegenSpeicherung.isPending}
            onAnlegen={(daten) => anlegenMutation.mutateAsync({ einsatzId, daten })}
            speicherung={anlegenSpeicherung}
          />
        </Paneel>
      )}

      {(offeneQuery.isError || (ansicht === 'abgeschlossen' && abgeschlosseneQuery.isError)) && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: token.marginSM }}
          title="Erinnerungen konnten nicht geladen werden"
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
      </div>
      {ansicht === 'offen' ? (
        offeneGruppen.length === 0 ? (
          <ErinnerungListe erinnerungen={[]} ansicht="offen" {...listenProps} />
        ) : (
          offeneGruppen.map(({ gruppe, erinnerungen }) => (
            <div key={gruppe} style={{ marginBottom: token.margin }}>
              <Augenbraue als="h2" style={{ display: 'block', marginBottom: token.marginXS }}>
                {GRUPPE_LABEL[gruppe]} ({erinnerungen.length})
              </Augenbraue>
              <ErinnerungListe erinnerungen={erinnerungen} ansicht="offen" {...listenProps} />
            </div>
          ))
        )
      ) : (
        <>
          {abgeschlosseneQuery.isPending ? (
            <div style={{ textAlign: 'center', padding: token.paddingLG }}>
              <Spin />
            </div>
          ) : (
            <ErinnerungListe
              erinnerungen={abgeschlossene}
              ansicht="abgeschlossen"
              {...listenProps}
            />
          )}
          {abgeschlosseneQuery.hasNextPage &&
            (kennzahlenQuery.data == null ||
              abgeschlossene.length < kennzahlenQuery.data.abgeschlossen) && (
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
    </EinsatzSeite>
  );
}
