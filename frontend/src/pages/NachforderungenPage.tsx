import { Alert, App, Breadcrumb, Col, Input, Modal, Row, Segmented, Spin, Typography } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { ApiError } from '../api/client';
import { legeNachforderungAn, lehneNachforderungAb, listeNachforderungen, setzeNachforderungStatus } from '../api/nachforderungen';
import type { Nachforderung, NachforderungStatus, NeueNachforderung } from '../api/types';
import { NACHFORDERUNG_STATUS, istAbgeschlossen } from '../kommunikation';
import NachforderungListe from '../nachforderungen/NachforderungListe';
import NachforderungFormular from '../nachforderungen/NachforderungFormular';

/** Prio-Rang für die Offen-Sortierung (sofort zuerst). */
const PRIO_RANG: Record<string, number> = { sofort: 0, dringend: 1, normal: 2 };

/** Schlüssel-Zeitstempel der Abgeschlossen-Ansicht: Eintreffen ODER Ablehnung. */
function abschlussZeit(n: Nachforderung): string {
  return n.eingetroffen_at ?? n.abgelehnt_at ?? n.angefordert_at;
}

export default function NachforderungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [ansicht, setAnsicht] = useState<'offen' | 'abgeschlossen'>('offen');
  // Ablehnen-Dialog: Grund (optional) wird erhoben, bevor abgelehnt wird.
  const [ablehnenId, setAblehnenId] = useState<number | null>(null);
  const [ablehnenGrund, setAblehnenGrund] = useState('');

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  // Offen/Abgeschlossen-Trennung erfolgt clientseitig → ALLE Nachforderungen laden.
  const nfQuery = useQuery({
    queryKey: ['einsatz-nachforderungen', einsatzId],
    queryFn: () => listeNachforderungen(einsatzId, {}),
  });

  const invalidiere = () => qc.invalidateQueries({ queryKey: ['einsatz-nachforderungen', einsatzId] });
  // Bei Fehler (insb. 422 aus der optimistischen Sperre) zusätzlich invalidieren,
  // damit der ggf. veraltete View den echten Status nachlädt.
  const fehler = (e: unknown) => {
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
    invalidiere();
  };

  const anlegenMutation = useMutation({
    mutationFn: (d: NeueNachforderung) => legeNachforderungAn(einsatzId, d),
    onSuccess: () => { invalidiere(); message.success('Nachforderung abgesetzt'); },
    onError: fehler,
  });
  const statusMutation = useMutation({
    mutationFn: ({ nfId, status }: { nfId: number; status: NachforderungStatus }) =>
      setzeNachforderungStatus(einsatzId, nfId, status),
    onSuccess: invalidiere,
    onError: fehler,
  });
  const ablehnenMutation = useMutation({
    mutationFn: ({ nfId, grund }: { nfId: number; grund?: string }) => lehneNachforderungAb(einsatzId, nfId, grund),
    onSuccess: () => { invalidiere(); message.success('Nachforderung abgelehnt'); },
    onError: fehler,
  });
  const ablehnenBestaetigen = () => {
    if (ablehnenId != null) {
      ablehnenMutation.mutate({ nfId: ablehnenId, grund: ablehnenGrund.trim() || undefined });
    }
    setAblehnenId(null);
    setAblehnenGrund('');
  };

  if (einsatzQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');
  const alle = nfQuery.data ?? [];

  // Offen/Abgeschlossen clientseitig über die gemeinsame Phasen-Semantik trennen
  // (eingetroffen → abgeschlossen, abgelehnt → ausnahme zählen als „abgeschlossen").
  const istAbg = (n: Nachforderung) => istAbgeschlossen(NACHFORDERUNG_STATUS[n.status]?.phase ?? 'offen');
  const offene = alle.filter((n) => !istAbg(n));
  const abgeschlossene = alle.filter(istAbg);

  // Offen-Ansicht: nach Priorität (sofort→dringend→normal), dann angefordert_at absteigend.
  const offeneSortiert = [...offene].sort((a, b) => {
    const rang = (PRIO_RANG[a.prioritaet] ?? 9) - (PRIO_RANG[b.prioritaet] ?? 9);
    return rang !== 0 ? rang : b.angefordert_at.localeCompare(a.angefordert_at);
  });
  // Abgeschlossen-Ansicht: flach, neueste zuerst (nach Abschluss-Zeit).
  const abgeschlosseneSortiert = [...abgeschlossene]
    .sort((a, b) => abschlussZeit(b).localeCompare(abschlussZeit(a)));

  const listenProps = {
    darfSchreiben,
    onStatus: (nfId: number, status: NachforderungStatus) => statusMutation.mutate({ nfId, status }),
    onAblehnen: (nfId: number) => { setAblehnenId(nfId); setAblehnenGrund(''); },
  };

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: 'Nachforderung' },
        ]}
      />
      <Typography.Title level={3} style={{ marginTop: 0 }}>Nachforderung Kräfte/Mittel</Typography.Title>
      <Row gutter={24}>
        <Col flex="auto">
          {nfQuery.isError && (
            <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Nachforderungen konnten nicht geladen werden" />
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12, alignItems: 'center' }}>
            <Segmented
              value={ansicht}
              onChange={(v) => setAnsicht(v as 'offen' | 'abgeschlossen')}
              options={[
                { value: 'offen', label: `Offen (${offene.length})` },
                { value: 'abgeschlossen', label: `Abgeschlossen (${abgeschlossene.length})` },
              ]}
            />
          </div>
          {ansicht === 'offen' ? (
            <NachforderungListe nachforderungen={offeneSortiert} ansicht="offen" {...listenProps} />
          ) : (
            <NachforderungListe nachforderungen={abgeschlosseneSortiert} ansicht="abgeschlossen" {...listenProps} />
          )}
        </Col>
        {darfSchreiben && (
          <Col flex="360px">
            <NachforderungFormular senden={anlegenMutation.isPending} onAnlegen={(d) => anlegenMutation.mutate(d)} />
          </Col>
        )}
      </Row>
      <Modal
        open={ablehnenId != null}
        title="Nachforderung ablehnen"
        okText="Ablehnen"
        okButtonProps={{ danger: true }}
        onOk={ablehnenBestaetigen}
        onCancel={() => { setAblehnenId(null); setAblehnenGrund(''); }}
      >
        <Input.TextArea
          aria-label="Ablehnungsgrund"
          value={ablehnenGrund}
          onChange={(e) => setAblehnenGrund(e.target.value)}
          placeholder="Grund (optional), z. B. keine Reserven verfügbar"
          rows={3}
        />
      </Modal>
    </div>
  );
}
