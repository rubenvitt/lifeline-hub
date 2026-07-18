import { Alert, App, Breadcrumb, Button, Space, Spin, Table, Tabs, Tag, Typography } from 'antd';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { personDetailPfad } from '../routing/deeplinks';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { legePersonAn, listePersonen, schlageAbgleichVor, setzePersonStatus, type PersonEingabe } from '../api/einsatzPerson';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import type { Person } from '../api/types';
import { PATIENT_SK, SK_META } from '../personen/personMeta';
import { abgleichSpalte, personenSpalten } from '../personen/personenSpalten';
import PersonErfassungModal, { type ErfassungsModus } from '../personen/PersonErfassungModal';
import LagebildStreifen from '../personen/LagebildStreifen';

/** Patient = gesichtet mit behandlungsrelevanter Kategorie (SK I–IV oder tot);
 *  unverletzt und ungesichtet zählen nicht (LFH-10, rein medizinische Achse). */
function istPatient(p: Person): boolean {
  return p.aktuelle_sichtung != null && PATIENT_SK.includes(p.aktuelle_sichtung);
}

/** Sicht-Tabs: 'alle' = kein Filter; 'patienten' = SK-Achse; sonst Status-Filter. */
type Sicht = 'erfasst' | 'vermisst' | 'betroffen' | 'patienten' | 'verstorben' | 'alle';
const SICHTEN: { key: Sicht; label: string }[] = [
  { key: 'erfasst', label: 'Neu' },
  { key: 'vermisst', label: 'Vermisst' },
  { key: 'betroffen', label: 'Betroffen' },
  { key: 'patienten', label: 'Patienten' },
  { key: 'verstorben', label: 'Verstorben' },
  { key: 'alle', label: 'Alle' },
];

export default function PersonenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const [sicht, setSicht] = useState<Sicht>('erfasst');

  // Live-Updates über den konsolidierten useEinsatzLiveStream im EinsatzLayout (LFH-207).

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const personenQuery = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
  });

  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modus, setModus] = useState<ErfassungsModus | null>(null);

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.personen(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const anlegenMutation = useMutation({
    mutationFn: async (v: { daten: PersonEingabe; folgeStatus?: 'vermisst' | 'betroffen' }) => {
      const person = await legePersonAn(einsatzId, v.daten);
      if (v.folgeStatus) await setzePersonStatus(einsatzId, person.id, v.folgeStatus);
      return person;
    },
    onSuccess: () => { invalidate(); setModus(null); },
    onError: fehler,
  });

  // Deep-Link: ?person=<id> leitet auf die Detailseite um (rückwärtskompatibel
  // mit dem alten Drawer-Verhalten, z. B. „Vollständig öffnen" aus dem UHS-Drawer).
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const pid = searchParams.get('person');
    if (pid) navigate(personDetailPfad(einsatzId, Number(pid)), { replace: true });
  }, [searchParams, einsatzId, navigate]);

  // Schnellaktion: ?neu=1 öffnet die Schnellerfassung (Command-Palette, LFH-11).
  // Warten bis der Einsatz geladen ist; Param immer löschen, aber Modal nur bei Schreibrecht öffnen.
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    const e = einsatzQuery.data;
    const darfSchr = darfImEinsatzSchreiben(e, benutzer);
    if (darfSchr) setModus('schnell');
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, einsatzQuery.data, benutzer]);

  const abgleichVorschlagMutation = useMutation({
    mutationFn: (v: { vermisstId: number; gefundenId: number }) =>
      schlageAbgleichVor(einsatzId, v.vermisstId, v.gefundenId),
    onSuccess: () => { invalidate(); message.success('Verdachts-Abgleich angelegt'); },
    onError: fehler,
  });

  if (einsatzQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  const alle = personenQuery.data ?? [];
  const personen = (sicht === 'alle' || sicht === 'patienten')
    ? alle
    : alle.filter((p) => p.status === sicht);

  const gefundene = alle.filter((p) => ['betroffen', 'verstorben'].includes(p.status) && !p.storniert_at);

  const aktionsSpalte = darfSchreiben && sicht === 'vermisst'
    ? abgleichSpalte(gefundene, (vermisstId, gefundenId) => abgleichVorschlagMutation.mutate({ vermisstId, gefundenId }))
    : [];

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Personen' }]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>Personen</Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
        {darfSchreiben && (
          <Space>
            <Button type="primary" onClick={() => setModus('schnell')}>Schnellerfassung</Button>
            <Button onClick={() => setModus('vermisst')}>Vermisst melden</Button>
            <Button onClick={() => setModus('betroffen')}>Betroffene/n erfassen</Button>
          </Space>
        )}
      </Space>

      <Tabs
        activeKey={sicht}
        onChange={(k) => setSicht(k as Sicht)}
        items={SICHTEN.map((s) => ({ key: s.key, label: s.label }))}
      />

      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert style={{ marginBottom: 12 }} type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
      )}

      <LagebildStreifen alle={alle} />

      {sicht === 'patienten' ? (
        <Spin spinning={personenQuery.isLoading}>
        <Space orientation="vertical" size="large" style={{ width: '100%' }}>
          {PATIENT_SK.map((sk) => {
            const gruppe = alle.filter((p) => p.aktuelle_sichtung === sk);
            if (gruppe.length === 0) return null;
            return (
              <div key={sk}>
                <Typography.Title level={5} style={{ marginTop: 0 }}>
                  <Tag color={SK_META[sk].color}>{SK_META[sk].label}</Tag>{' '}
                  <Typography.Text type="secondary">
                    {gruppe.length} {gruppe.length === 1 ? 'Patient' : 'Patienten'}
                  </Typography.Text>
                </Typography.Title>
                <Table
                  rowKey="id"
                  dataSource={gruppe}
                  columns={personenSpalten}
                  pagination={false}
                  onRow={(p) => ({ onClick: () => navigate(personDetailPfad(einsatzId, p.id)), style: { cursor: 'pointer' } })}
                />
              </div>
            );
          })}
          {!personenQuery.isLoading && !alle.some(istPatient) && (
            <Alert type="info" showIcon title="Keine Patienten in diesem Einsatz." />
          )}
        </Space>
        </Spin>
      ) : (
        <Table
          rowKey="id"
          loading={personenQuery.isLoading}
          dataSource={personen}
          columns={[...personenSpalten, ...aktionsSpalte]}
          pagination={false}
          locale={{ emptyText: 'Keine Personen in dieser Sicht' }}
          onRow={(p) => ({ onClick: () => navigate(personDetailPfad(einsatzId, p.id)), style: { cursor: 'pointer' } })}
        />
      )}

      <PersonErfassungModal
        modus={modus}
        isPending={anlegenMutation.isPending}
        onCancel={() => setModus(null)}
        onFinish={(daten) =>
          anlegenMutation.mutate({
            daten,
            folgeStatus: modus === 'vermisst' ? 'vermisst' : modus === 'betroffen' ? 'betroffen' : undefined,
          })
        }
      />
    </div>
  );
}
