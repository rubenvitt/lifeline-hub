import { Alert, App, Breadcrumb, Button, Card, Descriptions, Empty, Form, Input, Popconfirm, Space, Spin, Tag, Tree, TreeSelect, Typography, type TreeDataNode } from 'antd';
import { Select } from '../components/Select';
import { Link, useParams } from 'react-router';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { einsatzKeys } from '../api/queryKeys';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinheiten } from '../api/einheiten';
import {
  aktualisiereAbschnitt, legeAbschnittAn, listeAbschnitte, loeseAbschnittAuf, type AbschnittEingabe,
} from '../api/einsatzabschnitte';
import { ApiError } from '../api/client';
import type { Einsatzabschnitt, Staerke } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import FunkErreichbarkeit, { KOMMUNIKATIONSMITTEL_OPTIONEN } from '../components/FunkErreichbarkeit';
import { Liste, ListenEintrag } from '../components/Liste';
import SprechgruppenPicker from '../components/SprechgruppenPicker';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';

function baueBaum(abschnitte: Einsatzabschnitt[]): TreeDataNode[] {
  const kinder = new Map<number | null, Einsatzabschnitt[]>();
  for (const a of abschnitte) {
    const key = a.ueber_abschnitt_id ?? null;
    if (!kinder.has(key)) kinder.set(key, []);
    kinder.get(key)!.push(a);
  }
  const baue = (parent: number | null): TreeDataNode[] =>
    (kinder.get(parent) ?? []).map((a) => ({
      key: a.id,
      title: (
        <Space size={4}>
          <span>{a.name}</span>
          {a.leiter_name && <span style={{ color: '#888' }}>👤 {a.leiter_name}</span>}
          {a.erreichbarkeit && <span style={{ color: '#888' }}>☎</span>}
        </Space>
      ),
      children: baue(a.id),
    }));
  return baue(null);
}

function nachfahrenInkl(abschnitte: Einsatzabschnitt[], id: number): Set<number> {
  const kinder = new Map<number, number[]>();
  for (const a of abschnitte) {
    if (a.ueber_abschnitt_id != null) {
      if (!kinder.has(a.ueber_abschnitt_id)) kinder.set(a.ueber_abschnitt_id, []);
      kinder.get(a.ueber_abschnitt_id)!.push(a.id);
    }
  }
  const ergebnis = new Set<number>();
  const stack = [id];
  while (stack.length) {
    const n = stack.pop()!;
    if (ergebnis.has(n)) continue;
    ergebnis.add(n);
    for (const c of kinder.get(n) ?? []) stack.push(c);
  }
  return ergebnis;
}

interface AbschnittWerte {
  name: string;
  ueber_abschnitt_id?: number | null;
  leiter_id?: number | null;
  bemerkung?: string;
  sprechgruppe_ids?: number[];
  kommunikationsmittel?: string;
  erreichbarkeit?: string;
}

export default function EinsatzabschnittePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [gewaehlt, setGewaehlt] = useState<number | null>(null);
  const [bearbeiten, setBearbeiten] = useState(false);
  const [form] = Form.useForm<AbschnittWerte>();

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const abschnitteQuery = useQuery({ queryKey: einsatzKeys.abschnitte(einsatzId), queryFn: () => listeAbschnitte(einsatzId) });
  const personalQuery = useQuery({ queryKey: einsatzKeys.personal(einsatzId), queryFn: () => listeEinsatzPersonal(einsatzId) });
  const einheitenQuery = useQuery({ queryKey: einsatzKeys.einheiten(einsatzId), queryFn: () => listeEinheiten(einsatzId) });

  // Cross-Modul-Deeplink (LFH-25): ?abschnitt=<id> selektiert den Abschnitt, sofern vorhanden.
  useQueryParamSelektion('abschnitt', abschnitteQuery.isSuccess, (zid) => {
    if ((abschnitteQuery.data ?? []).some((a) => a.id === zid)) setGewaehlt(zid);
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.abschnitte(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const abschnitte = useMemo(() => abschnitteQuery.data ?? [], [abschnitteQuery.data]);
  const aktuell = abschnitte.find((a) => a.id === gewaehlt) ?? null;

  const speichern = useMutation({
    mutationFn: (werte: AbschnittWerte) => {
      const daten: AbschnittEingabe = {
        name: werte.name.trim(),
        ueber_abschnitt_id: werte.ueber_abschnitt_id ?? null,
        leiter_id: werte.leiter_id ?? null,
        bemerkung: werte.bemerkung?.trim() || null,
        sprechgruppe_ids: werte.sprechgruppe_ids ?? [],
        kommunikationsmittel: werte.kommunikationsmittel || null,
        erreichbarkeit: werte.erreichbarkeit?.trim() || null,
      };
      return aktuell ? aktualisiereAbschnitt(einsatzId, aktuell.id, daten) : legeAbschnittAn(einsatzId, daten);
    },
    onSuccess: (a) => { invalidate(); setGewaehlt(a.id); setBearbeiten(false); message.success('Gespeichert'); },
    onError: fehler,
  });
  const anlegen = useMutation({
    mutationFn: () => legeAbschnittAn(einsatzId, { name: 'Neuer Abschnitt' }),
    onSuccess: (a) => { invalidate(); setGewaehlt(a.id); setBearbeiten(true); },
    onError: fehler,
  });
  const aufloesen = useMutation({
    mutationFn: (aid: number) => loeseAbschnittAuf(einsatzId, aid),
    onSuccess: () => { invalidate(); setGewaehlt(null); setBearbeiten(false); },
    onError: fehler,
  });

  // Beim Wechsel des gewählten Abschnitts zurück in die Lese-Ansicht.
  useEffect(() => { setBearbeiten(false); }, [gewaehlt]);

  // Formular mit den Werten des aktuellen Abschnitts vorbelegen, sobald der Edit-Modus öffnet.
  useEffect(() => {
    if (aktuell && bearbeiten) {
      form.setFieldsValue({
        name: aktuell.name, ueber_abschnitt_id: aktuell.ueber_abschnitt_id ?? undefined,
        leiter_id: aktuell.leiter_id ?? undefined, bemerkung: aktuell.bemerkung ?? undefined,
        sprechgruppe_ids: aktuell.sprechgruppen?.map((s) => s.id) ?? [],
        kommunikationsmittel: aktuell.kommunikationsmittel ?? undefined,
        erreichbarkeit: aktuell.erreichbarkeit ?? undefined,
      });
    }
  }, [aktuell, bearbeiten, form]);

  const baumDaten = useMemo(() => baueBaum(abschnitte), [abschnitte]);
  const verboten = aktuell ? nachfahrenInkl(abschnitte, aktuell.id) : new Set<number>();
  const parentOptionen = abschnitte.filter((a) => !verboten.has(a.id)).map((a) => ({ value: a.id, title: a.name }));
  const personalOptionen = (personalQuery.data ?? []).map((p) => ({ value: p.id, label: p.name }));
  const zugeordneteEinheiten = (einheitenQuery.data ?? []).filter((e) => e.abschnitt_id === aktuell?.id);

  // Stärke des Abschnitts = Summe der kumulierten Ist-Stärke der direkt zugeordneten Einheiten.
  const abschnittStaerke: Staerke | null = zugeordneteEinheiten.length === 0
    ? null
    : zugeordneteEinheiten.reduce<Staerke>(
        (acc, e) => ({
          fuehrer: acc.fuehrer + (e.ist_kumuliert?.fuehrer ?? 0),
          unterfuehrer: acc.unterfuehrer + (e.ist_kumuliert?.unterfuehrer ?? 0),
          mannschaft: acc.mannschaft + (e.ist_kumuliert?.mannschaft ?? 0),
        }),
        { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
      );

  if (einsatzQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  const einheitenListe = (
    <>
      <Typography.Title level={5} style={{ marginTop: 16 }}>Zugeordnete Einheiten</Typography.Title>
      <Liste
        size="small"
        emptyText="Keine Einheiten zugeordnet"
        dataSource={zugeordneteEinheiten}
        renderItem={(e) => (
          <ListenEintrag>
            <Space>
              <span>{e.name}</span>
              {e.typ_label && <Tag>{e.typ_label}</Tag>}
              <Tag color="blue">kumuliert <StaerkeAnzeige wert={e.ist_kumuliert} /></Tag>
            </Space>
          </ListenEintrag>
        )}
      />
      <Typography.Text type="secondary">
        Die Abschnitts-Zuordnung einer Einheit wird auf der Einheiten-Seite gesetzt.
      </Typography.Text>
    </>
  );

  return (
    <div>
      <Breadcrumb style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Einsatzabschnitte' }]} />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>Einsatzabschnitte</Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
        {darfSchreiben && <Button type="primary" onClick={() => anlegen.mutate()}>Abschnitt anlegen</Button>}
      </Space>
      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert style={{ marginBottom: 12 }} type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
      )}

      <div style={{ display: 'flex', gap: 16 }}>
        <Card style={{ flex: '0 0 360px' }} size="small" title="Gliederung">
          {abschnitte.length === 0 ? (
            <Empty description="Noch keine Abschnitte" />
          ) : (
            <Tree treeData={baumDaten} selectedKeys={gewaehlt != null ? [gewaehlt] : []} defaultExpandAll
              onSelect={(keys) => setGewaehlt(keys.length ? Number(keys[0]) : null)} />
          )}
        </Card>

        <Card style={{ flex: 1 }} size="small" title={aktuell ? `Abschnitt: ${aktuell.name}` : 'Kein Abschnitt gewählt'}>
          {!aktuell ? (
            <Empty description="Wähle einen Abschnitt im Baum" />
          ) : bearbeiten ? (
            <Form<AbschnittWerte> form={form} layout="vertical" onFinish={(w) => speichern.mutate(w)}>
              <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
              <Form.Item label="Über-Abschnitt" name="ueber_abschnitt_id">
                <TreeSelect allowClear placeholder="Übergeordneter Abschnitt" treeData={parentOptionen} />
              </Form.Item>
              <Form.Item label="Abschnittsleiter" name="leiter_id">
                <Select allowClear placeholder="Disponierte Person" options={personalOptionen} />
              </Form.Item>

              <Typography.Title level={5} style={{ marginTop: 4 }}>Funk / Kommunikation</Typography.Title>
              <Form.Item label="Sprechgruppen" name="sprechgruppe_ids">
                <SprechgruppenPicker einsatzId={einsatzId} />
              </Form.Item>
              <Form.Item label="Kommunikationsmittel" name="kommunikationsmittel">
                <Select allowClear placeholder="Digitalfunk / Mobil / Festnetz" options={KOMMUNIKATIONSMITTEL_OPTIONEN} />
              </Form.Item>
              <Form.Item label="Erreichbarkeit / Nummer" name="erreichbarkeit">
                <Input placeholder="z. B. 0151 23456" allowClear />
              </Form.Item>

              <Form.Item label="Bemerkung" name="bemerkung"><Input.TextArea rows={2} /></Form.Item>
              <Space>
                <Button type="primary" htmlType="submit" loading={speichern.isPending}>Speichern</Button>
                <Button onClick={() => setBearbeiten(false)}>Abbrechen</Button>
                <Popconfirm title="Abschnitt auflösen?"
                  description={'Unter-Abschnitte rücken hoch, zugeordnete Einheiten werden „nicht zugeordnet“.'}
                  onConfirm={() => aufloesen.mutate(aktuell.id)}>
                  <Button danger>Auflösen</Button>
                </Popconfirm>
              </Space>
            </Form>
          ) : (
            <>
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="Abschnittsleiter">{aktuell.leiter_name ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="Funk / Erreichbarkeit">
                  <FunkErreichbarkeit
                    sprechgruppen={aktuell.sprechgruppen}
                    kommunikationsmittel={aktuell.kommunikationsmittel}
                    erreichbarkeit={aktuell.erreichbarkeit}
                    leerText="keine Funk-Angaben"
                  />
                </Descriptions.Item>
                <Descriptions.Item label="Stärke (F/UF/M//Σ)"><StaerkeAnzeige wert={abschnittStaerke} /></Descriptions.Item>
                {aktuell.bemerkung && <Descriptions.Item label="Bemerkung">{aktuell.bemerkung}</Descriptions.Item>}
              </Descriptions>

              {darfSchreiben && (
                <Space style={{ marginTop: 12 }}>
                  <Button type="primary" onClick={() => setBearbeiten(true)}>Bearbeiten</Button>
                  <Popconfirm title="Abschnitt auflösen?"
                    description={'Unter-Abschnitte rücken hoch, zugeordnete Einheiten werden „nicht zugeordnet“.'}
                    onConfirm={() => aufloesen.mutate(aktuell.id)}>
                    <Button danger>Auflösen</Button>
                  </Popconfirm>
                </Space>
              )}

              {einheitenListe}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
