import SichtungsTag from '../components/SichtungsTag';
import { Space, Tag, Typography } from 'antd';
import type { Person, Sichtungskategorie } from '../api/types';
import { PATIENT_SK } from './personMeta';

/** Zählt je SK-Kategorie + Gruppe „ungesichtet" (Spec-Drei-Teilung). */
function lagebildZaehlung(alle: Person[]): {
  sk: Record<Sichtungskategorie, number>;
  ungesichtet: number;
} {
  const sk: Record<Sichtungskategorie, number> = {
    sk1: 0,
    sk2: 0,
    sk3: 0,
    sk4: 0,
    tot: 0,
    unverletzt: 0,
  };
  let ungesichtet = 0;
  for (const p of alle) {
    if (p.aktuelle_sichtung) sk[p.aktuelle_sichtung]++;
    else ungesichtet++;
  }
  return { sk, ungesichtet };
}

/** Kompakter Lagebild-Streifen über allen Personen: Patientenzahl (SK I–IV + tot),
 *  je SK-Kategorie ein Tag und die Zahl der ungesichteten Personen. */
export default function LagebildStreifen({ alle }: { alle: Person[] }) {
  const z = lagebildZaehlung(alle);
  const patientenAnzahl = PATIENT_SK.reduce((summe, k) => summe + z.sk[k], 0);
  const skTags = (Object.keys(z.sk) as Sichtungskategorie[])
    .filter((k) => z.sk[k] > 0)
    .map((k) => <SichtungsTag key={k} kategorie={k} anzahl={z.sk[k]} />);
  return (
    <Space wrap style={{ marginBottom: 12 }}>
      <Typography.Text type="secondary">Lagebild:</Typography.Text>
      <Tag color="geekblue">Patienten: {patientenAnzahl}</Tag>
      {skTags.length > 0 ? (
        skTags
      ) : (
        <Typography.Text type="secondary">noch keine Sichtungen</Typography.Text>
      )}
      <Tag>ungesichtet: {z.ungesichtet}</Tag>
    </Space>
  );
}
