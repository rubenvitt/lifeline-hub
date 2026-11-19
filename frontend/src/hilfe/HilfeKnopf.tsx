import { Button, Tooltip, theme } from 'antd';
import { IconHilfe } from '../icons';
import { suchTrefflaeche } from '../components/CommandPaletteTrigger';
import { useViewport } from '../components/useViewport';
import { rahmenFarben } from '../theme/tokens';
import { useHilfeSeitenleiste } from './HilfeSeitenleisteProvider';

interface HilfeKnopfProps {
  /** Mit Wortlaut statt nur Symbol (Fuß des Navigations-Drawers am Handy). */
  beschriftet?: boolean;
  /** Läuft vor dem Öffnen, etwa um den Navigations-Drawer zu schließen. */
  onVorOeffnen?: () => void;
}

/**
 * Knopf „?“ im Kopf (LLH-1824): öffnet die Hilfe-Seitenleiste mit dem Kapitel zur aktuellen Seite.
 * Wo es keine Leiste gibt (Gerät, Hilfeseite, ohne Provider), steht er nicht.
 */
export default function HilfeKnopf({ beschriftet = false, onVorOeffnen }: HilfeKnopfProps) {
  const { oeffneHilfe } = useHilfeSeitenleiste();
  const { token } = theme.useToken();
  const { istBeruehrung } = useViewport();
  if (!oeffneHilfe) return null;

  function oeffne() {
    onVorOeffnen?.();
    oeffneHilfe!('seite');
  }

  if (beschriftet) {
    return (
      <Button block icon={<IconHilfe />} onClick={oeffne} aria-keyshortcuts="? F1">
        Hilfe zu dieser Seite
      </Button>
    );
  }

  const trefflaeche = suchTrefflaeche(token);
  const knopf = (
    <Button
      type="text"
      aria-label="Hilfe zu dieser Seite"
      aria-keyshortcuts="? F1"
      icon={<IconHilfe size={20} />}
      onClick={oeffne}
      style={{
        color: rahmenFarben.text,
        flexShrink: 0,
        width: trefflaeche,
        height: trefflaeche,
        minWidth: trefflaeche,
        minHeight: trefflaeche,
      }}
    />
  );
  return istBeruehrung ? knopf : <Tooltip title="Hilfe zu dieser Seite (?)">{knopf}</Tooltip>;
}
