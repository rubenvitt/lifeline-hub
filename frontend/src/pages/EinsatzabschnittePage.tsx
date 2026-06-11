import {
  Alert, App, Breadcrumb, Button, Card, Empty, Form, Input, List, Popconfirm, Select, Space, Spin,
  Tag, Tree, TreeSelect, Typography, type TreeDataNode,
} from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinheiten } from '../api/einheiten';
import {
  aktualisiereAbschnitt, legeAbschnittAn, listeAbschnitte, loeseAbschnittAuf, type AbschnittEingabe,
} from '../api/einsatzabschnitte';
import { ApiError } from '../api/client';
import type { Einsatzabschnitt, Staerke } from '../api/types';

function staerkeText(s: Staerke): string {
  return `${s.fuehrer}/${s.unterfuehrer}/${s.mannschaft}/${s.fuehrer + s.unterfuehrer + s.mannschaft}`;
}

const KOMMUNIKATIONSMITTEL_LABEL: Record<string, string> = {
  digitalfunk: 'Digitalfunk',
  mobil: 'Mobil',
  festnetz: 'Festnetz',
};

function baueBaum(abschnitte: Einsatzabschnitt[]): TreeDataNode[] {
  const kinder = new Map<number | null, Einsatzabschnitt[]>();
  for (const a of abschnitte) {
    const key = a.ueber_abschnitt_id;
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
  sprechgruppe_tmo?: string;
  sprechgruppe_dmo?: string;
  kommunikationsmittel?: string;
  erreichbarkeit?: string;
}

export default function EinsatzabschnittePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [gewaehlt, setGewaehlt] = useState<number | null>(null);
  const [form] = Form.useForm<AbschnittWerte>();

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const abschnitteQuery = useQuery({ queryKey: ['abschnitte', einsatzId], queryFn: () => listeAbschnitte(einsatzId) });
  const personalQuery = useQuery({ queryKey: ['einsatz-personal', einsatzId], queryFn: () => listeEinsatzPersonal(einsatzId) });
  const einheitenQuery = useQuery({ queryKey: ['einheiten', einsatzId], queryFn: () => listeEinheiten(einsatzId) });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['abschnitte', einsatzId] });
    qc.invalidateQueries({ queryKey: ['einheiten', einsatzId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const abschnitte = abschnitteQuery.data ?? [];
  const aktuell = abschnitte.find((a) => a.id === gewaehlt) ?? null;

  const speichern = useMutation({
    mutationFn: (werte: AbschnittWerte) => {
      const daten: AbschnittEingabe = {
        name: werte.name.trim(),
        ueber_abschnitt_id: werte.ueber_abschnitt_id ?? null,
        leiter_id: werte.leiter_id ?? null,
        bemerkung: werte.bemerkung?.trim() || null,
        sprechgruppe_tmo: werte.sprechgruppe_tmo?.trim() || null,
        sprechgruppe_dmo: werte.sprechgruppe_dmo?.trim() || null,
        kommunikationsmittel: werte.kommunikationsmittel || null,
        erreichbarkeit: werte.erreichbarkeit?.trim() || null,
      };
      return aktuell ? aktualisiereAbschnitt(einsatzId, aktuell.id, daten) : legeAbschnittAn(einsatzId, daten);
    },
    onSuccess: (a) => { invalidate(); setGewaehlt(a.id); message.success('Gespeichert'); },
    onError: fehler,
  });
  const anlegen = useMutation({
    mutationFn: () => legeAbschnittAn(einsatzId, { name: 'Neuer Abschnitt' }),
    onSuccess: (a) => { invalidate(); setGewaehlt(a.id); },
    onError: fehler,
  });
  const aufloesen = useMutation({
    mutationFn: (aid: number) => loeseAbschnittAuf(einsatzId, aid),
    onSuccess: () => { invalidate(); setGewaehlt(null); },
    onError: fehler,
  });

  useEffect(() => {
    if (aktuell) {
      form.setFieldsValue({
        name: aktuell.name, ueber_abschnitt_id: aktuell.ueber_abschnitt_id ?? undefined,
        leiter_id: aktuell.leiter_id ?? undefined, bemerkung: aktuell.bemerkung ?? undefined,
        sprechgruppe_tmo: aktuell.sprechgruppe_tmo ?? undefined,
        sprechgruppe_dmo: aktuell.sprechgruppe_dmo ?? undefined,
        kommunikationsmittel: aktuell.kommunikationsmittel ?? undefined,
        erreichbarkeit: aktuell.erreichbarkeit ?? undefined,
      });
    }
  }, [aktuell, form]);

  const baumDaten = useMemo(() => baueBaum(abschnitte), [abschnitte]);
  const verboten = aktuell ? nachfahrenInkl(abschnitte, aktuell.id) : new Set<number>();
  const parentOptionen = abschnitte.filter((a) => !verboten.has(a.id)).map((a) => ({ value: a.id, title: a.name }));
  const personalOptionen = (personalQuery.data ?? []).map((p) => ({ value: p.id, label: p.name }));
  const zugeordneteEinheiten = (einheitenQuery.data ?? []).filter((e) => e.abschnitt_id === aktuell?.id);

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
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message="Einsatz ist abgeschlossen — nur Ansicht." />
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
          ) : (
            <>
              <Form<AbschnittWerte> form={form} layout="vertical" disabled={!darfSchreiben} onFinish={(w) => speichern.mutate(w)}>
                <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
                <Form.Item label="Über-Abschnitt" name="ueber_abschnitt_id">
                  <TreeSelect allowClear placeholder="Übergeordneter Abschnitt" treeData={parentOptionen} />
                </Form.Item>
                <Form.Item label="Abschnittsleiter" name="leiter_id">
                  <Select allowClear showSearch optionFilterProp="label" placeholder="Disponierte Person" options={personalOptionen} />
                </Form.Item>
                <Form.Item label="Sprechgruppe TMO" name="sprechgruppe_tmo">
                  <Input placeholder="z. B. 412_F_DRK" allowClear />
                </Form.Item>
                <Form.Item label="Sprechgruppe DMO" name="sprechgruppe_dmo">
                  <Input placeholder="z. B. DMO 31" allowClear />
                </Form.Item>
                <Form.Item label="Kommunikationsmittel" name="kommunikationsmittel">
                  <Select
                    allowClear
                    placeholder="Digitalfunk / Mobil / Festnetz"
                    options={Object.entries(KOMMUNIKATIONSMITTEL_LABEL).map(([value, label]) => ({ value, label }))}
                  />
                </Form.Item>
                <Form.Item label="Erreichbarkeit / Nummer" name="erreichbarkeit">
                  <Input placeholder="z. B. 0151 23456" allowClear />
                </Form.Item>
                <Form.Item label="Bemerkung" name="bemerkung"><Input.TextArea rows={2} /></Form.Item>
                {darfSchreiben && (
                  <Space>
                    <Button type="primary" htmlType="submit" loading={speichern.isPending}>Speichern</Button>
                    <Popconfirm title="Abschnitt auflösen?"
                      description={'Unter-Abschnitte rücken hoch, zugeordnete Einheiten werden „nicht zugeordnet“.'}
                      onConfirm={() => aufloesen.mutate(aktuell.id)}>
                      <Button danger>Auflösen</Button>
                    </Popconfirm>
                  </Space>
                )}
              </Form>

              {(aktuell.sprechgruppe_tmo || aktuell.sprechgruppe_dmo
                || aktuell.kommunikationsmittel || aktuell.erreichbarkeit) && (
                <div data-testid="funk-erreichbarkeit" style={{ marginTop: 8 }}>
                  <Space size={[4, 4]} wrap>
                    {aktuell.sprechgruppe_tmo && <Tag color="blue">TMO: {aktuell.sprechgruppe_tmo}</Tag>}
                    {aktuell.sprechgruppe_dmo && <Tag color="geekblue">DMO: {aktuell.sprechgruppe_dmo}</Tag>}
                    {aktuell.kommunikationsmittel && (
                      <Tag>{KOMMUNIKATIONSMITTEL_LABEL[aktuell.kommunikationsmittel] ?? aktuell.kommunikationsmittel}</Tag>
                    )}
                    {aktuell.erreichbarkeit && <Tag>☎ {aktuell.erreichbarkeit}</Tag>}
                  </Space>
                </div>
              )}

              <Typography.Title level={5} style={{ marginTop: 16 }}>Zugeordnete Einheiten</Typography.Title>
              <List
                size="small"
                locale={{ emptyText: 'Keine Einheiten zugeordnet' }}
                dataSource={zugeordneteEinheiten}
                renderItem={(e) => (
                  <List.Item>
                    <Space>
                      <span>{e.name}</span>
                      {e.typ_label && <Tag>{e.typ_label}</Tag>}
                      <Tag color="blue">kumuliert {staerkeText(e.ist_kumuliert)}</Tag>
                    </Space>
                  </List.Item>
                )}
              />
              <Typography.Text type="secondary">
                Die Abschnitts-Zuordnung einer Einheit wird auf der Einheiten-Seite gesetzt.
              </Typography.Text>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
