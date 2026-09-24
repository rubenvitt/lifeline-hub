import { useCallback } from 'react';
import { Space, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import type { Uhs } from '../../api/types';
import KoordinatenAnzeige from '../../anzeige/KoordinatenAnzeige';
import StatusTag from '../../components/StatusTag';
import { Datenfeld, Datenraster } from '../../components/instrument';
import { datensatzAbfrage } from '../../command-palette/datensatzAbfrage';
import { VorschauZustand } from '../../command-palette/VorschauZustand';
import { uhsStatus, uhsTyp } from '../../theme/statusFarben';

/**
 * Lese-Vorschau einer Unfallhilfsstelle in der Sprungpalette (LFH-664).
 *
 * DATEN: das LISTENfach der Palette (`datensatzAbfrage.uhs`) mit `select` auf die `id` — nicht
 * das Detailfach `uhsDetail`/`ladeUhs`: das steht in `NICHT_LIVE_KEYS`, eine Vorschau darauf
 * verpasste Live-Änderungen. Die Listenform trägt alles, was die Vorschau zeigt.
 *
 * INHALT wie der Kopf der Detailseite (Typ, Status, Standort, Notiz), dazu die Verortung.
 * Der Typ ist eine Kategorie und keine Lage (`uhsTyp` ist durchgängig `neutral`) — er steht
 * deshalb als Wort, nicht als Statusetikett. Grundriss, Material und Bewegungen bleiben der
 * Detailseite (design.md, Non-Goals).
 *
 * VERORTUNG ohne `einsatzId` an `KoordinatenAnzeige`: mit ihr holte die Ort-Zeile (Peilung,
 * Ortsname) einen eigenen Abruf — die Spec verlangt für einen geladenen Stand aber „kein
 * zusätzlicher Abruf". „nicht verortet" steht als Text ohne Verweis auf die Karte: die
 * Vorschau liest nur, das Verorten ist eine Handlung.
 */
export default function UhsVorschau({ einsatzId, id }: { einsatzId: number; id: number }) {
  const select = useCallback((liste: Uhs[]) => liste.find((u) => u.id === id), [id]);
  const abfrage = useQuery({ ...datensatzAbfrage.uhs(einsatzId), select });

  return (
    <VorschauZustand abfrage={abfrage} sorte="Die Unfallhilfsstelle">
      {(u) => (
        <Datenraster spalten={2} beschriftung={`Unfallhilfsstelle ${u.bezeichnung}`}>
          <Datenfeld label="Bezeichnung">{u.bezeichnung}</Datenfeld>
          <Datenfeld label="Status">
            <Space wrap>
              <StatusTag darstellung={uhsStatus[u.status]} />
              {u.storniert_at && <Typography.Text type="secondary">storniert</Typography.Text>}
            </Space>
          </Datenfeld>
          <Datenfeld label="Typ">{uhsTyp[u.typ].label}</Datenfeld>
          {u.standort && <Datenfeld label="Standort">{u.standort}</Datenfeld>}
          <Datenfeld label="Verortung" mono={u.lat != null && u.lon != null}>
            {u.lat != null && u.lon != null ? (
              <KoordinatenAnzeige lat={u.lat} lon={u.lon} />
            ) : (
              <Typography.Text type="secondary">nicht verortet</Typography.Text>
            )}
          </Datenfeld>
          {u.notiz && (
            <Datenfeld label="Notiz" breit>
              {u.notiz}
            </Datenfeld>
          )}
        </Datenraster>
      )}
    </VorschauZustand>
  );
}
