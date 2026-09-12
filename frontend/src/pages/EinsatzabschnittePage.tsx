import {
  Alert,
  App,
  Breadcrumb,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Popconfirm,
  Space,
  Tag,
  Tree,
  TreeSelect,
  Typography,
  type TreeDataNode,
} from 'antd';
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
  aktualisiereAbschnitt,
  legeAbschnittAn,
  listeAbschnitte,
  loeseAbschnittAuf,
  type AbschnittEingabe,
} from '../api/einsatzabschnitte';
import { ApiError } from '../api/client';
import type { Einheit, Einsatzabschnitt } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import FunkErreichbarkeit, {
  KOMMUNIKATIONSMITTEL_OPTIONEN,
} from '../components/FunkErreichbarkeit';
import { Liste, ListenEintrag } from '../components/Liste';
import {
  SeitenFehler,
  SeitenLeer,
  SeitenSkeleton,
  SeitenStandVeraltet,
} from '../components/SeitenZustand';
import SprechgruppenPicker from '../components/SprechgruppenPicker';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import Datenstand, { gemeinsamerDatenstand } from '../components/Datenstand';
import { useViewport } from '../components/useViewport';
import { abschnittStaerken, nachfahrenInkl } from './einsatzabschnitte/abschnittStaerke';
import AbschnittKnoten from './einsatzabschnitte/AbschnittKnoten';

function baueBaum(abschnitte: Einsatzabschnitt[], einheiten: Einheit[]): TreeDataNode[] {
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
        <AbschnittKnoten
          abschnitt={a}
          staerke={abschnittStaerken(abschnitte, einheiten, a.id).inklUnter}
          anzahlEinheiten={einheiten.filter((e) => e.abschnitt_id === a.id).length}
        />
      ),
      children: baue(a.id),
    }));
  return baue(null);
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
  const [entwurf, setEntwurf] = useState(false);
  const [form] = Form.useForm<AbschnittWerte>();
  const { abBreite } = useViewport();
  const breit = abBreite('md');

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
  });
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });

  // Cross-Modul-Deeplink (LFH-25): ?abschnitt=<id> selektiert den Abschnitt, sofern vorhanden.
  // Spiegelt `Tree onSelect`: der Kopfknopf ist klickbar, bevor `abschnitteQuery` aufgelöst
  // ist, und ein danach feuernder Deeplink darf einen offenen Entwurf nicht überleben lassen
  // (LFH-347 · Fix-Runde 1) — sonst nimmt `speichern` wegen `!entwurf === false` fälschlich
  // den POST-Zweig für einen bereits ausgewählten Bestandsabschnitt.
  useQueryParamSelektion('abschnitt', abschnitteQuery.isSuccess, (zid) => {
    if ((abschnitteQuery.data ?? []).some((a) => a.id === zid)) {
      setEntwurf(false);
      setGewaehlt(zid);
    }
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.abschnitte(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

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
      return aktuell && !entwurf
        ? aktualisiereAbschnitt(einsatzId, aktuell.id, daten)
        : legeAbschnittAn(einsatzId, daten);
    },
    onSuccess: (a) => {
      invalidate();
      setEntwurf(false);
      setGewaehlt(a.id);
      setBearbeiten(false);
      message.success('Gespeichert');
    },
    onError: fehler,
  });
  const aufloesen = useMutation({
    mutationFn: (aid: number) => loeseAbschnittAuf(einsatzId, aid),
    onSuccess: () => {
      invalidate();
      setGewaehlt(null);
      setBearbeiten(false);
    },
    onError: fehler,
  });

  // Beim Wechsel des gewählten Abschnitts zurück in die Lese-Ansicht.
  useEffect(() => {
    setBearbeiten(false);
  }, [gewaehlt]);

  // Formular mit den Werten des aktuellen Abschnitts vorbelegen, sobald der Edit-Modus öffnet.
  useEffect(() => {
    if (aktuell && bearbeiten && !entwurf) {
      form.setFieldsValue({
        name: aktuell.name,
        ueber_abschnitt_id: aktuell.ueber_abschnitt_id ?? undefined,
        leiter_id: aktuell.leiter_id ?? undefined,
        bemerkung: aktuell.bemerkung ?? undefined,
        sprechgruppe_ids: aktuell.sprechgruppen?.map((s) => s.id) ?? [],
        kommunikationsmittel: aktuell.kommunikationsmittel ?? undefined,
        erreichbarkeit: aktuell.erreichbarkeit ?? undefined,
      });
    }
  }, [aktuell, bearbeiten, entwurf, form]);

  /** Lokaler Entwurf statt Server-Datensatz (LFH-347 · M55): der POST — und damit der
   *  ETB-Eintrag — entsteht erst beim Speichern. Abbrechen hinterlässt nichts. */
  function entwurfOeffnen() {
    setGewaehlt(null);
    setBearbeiten(false);
    form.resetFields();
    setEntwurf(true);
  }

  const baumDaten = useMemo(() => {
    const knoten = baueBaum(abschnitte, einheitenQuery.data ?? []);
    return entwurf
      ? [
          ...knoten,
          { key: 'entwurf', title: <i>Neuer Abschnitt (ungespeichert)</i>, selectable: false },
        ]
      : knoten;
  }, [abschnitte, einheitenQuery.data, entwurf]);
  const verboten = aktuell ? nachfahrenInkl(abschnitte, aktuell.id) : new Set<number>();
  const parentOptionen = abschnitte
    .filter((a) => !verboten.has(a.id))
    .map((a) => ({ value: a.id, title: a.name }));
  const personalOptionen = (personalQuery.data ?? []).map((p) => ({ value: p.id, label: p.name }));
  const zugeordneteEinheiten = (einheitenQuery.data ?? []).filter(
    (e) => e.abschnitt_id === aktuell?.id,
  );

  // ZWEI Werte, getrennt beschriftet (LFH-347 · H37): „eigene" ist die Bedeutung der
  // Bestandszeile und bleibt es; „inkl. Unterabschnitte" ist das, was der Einsatzleiter
  // im Fükw bisher im Kopf addieren musste.
  const staerken = aktuell
    ? abschnittStaerken(abschnitte, einheitenQuery.data ?? [], aktuell.id)
    : { eigene: null, inklUnter: null };

  // ZWEI EBENEN, getrennt gehalten (LFH-331 · B3, D3):
  //
  // SEITENZUSTAND — nur `einsatzQuery`. Ohne sie rendern weder Breadcrumb noch
  // `darfImEinsatzSchreiben(...)`, also gibt es hier nichts zu zeigen als Ladebild oder
  // Fehler. Nur diese Query rechtfertigt einen Frühausstieg.
  //
  // LISTENZUSTAND — `abschnitteQuery` und alles Weitere. Diese Queries entscheiden an der
  // Stelle, an der ihre Daten stehen (siehe Gliederungs-Karte unten), NIE als Frühausstieg:
  // sonst reißt ein gescheiterter Nebenabruf die ganze Seite weg, obwohl der Rest bedienbar
  // bliebe.
  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  /**
   * LISTENZUSTAND der Gliederungs-Karte — zwei Lagen, zwei Antworten (D3). Der Fehler
   * allein reicht als Bedingung NICHT.
   *
   * Ohne Abschnitte im Zwischenspeicher tritt der Fehler an die Stelle des Baums. MIT
   * Abschnitten bleibt der Baum stehen und bekommt ein Banner: er ist echt, nur womöglich
   * alt. Ein Fehler, der ihn wegräumt, nähme der Einsatzkraft die Gliederung, die sie eben
   * noch vor sich hatte — und mit ihr die Auswahl, über die die rechte Karte lebt. Genau
   * das Gegenteil dessen, wofür `SeitenStandVeraltet` gebaut ist.
   *
   * Gemessen an der UNGEFILTERTEN Menge (Muster aus `TierePage`/`SchaedenPage`).
   */
  const listeGescheitert = abschnitteQuery.isError && abschnitte.length === 0;
  const standVeraltet = abschnitteQuery.isError && abschnitte.length > 0;

  const einheitenListe = (
    <>
      <Typography.Title level={5} style={{ marginTop: 16 }}>
        Zugeordnete Einheiten
      </Typography.Title>
      <Liste
        size="small"
        emptyText="Keine Einheiten zugeordnet"
        dataSource={zugeordneteEinheiten}
        renderItem={(e) => (
          <ListenEintrag>
            <Space>
              <span>{e.name}</span>
              {e.typ_label && <Tag>{e.typ_label}</Tag>}
              <Tag color="blue">
                kumuliert <StaerkeAnzeige wert={e.ist_kumuliert} />
              </Tag>
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
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: 'Einsatzabschnitte' },
        ]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space orientation="vertical" size={0}>
          <Space>
            <Typography.Title level={3} style={{ margin: 0 }}>
              Einsatzabschnitte
            </Typography.Title>
            <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
          </Space>
          <Datenstand
            dataUpdatedAt={gemeinsamerDatenstand(
              abschnitteQuery.dataUpdatedAt,
              einheitenQuery.dataUpdatedAt,
              personalQuery.dataUpdatedAt,
            )}
          />
        </Space>
        {darfSchreiben && (
          <Button type="primary" onClick={entwurfOeffnen}>
            Abschnitt anlegen
          </Button>
        )}
      </Space>
      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert
          style={{ marginBottom: 12 }}
          type="info"
          showIcon
          title="Einsatz ist abgeschlossen — nur Ansicht."
        />
      )}

      {/* Unter `md` stapeln statt einer 360-px-Spalte neben dem Detail (LFH-341 · H40).
          Kein Collapse: `GefahrenPage` hat die Frage für den Geschwisterfall entschieden —
          eine zweite Bedienform für dieselbe Liste. Gestapelt trägt die Gliederung dieselbe
          Bedienung wie breit, nur untereinander. */}
      <div
        data-testid="abschnitte-rahmen"
        style={{
          display: 'flex',
          flexDirection: breit ? 'row' : 'column',
          gap: 16,
          alignItems: breit ? 'flex-start' : 'stretch',
        }}
      >
        <Card
          data-testid="abschnitte-gliederung"
          style={breit ? { flex: '0 0 360px' } : { width: '100%' }}
          size="small"
          title="Gliederung"
        >
          {/* Drei Zustände, in dieser Reihenfolge (LFH-331 · B3). Vorher stand hier eine
              einzige Weiche auf die Länge der Liste — die ist während des Ladens und im
              Fehlerfall genauso wahr wie bei einer wirklich leeren Gliederung. Die Seite
              behauptete damit „keine Abschnitte", wenn bloß die Verbindung abgerissen war.
              Solange geladen wird, wird über die Menge nichts behauptet.

              Der Fehlerzweig trägt zusätzlich die MENGENBEDINGUNG (`listeGescheitert`):
              er verdrängt den Baum nur, wenn es keinen gibt. Steht einer im
              Zwischenspeicher, bleibt er und bekommt das Veraltet-Banner (unten). */}
          {abschnitteQuery.isLoading ? (
            <SeitenSkeleton />
          ) : listeGescheitert ? (
            <SeitenFehler
              text="Abschnitte konnten nicht geladen werden"
              ursache={abschnitteQuery.error}
              onWiederholen={() => void abschnitteQuery.refetch()}
            />
          ) : abschnitte.length === 0 && !entwurf ? (
            <SeitenLeer
              titel="Noch keine Abschnitte"
              hinweis="Gliedere die Lage in Abschnitte, um Einheiten und Führung zuzuordnen."
              /* Derselbe Wortlaut wie der Kopfknopf: eine zweite Schreibweise für dieselbe
                 Geste wäre der Befund, den B3 behebt. Ohne Schreibrecht keine Aktion — ein
                 Knopf, der nur eine Fehlermeldung auslöst, ist kein Weg aus dem Leerzustand. */
              aktion={
                darfSchreiben ? { label: 'Abschnitt anlegen', onClick: entwurfOeffnen } : undefined
              }
            />
          ) : (
            <>
              {standVeraltet && (
                <SeitenStandVeraltet onWiederholen={() => void abschnitteQuery.refetch()} />
              )}
              <Tree
                treeData={baumDaten}
                selectedKeys={entwurf ? ['entwurf'] : gewaehlt != null ? [gewaehlt] : []}
                defaultExpandAll
                onSelect={(keys) => {
                  setEntwurf(false);
                  setGewaehlt(keys.length ? Number(keys[0]) : null);
                }}
              />
            </>
          )}
        </Card>

        <Card
          style={{ flex: 1 }}
          size="small"
          title={
            entwurf
              ? 'Neuer Abschnitt'
              : aktuell
                ? `Abschnitt: ${aktuell.name}`
                : 'Kein Abschnitt gewählt'
          }
        >
          {/* KEIN Leerzustand, sondern eine Aufforderung bei fehlender Auswahl: die Menge
              kann voll sein, es fehlt nur die Wahl. Deshalb ausdrücklich ohne Aktion — es
              gibt nichts zu beheben, nur etwas anzuklicken. */}
          {!aktuell && !entwurf ? (
            <SeitenLeer titel="Wähle einen Abschnitt im Baum" />
          ) : entwurf || bearbeiten ? (
            <Form<AbschnittWerte>
              form={form}
              layout="vertical"
              onFinish={(w) => speichern.mutate(w)}
            >
              <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true }]}>
                <Input autoFocus />
              </Form.Item>
              <Form.Item label="Über-Abschnitt" name="ueber_abschnitt_id">
                <TreeSelect
                  allowClear
                  placeholder="Übergeordneter Abschnitt"
                  treeData={parentOptionen}
                />
              </Form.Item>
              <Form.Item label="Abschnittsleiter" name="leiter_id">
                <Select allowClear placeholder="Disponierte Person" options={personalOptionen} />
              </Form.Item>

              <Typography.Title level={5} style={{ marginTop: 4 }}>
                Funk / Kommunikation
              </Typography.Title>
              <Form.Item label="Sprechgruppen" name="sprechgruppe_ids">
                <SprechgruppenPicker einsatzId={einsatzId} />
              </Form.Item>
              <Form.Item label="Kommunikationsmittel" name="kommunikationsmittel">
                <Select
                  allowClear
                  placeholder="Digitalfunk / Mobil / Festnetz"
                  options={KOMMUNIKATIONSMITTEL_OPTIONEN}
                />
              </Form.Item>
              <Form.Item label="Erreichbarkeit / Nummer" name="erreichbarkeit">
                <Input placeholder="z. B. 0151 23456" allowClear />
              </Form.Item>

              <Form.Item label="Bemerkung" name="bemerkung">
                <Input.TextArea rows={2} />
              </Form.Item>
              <Space size="middle">
                <Button type="primary" htmlType="submit" loading={speichern.isPending}>
                  Speichern
                </Button>
                <Button
                  onClick={() => {
                    setEntwurf(false);
                    setBearbeiten(false);
                  }}
                >
                  Abbrechen
                </Button>
                {!entwurf && aktuell && (
                  <Popconfirm
                    title="Abschnitt auflösen?"
                    description={
                      'Unter-Abschnitte rücken hoch, zugeordnete Einheiten werden „nicht zugeordnet“.'
                    }
                    okButtonProps={{ danger: true }}
                    onConfirm={() => aufloesen.mutate(aktuell.id)}
                  >
                    <Button danger>Auflösen</Button>
                  </Popconfirm>
                )}
              </Space>
            </Form>
          ) : aktuell ? (
            <>
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="Abschnittsleiter">
                  {aktuell.leiter_name ?? '—'}
                </Descriptions.Item>
                <Descriptions.Item label="Funk / Erreichbarkeit">
                  <FunkErreichbarkeit
                    sprechgruppen={aktuell.sprechgruppen}
                    kommunikationsmittel={aktuell.kommunikationsmittel}
                    erreichbarkeit={aktuell.erreichbarkeit}
                    leerText="keine Funk-Angaben"
                  />
                </Descriptions.Item>
                <Descriptions.Item label="Stärke (F/UF/M//Σ)">
                  <StaerkeAnzeige wert={staerken.eigene} />
                </Descriptions.Item>
                <Descriptions.Item label="Stärke inkl. Unterabschnitte (F/UF/M//Σ)">
                  <StaerkeAnzeige wert={staerken.inklUnter} />
                </Descriptions.Item>
                {aktuell.bemerkung && (
                  <Descriptions.Item label="Bemerkung">{aktuell.bemerkung}</Descriptions.Item>
                )}
              </Descriptions>

              {darfSchreiben && (
                <Space size="middle" style={{ marginTop: 12 }}>
                  <Button type="primary" onClick={() => setBearbeiten(true)}>
                    Bearbeiten
                  </Button>
                  <Popconfirm
                    title="Abschnitt auflösen?"
                    description={
                      'Unter-Abschnitte rücken hoch, zugeordnete Einheiten werden „nicht zugeordnet“.'
                    }
                    okButtonProps={{ danger: true }}
                    onConfirm={() => aufloesen.mutate(aktuell.id)}
                  >
                    <Button danger>Auflösen</Button>
                  </Popconfirm>
                </Space>
              )}

              {einheitenListe}
            </>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
