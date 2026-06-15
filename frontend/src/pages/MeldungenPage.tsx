import { Alert, App, Breadcrumb, Col, Row, Segmented, Spin, Typography } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz, ladeMitglieder } from '../api/einsaetze';
import { ApiError } from '../api/client';
import { bestaetigeMeldung, legeMeldungAn, listeMeldungen, markiereLagerelevant, setzeMeldungStatus, weiseBearbeiterZu } from '../api/meldungen';
import type { Meldung, MeldungStatus, NeueMeldung } from '../api/types';
import { MELDUNG_STATUS, istAbgeschlossen } from '../kommunikation';
import MeldungListe from '../meldungen/MeldungListe';
import MeldungFormular from '../meldungen/MeldungFormular';

const PRIO_ORDNUNG: Record<string, number> = { sofort: 0, dringend: 1, normal: 2 };

/**
 * Sortierung der Meldungen: Prio (sofort→dringend→normal), dann eskaliert zuerst
 * (Alarm oben), dann Ereigniszeit absteigend. Meldungen haben keine Frist im
 * Auftrags-Sinn → keine Fälligkeits-Gruppierung, flache Liste mit Badges.
 */
function vergleicheMeldung(a: Meldung, b: Meldung): number {
  const prio = (PRIO_ORDNUNG[a.prioritaet] ?? 99) - (PRIO_ORDNUNG[b.prioritaet] ?? 99);
  if (prio !== 0) return prio;
  const eskaliert = Number(b.eskaliert) - Number(a.eskaliert);
  if (eskaliert !== 0) return eskaliert;
  return (b.ereigniszeit ?? '').localeCompare(a.ereigniszeit ?? '');
}

export default function MeldungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const qc = useQueryClient();

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const mitgliederQuery = useQuery({ queryKey: ['einsatz-mitglieder', einsatzId], queryFn: () => ladeMitglieder(einsatzId) });

  // Offen/Abgeschlossen-Trennung erfolgt clientseitig (alle Meldungen laden, Server-Default).
  const [ansicht, setAnsicht] = useState<'offen' | 'abgeschlossen'>('offen');
  const [richtungFilter, setRichtungFilter] = useState<string | undefined>(undefined);

  const meldungenQuery = useQuery({
    queryKey: ['einsatz-meldungen', einsatzId, richtungFilter ?? 'alle'],
    queryFn: () => listeMeldungen(einsatzId, { richtung: richtungFilter }),
  });

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  const invalidiere = () => qc.invalidateQueries({ queryKey: ['einsatz-meldungen', einsatzId] });

  const anlegenMutation = useMutation({
    mutationFn: (d: NeueMeldung) => legeMeldungAn(einsatzId, d),
    onSuccess: () => { invalidiere(); message.success('Meldung erfasst'); },
    onError: fehler,
  });
  const statusMutation = useMutation({
    mutationFn: ({ meldungId, status }: { meldungId: number; status: MeldungStatus }) =>
      setzeMeldungStatus(einsatzId, meldungId, status),
    onSuccess: invalidiere,
    onError: fehler,
  });
  const zuweisenMutation = useMutation({
    mutationFn: ({ meldungId, bearbeiterId }: { meldungId: number; bearbeiterId: number | null }) =>
      weiseBearbeiterZu(einsatzId, meldungId, bearbeiterId),
    onSuccess: invalidiere,
    onError: fehler,
  });
  const lageMutation = useMutation({
    mutationFn: (meldungId: number) => markiereLagerelevant(einsatzId, meldungId),
    onSuccess: () => {
      invalidiere();
      qc.invalidateQueries({ queryKey: ['einsatz-lagemeldungen', einsatzId] });
      message.success('An die Lage übergeben');
    },
    onError: fehler,
  });
  const bestaetigenMutation = useMutation({
    mutationFn: (meldungId: number) => bestaetigeMeldung(einsatzId, meldungId),
    onSuccess: () => { invalidiere(); message.success('Sofortmeldung bestätigt'); },
    onError: fehler,
  });

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
  const alleMeldungen = meldungenQuery.data ?? [];

  // Offen/Abgeschlossen clientseitig über die gemeinsame Phasen-Semantik trennen.
  const phaseVon = (m: Meldung) => MELDUNG_STATUS[m.status]?.phase ?? 'offen';
  const offene = alleMeldungen.filter((m) => !istAbgeschlossen(phaseVon(m))).sort(vergleicheMeldung);
  const abgeschlossene = alleMeldungen.filter((m) => istAbgeschlossen(phaseVon(m))).sort(vergleicheMeldung);
  const sichtbare = ansicht === 'offen' ? offene : abgeschlossene;
  const mitglieder = mitgliederQuery.data ?? [];

  const listenProps = {
    darfSchreiben,
    mitglieder,
    onStatus: (meldungId: number, status: MeldungStatus) => statusMutation.mutate({ meldungId, status }),
    onZuweisen: (meldungId: number, bearbeiterId: number | null) => zuweisenMutation.mutate({ meldungId, bearbeiterId }),
    onLagerelevant: (meldungId: number) => lageMutation.mutate(meldungId),
    onBestaetigen: (meldungId: number) => bestaetigenMutation.mutate(meldungId),
  };

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: 'Meldungen (eingehend)' },
        ]}
      />
      <Typography.Title level={3} style={{ marginTop: 0 }}>Meldungen (eingehend)</Typography.Title>
      <Row gutter={24}>
        <Col flex="auto">
          {meldungenQuery.isError && (
            <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Meldungen konnten nicht geladen werden" />
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
            <Segmented
              value={richtungFilter ?? 'alle'}
              onChange={(v) => setRichtungFilter(v === 'alle' ? undefined : String(v))}
              options={[
                { value: 'alle', label: 'Alle Richtungen' },
                { value: 'intern', label: 'Intern' },
                { value: 'extern', label: 'Extern' },
              ]}
            />
          </div>
          <MeldungListe meldungen={sichtbare} {...listenProps} />
        </Col>
        {darfSchreiben && (
          <Col flex="360px">
            <MeldungFormular senden={anlegenMutation.isPending} onAnlegen={(d) => anlegenMutation.mutate(d)} />
          </Col>
        )}
      </Row>
    </div>
  );
}
