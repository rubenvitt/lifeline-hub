import { IconChevronHoch, IconKreuz, IconPlus } from '../icons';
import { Alert, App, Breadcrumb, Button, Input, Modal, Spin } from 'antd';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { einsatzKeys } from '../api/queryKeys';
import {
  legeNachforderungAn,
  lehneNachforderungAb,
  listeNachforderungen,
  setzeNachforderungStatus,
} from '../api/nachforderungen';
import type { Nachforderung, NachforderungStatus, NeueNachforderung } from '../api/types';
import { NACHFORDERUNG_STATUS, istAbgeschlossen, prioRang } from '../kommunikation';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import NachforderungListe from '../nachforderungen/NachforderungListe';
import NachforderungFormular from '../nachforderungen/NachforderungFormular';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenHinweise, SpeicherFehler } from '../components/SpeicherHinweis';
import { useZeilenFehler } from '../components/useZeilenFehler';
import {
  NACHFORDERUNG_VORBELEGUNG_PARAMS,
  parseNachforderungVorbelegung,
  type NachforderungVorbelegung,
} from '../routing/deeplinks';
import { Paneel, Segmentleiste, useRollen } from '../components/instrument';
import { modulName } from '../einsatz/modulRegistry';

/** Schlüssel-Zeitstempel der Abgeschlossen-Ansicht: Eintreffen ODER Ablehnung. */
function abschlussZeit(n: Nachforderung): string {
  return n.eingetroffen_at ?? n.abgelehnt_at ?? n.angefordert_at;
}

export default function NachforderungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { token } = useRollen();

  const [ansicht, setAnsicht] = useState<'offen' | 'abgeschlossen'>('offen');
  // Inline-Erfassen-Formular: per Kopf-Knopf auf-/zugeklappt, kein Drawer.
  const [formOffen, setFormOffen] = useState(false);
  // Vorbelegung aus `?neu=1&art=…`. Lebt nur, solange die Erfassung offen ist: wer schließt und neu
  // öffnet, bekommt die leere Maske.
  const [vorbelegung, setVorbelegung] = useState<NachforderungVorbelegung | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const schliesseFormular = () => {
    setFormOffen(false);
    setVorbelegung(null);
  };
  // Grund einer abgelehnten Rücknahme aus dem Rückgängig-Toast: die Karte ist dann oft gewandert,
  // der Grund steht im Hinweis der Seite (LFH-1077).
  const [seitenFehler, setSeitenFehler] = useState<unknown>(null);
  // Ablehnen-Dialog: Grund (optional) wird erhoben, bevor abgelehnt wird.
  const [ablehnenId, setAblehnenId] = useState<number | null>(null);
  const [ablehnenGrund, setAblehnenGrund] = useState('');

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  // Offen/Abgeschlossen-Trennung clientseitig → alle Nachforderungen laden.
  const nfQuery = useQuery({
    queryKey: einsatzKeys.nachforderungen(einsatzId),
    queryFn: () => listeNachforderungen(einsatzId, {}),
  });

  const invalidiere = () =>
    qc.invalidateQueries({ queryKey: einsatzKeys.nachforderungen(einsatzId) });
  /*
   * Jede Handlung meldet ihre Ablehnung an ihrem Ort, kein Toast (LFH-1077, `frontend/AGENTS.md`,
   * „Rückwege und Fehler“): Anlegen am Formular, Fortschalten an der Karte, Rückgängig im
   * Seitenhinweis, Ablehnen im Dialog. Bei Fehler (insb. 422 aus der optimistischen Sperre)
   * zusätzlich invalidieren, damit ein veralteter View den echten Status nachlädt.
   */
  const kartenFehler = useZeilenFehler<number>();

  const anlegenMutation = useMutation({
    mutationFn: (d: NeueNachforderung) => legeNachforderungAn(einsatzId, d),
    // Das Inline-Formular bleibt nach dem Anlegen offen, damit die nächste Nachforderung ohne
    // Aufklappen folgt; ein Zuklappen unmountete es samt Serienzähler und Wertübernahme.
    onSuccess: () => {
      invalidiere();
      message.success('Nachforderung abgesetzt');
    },
    onError: invalidiere,
  });
  /**
   * Fortschaltung und Rücknahme sind getrennte Mutationen, weil ihr Fehler an verschiedenen Orten
   * steht: an der Karte und im Seitenhinweis. Die Rücknahme erzeugt keinen eigenen
   * Rückgängig-Toast, sonst schaukelte sich das Paar endlos auf. `vorher` ist der Stand vor dem
   * Klick und damit das Ziel des Rückwegs — übergeben statt abgeleitet, weil `NAECHSTER` rückwärts
   * mehrdeutig wäre, sobald die Kette einen Abzweig bekommt.
   */
  // Die nächste Rücknahme räumt den Grund der vorigen.
  const ruecknahmeMutation = useMutation({
    mutationFn: ({ nfId, status }: { nfId: number; status: NachforderungStatus }) =>
      setzeNachforderungStatus(einsatzId, nfId, status),
    onMutate: () => setSeitenFehler(null),
    onSuccess: invalidiere,
    onError: (e) => {
      setSeitenFehler(e);
      invalidiere();
    },
  });
  const statusMutation = useMutation({
    mutationFn: ({
      nfId,
      status,
    }: {
      nfId: number;
      status: NachforderungStatus;
      vorher?: NachforderungStatus;
    }) => setzeNachforderungStatus(einsatzId, nfId, status),
    // Eine neue Fortschaltung an der Karte räumt deren alten Grund.
    onMutate: ({ nfId }) => kartenFehler.beginne(nfId),
    onSuccess: (_daten, { nfId, status, vorher }) => {
      invalidiere();
      if (!vorher) return;
      zeigeRueckgaengig(message, `Status: ${NACHFORDERUNG_STATUS[status]?.label ?? status}`, () =>
        ruecknahmeMutation.mutate({ nfId, status: vorher }),
      );
    },
    onError: (e, { nfId }) => {
      kartenFehler.melde(nfId, e, 'Statuswechsel fehlgeschlagen');
      invalidiere();
    },
  });
  const ablehnenMutation = useMutation({
    mutationFn: ({ nfId, grund }: { nfId: number; grund?: string }) =>
      lehneNachforderungAb(einsatzId, nfId, grund),
    // Der Dialog schließt erst hier (design.md D3): bis zur Antwort bleibt der getippte Grund
    // stehen, eine Ablehnung steht im Dialog. Solange sie läuft, sind seine Auswege gesperrt.
    onSuccess: () => {
      invalidiere();
      message.success('Nachforderung abgelehnt');
      setAblehnenId(null);
      setAblehnenGrund('');
    },
    onError: invalidiere,
  });
  const darfSchreibenRoh = darfImEinsatzSchreiben(einsatzQuery.data, benutzer);

  /**
   * Erfassung per Deeplink: `?neu=1` öffnet sie, eine Vorbelegung
   * (`art`/`bezeichnung`/`anzahl`/`begruendung`) füllt sie. Apply-then-clean wie der
   * Platzier-Auftrag in `LagekartePage.tsx`: erst anwenden, dann räumen, `replace`, `searchParams`
   * kopiert statt mutiert. Ein stehengebliebener Auftrag öffnete das Formular bei jedem Neuladen.
   *
   * Der Lade-Riegel steht vor dem Räumen: `darfImEinsatzSchreiben` liefert für einen noch nicht
   * geladenen Einsatz `false`; ohne Riegel ginge der Deeplink bei F5 oder aus einem neuen Tab still
   * verloren.
   *
   * Eine unbrauchbare Vorbelegung wird ganz verworfen (`parseNachforderungVorbelegung`), die
   * Erfassung öffnet dann leer. Ohne Schreibrecht öffnet nichts — geräumt wird trotzdem.
   */
  useEffect(() => {
    const neu = searchParams.get('neu') === '1';
    const hatVorbelegung = NACHFORDERUNG_VORBELEGUNG_PARAMS.some((k) => searchParams.has(k));
    if (!neu && !hatVorbelegung) return;
    if (einsatzQuery.isLoading) return;
    if (darfSchreibenRoh) {
      setVorbelegung(parseNachforderungVorbelegung(searchParams));
      setFormOffen(true);
    }
    const naechste = new URLSearchParams(searchParams);
    naechste.delete('neu');
    for (const k of NACHFORDERUNG_VORBELEGUNG_PARAMS) naechste.delete(k);
    setSearchParams(naechste, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, darfSchreibenRoh]);

  /*
   * Gemerkt über den Datenstand, Handler über einen Ref-Bündel (LFH-949, D7): die Karten sind
   * `memo`, und je Render neue Listen oder Pfeile machten jede Karte neu. Steht vor den frühen
   * Rücksprüngen, wie jeder Hook.
   */
  const { offene, abgeschlossene, offeneSortiert, abgeschlosseneSortiert } = useMemo(() => {
    const alle = nfQuery.data ?? [];
    // Offen/Abgeschlossen clientseitig über die gemeinsame Phasen-Semantik (eingetroffen und
    // abgelehnt zählen als „abgeschlossen").
    const istAbg = (n: Nachforderung) =>
      istAbgeschlossen(NACHFORDERUNG_STATUS[n.status]?.phase ?? 'offen');
    const offene = alle.filter((n) => !istAbg(n));
    const abgeschlossene = alle.filter(istAbg);
    return {
      offene,
      abgeschlossene,
      // Offen-Ansicht: nach Priorität (sofort→dringend→normal), dann angefordert_at absteigend.
      offeneSortiert: [...offene].sort((a, b) => {
        const rang = prioRang(a.prioritaet) - prioRang(b.prioritaet);
        return rang !== 0 ? rang : b.angefordert_at.localeCompare(a.angefordert_at);
      }),
      // Abgeschlossen-Ansicht: flach, neueste zuerst (nach Abschluss-Zeit).
      abgeschlosseneSortiert: [...abgeschlossene].sort((a, b) =>
        abschlussZeit(b).localeCompare(abschlussZeit(a)),
      ),
    };
  }, [nfQuery.data]);
  const stand = useRef({ alle: nfQuery.data, statusMutation });
  useLayoutEffect(() => {
    stand.current = { alle: nfQuery.data, statusMutation };
  });
  const onStatus = useCallback((nfId: number, status: NachforderungStatus) => {
    const vorher = stand.current.alle?.find((n) => n.id === nfId)?.status;
    stand.current.statusMutation.mutate({ nfId, status, vorher });
  }, []);
  // Öffnen und Abbrechen räumen den Grund einer früheren Ablehnung; eine laufende Mutation bleibt
  // unberührt, `reset()` hängte ihr Ergebnis ab.
  const ablehnenRef = useRef(ablehnenMutation);
  ablehnenRef.current = ablehnenMutation;
  const raeumeAblehnen = useCallback(() => {
    const m = ablehnenRef.current;
    if (!m.isPending && m.error != null) m.reset();
  }, []);
  const onAblehnen = useCallback(
    (nfId: number) => {
      raeumeAblehnen();
      setAblehnenId(nfId);
      setAblehnenGrund('');
    },
    [raeumeAblehnen],
  );

  const ablehnenBestaetigen = () => {
    if (ablehnenId == null) return;
    ablehnenMutation.mutate({ nfId: ablehnenId, grund: ablehnenGrund.trim() || undefined });
  };
  // Solange abgelehnt wird, sind alle Auswege gesperrt: der Dialog bleibt bis zur Antwort offen.
  const lehntAb = ablehnenMutation.isPending;

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
  const listenProps = { darfSchreiben, onStatus, onAblehnen, kartenFehler: kartenFehler.grund };
  /*
   * Nach einer Ablehnung lädt `onError` neu; die Karte kann dabei in die andere Ansicht wandern
   * (ein anderer Arbeitsplatz hat schon fortgeschaltet). Ihr Grund hätte dann keinen Ort mehr und
   * steht im Seitenhinweis, solange sie in der gezeigten Liste fehlt. Die Rücknahme geht vor.
   */
  const gezeigt = ansicht === 'offen' ? offeneSortiert : abgeschlosseneSortiert;
  const gewandertId = kartenFehler.gemeldet().find((nfId) => !gezeigt.some((n) => n.id === nfId));
  const gewandert = gewandertId != null ? kartenFehler.grund(gewandertId) : null;
  const gewandertName = nfQuery.data?.find((n) => n.id === gewandertId)?.bezeichnung;
  const seitenGrund =
    seitenFehler != null
      ? {
          fehler: seitenFehler,
          titel: 'Nicht zurückgenommen',
          fallback: 'Rücknahme fehlgeschlagen',
        }
      : gewandert != null
        ? {
            fehler: gewandert.fehler,
            titel: gewandertName
              ? `Status von „${gewandertName}“ nicht geändert`
              : 'Status nicht geändert',
            fallback: gewandert.fallback,
          }
        : null;

  return (
    <EinsatzSeite
      titel={modulName('nachforderungen')}

      meta={`${offene.length} offen · ${abgeschlossene.length} abgeschlossen`}
      dataUpdatedAt={nfQuery.dataUpdatedAt}
      // Nur mit Inhalt gesetzt: ein leerer Slot rendert in `EinsatzSeite` trotzdem seinen Rahmen.
      hinweis={
        seitenGrund != null && (
          <SeitenHinweise
            fehler={seitenGrund.fehler}
            fehlerTitel={seitenGrund.titel}
            fehlerFallback={seitenGrund.fallback}
          />
        )
      }
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('nachforderungen') },
          ]}
        />
      }
      aktionen={
        darfSchreiben && (
          // Solange eine Nachforderung unterwegs ist, bleibt das Formular offen: die Antwort braucht
          // ihren Ort (design.md D3).
          <Button
            type="primary"
            icon={formOffen ? <IconChevronHoch /> : <IconPlus />}
            disabled={formOffen && anlegenMutation.isPending}
            onClick={() => (formOffen ? schliesseFormular() : setFormOffen(true))}
          >
            {formOffen ? 'Formular schließen' : 'Nachforderung anlegen'}
          </Button>
        )
      }
    >
      {darfSchreiben && formOffen && (
        <Paneel
          titel="Neue Nachforderung"
          koerperPolster
          style={{ marginBottom: token.margin }}
          aktion={
            <Button
              type="text"
              icon={<IconKreuz />}
              disabled={anlegenMutation.isPending}
              onClick={schliesseFormular}
              aria-label="Formular schließen"
            />
          }
        >
          <NachforderungFormular
            card={false}
            vorbelegung={vorbelegung}
            senden={anlegenMutation.isPending}
            // mutateAsync: die Erfassungshülle darf die Felder nur leeren, wenn die Nachforderung
            // angekommen ist.
            onAnlegen={(d) => anlegenMutation.mutateAsync(d)}
            // Grund einer Ablehnung im Formular, bis zum nächsten Absetzen; Einhängen räumt ihn.
            speicherung={anlegenMutation}
          />
        </Paneel>
      )}

      {nfQuery.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: token.marginSM }}
          title="Nachforderungen konnten nicht geladen werden"
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
            { wert: 'offen', label: `Offen (${offene.length})` },
            { wert: 'abgeschlossen', label: `Abgeschlossen (${abgeschlossene.length})` },
          ]}
        />
      </div>
      {ansicht === 'offen' ? (
        <NachforderungListe nachforderungen={offeneSortiert} ansicht="offen" {...listenProps} />
      ) : (
        <NachforderungListe
          nachforderungen={abgeschlosseneSortiert}
          ansicht="abgeschlossen"
          {...listenProps}
        />
      )}
      <Modal
        open={ablehnenId != null}
        title="Nachforderung ablehnen"
        okText="Ablehnen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true }}
        confirmLoading={lehntAb}
        cancelButtonProps={{ disabled: lehntAb }}
        closable={lehntAb ? { disabled: true } : true}
        mask={{ closable: !lehntAb }}
        keyboard={!lehntAb}
        onOk={ablehnenBestaetigen}
        onCancel={() => {
          raeumeAblehnen();
          setAblehnenId(null);
          setAblehnenGrund('');
        }}
      >
        <Input.TextArea
          aria-label="Ablehnungsgrund"
          value={ablehnenGrund}
          onChange={(e) => setAblehnenGrund(e.target.value)}
          placeholder="Grund (optional), z. B. keine Reserven verfügbar"
          rows={3}
        />
        {ablehnenMutation.error != null && (
          <div style={{ marginTop: token.marginSM }}>
            <SpeicherFehler
              fehler={ablehnenMutation.error}
              titel="Nicht abgelehnt"
              fallback="Ablehnen fehlgeschlagen"
            />
          </div>
        )}
      </Modal>
    </EinsatzSeite>
  );
}
