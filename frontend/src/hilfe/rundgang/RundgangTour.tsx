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
      indicatorsRender={(c, gesamt) => `${c + 1}/${gesamt}`}
      // Eigene Knöpfe statt der kleinen aus antd: sie folgen der Bediendichte (Dichte-Staffel,
      // `frontend/AGENTS.md`), auch mit Handschuh.
      actionsRender={(_, { current }) => (
        <>
          <Button type="text" onClick={onClose}>
            Rundgang beenden
          </Button>
          {current > 0 && <Button onClick={() => setAktuell(current - 1)}>Zurück</Button>}
          {current < letzter ? (
            <Button type="primary" onClick={() => setAktuell(current + 1)}>
              Weiter
            </Button>
          ) : (
            <Button type="primary" onClick={onClose}>
              Fertig
            </Button>
          )}
        </>
      )}
      steps={schritte.map(({ schritt, ziel, text }) => ({
        title: schritt.titel,
        description: <div data-lfh="rundgang">{text}</div>,
        target: () => ziel,
      }))}
    />
  );
}
