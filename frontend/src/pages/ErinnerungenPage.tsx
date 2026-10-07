import { IconChevronHoch, IconKreuz, IconPlus } from '../icons';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { Alert, App, Breadcrumb, Button, Spin } from 'antd';
import { useMemo, useState } from 'react';
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
import { useFehlerMeldung } from '../components/useFehlerMeldung';

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
  const fehler = useFehlerMeldung();
  const invalidiere = () => qc.invalidateQueries({ queryKey: einsatzKeys.erinnerungen(einsatzId) });

  const anlegenMutation = useMutation({
    mutationFn: (daten: NeueErinnerung) => legeErinnerungAn(einsatzId, daten),
    // Das Inline-Formular bleibt nach dem Anlegen offen, damit die nächste Erinnerung ohne
    // Aufklappen folgt; ein Schließen unmountete es samt Serienzähler und Wertübernahme.
    onSuccess: () => {
      invalidiere();
      message.success('Erinnerung angelegt');
    },
    onError: fehler,
  });
  /**
   * Der Rückweg beider Abschluss-Aktionen: „Erledigt" und „Erübrigt" schalten mit einem Klick
   * statt mit Rückfrage; `POST …/erinnerungen/{eid}/oeffnen` räumt dafür alle drei Achsen (Status,
   * Vollzug, Quittung).
   */
  const oeffnenMutation = useMutation({
    mutationFn: (eid: number) => oeffneErinnerung(einsatzId, eid),
    onSuccess: invalidiere,
    onError: fehler,
  });
  const erledigenMutation = useMutation({
    mutationFn: (eid: number) => erledigeErinnerung(einsatzId, eid),
    onSuccess: (_daten, eid) => {
      invalidiere();
      zeigeRueckgaengig(message, 'Erinnerung erledigt', () => oeffnenMutation.mutate(eid));
    },
    onError: fehler,
  });
  const quittierenMutation = useMutation({
    mutationFn: (eid: number) => quittiereErinnerung(einsatzId, eid),
    onSuccess: (_daten, eid) => {
      invalidiere();
      zeigeRueckgaengig(message, 'Erinnerung erübrigt', () => oeffnenMutation.mutate(eid));
    },
    onError: fehler,
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
    onErledigen: (eid: number) => erledigenMutation.mutate(eid),
    onQuittieren: (eid: number) => quittierenMutation.mutate(eid),
  };

  return (
    <EinsatzSeite
      titel="Erinnerungen"

      meta={`${offenZahl} offen · ${abgeschlossenZahl} abgeschlossen`}
      dataUpdatedAt={offeneQuery.dataUpdatedAt}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Erinnerungen' },
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
            senden={anlegenMutation.isPending}
            onAnlegen={(d) => anlegenMutation.mutateAsync(d)}
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
