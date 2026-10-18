import { useId, useState } from 'react';
import { Alert, Button, Space, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { IconKachelraster } from '../icons';
import { useAuth } from '../auth/AuthContext';
import { ladeEinsatz } from '../api/einsaetze';
import { ladeUhs } from '../api/einsatzUhs';
import { einsatzKeys } from '../api/queryKeys';
import type { UhsDetail } from '../api/types';
import EinsatzSeite from '../components/EinsatzSeite';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import { Segmentleiste } from '../components/instrument';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import MaterialTab from '../pages/uhs/MaterialTab';
import UhsAnhaenge from '../pages/uhs/UhsAnhaenge';
import UhsKraefte from '../pages/uhs/UhsKraefte';
import UhsLagezeile from '../pages/uhs/UhsLagezeile';
import { geraetPatientenPfad, geraetUhsPfad } from '../routing/deeplinks';
import GeraetMeldungen from './GeraetMeldungen';

const BEREICH_NAME = {
  plaetze: 'Plätze',
  kraefte: 'Kräfte',
  material: 'Material',
  meldungen: 'Meldungen',
  dateien: 'Dateien',
} as const;
type Bereich = keyof typeof BEREICH_NAME;
const BEREICHE = Object.keys(BEREICH_NAME) as Bereich[];

function PlaetzeBereich({ einsatzId, uhs }: { einsatzId: number; uhs: UhsDetail }) {
  const navigate = useNavigate();
  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <UhsLagezeile
        einsatzId={einsatzId}
        uhs={uhs}
        form="band"
        ziele={{
          grundriss: geraetUhsPfad(einsatzId, uhs.id),
          patienten: geraetPatientenPfad(einsatzId),
        }}
      />
      <Button
        icon={<IconKachelraster />}
        onClick={() => navigate(geraetUhsPfad(einsatzId, uhs.id))}
      >
        Grundriss bearbeiten
      </Button>
    </Space>
  );
}

/**
 * Bereich „UHS“ des UHS-Laptops (LFH-892, Subtask LFH-1025; Spec `feldgeraet-bedienung`): die
 * Lage der Stelle in Zahlen wie am Fükw (LLH-1136) mit dem Weg in den Grundriss, Stärke und Kräfte der UHS (LFH-1045), Material der
 * eigenen UHS zum Lesen, Meldungen an die Einsatzleitung und die Dateien der UHS. Der Grundriss
 * selbst bleibt der eigene Bereich.
 */
export default function GeraetStellePage() {
  const { geraet } = useAuth();
  const einsatzId = geraet?.einsatz_id ?? 0;
  const uhsId = geraet?.uhs_id ?? null;
  const [bereich, setBereich] = useState<Bereich>('plaetze');
  const feld = useId();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
    enabled: geraet != null,
  });
  const uhsQuery = useQuery({
    queryKey: einsatzKeys.uhsDetail(einsatzId, uhsId ?? 0),
    queryFn: () => ladeUhs(einsatzId, uhsId!),
    enabled: geraet != null && uhsId != null,
  });
  const uhs = uhsQuery.data;
  const schreibgeschuetzt = !darfImEinsatzSchreiben(einsatzQuery.data);

  return (
    <EinsatzSeite
      titel="UHS"
      meta={uhs?.bezeichnung}
      dataUpdatedAt={gemeinsamerDatenstand(einsatzQuery.dataUpdatedAt, uhsQuery.dataUpdatedAt)}
    >
      {uhsQuery.isError ? (
        <Alert type="error" showIcon title="UHS konnte nicht geladen werden" />
      ) : !uhs ? (
        <Spin />
      ) : (
        <>
          <Segmentleiste
            rolle="tablist"
            beschriftung="Plätze, Kräfte, Material, Meldungen und Dateien"
            wert={bereich}
            onWechsel={setBereich}
            optionen={BEREICHE.map((b) => ({ wert: b, label: BEREICH_NAME[b], steuert: feld }))}
            style={{ marginBottom: 12 }}
          />
          <div role="tabpanel" id={feld} aria-label={BEREICH_NAME[bereich]}>
            {bereich === 'plaetze' ? (
              <PlaetzeBereich einsatzId={einsatzId} uhs={uhs} />
            ) : bereich === 'kraefte' ? (
              <UhsKraefte
                einsatzId={einsatzId}
                uhs={uhs}
                schreibgeschuetzt={schreibgeschuetzt}
                einheitZuordnen={false}
              />
            ) : bereich === 'material' ? (
              <MaterialTab einsatzId={einsatzId} uhs={uhs} schreibgeschuetzt />
            ) : bereich === 'meldungen' ? (
              <GeraetMeldungen
                einsatzId={einsatzId}
                absender={[uhs.bezeichnung, geraet?.bezeichnung].filter(Boolean).join(' · ')}
                schreibgeschuetzt={schreibgeschuetzt}
              />
            ) : (
              <UhsAnhaenge
                einsatzId={einsatzId}
                uhs={uhs}
                darfSchreiben={!schreibgeschuetzt}
                zeigeZugriffe={false}
              />
            )}
          </div>
        </>
      )}
    </EinsatzSeite>
  );
}
