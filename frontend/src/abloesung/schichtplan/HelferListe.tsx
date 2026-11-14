import { Button, Form, Input, Modal, Space, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  SCHICHTPLAN_HELFER_QUALIFIKATIONEN_MAX,
  SCHICHTPLAN_HELFER_TELEFON_MAX,
  SCHICHTPLAN_HELFER_TEXT_MAX,
} from '../../api/eingabegrenzen';
import { listeQualifikationen } from '../../api/qualifikationen';
import { globalKeys } from '../../api/queryKeys';
import type {
  SchichtplanHelfer,
  SchichtplanHelferAendernBody,
  SchichtplanHelferBody,
} from '../../api/types';
import { ErfassungsModal, type Speicherung } from '../../components/Erfassung';
import { Datenfeld, Datenraster, monoStil, useRollen } from '../../components/instrument';
import { MODUL_PERSONAL_GESPERRT } from '../../components/nurAnsicht';
import KatalogTabelle, { type KatalogSpalte } from '../../components/KatalogTabelle';
import { nachText, werteAus } from '../../components/katalogVergleich';
import { Select } from '../../components/Select';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { teilwortSuche } from '../../components/teilwortSuche';

interface HelferWerte {
  name: string;
  organisation?: string;
  telefon?: string;
  qualifikationen?: number[];
}

type HelferSpeichern =
  | { art: 'anlegen'; body: SchichtplanHelferBody }
  | { art: 'aendern'; helferId: number; body: SchichtplanHelferAendernBody };

const leer = (s: string | undefined) => s?.trim() || null;

/** Nur Geändertes; ein geleertes Feld ist `null`. */
export function helferAenderung(
  h: SchichtplanHelfer,
  w: HelferWerte,
): SchichtplanHelferAendernBody {
  const body: SchichtplanHelferAendernBody = {};
  const name = w.name.trim();
  if (name !== h.name) body.name = name;
  if (leer(w.organisation) !== (h.organisation ?? null)) body.organisation = leer(w.organisation);
  if (leer(w.telefon) !== (h.telefon ?? null)) body.telefon = leer(w.telefon);
  const quali = w.qualifikationen ?? [];
  if (quali.join(',') !== h.qualifikationen.join(',')) body.qualifikationen = quali;
  return body;
}

function HelferDialog({
  helfer,
  laeuft,
  speicherung,
  onSpeichern,
  onSchliessen,
}: {
  helfer: SchichtplanHelfer | null;
  laeuft: boolean;
  speicherung: Speicherung;
  onSpeichern: (s: HelferSpeichern) => Promise<unknown>;
  onSchliessen: () => void;
}) {
  const [form] = Form.useForm<HelferWerte>();
  const { token } = useRollen();
  const qualiQuery = useQuery({
    queryKey: globalKeys.qualifikationen(),
    queryFn: listeQualifikationen,
  });
  const anfang: HelferWerte = helfer
    ? {
        name: helfer.name,
        organisation: helfer.organisation ?? '',
        telefon: helfer.telefon ?? '',
        qualifikationen: helfer.qualifikationen,
      }
    : { name: '', qualifikationen: [] };

  const speichern = (w: HelferWerte) => {
    if (!helfer) {
      const body: SchichtplanHelferBody = { name: w.name.trim() };
      const organisation = leer(w.organisation);
      if (organisation) body.organisation = organisation;
      const telefon = leer(w.telefon);
      if (telefon) body.telefon = telefon;
      if (w.qualifikationen?.length) body.qualifikationen = w.qualifikationen;
      return onSpeichern({ art: 'anlegen', body });
    }
    const body = helferAenderung(helfer, w);
    if (Object.keys(body).length === 0) return Promise.resolve();
    return onSpeichern({ art: 'aendern', helferId: helfer.id, body });
  };

  return (
    <ErfassungsModal<HelferWerte>
      offen
      titel={helfer ? `Helfer ${helfer.name}` : 'Helfer anlegen'}
      form={form}
      initialValues={anfang}
      erfassenText={helfer ? 'Speichern' : 'Helfer anlegen'}
      laeuft={laeuft}
      speicherung={speicherung}
      speicherFehlerTitel={helfer ? 'Helfer nicht gespeichert' : 'Helfer nicht angelegt'}
      serie={helfer == null}
      uebernahme={['organisation']}
      onErfassen={speichern}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {/* Kennung und Herkunft (Einlesen, Übernahme aus einer Planung) nur lesend, ohne Eingabe. */}
      {helfer && (helfer.kennung || helfer.herkunft) && (
        <Datenraster spalten={2} style={{ marginBottom: token.margin }}>
          {helfer.kennung && (
            <Datenfeld label="Kennung" mono>
              {helfer.kennung}
            </Datenfeld>
          )}
          {helfer.herkunft && <Datenfeld label="Herkunft">{helfer.herkunft}</Datenfeld>}
        </Datenraster>
      )}
      <Form.Item<HelferWerte>
        label="Name"
        name="name"
        rules={[{ required: true, whitespace: true, message: 'Name darf nicht leer sein' }]}
      >
        <Input maxLength={SCHICHTPLAN_HELFER_TEXT_MAX} />
      </Form.Item>
      <Form.Item<HelferWerte> label="Organisation" name="organisation">
        <Input placeholder="z. B. DLRG" maxLength={SCHICHTPLAN_HELFER_TEXT_MAX} />
      </Form.Item>
      <Form.Item<HelferWerte> label="Telefon" name="telefon">
        <Input maxLength={SCHICHTPLAN_HELFER_TELEFON_MAX} inputMode="tel" />
      </Form.Item>
      <Form.Item<HelferWerte>
        label="Qualifikationen"
        name="qualifikationen"
        rules={[
          {
            type: 'array',
            max: SCHICHTPLAN_HELFER_QUALIFIKATIONEN_MAX,
            message: `Höchstens ${SCHICHTPLAN_HELFER_QUALIFIKATIONEN_MAX}`,
          },
        ]}
      >
        <Select<number[]>
          mode="multiple"
          aria-label="Qualifikationen"
          placeholder="keine"
          showSearch={teilwortSuche}
          loading={qualiQuery.isLoading}
          options={(qualiQuery.data ?? []).map((q) => ({ value: q.id, label: q.label }))}
        />
      </Form.Item>
    </ErfassungsModal>
  );
}

/** Schreibwege der Helfer eines Plans; jede Antwort ist der Helfer, nicht der ganze Plan. */
export interface HelferListeApi {
  create: (body: SchichtplanHelferBody) => Promise<SchichtplanHelfer>;
  update: (helferId: number, body: SchichtplanHelferAendernBody) => Promise<SchichtplanHelfer>;
  delete: (helferId: number) => Promise<unknown>;
}

/** Übernahme in den Cache des Plans nach einem Schreibweg. */
export interface HelferListeCache {
  /** Setzt den gespeicherten Helfer sofort in den Plan (optional). */
  set?: (helfer: SchichtplanHelfer) => void;
  /** Lädt den Plan neu; das Speichern wartet darauf. */
  invalidate: () => Promise<unknown>;
}

interface HelferListeProps {
  /** Die Helfer des Plans; `null` ohne Freigabe des Moduls Personal (Sperrhinweis statt Liste). */
  helfer: readonly SchichtplanHelfer[] | null;
  /** Blöcke des Plans: die Rückfrage beim Löschen nennt, aus wie vielen der Helfer fällt. */
  bloecke: readonly { personen: readonly { helfer_id?: number | null }[] }[];
  /** Nur lesen: ohne Anlegen und Aktionen. */
  readOnly?: boolean;
  /** Grund der Sperre, wenn `helfer` `null` ist. Vorgabe: Modul Personal gesperrt. */
  gesperrt?: string;
  api: HelferListeApi;
  cache: HelferListeCache;
  /** `data-lfh` der Wurzel, je Plan („planung-helfer“, „schichtplan-helfer“). */
  dataLfh: string;
}

/**
 * Helfer eines Plans (LLH-1586; Change `y106s29r-blockplan-kern`, design.md D7): Personen ohne
 * Stammdatensatz, nur in diesem Plan, etwa von einer anderen Organisation. Sie stehen in der
 * Seitenleiste des Plans unter „Helfer“. Ein gelöschter Helfer verschwindet aus allen Blöcken; die
 * Rückfrage nennt, aus wie vielen. Kennung und Herkunft (Einlesen, Übernahme aus einer Planung)
 * stehen nur lesend da, die Spalten nur, wenn ein Helfer sie trägt.
 *
 * Träger: der Reiter „Helfer“ einer Planung (`planung/PlanungPage`) und der Knopf „Helfer“ in der
 * Werkzeugzeile des Schichtplans im Einsatz (`SchichtplanAnsicht`). Die Hülle reicht Daten, API und
 * Cache-Übernahme.
 */
export default function HelferListe({
  helfer: helferListe,
  bloecke,
  readOnly = false,
  gesperrt = MODUL_PERSONAL_GESPERRT,
  api,
  cache,
  dataLfh,
}: HelferListeProps) {
  const { token } = useRollen();
  const [dialog, setDialog] = useState<{ helfer: SchichtplanHelfer | null } | null>(null);
  const [zuLoeschen, setZuLoeschen] = useState<SchichtplanHelfer | null>(null);
  const qualiQuery = useQuery({
    queryKey: globalKeys.qualifikationen(),
    queryFn: listeQualifikationen,
  });
  const qualiNamen = useMemo(
    () => new Map((qualiQuery.data ?? []).map((q) => [q.id, q.label])),
    [qualiQuery.data],
  );
  const qualiText = (h: SchichtplanHelfer) =>
    h.qualifikationen.map((id) => qualiNamen.get(id) ?? '?').join(', ');

  const speichernMut = useMutation({
    mutationFn: (s: HelferSpeichern) =>
      s.art === 'anlegen' ? api.create(s.body) : api.update(s.helferId, s.body),
    onSuccess: (h) => {
      cache.set?.(h);
      return cache.invalidate();
    },
  });
  const loeschenMut = useMutation({
    mutationFn: (helferId: number) => api.delete(helferId),
    onSuccess: async () => {
      setZuLoeschen(null);
      await cache.invalidate();
    },
  });

  const helfer = helferListe ?? [];
  const bloeckeMit = (h: SchichtplanHelfer) =>
    bloecke.filter((b) => b.personen.some((p) => p.helfer_id === h.id)).length;
  const loeschAnzahl = zuLoeschen ? bloeckeMit(zuLoeschen) : 0;

  const organisationWerte = werteAus(helfer, (h) => h.organisation);
  const qualiWerte = werteAus(helfer, (h) => h.qualifikationen.map((id) => qualiNamen.get(id)));

  const spalten: KatalogSpalte<SchichtplanHelfer>[] = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      sorter: nachText((h: SchichtplanHelfer) => h.name),
      render: (_, h) => <span style={{ overflowWrap: 'anywhere' }}>{h.name}</span>,
    },
    {
      title: 'Organisation',
      key: 'organisation',
      suchText: (h) => h.organisation,
      sorter: nachText((h: SchichtplanHelfer) => h.organisation),
      filters: organisationWerte.length > 0 ? organisationWerte : undefined,
      onFilter: (wert, h) => h.organisation === wert,
      render: (_, h) => h.organisation ?? '—',
    },
    {
      title: 'Telefon',
      key: 'telefon',
      abBreite: 'md',
      suchText: (h) => h.telefon,
      sorter: nachText((h: SchichtplanHelfer) => h.telefon),
      render: (_, h) => h.telefon ?? '—',
    },
    {
      title: 'Qualifikationen',
      key: 'qualifikationen',
      suchText: qualiText,
      // Ein Helfer trägt mehrere: der Filter trifft, wer den Wert unter seinen hat.
      filters: qualiWerte.length > 0 ? qualiWerte : undefined,
      onFilter: (wert, h) => h.qualifikationen.some((id) => qualiNamen.get(id) === wert),
      render: (_, h) => qualiText(h) || '—',
    },
    // Nur lesend und nur, wenn ein Helfer sie trägt (Einlesen, Übernahme aus einer Planung).
    ...(helfer.some((h) => h.kennung)
      ? [
          {
            title: 'Kennung',
            key: 'kennung',
            abBreite: 'md',
            suchText: (h: SchichtplanHelfer) => h.kennung,
            sorter: nachText((h: SchichtplanHelfer) => h.kennung),
            render: (_: unknown, h: SchichtplanHelfer) =>
              h.kennung ? <span style={monoStil(13)}>{h.kennung}</span> : '—',
          } satisfies KatalogSpalte<SchichtplanHelfer>,
        ]
      : []),
    ...(helfer.some((h) => h.herkunft)
      ? [
          {
            title: 'Herkunft',
            key: 'herkunft',
            abBreite: 'md',
            sorter: nachText((h: SchichtplanHelfer) => h.herkunft),
            render: (_: unknown, h: SchichtplanHelfer) => h.herkunft ?? '—',
          } satisfies KatalogSpalte<SchichtplanHelfer>,
        ]
      : []),
    {
      title: 'Aktionen',
      key: 'aktionen',
      immerSichtbar: true,
      render: (_, h) => (
        <Space size="middle">
          <Button
            aria-label={`${h.name} bearbeiten`}
            onClick={() => {
              speichernMut.reset();
              setDialog({ helfer: h });
            }}
          >
            Bearbeiten
          </Button>
          <Button
            danger
            aria-label={`${h.name} löschen`}
            onClick={() => {
              loeschenMut.reset();
              setZuLoeschen(h);
            }}
          >
            Löschen
          </Button>
        </Space>
      ),
    },
  ];
  const sichtbareSpalten = readOnly ? spalten.filter((sp) => sp.key !== 'aktionen') : spalten;

  // Ohne Personal keine Namen und kein Anlegen (Server: `helfer` ist `null`).
  if (helferListe == null) {
    return (
      <div data-lfh={dataLfh}>
        <Typography.Text type="secondary" data-lfh="helfer-sperre">
          {gesperrt}
        </Typography.Text>
      </div>
    );
  }

  // Reiter einer Detailseite: Sortierung und Filter ohne Gedächtnis, die Adresse meint den Plan.
  return (
    <div data-lfh={dataLfh}>
      {/* Zielabstand zur Werkzeugzeile der Tabelle darunter (LLH-1595): 7 / 11 / 16 px. */}
      {!readOnly && (
        <Space style={{ marginBottom: token.marginSM }}>
          <Button
            onClick={() => {
              speichernMut.reset();
              setDialog({ helfer: null });
            }}
          >
            Helfer anlegen
          </Button>
        </Space>
      )}
      <KatalogTabelle
        rowKey="id"
        dataSource={helfer}
        columns={sichtbareSpalten}
        spaltenSchalter={{ bezeichnung: 'Helfer' }}
        mehrzahl="Helfern"
        suche={{ platzhalter: 'Name, Organisation oder Qualifikation' }}
        locale={{ emptyText: 'Noch keine Helfer' }}
      />
      {dialog && (
        <HelferDialog
          key={dialog.helfer?.id ?? 'neu'}
          helfer={dialog.helfer}
          laeuft={speichernMut.isPending}
          speicherung={speichernMut}
          onSpeichern={(s) => speichernMut.mutateAsync(s)}
          onSchliessen={() => setDialog(null)}
        />
      )}
      <Modal
        open={zuLoeschen != null}
        title={zuLoeschen ? `${zuLoeschen.name} löschen?` : 'Helfer löschen?'}
        okText="Helfer löschen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, loading: loeschenMut.isPending }}
        onOk={() => zuLoeschen && loeschenMut.mutate(zuLoeschen.id)}
        onCancel={() => setZuLoeschen(null)}
        destroyOnHidden
      >
        {loeschAnzahl > 0 && (
          <p style={{ margin: 0 }}>
            {loeschAnzahl === 1
              ? 'Wird aus einem Block genommen.'
              : `Wird aus ${loeschAnzahl} Blöcken genommen.`}
          </p>
        )}
        {loeschenMut.error != null && (
          <SpeicherFehler fehler={loeschenMut.error} titel="Helfer nicht gelöscht" />
        )}
      </Modal>
    </div>
  );
}
