import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { expect } from 'vitest';
import { NichtGefundenProvider } from '../einsatz/nichtGefundenContext';

/**
 * Prüft das Muster für ein Objekt, das es nicht (mehr) gibt (`SeitenNichtGefunden`, LLH-1827,
 * Change `a12ms7g9-seitenzustaende`, D4): der Satz in der Grammatik der Sache, genau der eine
 * Rückweg, kein „Erneut abrufen“ und keine Servermeldung („Nicht gefunden“) als Zeile.
 *
 * Mit `liste` folgt ein Klick auf den Rückweg, danach steht der Platzhalter der Listenroute da.
 */
export async function erwarteNichtGefunden({
  titel,
  knopf,
  liste,
}: {
  titel: string;
  knopf: string;
  liste?: string;
}): Promise<void> {
  expect(await screen.findByText(titel)).toBeInTheDocument();
  const rueckweg = screen.getByRole('button', { name: knopf });
  expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).toBeNull();
  expect(screen.queryByText('Nicht gefunden')).toBeNull();
  // Neutral: gescheitert ist nichts in der Anwendung, also kein Alarmbanner.
  expect(screen.queryByRole('alert')).toBeNull();
  if (liste != null) {
    await userEvent.click(rueckweg);
    expect(await screen.findByText(liste)).toBeInTheDocument();
  }
}

/** Eine 404-Antwort, wie der Server sie für ein unbekanntes Objekt schickt. */
export const NICHT_GEFUNDEN_BODY = { error: 'Nicht gefunden' } as const;

/**
 * Der Einsatzrahmen im Kleinen: er hält die Marke „nicht als letzten Ort merken“
 * (`einsatz/nichtGefundenContext.ts`), die `SeitenNichtGefunden` setzt. `marke.current` sagt nach
 * dem Zeichnen, ob der Rahmen die Adresse merken würde; `widerrufe` hält fest, für welche Adressen
 * die Seite ein schon Gemerktes zurücknehmen ließ.
 */
export function MarkenRahmen({
  marke,
  widerrufen = [],
  children,
}: {
  marke: { current: boolean };
  widerrufen?: string[];
  children: ReactNode;
}) {
  const [wert] = useState(() => ({
    marke,
    widerrufe: (pfad: string) => {
      widerrufen.push(pfad);
    },
  }));
  return <NichtGefundenProvider value={wert}>{children}</NichtGefundenProvider>;
}
