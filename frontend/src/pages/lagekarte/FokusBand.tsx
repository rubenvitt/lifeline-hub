import { Button, Card, Typography } from 'antd';
import { useRollen } from '../../components/instrument';
import { bandStil } from './KartenFuss';
import EscKappe from './EscKappe';

/**
 * Band im Kartenfuß für den Fokus auf einen Einsatzabschnitt (LLH-1057, Spec
 * `lagekarte-abschnitt-fokus`): nennt den Abschnitt und trägt „Fokus aufheben“. Gestapelt nach der
 * Stapelregel (LFH-355) wie die Suchnadel, am Handschirm erreichbar. Ohne Fokus rendert es nichts.
 * Präsentationsfrei, nur Props.
 */
export default function FokusBand({
  name,
  escHebtAuf,
  onAufheben,
}: {
  /** Name des fokussierten Abschnitts; `null` = kein Fokus. */
  name: string | null;
  /** Hebt Esc gerade den Fokus auf? Mit offener Auswahl gehört Esc erst ihr (LLH-1023). */
  escHebtAuf: boolean;
  onAufheben: () => void;
}) {
  const { token, rollen } = useRollen();
  if (name == null) return null;
  return (
    <Card
      size="small"
      data-lfh="fokus-band"
      style={{ ...bandStil('links'), boxShadow: token.boxShadowSecondary, maxWidth: '100%' }}
      styles={{ body: { display: 'flex', alignItems: 'center', gap: token.marginSM } }}
    >
      {/* Eine Region mit Namen: ein Vorleser findet, worauf die Karte gerade schaut. */}
      <section aria-label="Fokus" style={{ minWidth: 0, flex: '1 1 auto' }}>
        <Typography.Text style={{ color: rollen.gedaempft, display: 'block' }}>
          Fokus
        </Typography.Text>
        {/* Lange Namen brechen um, statt die Karte zu überdecken oder abgeschnitten zu werden. */}
        <Typography.Text style={{ display: 'block', overflowWrap: 'anywhere' }}>
          {name}
        </Typography.Text>
      </section>
      <Button onClick={onAufheben} aria-keyshortcuts={escHebtAuf ? 'Escape' : undefined}>
        Fokus aufheben{escHebtAuf && <EscKappe />}
      </Button>
    </Card>
  );
}
