// frontend/src/etb/entwuerfe/EtbEntwurfsTabs.tsx
import { Tabs } from 'antd';
import { useCallback, useState } from 'react';
import type { NeuerEintrag } from '../../api/etb';
import type { EinsatzAnzeige, EtbBaustein } from '../../api/types';
import Schnellerfassung, { nurUebernahme } from '../Schnellerfassung';
import type { MetadatenWerte } from '../schnellerfassungModell';
import { entwurfLabel, zuWerte, type EntwurfWerte } from './entwurfModell';
import { useEtbEntwuerfe } from './useEtbEntwuerfe';

export interface EtbEntwurfsTabsProps {
  einsatzId: number;
  erfassen: (e: NeuerEintrag) => Promise<void>;
  bausteine: EtbBaustein[];
  einsatz: EinsatzAnzeige;
  /** Zustand des Schalters „Werte behalten". Liegt beim Aufrufer — s. Kommentar unten. */
  werteBehalten: boolean;
  onWerteBehaltenChange: (b: boolean) => void;
}

/**
 * Setzt die übernommenen Wiederholfelder in einen Entwurf ein. Eigene Werte des Entwurfs
 * haben Vorrang — die Übernahme füllt nur Lücken, sie überschreibt nichts Erfasstes.
 */
function mitUebernahme(w: EntwurfWerte, u: MetadatenWerte): EntwurfWerte {
  return {
    ...w,
    metadaten: {
      ...w.metadaten,
      von: w.metadaten.von ?? u.von,
      an: w.metadaten.an ?? u.an,
      meldeweg: w.metadaten.meldeweg ?? u.meldeweg,
    },
  };
}

export default function EtbEntwurfsTabs({
  einsatzId, erfassen, bausteine, einsatz, werteBehalten, onWerteBehaltenChange,
}: EtbEntwurfsTabsProps) {
  const { entwuerfe, aktiverId, neuerEntwurf, entwurfSchliessen, entwurfAktualisieren, aktivenSetzen } =
    useEtbEntwuerfe(einsatzId);

  /**
   * Wertübernahme über die Remount-Grenze (LFH-332/H61).
   *
   * Nach erfolgreichem Erfassen schliesst dieser Container den Entwurfs-Tab; das `key`-Prop
   * an `Schnellerfassung` erzwingt dabei einen Remount. Deshalb liegen die übernommenen
   * Werte HIER und nicht in der Schnellerfassung — ein `useState` unterhalb der
   * Remount-Grenze überlebt das nicht. Bewusst kein Modul-Global (macht Tests
   * reihenfolgeabhängig) und kein `localStorage` (die Übernahme gilt für die laufende
   * Erfassung, nicht für die nächste Sitzung).
   *
   * **Der SCHALTER liegt noch eine Ebene höher, in `EtbPage`** — und zwar aus demselben
   * Grund, eine Grenze weiter: `EtbPage` rendert bei einer Berichtigung eine eigene
   * `Schnellerfassung` STATT dieser Tabs, dieser Container verschwindet dabei also ganz.
   * Läge der Schalter hier, stünde eine bewusst abgewählte Wertübernahme nach jeder
   * Berichtigung wieder auf AN — ohne Nutzeraktion und ohne Hinweis. Die übernommenen
   * WERTE dürfen dabei fallen (eine Berichtigung unterbricht die Erfassungsreihe
   * ohnehin); die Entscheidung darf es nicht.
   */
  const [uebernahme, setUebernahme] = useState<MetadatenWerte>({});

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
            // Übernahme VOR dem Schliessen setzen: `entwurfSchliessen` montiert die
            // Schnellerfassung neu, und `initialWerte` wird nur beim Mount gelesen.
            // Bei ausgeschaltetem Schalter wird geleert statt nur nicht angewandt —
            // sonst tauchten alte Werte beim Wiedereinschalten wieder auf.
            setUebernahme(werteBehalten ? nurUebernahme(eintrag) : {});
            await entwurfSchliessen(e.id); // genau diesen Tab schließen, nicht den aktiven
          }}
          berichtigungZu={null}
          onBerichtigungAbbrechen={() => {}}
          bausteine={bausteine}
          einsatz={einsatz}
          initialWerte={mitUebernahme(zuWerte(e), uebernahme)}
          onWerteChange={(w) => entwurfAktualisieren(e.id, w)}
          werteBehalten={werteBehalten}
          onWerteBehaltenChange={onWerteBehaltenChange}
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
