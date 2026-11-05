import { useContext, useState, type ReactNode } from 'react';
import { UNSAFE_LocationContext } from 'react-router';

/**
 * Hält den Router-Commit an: Die Seite sieht weiter die Adresse des ersten Renders, auch nachdem sie
 * navigiert hat. So steht es unter Last, solange React Router die Räumung eines Link-Auftrags noch
 * in einer Transition rendert (LLH-1361, LLH-1530).
 */
export function AdresseSteht({ children }: { children: ReactNode }) {
  const aktuell = useContext(UNSAFE_LocationContext);
  const [fest] = useState(aktuell);
  return <UNSAFE_LocationContext.Provider value={fest}>{children}</UNSAFE_LocationContext.Provider>;
}
