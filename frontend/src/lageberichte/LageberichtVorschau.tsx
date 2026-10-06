import { useQuery } from '@tanstack/react-query';
import { Space } from 'antd';
import { Datenfeld, Datenraster } from '../components/instrument';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { LAGEBERICHT_STATUS, StatusBadge } from '../kommunikation';
import { lageberichtAbfrage } from '../command-palette/datensatzAbfrage';
import { VORSCHAU_UNTER_EBENE, VorschauZustand } from '../command-palette/VorschauZustand';
import LageberichtText from './LageberichtText';
import { vorlage } from './vorlagen';

/**
 * Lese-Vorschau eines Lageberichts in der Sprungpalette.
 *
 * Quelle ist das Detail des Lageberichts: die Liste trägt seit LFH-931 nur Kopfdaten, den Text
 * liefert nur der Einzelabruf (Spec `listen-projektion`). Der Detail-Key ist live. Der Titel
 * steht schon im Kopf der Palette. Darunter Status, Vorlage, Fassung, Zeitstand, Ersteller, ggf. Freigabe und der
 * Berichtstext aus demselben Bauteil wie der Lesezweig der Seite.
 */
export default function LageberichtVorschau({ einsatzId, id }: { einsatzId: number; id: number }) {
  const abfrage = useQuery(lageberichtAbfrage(einsatzId, id));

  return (
    <VorschauZustand abfrage={abfrage} sorte="Der Lagebericht">
      {(b) => (
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <StatusBadge
            phase={LAGEBERICHT_STATUS[b.status].phase}
            label={LAGEBERICHT_STATUS[b.status].label}
          />
          <Datenraster spalten={2} beschriftung="Berichtsdaten">
            <Datenfeld label="Vorlage">{vorlage(b.vorlage)?.label ?? b.vorlage}</Datenfeld>
            <Datenfeld label="Fassung" mono>
              v{b.version}
            </Datenfeld>
            <Datenfeld label="Zeitstand" mono>
              <ZeitAnzeige wert={b.zeitstand} />
            </Datenfeld>
            <Datenfeld label="Ersteller">{b.ersteller_name}</Datenfeld>
            {b.status === 'freigegeben' && (
              <>
                <Datenfeld label="Freigegeben von">{b.freigegeben_von_name ?? '—'}</Datenfeld>
                <Datenfeld label="Freigegeben am" mono>
                  {b.freigegeben_at ? <ZeitAnzeige wert={b.freigegeben_at} /> : '—'}
                </Datenfeld>
              </>
            )}
          </Datenraster>
          <div>
            <LageberichtText bericht={b} unterEbene={VORSCHAU_UNTER_EBENE} />
          </div>
        </Space>
      )}
    </VorschauZustand>
  );
}
