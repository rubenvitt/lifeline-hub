import { Button, Card, Typography } from 'antd';
import { monoStil, useRollen } from '../../components/instrument';
import type { GefundenerOrt } from '../../anzeige/ortssuche';
import { bandStil } from './KartenFuss';

/**
 * Band im Kartenfuß für die Suchnadel der Ortssuche (LFH-638, design.md D3): nennt den Ort und
 * trägt „Suchnadel entfernen“. Im Fuß statt als Popup an der Nadel — ein Popup wäre ein Klickziel
 * auf der Karte und verdeckte Marker; das Band folgt der Stapelregel (LFH-355) und ist am
 * Handschirm erreichbar. Ohne Nadel rendert es nichts. Präsentationsfrei, nur Props.
 */
export default function SuchnadelBand({
  ort,
  onEntfernen,
}: {
  ort: GefundenerOrt | null;
  onEntfernen: () => void;
}) {
  const { token, rollen } = useRollen();
  if (!ort) return null;
  return (
    <Card
      size="small"
      data-lfh="suchnadel-band"
      style={{ ...bandStil('links'), boxShadow: token.boxShadowSecondary, maxWidth: '100%' }}
      styles={{ body: { display: 'flex', alignItems: 'center', gap: token.marginSM } }}
    >
      {/* Eine Region mit Namen: ein Vorleser findet das Ziel der letzten Suche wieder. */}
      <section aria-label="Suchnadel" style={{ minWidth: 0, flex: '1 1 auto' }}>
        <Typography.Text style={{ color: rollen.gedaempft, display: 'block' }}>
          Suchnadel
        </Typography.Text>
        {/* Lange Adressen brechen um, statt die Karte zu überdecken oder abgeschnitten zu werden. */}
        <Typography.Text
          style={{
            display: 'block',
            overflowWrap: 'anywhere',
            ...(ort.art === 'koordinate' ? monoStil(token.fontSize) : {}),
          }}
        >
          {ort.beschriftung}
        </Typography.Text>
      </section>
      <Button onClick={onEntfernen}>Suchnadel entfernen</Button>
    </Card>
  );
}
