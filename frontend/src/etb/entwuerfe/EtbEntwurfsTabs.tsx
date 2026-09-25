// frontend/src/etb/entwuerfe/EtbEntwurfsTabs.tsx
import { Spin, Tabs } from 'antd';
import { useCallback, useState } from 'react';
import type { NeuerEintrag } from '../../api/etb';
import type { EinsatzAnzeige, EtbBaustein } from '../../api/types';
import Schnellerfassung, { nurUebernahme } from '../Schnellerfassung';
import type { MetadatenWerte } from '../schnellerfassungModell';
import { entwurfLabel, zuWerte } from './entwurfModell';
import { useEtbEntwuerfe } from './useEtbEntwuerfe';

export interface EtbEntwurfsTabsProps {
  einsatzId: number;
  erfassen: (e: NeuerEintrag) => Promise<void>;
  bausteine: EtbBaustein[];
  einsatz: EinsatzAnzeige;
  /** Eine laufende Detail-Abfrage muss vor der ersten Vorbelegung ankommen. */
  kontextLaedt?: boolean;
  /** Zustand des Schalters „Werte behalten". Liegt beim Aufrufer — s. Kommentar unten. */
  werteBehalten: boolean;
  onWerteBehaltenChange: (b: boolean) => void;
}

/** Stabile leere Liste: ein frisches `[]` je Render wäre für die Schnellerfassung jedes Mal neu. */
const KEINE_DATEIEN: File[] = [];

export default function EtbEntwurfsTabs({
  einsatzId,
  erfassen,
  bausteine,
  einsatz,
  kontextLaedt = false,
  werteBehalten,
  onWerteBehaltenChange,
}: EtbEntwurfsTabsProps) {
  const {
    entwuerfe,
    aktiverId,
    neuerEntwurf,
    entwurfSchliessen,
    entwurfAktualisieren,
    aktivenSetzen,
  } = useEtbEntwuerfe(einsatzId, einsatz.meine_fuehrungsstelle, kontextLaedt);

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

  /**
   * Gewählte Anhänge je Entwurf (LFH-117, design.md D9). Nur der aktive Tab ist montiert,
   * also liegen die Dateien hier und nicht in der Schnellerfassung — sonst gingen sie beim
   * Tabwechsel verloren. Bewusst NUR im Speicher: der Entwurfsspeicher (IndexedDB) ist JSON,
   * und eine Datei überlebt einen Reload ohnehin nicht als `File`. Schliesst ein Entwurf,
   * fällt sein Eintrag weg.
   */
  const [dateienJe, setDateienJe] = useState<Record<string, File[]>>({});
  const dateienVerwerfen = useCallback((id: string) => {
    setDateienJe((alt) => {
      if (!(id in alt)) return alt;
      const rest = { ...alt };
      delete rest[id];
      return rest;
    });
  }, []);

  const onEdit = useCallback(
    (targetKey: React.MouseEvent | React.KeyboardEvent | string, action: 'add' | 'remove') => {
      if (action === 'add') neuerEntwurf(werteBehalten ? uebernahme : {});
      else if (typeof targetKey === 'string') {
        dateienVerwerfen(targetKey);
        void entwurfSchliessen(targetKey);
      }
    },
    [neuerEntwurf, entwurfSchliessen, werteBehalten, uebernahme, dateienVerwerfen],
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
            const naechsteMetadaten = werteBehalten ? nurUebernahme(eintrag) : {};
            setUebernahme(naechsteMetadaten);
            // Die Dateien sind jetzt am Eintrag — sie gehen mit dem Entwurf (LFH-117).
            dateienVerwerfen(e.id);
            // Nur ein NEUER Folgeentwurf erhält die Übernahme. Ein bestehender Entwurf
            // bleibt auch mit bewusst leerem An maßgeblich (LFH-461).
            await entwurfSchliessen(e.id, naechsteMetadaten);
          }}
          berichtigungZu={null}
          onBerichtigungAbbrechen={() => {}}
          bausteine={bausteine}
          einsatz={einsatz}
          initialWerte={zuWerte(e)}
          onWerteChange={(w) => entwurfAktualisieren(e.id, w)}
          werteBehalten={werteBehalten}
          onWerteBehaltenChange={onWerteBehaltenChange}
          // Die Entwurfs-id ist der Idempotenzschlüssel: sie überlebt den Remount beim
          // Tabwechsel, ein zweites Absenden während des ersten dedupliziert der Server.
          clientId={e.id}
          dateien={dateienJe[e.id] ?? KEINE_DATEIEN}
          onDateienChange={(d) => setDateienJe((alt) => ({ ...alt, [e.id]: d }))}
        />
      ) : null,
  }));

  // Auch „+“ wartet auf die Initialisierung, sonst überschriebe das Laden einen
  // währenddessen angelegten und womöglich bereits bearbeiteten Tab.
  if (entwuerfe.length === 0) return <Spin aria-label="ETB-Entwürfe werden geladen" />;

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
