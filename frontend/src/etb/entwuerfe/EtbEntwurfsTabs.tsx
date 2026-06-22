// frontend/src/etb/entwuerfe/EtbEntwurfsTabs.tsx
import { Tabs } from 'antd';
import { useCallback } from 'react';
import type { NeuerEintrag } from '../../api/etb';
import type { EinsatzAnzeige, EtbBaustein } from '../../api/types';
import Schnellerfassung from '../Schnellerfassung';
import { entwurfLabel, zuWerte } from './entwurfModell';
import { useEtbEntwuerfe } from './useEtbEntwuerfe';

export interface EtbEntwurfsTabsProps {
  einsatzId: number;
  erfassen: (e: NeuerEintrag) => Promise<void>;
  bausteine: EtbBaustein[];
  einsatz: EinsatzAnzeige;
}

export default function EtbEntwurfsTabs({ einsatzId, erfassen, bausteine, einsatz }: EtbEntwurfsTabsProps) {
  const { entwuerfe, aktiverId, neuerEntwurf, entwurfSchliessen, entwurfAktualisieren, aktivenSetzen } =
    useEtbEntwuerfe(einsatzId);

  const onEdit = useCallback(
    (targetKey: React.MouseEvent | React.KeyboardEvent | string, action: 'add' | 'remove') => {
      if (action === 'add') neuerEntwurf();
      else if (typeof targetKey === 'string') void entwurfSchliessen(targetKey);
    },
    [neuerEntwurf, entwurfSchliessen],
  );

  const items = entwuerfe.map((e) => ({
    key: e.id,
    label: entwurfLabel(e),
    closable: true,
    children:
      e.id === aktiverId ? (
        <Schnellerfassung
          key={e.id}
          erfassen={async (eintrag) => {
            await erfassen(eintrag); // wirft bei fachlicher Ablehnung → Entwurf bleibt
            await entwurfSchliessen(e.id); // genau diesen Tab schließen, nicht den aktiven
          }}
          berichtigungZu={null}
          onBerichtigungAbbrechen={() => {}}
          bausteine={bausteine}
          einsatz={einsatz}
          initialWerte={zuWerte(e)}
          onWerteChange={(w) => entwurfAktualisieren(e.id, w)}
        />
      ) : null,
  }));

  return (
    <Tabs
      type="editable-card"
      activeKey={aktiverId ?? undefined}
      onChange={aktivenSetzen}
      onEdit={onEdit}
      items={items}
    />
  );
}
