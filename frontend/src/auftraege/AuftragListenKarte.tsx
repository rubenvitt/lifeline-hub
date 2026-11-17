import { Flex, Typography } from 'antd';
import { memo } from 'react';
import type { Auftrag } from '../api/types';
import KommKarte from '../kommunikation/KommKarte';
import { AuswahlZiel, type AuswahlZielProps } from '../components/ListeDetail';
import { mitBesetzung } from '../fuehrung/funktionsOptionenKern';
import { useRollen } from '../components/instrument';
import {
  AuftragKopf,
  AuftragQuittungsstand,
  AuftragZeit,
  auftragKante,
  auftragKennung,
} from './AuftragTeile';

const { Text } = Typography;

/**
 * Karte eines Einzelauftrags in der Liste des Musters „Liste + Detailpaneel“ (Spec
 * `auftraege-befehle`, „Karte eines Auftrags“; design.md D4). Sie trägt KEINE Handlung: nur das
 * Auswahlziel (der Auftragstext), keinen ETB-Sprung, keine Quittier-Knöpfe. Gehandelt wird im
 * Detail (`AuftragDetail`).
 *
 * `memo` (LFH-949): ein Live-Ereignis mit einem geänderten Auftrag rendert nur dessen Karte;
 * `auswahl` bleibt je Auftrag dasselbe Objekt, solange Wahl und Breite gleich sind (`ListeDetail`).
 */
export default memo(AuftragListenKarte);

function AuftragListenKarte({
  auftrag: a,
  gewaehlt,
  hervorgehoben,
  auswahl,
}: {
  auftrag: Auftrag;
  gewaehlt: boolean;
  hervorgehoben: boolean;
  auswahl: AuswahlZielProps;
}) {
  const { rollen } = useRollen();
  const kennung = auftragKennung(a);
  const empfaenger = a.empfaenger
    .map((e) => mitBesetzung(e.snap_anzeige, e.aktuelle_besetzung))
    .join(', ');
  return (
    <KommKarte
      data-auftrag-id={a.id}
      data-ueberfaellig={a.ist_ueberfaellig ? 'true' : undefined}
      {...auftragKante(a)}
      gewaehlt={gewaehlt}
      hervorgehoben={hervorgehoben}
      zeit={<AuftragZeit auftrag={a} />}
      nr={kennung}
    >
      <AuftragKopf auftrag={a} mitEtbSprung={false} />
      {/* Der volle Text steht im zugänglichen Namen; sichtbar höchstens drei Zeilen, den Rest zeigt
          das Detail. */}
      <AuswahlZiel {...auswahl} name={`Auftrag${kennung ? ` ${kennung}` : ''}: ${a.auftrag_text}`}>
        <Text
          strong
          data-zeilen={3}
          style={{
            fontSize: 15,
            lineHeight: 1.4,
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 3,
            overflow: 'hidden',
          }}
        >
          {a.auftrag_text}
        </Text>
      </AuswahlZiel>
      <Flex align="baseline" gap={8} wrap style={{ marginTop: 4 }}>
        <AuftragQuittungsstand auftrag={a} />
        {empfaenger !== '' && (
          <Text style={{ fontSize: 13, color: rollen.text2, minWidth: 0 }} ellipsis>
            {empfaenger}
          </Text>
        )}
      </Flex>
    </KommKarte>
  );
}
