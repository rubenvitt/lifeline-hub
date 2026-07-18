import { Alert, App, Breadcrumb, Button, Card, Empty, Form, Input, Popconfirm, Space, Spin, Tag, Tree, TreeSelect, Typography, type TreeDataNode } from 'antd';
import { Select } from '../components/Select';
import { Link, useParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { listeEinheitTypen } from '../api/einheitTypen';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { gibMaterialFrei, listeEinsatzMaterial, ordneMaterialZu } from '../api/einsatzMaterial';
import {
  aktualisiereEinheit, bildeEinheit, gibFahrzeugFrei, gibPersonalFrei, listeEinheiten,
  loeseEinheitAuf, ordneFahrzeugZu, ordnePersonalZu, type EinheitEingabe,
} from '../api/einheiten';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import type { Einheit, Staerke } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import StaerkeEingabe from '../anzeige/StaerkeEingabe';
import SprechgruppenPicker from '../components/SprechgruppenPicker';
import FunkErreichbarkeit, { KOMMUNIKATIONSMITTEL_OPTIONEN } from '../components/FunkErreichbarkeit';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';

/** Baut antd-Tree-Daten aus der flachen Einheitenliste (nach ueber_einheit_id). */
function baueBaum(einheiten: Einheit[]): TreeDataNode[] {
  const kinder = new Map<number | null, Einheit[]>();
  for (const e of einheiten) {
    const key = e.ueber_einheit_id ?? null;
    if (!kinder.has(key)) kinder.set(key, []);
    kinder.get(key)!.push(e);
  }
  const baue = (parent: number | null): TreeDataNode[] =>
    (kinder.get(parent) ?? []).map((e) => ({
      key: e.id,
      title: (
        <Space size={4}>
          <span>{e.name}</span>
          {e.typ_label && <Tag>{e.typ_label}</Tag>}
          <Tag color="blue"><StaerkeAnzeige wert={e.ist} />{e.soll ? <> / Soll <StaerkeAnzeige wert={e.soll} /></> : null}</Tag>
          {e.fuehrer_name && <span style={{ color: '#888' }}>👤 {e.fuehrer_name}</span>}
        </Space>
      ),
      children: baue(e.id),
    }));
  return baue(null);
}

/** Menge der Nachfahren-IDs (inkl. self) — für die zyklenfreie Parent-Auswahl. */
function nachfahrenInkl(einheiten: Einheit[], id: number): Set<number> {
  const kinder = new Map<number, number[]>();
  for (const e of einheiten) {
    if (e.ueber_einheit_id != null) {
      if (!kinder.has(e.ueber_einheit_id)) kinder.set(e.ueber_einheit_id, []);
      kinder.get(e.ueber_einheit_id)!.push(e.id);
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

interface KopfWerte {
  name: string;
  typ_id?: number | null;
  abschnitt_id?: number | null;
  ueber_einheit_id?: number | null;
  soll?: Staerke | null;
  bemerkung?: string;
  sprechgruppe_ids?: number[];
  kommunikationsmittel?: string;
  erreichbarkeit?: string;
}

export default function EinheitenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [gewaehlt, setGewaehlt] = useState<number | null>(null);
  const [form] = Form.useForm<KopfWerte>();

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const einheitenQuery = useQuery({ queryKey: einsatzKeys.einheiten(einsatzId), queryFn: () => listeEinheiten(einsatzId) });
  const typenQuery = useQuery({ queryKey: ['einheit-typen'], queryFn: listeEinheitTypen });
  const abschnitteQuery = useQuery({ queryKey: einsatzKeys.abschnitte(einsatzId), queryFn: () => listeAbschnitte(einsatzId) });
  const personalQuery = useQuery({ queryKey: einsatzKeys.personal(einsatzId), queryFn: () => listeEinsatzPersonal(einsatzId) });
  const fahrzeugeQuery = useQuery({ queryKey: einsatzKeys.fahrzeuge(einsatzId), queryFn: () => listeEinsatzFahrzeuge(einsatzId) });
  const materialQuery = useQuery({ queryKey: einsatzKeys.material(einsatzId), queryFn: () => listeEinsatzMaterial(einsatzId) });

  // Cross-Modul-Deeplink (LFH-25): ?einheit=<id> selektiert die Einheit, sofern vorhanden.
  useQueryParamSelektion('einheit', einheitenQuery.isSuccess, (id) => {
    if ((einheitenQuery.data ?? []).some((e) => e.id === id)) setGewaehlt(id);
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.personal(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.fahrzeuge(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.material(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const einheiten = useMemo(() => einheitenQuery.data ?? [], [einheitenQuery.data]);
  const aktuell = einheiten.find((e) => e.id === gewaehlt) ?? null;

  const speichern = useMutation({
    mutationFn: (werte: KopfWerte) => {
      const daten: EinheitEingabe = {
        name: werte.name.trim(),
        typ_id: werte.typ_id ?? null,
        abschnitt_id: werte.abschnitt_id ?? null,
        ueber_einheit_id: werte.ueber_einheit_id ?? null,
        fuehrer_id: aktuell?.fuehrer_id ?? null, // Führer unverändert (authoritativ)
        soll_fuehrer: werte.soll?.fuehrer ?? null,
        soll_unterfuehrer: werte.soll?.unterfuehrer ?? null,
        soll_mannschaft: werte.soll?.mannschaft ?? null,
        bemerkung: werte.bemerkung?.trim() || null,
        sprechgruppe_ids: werte.sprechgruppe_ids ?? [],
        kommunikationsmittel: werte.kommunikationsmittel || null,
        erreichbarkeit: werte.erreichbarkeit?.trim() || null,
      };
      return aktuell ? aktualisiereEinheit(einsatzId, aktuell.id, daten) : bildeEinheit(einsatzId, daten);
    },
    onSuccess: (e) => { invalidate(); setGewaehlt(e.id); message.success('Gespeichert'); },
    onError: fehler,
  });

  const bilden = useMutation({
    mutationFn: () => bildeEinheit(einsatzId, { name: 'Neue Einheit' }),
    onSuccess: (e) => { invalidate(); setGewaehlt(e.id); },
    onError: fehler,
  });
  const aufloesen = useMutation({
    mutationFn: (eid: number) => loeseEinheitAuf(einsatzId, eid),
    onSuccess: () => { invalidate(); setGewaehlt(null); },
    onError: fehler,
  });
  const personalZu = useMutation({
    mutationFn: (epId: number) => ordnePersonalZu(einsatzId, aktuell!.id, epId),
    onSuccess: invalidate, onError: fehler,
  });
  const personalFrei = useMutation({
    mutationFn: (epId: number) => gibPersonalFrei(einsatzId, aktuell!.id, epId),
    onSuccess: invalidate, onError: fehler,
  });
  const fahrzeugZu = useMutation({
    mutationFn: (efId: number) => ordneFahrzeugZu(einsatzId, aktuell!.id, efId),
    onSuccess: invalidate, onError: fehler,
  });
  const fahrzeugFrei = useMutation({
    mutationFn: (efId: number) => gibFahrzeugFrei(einsatzId, aktuell!.id, efId),
    onSuccess: invalidate, onError: fehler,
  });
  const materialZu = useMutation({
    mutationFn: (emId: number) => ordneMaterialZu(einsatzId, aktuell!.id, emId),
    onSuccess: invalidate, onError: fehler,
  });
  const materialFrei = useMutation({
    mutationFn: (emId: number) => gibMaterialFrei(einsatzId, aktuell!.id, emId),
    onSuccess: invalidate, onError: fehler,
  });
  const fuehrerSetzen = useMutation({
    // Baut den PATCH-Body bewusst aus dem Server-Stand (`aktuell`), nicht aus dem
    // Formular: ungespeicherte Kopf-Edits werden NICHT mitgesendet (Vollersatz-Vertrag).
    // Führer-Markieren ist eine eigenständige Aktion; zuerst Kopfdaten „Speichern".
    mutationFn: (epId: number | null) => {
      const e = aktuell!;
      return aktualisiereEinheit(einsatzId, e.id, {
        name: e.name, typ_id: e.typ_id, abschnitt_id: e.abschnitt_id, ueber_einheit_id: e.ueber_einheit_id,
        fuehrer_id: epId, soll_fuehrer: e.soll?.fuehrer ?? null, soll_unterfuehrer: e.soll?.unterfuehrer ?? null,
        soll_mannschaft: e.soll?.mannschaft ?? null, bemerkung: e.bemerkung,
      });
    },
    onSuccess: invalidate, onError: fehler,
  });

  // Formular bei Auswahlwechsel mit den Kopfdaten der Einheit füllen.
  useEffect(() => {
    if (aktuell) {
      form.setFieldsValue({
        name: aktuell.name, typ_id: aktuell.typ_id ?? undefined, abschnitt_id: aktuell.abschnitt_id ?? undefined,
        ueber_einheit_id: aktuell.ueber_einheit_id ?? undefined, soll: aktuell.soll,
        bemerkung: aktuell.bemerkung ?? undefined,
        sprechgruppe_ids: aktuell.sprechgruppen?.map((s) => s.id) ?? [],
        kommunikationsmittel: aktuell.kommunikationsmittel ?? undefined,
        erreichbarkeit: aktuell.erreichbarkeit ?? undefined,
      });
    }
  }, [aktuell, form]);

  const baumDaten = useMemo(() => baueBaum(einheiten), [einheiten]);
  const verbotenAlsParent = aktuell ? nachfahrenInkl(einheiten, aktuell.id) : new Set<number>();
  const parentOptionen = einheiten
    .filter((e) => !verbotenAlsParent.has(e.id))
    .map((e) => ({ value: e.id, title: e.name }));
  const abschnittOptionen = (abschnitteQuery.data ?? []).map((a) => ({ value: a.id, title: a.name }));

  // Frei-Pool: disponierte Kräfte ohne Einheit.
  const freiesPersonal = (personalQuery.data ?? []).filter((p) => p.einheit_id == null);
  const freieFahrzeuge = (fahrzeugeQuery.data ?? []).filter((f) => f.einheit_id == null);
  const freiesMaterial = (materialQuery.data ?? []).filter((m) => m.einheit_id == null);

  if (einsatzQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  return (
    <div>
      <Breadcrumb style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Einheiten' }]} />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>Einheiten</Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
        {darfSchreiben && <Button type="primary" onClick={() => bilden.mutate()}>Einheit bilden</Button>}
      </Space>
      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert style={{ marginBottom: 12 }} type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
      )}

      <div style={{ display: 'flex', gap: 16 }}>
        <Card style={{ flex: '0 0 360px' }} size="small" title="Gliederung">
          {einheiten.length === 0 ? (
            <Empty description="Noch keine Einheiten" />
          ) : (
            <Tree
              treeData={baumDaten}
              selectedKeys={gewaehlt != null ? [gewaehlt] : []}
              defaultExpandAll
              onSelect={(keys) => setGewaehlt(keys.length ? Number(keys[0]) : null)}
            />
          )}
        </Card>

        <Card style={{ flex: 1 }} size="small" title={aktuell ? `Einheit: ${aktuell.name}` : 'Keine Einheit gewählt'}>
          {!aktuell ? (
            <Empty description="Wähle eine Einheit im Baum" />
          ) : (
            <Form<KopfWerte> form={form} layout="vertical" disabled={!darfSchreiben} onFinish={(w) => speichern.mutate(w)}>
              <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
              <Form.Item label="Typ" name="typ_id">
                <Select allowClear placeholder="Typ wählen"
                  options={(typenQuery.data ?? []).map((t) => ({ value: t.id, label: t.label }))} />
              </Form.Item>
              <Form.Item label="Abschnitt" name="abschnitt_id">
                <TreeSelect allowClear placeholder="Abschnitt zuordnen" treeData={abschnittOptionen} />
              </Form.Item>
              <Form.Item label="Über-Einheit" name="ueber_einheit_id">
                <TreeSelect allowClear placeholder="Unterstellung" treeData={parentOptionen} />
              </Form.Item>
              <Form.Item label="Soll-Override (vollständig oder leer)">
                <Space align="end" wrap>
                  <Form.Item name="soll" noStyle><StaerkeEingabe /></Form.Item>
                  <span style={{ color: '#888' }}>
                    Ist: <StaerkeAnzeige wert={aktuell.ist} /> · kumuliert: <StaerkeAnzeige wert={aktuell.ist_kumuliert} />
                  </span>
                </Space>
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
              {darfSchreiben && (
                <Space>
                  <Button type="primary" htmlType="submit" loading={speichern.isPending}>Speichern</Button>
                  <Popconfirm
                    title="Einheit auflösen?"
                    description="Mitglieder werden frei, Unter-Einheiten rücken eine Ebene hoch."
                    onConfirm={() => aufloesen.mutate(aktuell.id)}
                  >
                    <Button danger>Auflösen</Button>
                  </Popconfirm>
                </Space>
              )}

              <div style={{ marginTop: 8 }}>
                <FunkErreichbarkeit
                  sprechgruppen={aktuell.sprechgruppen}
                  kommunikationsmittel={aktuell.kommunikationsmittel}
                  erreichbarkeit={aktuell.erreichbarkeit}
                />
              </div>

              <Typography.Title level={5} style={{ marginTop: 16 }}>Personal</Typography.Title>
              {aktuell.personal_mitglieder.map((m) => (
                <Space key={m.ep_id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{m.name}{m.staerke_position ? ` (${m.staerke_position})` : ''}{m.ist_fuehrer && <Tag color="gold" style={{ marginLeft: 4 }}>Einheitsführer</Tag>}</span>
                  {darfSchreiben && (
                    <Space>
                      {!m.ist_fuehrer && <Button size="small" onClick={() => fuehrerSetzen.mutate(m.ep_id)}>Als Einheitsführer</Button>}
                      <Button size="small" danger onClick={() => personalFrei.mutate(m.ep_id)}>Entfernen</Button>
                    </Space>
                  )}
                </Space>
              ))}
              {darfSchreiben && (
                <Select style={{ width: '100%', marginTop: 8 }} placeholder="Person zuordnen …" value={null}
                  notFoundContent="Keine freien Personen"
                  options={freiesPersonal.map((p) => ({ value: p.id, label: p.name }))}
                  onSelect={(epId) => personalZu.mutate(Number(epId))} />
              )}

              <Typography.Title level={5} style={{ marginTop: 16 }}>Fahrzeuge</Typography.Title>
              {aktuell.fahrzeug_mitglieder.map((m) => (
                <Space key={m.ef_id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{m.funkrufname}{m.fahrzeugtyp ? ` (${m.fahrzeugtyp})` : ''}</span>
                  {darfSchreiben && <Button size="small" danger onClick={() => fahrzeugFrei.mutate(m.ef_id)}>Entfernen</Button>}
                </Space>
              ))}
              {darfSchreiben && (
                <Select style={{ width: '100%', marginTop: 8 }} placeholder="Fahrzeug zuordnen …" value={null}
                  notFoundContent="Keine freien Fahrzeuge"
                  options={freieFahrzeuge.map((f) => ({ value: f.id, label: f.funkrufname }))}
                  onSelect={(efId) => fahrzeugZu.mutate(Number(efId))} />
              )}

              <Typography.Title level={5} style={{ marginTop: 16 }}>Material</Typography.Title>
              {aktuell.material_mitglieder.map((m) => (
                <Space key={m.em_id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{m.bezeichnung} ×{m.menge}</span>
                  {darfSchreiben && <Button size="small" danger onClick={() => materialFrei.mutate(m.em_id)}>Entfernen</Button>}
                </Space>
              ))}
              {darfSchreiben && (
                <Select style={{ width: '100%', marginTop: 8 }} placeholder="Material zuordnen …" value={null}
                  notFoundContent="Kein freies Material"
                  options={freiesMaterial.map((m) => ({ value: m.id, label: `${m.bezeichnung} ×${m.menge}` }))}
                  onSelect={(emId) => materialZu.mutate(Number(emId))} />
              )}
            </Form>
          )}
        </Card>
      </div>
    </div>
  );
}
