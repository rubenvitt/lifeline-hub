import { Flex, Space, Typography } from 'antd';
import { memo } from 'react';
import type { BefehlKopf } from '../api/types';
import KommKarte from '../kommunikation/KommKarte';
import { BEFEHL_STATUS, StatusBadge } from '../kommunikation';
import { AuswahlZiel, type AuswahlZielProps } from '../components/ListeDetail';
import { monoStil, useRollen } from '../components/instrument';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { befehlSchemaLabel } from './befehlTexte';

const { Text } = Typography;

/**
 * Karte eines Einsatzbefehls in der Liste des Musters „Liste + Detailpaneel“ (Spec
 * `auftraege-befehle`, „Karte eines Befehls“): derselbe Rahmen und dieselbe Zeitspalte wie die
 * Auftragskarte. Links der Zeitstand, darunter die Fassung — DIE V-NUMMER IST KEIN ZIERRAT: die
 * Fortschreibung legt eine neue Zeile mit gleichem Titel an, der Vorgänger bleibt freigegeben
 * liegen. Keine Handlung: Freigeben, Fortschreiben und der Sprung zur Vollseite stehen im Detail.
 */
export default memo(BefehlListenKarte);

function BefehlListenKarte({
  befehl: b,
  gewaehlt,
  hervorgehoben,
  auswahl,
}: {
  befehl: BefehlKopf;
  gewaehlt: boolean;
  hervorgehoben: boolean;
  auswahl: AuswahlZielProps;
}) {
  const { rollen } = useRollen();
  const status = BEFEHL_STATUS[b.status];
  return (
    <KommKarte
      data-befehl-id={b.id}
      gewaehlt={gewaehlt}
      hervorgehoben={hervorgehoben}
      zeit={
        <>
          <span style={{ display: 'block', ...monoStil(10), color: rollen.schwach }}>Stand</span>
          <span>
            <ZeitAnzeige wert={b.zeitstand} format="uhrzeit" />
          </span>
        </>
      }
      nr={`v${b.version}`}
    >
      <Space size={6} wrap style={{ marginBottom: 6 }}>
        <StatusBadge phase={status.phase} label={status.label} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          {befehlSchemaLabel(b.vorlage)}
        </Text>
      </Space>
      <AuswahlZiel {...auswahl} name={`Befehl v${b.version}: ${b.titel}`}>
        <Text strong style={{ fontSize: 15, lineHeight: 1.4 }}>
          {b.titel}
        </Text>
      </AuswahlZiel>
      <Flex gap={8} wrap style={{ marginTop: 4, ...monoStil(11), color: rollen.gedaempft }}>
        <span>{b.ersteller_name}</span>
        {b.status === 'freigegeben' && b.freigegeben_at && (
          <span>
            · freigegeben <ZeitAnzeige wert={b.freigegeben_at} format="uhrzeit" />
            {b.freigegeben_von_name ? ` von ${b.freigegeben_von_name}` : ''}
          </span>
        )}
      </Flex>
    </KommKarte>
  );
}
