import { Button, Flex, Form, Input, Modal, Typography, theme } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { suchePersonen } from '../api/aufbewahrung';
import type { PersonTreffer } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import KatalogTabelle, { type KatalogSpalte } from '../components/KatalogTabelle';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import StatusTag from '../components/StatusTag';
import { personStatus, schwaerzungsantragStand } from '../theme/statusFarben';
import { ZIEL_ART } from './archivText';

/**
 * Pseudonyme Personensuche für ein Löschersuchen (LFH-751, Spec `aufbewahrung-loeschersuchen`,
 * „Pseudonyme Personensuche“).
 *
 * Wer das Ersuchen bearbeitet, kennt Name oder Rufnummer; die Akte zeigt beides nicht. Der
 * Server gleicht ab und liefert nur Art, Kennung, Erfassung, Status und den Stand eines Antrags
 * — der Dialog zeigt deshalb nie einen Namen. Nur ganze Wörter treffen („Muster“ findet
 * „Mustermann“ nicht). Eine Zeile mit offenem oder vollzogenem Antrag bekommt keinen weiteren.
 *
 * Tabelle: hier wird verglichen („welcher dieser Treffer ist es?“), fixierte Kennung. Die Suche
 * ist ein POST (Suchtext im Body, nie in der Adresse) und läuft deshalb als Mutation, ohne Cache.
 */

const MIN_SUCHTEXT = 3;
const leer = '—';

interface PersonensucheDialogProps {
  einsatzId: number;
  onWaehlen: (treffer: PersonTreffer) => void;
  onSchliessen: () => void;
}

export default function PersonensucheDialog({
  einsatzId,
  onWaehlen,
  onSchliessen,
}: PersonensucheDialogProps) {
  const { token } = theme.useToken();
  const [form] = Form.useForm<{ suchtext?: string }>();
  const suche = useMutation({
    mutationFn: (suchtext: string) => suchePersonen(einsatzId, suchtext),
    // Der Suchtext (ein Name) bleibt nicht im Mutations-Cache liegen.
    gcTime: 0,
  });

  const spalten: KatalogSpalte<PersonTreffer>[] = [
    { key: 'kennung', title: 'Kennung', width: 110, zahl: true, render: (_, t) => t.kennung },
    { key: 'art', title: 'Art', width: 230, render: (_, t) => ZIEL_ART[t.art] },
    {
      key: 'erfasst',
      title: 'Erfasst',
      width: 150,
      zahl: true,
      render: (_, t) => <ZeitAnzeige wert={t.erfasst_at} />,
    },
    {
      key: 'status',
      title: 'Status',
      width: 140,
      render: (_, t) =>
        t.person_status ? <StatusTag darstellung={personStatus[t.person_status]} /> : leer,
    },
    {
      key: 'antrag',
      title: 'Löschersuchen',
      width: 150,
      render: (_, t) =>
        t.antrag != null ? <StatusTag darstellung={schwaerzungsantragStand[t.antrag]} /> : leer,
    },
    {
      key: 'aktion',
      title: 'Aktion',
      width: 170,
      render: (_, t) =>
        t.antrag === 'offen' || t.antrag === 'vollzogen' ? (
          leer
        ) : (
          <Button
            danger
            onClick={() => onWaehlen(t)}
            aria-label={`Antrag stellen für ${t.kennung}`}
          >
            Antrag stellen
          </Button>
        ),
    },
  ];

  return (
    <Modal
      open
      title="Person suchen"
      onCancel={onSchliessen}
      footer={null}
      destroyOnHidden
      width={960}
    >
      <Typography.Paragraph type="secondary">
        Name oder Rufnummer der antragstellenden Person. Gezeigt wird nur die Kennung, nie der Name;
        es treffen nur ganze Wörter.
      </Typography.Paragraph>
      <Form
        form={form}
        layout="inline"
        onFinish={(werte) => suche.mutate((werte.suchtext ?? '').trim())}
        style={{ marginBottom: token.margin }}
      >
        <Form.Item
          name="suchtext"
          label="Name oder Rufnummer"
          rules={[
            {
              validator: (_, wert: string | undefined) =>
                (wert ?? '').trim().length >= MIN_SUCHTEXT
                  ? Promise.resolve()
                  : Promise.reject(new Error(`Mindestens ${MIN_SUCHTEXT} Zeichen`)),
            },
          ]}
        >
          <Input autoComplete="off" autoFocus />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={suche.isPending}>
            Suchen
          </Button>
        </Form.Item>
      </Form>
      <SpeicherFehler fehler={suche.error} titel="Suche fehlgeschlagen" />
      {suche.data && (
        <Flex vertical gap={token.marginXS} data-lfh="personensuche-treffer">
          <Typography.Text type="secondary" aria-live="polite">
            {suche.data.length === 1 ? '1 Treffer' : `${suche.data.length} Treffer`}
          </Typography.Text>
          <KatalogTabelle<PersonTreffer>
            rowKey={(t) => `${t.art}-${t.id}`}
            pagination={false}
            columns={spalten}
            dataSource={suche.data}
            locale={{ emptyText: 'Keine Person gefunden' }}
          />
        </Flex>
      )}
    </Modal>
  );
}
