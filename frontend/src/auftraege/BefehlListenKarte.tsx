import { Flex, Space, Typography } from 'antd';
import { memo } from 'react';
import type { BefehlKopf } from '../api/types';
import KommKarte from '../kommunikation/KommKarte';
import { BEFEHL_STATUS, StatusBadge } from '../kommunikation';
import { AuswahlZiel, type AuswahlZielProps } from '../components/ListeDetail';
import { Textstufe, monoStil, schriftStil, useRollen } from '../components/instrument';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { befehlSchemaLabel } from './befehlTexte';
import { Quittungsstand } from './EmpfaengerQuittung';

const { Text } = Typography;

/**
 * Karte eines Einsatzbefehls in der Liste des Musters „Liste + Detailpaneel“ (Spec
 * `auftraege-befehle`, „Karte eines Befehls“): derselbe Rahmen und dieselbe Zeitspalte wie die
 * Auftragskarte. Links der Zeitstand, darunter die Fassung — DIE V-NUMMER IST KEIN ZIERRAT: die
 * Fortschreibung legt eine neue Zeile mit gleichem Titel an, der Vorgänger bleibt freigegeben
 * liegen. Keine Handlung: Freigeben, Fortschreiben und der Sprung zur Vollseite stehen im Detail.
 * Unten der Verteiler wie die Empfänger der Auftragskarte, bei einem freigegebenen Befehl mit
 * derselben Zählzeile des Quittungsstands (LLH-1173).
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
  const { rollen, token } = useRollen();
  const status = BEFEHL_STATUS[b.status];
  const verteiler = b.verteiler ?? [];
  return (
    <KommKarte
      data-befehl-id={b.id}
      gewaehlt={gewaehlt}
      hervorgehoben={hervorgehoben}
      zeit={
        <>
          <span style={{ display: 'block', ...monoStil('metaKlein'), color: rollen.schwach }}>
            Stand
          </span>
          <span>
            <ZeitAnzeige wert={b.zeitstand} rolle="kurz" />
          </span>
        </>
      }
      nr={`v${b.version}`}
    >
      <Space size={token.marginSM} wrap style={{ marginBottom: token.marginSM }}>
        <StatusBadge phase={status.phase} label={status.label} />
        <Textstufe stufe="textKlein" ton="gedaempft">
          {befehlSchemaLabel(b.vorlage)}
        </Textstufe>
      </Space>
      <AuswahlZiel {...auswahl} name={`Befehl v${b.version}: ${b.titel}`}>
        <Textstufe stufe="kartentitel">{b.titel}</Textstufe>
      </AuswahlZiel>
      <Flex
        gap={token.marginSM}
        wrap
        style={{ marginTop: token.marginXS, ...monoStil('meta'), color: rollen.gedaempft }}
      >
        <span>{b.ersteller_name}</span>
        {b.status === 'freigegeben' && b.freigegeben_at && (
          <span>
            · freigegeben <ZeitAnzeige wert={b.freigegeben_at} rolle="kurz" />
            {b.freigegeben_von_name ? ` von ${b.freigegeben_von_name}` : ''}
          </span>
        )}
      </Flex>
      {verteiler.length > 0 && (
        <Flex align="baseline" gap={token.marginSM} wrap style={{ marginTop: token.marginXS }}>
          {b.status === 'freigegeben' && (
            <Quittungsstand
              anzahl={verteiler.length}
              quittiert={verteiler.filter((e) => e.quittiert_at).length}
            />
          )}
          <Text style={{ ...schriftStil('text'), color: rollen.text2, minWidth: 0 }} ellipsis>
            {verteiler.map((e) => e.snap_anzeige).join(', ')}
          </Text>
        </Flex>
      )}
    </KommKarte>
  );
}
