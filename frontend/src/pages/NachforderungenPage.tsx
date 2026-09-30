import { IkoneChevronHoch, IkoneKreuz, IkonePlus } from '../ikonen';
import { Alert, App, Breadcrumb, Button, Input, Modal, Spin } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { fehlerText } from '../api/client';
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
import {
  NACHFORDERUNG_VORBELEGUNG_PARAMS,
  parseNachforderungVorbelegung,
  type NachforderungVorbelegung,
} from '../routing/deeplinks';
import { Paneel, Segmentleiste, useRollen } from '../components/instrument';

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
  // Bei Fehler (insb. 422 aus der optimistischen Sperre) zusätzlich invalidieren, damit ein
  // veralteter View den echten Status nachlädt.
  const fehler = (e: unknown) => {
    message.error(fehlerText(e));
    invalidiere();
  };

  const anlegenMutation = useMutation({
    mutationFn: (d: NeueNachforderung) => legeNachforderungAn(einsatzId, d),
    // Das Inline-Formular bleibt nach dem Anlegen offen, damit die nächste Nachforderung ohne
    // Aufklappen folgt; ein Zuklappen unmountete es samt Serienzähler und Wertübernahme.
    onSuccess: () => {
      invalidiere();
      message.success('Nachforderung abgesetzt');
    },
    onError: fehler,
  });
  /**
   * Fortschaltung und Rücknahme laufen durch dieselbe Mutation. `vorher` ist der Stand vor dem
   * Klick und damit das Ziel des Rückwegs — übergeben statt abgeleitet, weil `NAECHSTER` rückwärts
   * mehrdeutig wäre, sobald die Kette einen Abzweig bekommt.
   *
   * `zurueck` unterscheidet die Richtungen: die Rücknahme darf keinen eigenen Rückgängig-Toast
   * erzeugen, sonst schaukelte sich das Paar endlos auf.
   */
  const statusMutation = useMutation({
    mutationFn: ({
      nfId,
      status,
    }: {
      nfId: number;
      status: NachforderungStatus;
      vorher?: NachforderungStatus;
      zurueck?: boolean;
    }) => setzeNachforderungStatus(einsatzId, nfId, status),
    onSuccess: (_daten, { nfId, status, vorher, zurueck }) => {
      invalidiere();
      if (zurueck || !vorher) return;
      zeigeRueckgaengig(message, `Status: ${NACHFORDERUNG_STATUS[status]?.label ?? status}`, () =>
        statusMutation.mutate({ nfId, status: vorher, zurueck: true }),
      );
    },
    onError: fehler,
  });
  const ablehnenMutation = useMutation({
    mutationFn: ({ nfId, grund }: { nfId: number; grund?: string }) =>
      lehneNachforderungAb(einsatzId, nfId, grund),
    onSuccess: () => {
      invalidiere();
      message.success('Nachforderung abgelehnt');
    },
    onError: fehler,
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

  const ablehnenBestaetigen = () => {
    if (ablehnenId != null) {
      ablehnenMutation.mutate({ nfId: ablehnenId, grund: ablehnenGrund.trim() || undefined });
    }
    setAblehnenId(null);
    setAblehnenGrund('');
  };

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
  const alle = nfQuery.data ?? [];

  // Offen/Abgeschlossen clientseitig über die gemeinsame Phasen-Semantik (eingetroffen und
  // abgelehnt zählen als „abgeschlossen").
  const istAbg = (n: Nachforderung) =>
    istAbgeschlossen(NACHFORDERUNG_STATUS[n.status]?.phase ?? 'offen');
  const offene = alle.filter((n) => !istAbg(n));
  const abgeschlossene = alle.filter(istAbg);

  // Offen-Ansicht: nach Priorität (sofort→dringend→normal), dann angefordert_at absteigend.
  const offeneSortiert = [...offene].sort((a, b) => {
    const rang = prioRang(a.prioritaet) - prioRang(b.prioritaet);
    return rang !== 0 ? rang : b.angefordert_at.localeCompare(a.angefordert_at);
  });
  // Abgeschlossen-Ansicht: flach, neueste zuerst (nach Abschluss-Zeit).
  const abgeschlosseneSortiert = [...abgeschlossene].sort((a, b) =>
    abschlussZeit(b).localeCompare(abschlussZeit(a)),
  );

  const listenProps = {
    darfSchreiben,
    onStatus: (nfId: number, status: NachforderungStatus) => {
      const vorher = alle.find((n) => n.id === nfId)?.status;
      statusMutation.mutate({ nfId, status, vorher });
    },
    onAblehnen: (nfId: number) => {
      setAblehnenId(nfId);
      setAblehnenGrund('');
    },
  };

  return (
    <EinsatzSeite
      titel="Nachforderung Kräfte/Mittel"

      meta={`${offene.length} offen · ${abgeschlossene.length} abgeschlossen`}
      dataUpdatedAt={nfQuery.dataUpdatedAt}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Nachforderung' },
          ]}
        />
      }
      aktionen={
        darfSchreiben && (
          <Button
            type="primary"
            icon={formOffen ? <IkoneChevronHoch /> : <IkonePlus />}
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
              icon={<IkoneKreuz />}
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
        okButtonProps={{ danger: true }}
        onOk={ablehnenBestaetigen}
        onCancel={() => {
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
      </Modal>
    </EinsatzSeite>
  );
}
