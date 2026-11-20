import { useState } from 'react';
import { Button, Tour } from 'antd';
import type { AufgeloesterSchritt } from './rundgangAnker';

/**
 * Die Sprechblasen des Rundgangs (LLH-1990) auf antd `Tour`. Liegt in eigenem Chunk; Esc,
 * „Rundgang beenden“ und „Fertig“ schließen.
 */
export default function RundgangTour({
  schritte,
  onClose,
}: {
  schritte: AufgeloesterSchritt[];
  onClose: () => void;
}) {
  const [aktuell, setAktuell] = useState(0);
  const letzter = schritte.length - 1;
  return (
    <Tour
      open
      keyboard
      current={aktuell}
      onChange={setAktuell}
      onClose={onClose}
      onFinish={onClose}
      indicatorsRender={(c, gesamt) => `${c + 1}/${gesamt}`}
      actionsRender={(knoepfe) => (
        <>
          <Button size="small" type="text" onClick={onClose}>
            Rundgang beenden
          </Button>
          {knoepfe}
        </>
      )}
      steps={schritte.map(({ schritt, ziel, text }, i) => ({
        title: schritt.titel,
        description: <div data-lfh="rundgang">{text}</div>,
        target: () => ziel,
        prevButtonProps: { children: 'Zurück' },
        nextButtonProps: { children: i === letzter ? 'Fertig' : 'Weiter' },
      }))}
    />
  );
}
