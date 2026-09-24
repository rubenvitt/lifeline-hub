import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Space } from 'antd';
import { Datenfeld, Datenraster } from '../components/instrument';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { LAGEBERICHT_STATUS, StatusBadge } from '../kommunikation';
import type { LageberichtAnzeige } from '../api/types';
import { datensatzAbfrage } from '../command-palette/datensatzAbfrage';
import { VORSCHAU_UNTER_EBENE, VorschauZustand } from '../command-palette/VorschauZustand';
import LageberichtText from './LageberichtText';
import { vorlage } from './vorlagen';

/**
 * Lese-Vorschau eines Lageberichts in der Sprungpalette (LFH-664).
 *
 * Quelle ist die Lageberichtsliste — das Fach der Palette, live über den SSE-Fan-out. Sie
 * trägt die Abschnittstexte (`src/lagebericht/repo.rs:liste` liest dasselbe `SELECT` samt
 * `abschnitte` wie `laden`), ein Einzel-GET wäre ein zweites Fach für dieselben Bytes.
 *
 * Der Titel steht schon im Kopf der Palette und wird nicht wiederholt. Status, Vorlage und
 * Fassung wie im Seitenkopf der Detailseite, dazu Zeitstand, Ersteller und — nur wenn
 * freigegeben — die Freigabe; darunter der Berichtstext aus demselben Bauteil wie der
 * Lesezweig der Seite.
 */
export default function LageberichtVorschau({ einsatzId, id }: { einsatzId: number; id: number }) {
  const select = useCallback((liste: LageberichtAnzeige[]) => liste.find((b) => b.id === id), [id]);
  const abfrage = useQuery({ ...datensatzAbfrage.lageberichte(einsatzId), select });

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
