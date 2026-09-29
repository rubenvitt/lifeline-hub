import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Space } from 'antd';
import type { Gefahrengebiet, Warnstufe } from '../../api/types';
import StatusTag from '../../components/StatusTag';
import { Augenbraue, Datenfeld, Datenraster } from '../../components/instrument';
import { warnstufeKarte } from '../../theme/statusFarben';
import { datensatzAbfrage } from '../../command-palette/datensatzAbfrage';
import { VorschauZustand } from '../../command-palette/VorschauZustand';
import { gefahrenMatrixAbfrage } from './gefahrenMatrixAbfrage';
import GefahrenMatrixAuszug from './GefahrenMatrixAuszug';

/**
 * Höchste Warnstufe als Etikett wie auf der Gefahrenseite, aber mit „keine Stufe gesetzt" statt
 * „keine" — das läse sich hier als „nicht bewertet", und im Severity-MAX des Backends sind beide
 * Fälle nicht trennbar (LFH-357). Rolle und Farbe bleiben die der Karte.
 */
function hoechsteStufe(w: Warnstufe) {
  return w === 'keine'
    ? { ...warnstufeKarte.keine, label: 'keine Stufe gesetzt' }
    : warnstufeKarte[w];
}

/**
 * Lese-Vorschau eines Gefahrengebiets in der Sprungpalette. Das Gebiet kommt aus der Gebietsliste
 * (Name steht schon im Palettenkopf). Darunter der Matrixauszug aus demselben Fach wie die
 * Gefahrenseite (`gefahrenMatrixAbfrage`) — die einzige zusätzliche Abfrage dieser Sorte, mit
 * eigenem Lade- und Fehlerzustand.
 */
export default function GefahrengebietVorschau({
  einsatzId,
  id,
}: {
  einsatzId: number;
  id: number;
}) {
  const select = useCallback((liste: Gefahrengebiet[]) => liste.find((g) => g.id === id), [id]);
  const abfrage = useQuery({ ...datensatzAbfrage.gefahrengebiete(einsatzId), select });

  return (
    <VorschauZustand abfrage={abfrage} sorte="Das Gefahrengebiet">
      {(g) => (
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <Datenraster spalten={2} beschriftung="Gebietsdaten">
            <Datenfeld label="Höchste Warnstufe">
              <StatusTag darstellung={hoechsteStufe(g.hoechste_warnstufe)} />
            </Datenfeld>
            <Datenfeld label="Zonen" mono>
              {g.zonen_ids.length}
            </Datenfeld>
          </Datenraster>
          {/* Erst mit vorhandenem Gebiet: für ein verschwundenes gäbe es keine Matrix. */}
          <MatrixAuszug einsatzId={einsatzId} gebietId={g.id} />
        </Space>
      )}
    </VorschauZustand>
  );
}

function MatrixAuszug({ einsatzId, gebietId }: { einsatzId: number; gebietId: number }) {
  const matrix = useQuery(gefahrenMatrixAbfrage(einsatzId, gebietId));
  return (
    <div>
      <Augenbraue style={{ display: 'block', marginBottom: 6 }}>Bewertete Gefahren</Augenbraue>
      <VorschauZustand abfrage={matrix} sorte="Die Gefahrenmatrix">
        {(m) => <GefahrenMatrixAuszug matrix={m} />}
      </VorschauZustand>
    </div>
  );
}
