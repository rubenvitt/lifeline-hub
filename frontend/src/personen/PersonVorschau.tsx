import StatusTag from '../components/StatusTag';
import SichtungsTag from '../components/SichtungsTag';
import { Descriptions, Space, Spin, Tag, Typography, theme } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { ladePerson } from '../api/einsatzPerson';
import { einsatzKeys } from '../api/queryKeys';
import { STATUS_META, istPatient } from './personMeta';
import PersonVerlauf from './PersonVerlauf';
import { SeitenFehler } from '../components/SeitenZustand';

/**
 * NUR-LESEN-Inhalt einer Person: Identität, Status, Sichtung und medizinischer Verlauf.
 *
 * EIN Bauteil für ZWEI Rahmen (LFH-645): den schlanken `PersonDetailDrawer` (Klick auf einen
 * Patienten im UHS-Grundriss) und die Vorschau der Sprungpalette (Taste →). Zwei Kopien
 * wären zwei Stellen, an denen ein Feld fehlen kann. Der Rahmen — Titel, „Vollständig
 * öffnen", Rückweg — bleibt beim Aufrufer; das Bearbeiten (Sichtung/Verbleib/Storno) bleibt
 * der Personen-Seite vorbehalten.
 *
 * Derselbe Query-Key wie die Personen-Liste und der Drawer-Titel (`einsatzKeys.person`):
 * der Cache wird geteilt, Live-Invalidierungen greifen für alle, ein zweiter Rahmen kostet
 * keinen zweiten Request.
 */
export default function PersonVorschau({
  einsatzId,
  personId,
}: {
  einsatzId: number;
  personId: number;
}) {
  const { token } = theme.useToken();
  const detailQuery = useQuery({
    queryKey: einsatzKeys.person(einsatzId, personId),
    queryFn: () => ladePerson(einsatzId, personId),
  });
  const p = detailQuery.data;

  return (
    <>
      {detailQuery.isLoading && <Spin />}
      {detailQuery.isError && (
        <SeitenFehler
          text="Person konnte nicht geladen werden"
          ursache={detailQuery.error}
          onWiederholen={() => void detailQuery.refetch()}
        />
      )}
      {p && (
        <Space orientation="vertical" style={{ width: '100%' }} size="large">
          <Space wrap>
            <StatusTag darstellung={STATUS_META[p.status]} />
            {istPatient(p) && <Tag color="geekblue">Patient</Tag>}
            {p.aktuelle_sichtung ? (
              <SichtungsTag kategorie={p.aktuelle_sichtung} praefix="SK: " />
            ) : (
              <Tag>ungesichtet</Tag>
            )}
            {p.aktueller_verbleib && <Tag color="purple">{p.aktueller_verbleib}</Tag>}
            {p.storniert_at && <Tag color="default">storniert</Tag>}
          </Space>

          <Descriptions column={1} bordered>
            <Descriptions.Item label="Name">{p.name ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Vorname">{p.vorname ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Geschlecht">{p.geschlecht ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Geburtsdatum">{p.geburtsdatum ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Alter (geschätzt)">
              {p.alter_geschaetzt ?? '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Herkunft / Adresse">
              {p.herkunft_adresse ?? '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Antreffort">{p.antreff_ort ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Melder / Kontakt">
              {p.melder_kontakt ?? '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Notiz">{p.notiz ?? '—'}</Descriptions.Item>
          </Descriptions>

          <div>
            <Typography.Text
              type="secondary"
              style={{ fontSize: token.fontSizeSM, textTransform: 'uppercase' }}
            >
              Medizinischer Verlauf (neueste zuerst)
            </Typography.Text>
            <div style={{ marginTop: token.marginXXS }}>
              <PersonVerlauf person={p} />
            </div>
          </div>
        </Space>
      )}
    </>
  );
}
