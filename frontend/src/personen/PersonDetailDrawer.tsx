import StatusTag from '../components/StatusTag';
import SichtungsTag from '../components/SichtungsTag';
import { Button, Descriptions, Drawer, Space, Spin, Tag, Typography, theme } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { personDetailPfad } from '../routing/deeplinks';
import { ladePerson, registrierAnzeige } from '../api/einsatzPerson';
import { einsatzKeys } from '../api/queryKeys';
import { STATUS_META, istPatient } from './personMeta';
import PersonVerlauf from './PersonVerlauf';
import { SeitenFehler } from '../components/SeitenZustand';

// Schlanker, NUR-LESEN Personen-Detail-Drawer für Kontexte außerhalb der vollen
// Personen-Verwaltung (z. B. Klick auf einen Patienten im UHS-Grundriss). Zeigt
// Identität, Status und den medizinischen Verlauf; das vollständige Bearbeiten
// (Sichtung/Verbleib/Storno) bleibt der Personen-Liste vorbehalten („vollständig öffnen").
//
// Nutzt denselben Query-Key wie die Personen-Liste (['einsatz-person', …]) → der
// Cache wird geteilt, Live-Invalidierungen greifen für beide.

export default function PersonDetailDrawer({
  einsatzId,
  personId,
  onClose,
}: {
  einsatzId: number;
  personId: number | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const detailQuery = useQuery({
    queryKey: einsatzKeys.person(einsatzId, personId),
    queryFn: () => ladePerson(einsatzId, personId!),
    enabled: personId != null,
  });
  const p = detailQuery.data;

  return (
    <Drawer
      open={personId != null}
      size={460}
      title={p ? `Person ${registrierAnzeige(p.registrier_nr)}` : 'Person'}
      onClose={onClose}
      extra={
        p && (
          <Button type="link" onClick={() => navigate(personDetailPfad(einsatzId, p.id))}>
            Vollständig öffnen
          </Button>
        )
      }
    >
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
    </Drawer>
  );
}
