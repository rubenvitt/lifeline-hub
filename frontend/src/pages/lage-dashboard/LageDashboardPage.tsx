import { Alert, Breadcrumb, Col, Row, Space, Spin, Tag, Typography } from 'antd';
import { formatZeitKurz } from '../../kommunikation/zeit';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { einsatzKeys } from '../../api/queryKeys';
import { ladeEinsatz } from '../../api/einsaetze';
import { listePersonen } from '../../api/einsatzPerson';
import { listeTiere } from '../../api/einsatzTier';
import { listeUhs } from '../../api/einsatzUhs';
import { listeSchaeden } from '../../api/einsatzSchaden';
import { ladeGefahrengebiete } from '../../api/gefahren';
import { listeZonen } from '../../api/lagezonen';
import { listeLageberichte } from '../../api/lageberichte';
import { listeAuftraege } from '../../api/auftraege';
import { listeMeldungen } from '../../api/meldungen';
import { listeEinheiten } from '../../api/einheiten';
import { listeEinsatzPersonal } from '../../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../../api/einsatzFahrzeuge';
import { listeEinsatzMaterial } from '../../api/einsatzMaterial';
import { listeAbschnitte } from '../../api/einsatzabschnitte';
import { baueKraeftebild } from '../../kraefte/kraeftebild';
import {
  neuesterLagebericht, verdichteGefahrengebiete, verdichtePersonen,
  verdichteSchaeden, verdichteTiere, verdichteUhs,
} from './lageVerdichtung';
import KennzahlenLeiste from './KennzahlenLeiste';
import BetroffeneKachel from './BetroffeneKachel';
import KraefteKachel from './KraefteKachel';
import InfrastrukturKachel from './InfrastrukturKachel';
import LageberichtKachel from './LageberichtKachel';
import AuftraegeKachel from './AuftraegeKachel';
import MeldungenKachel from './MeldungenKachel';

export default function LageDashboardPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const gehe = (route: string) => navigate(`/einsaetze/${einsatzId}/${route}`);

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  // Query-Keys IDENTISCH zu den vom Live-Hook (useEinsatzLiveStream) invalidierten Keys.
  const personenQuery = useQuery({ queryKey: einsatzKeys.personen(einsatzId), queryFn: () => listePersonen(einsatzId) });
  const tiereQuery = useQuery({ queryKey: einsatzKeys.tiere(einsatzId), queryFn: () => listeTiere(einsatzId) });
  const uhsQuery = useQuery({ queryKey: einsatzKeys.uhs(einsatzId), queryFn: () => listeUhs(einsatzId) });
  const schaedenQuery = useQuery({ queryKey: einsatzKeys.schaeden(einsatzId), queryFn: () => listeSchaeden(einsatzId) });
  const gefahrenQuery = useQuery({ queryKey: einsatzKeys.gefahrengebiete(einsatzId), queryFn: () => ladeGefahrengebiete(einsatzId) });
  const zonenQuery = useQuery({ queryKey: einsatzKeys.zonen(einsatzId), queryFn: () => listeZonen(einsatzId) });
  const lageberichteQuery = useQuery({ queryKey: einsatzKeys.lageberichte(einsatzId), queryFn: () => listeLageberichte(einsatzId) });
  const einheitenQuery = useQuery({ queryKey: einsatzKeys.einheiten(einsatzId), queryFn: () => listeEinheiten(einsatzId) });
  const personalQuery = useQuery({ queryKey: einsatzKeys.personal(einsatzId), queryFn: () => listeEinsatzPersonal(einsatzId) });
  const fahrzeugeQuery = useQuery({ queryKey: einsatzKeys.fahrzeuge(einsatzId), queryFn: () => listeEinsatzFahrzeuge(einsatzId) });
  const materialQuery = useQuery({ queryKey: einsatzKeys.material(einsatzId), queryFn: () => listeEinsatzMaterial(einsatzId) });
  const abschnitteQuery = useQuery({ queryKey: einsatzKeys.abschnitte(einsatzId), queryFn: () => listeAbschnitte(einsatzId) });
  const auftraegeQuery = useQuery({ queryKey: einsatzKeys.auftraege(einsatzId), queryFn: () => listeAuftraege(einsatzId) });
  const meldungenQuery = useQuery({ queryKey: einsatzKeys.meldungen(einsatzId), queryFn: () => listeMeldungen(einsatzId) });

  const kraefteFehler = einheitenQuery.isError || personalQuery.isError
    || fahrzeugeQuery.isError || materialQuery.isError || abschnitteQuery.isError;
  const kraefte = useMemo(() => {
    if (kraefteFehler) return null;
    return baueKraeftebild(
      abschnitteQuery.data ?? [], einheitenQuery.data ?? [], personalQuery.data ?? [],
      fahrzeugeQuery.data ?? [], materialQuery.data ?? [],
    ).verdichtung;
  }, [kraefteFehler, abschnitteQuery.data, einheitenQuery.data, personalQuery.data, fahrzeugeQuery.data, materialQuery.data]);

  const betroffene = personenQuery.isError ? null : verdichtePersonen(personenQuery.data ?? []);
  const tiere = tiereQuery.isError ? null : verdichteTiere(tiereQuery.data ?? []);
  const uhs = uhsQuery.isError ? null : verdichteUhs(uhsQuery.data ?? []);
  const schaeden = schaedenQuery.isError ? null : verdichteSchaeden(schaedenQuery.data ?? []);
  const gefahren = gefahrenQuery.isError ? null : verdichteGefahrengebiete(gefahrenQuery.data ?? []);
  const zonen = zonenQuery.isError ? null : (zonenQuery.data ?? []).length;
  const bericht = lageberichteQuery.isError ? null : neuesterLagebericht(lageberichteQuery.data ?? []);
  const einheitenAnzahl = einheitenQuery.isError ? null : (einheitenQuery.data ?? []).length;
  const abschnitteAnzahl = abschnitteQuery.isError ? null : (abschnitteQuery.data ?? []).length;
  const auftraege = auftraegeQuery.isError ? null : (auftraegeQuery.data ?? []);
  const meldungen = meldungenQuery.isError ? null : (meldungenQuery.data ?? []);

  if (einsatzQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Lage-Dashboard' }]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }} align="center">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>{einsatz.bezeichnung}</Typography.Title>
          <Typography.Text type="secondary">
            {[einsatz.stichwort, `seit ${formatZeitKurz(einsatz.begonnen_at)}`, einsatz.org_name]
              .filter(Boolean).join(' · ')}
          </Typography.Text>
        </div>
        <Space>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
          <Tag color="blue">Live</Tag>
        </Space>
      </Space>

      <KennzahlenLeiste
        kraefte={kraefte}
        patienten={betroffene?.patienten ?? null}
        vermisst={betroffene?.vermisst ?? null}
        warnstufe={gefahren?.hoechste ?? null}
        schaedenOffen={schaeden?.offen ?? null}
        uhsAktiv={uhs?.aktiv ?? null}
        onNavigate={gehe}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={8}><BetroffeneKachel betroffene={betroffene} onNavigate={gehe} /></Col>
        <Col xs={24} md={12} xl={8}><KraefteKachel kraefte={kraefte} einheiten={einheitenAnzahl} abschnitte={abschnitteAnzahl} onNavigate={gehe} /></Col>
        <Col xs={24} md={12} xl={8}><InfrastrukturKachel uhs={uhs} schaeden={schaeden} tiere={tiere} zonen={zonen} onNavigate={gehe} /></Col>
        <Col xs={24} md={12} xl={8}><LageberichtKachel bericht={bericht} onNavigate={gehe} /></Col>
        <Col xs={24} md={12} xl={8}><AuftraegeKachel auftraege={auftraege} onNavigate={gehe} /></Col>
        <Col xs={24} md={12} xl={8}><MeldungenKachel meldungen={meldungen} onNavigate={gehe} /></Col>
      </Row>
    </div>
  );
}
