import { useEffect, useState } from 'react';

/**
 * Ein Takt, der zur vollen Minute tickt — für Uhr, Einsatzdauer und das Alter der Fachebenen.
 *
 * Erst ein `setTimeout` bis zur nächsten Minutengrenze, danach ein Minutenintervall; ein bloßes
 * `setInterval(60 000)` zeigte bis zu 59 s die alte Minute. Liefert Millisekunden (primitiv, für
 * Dependency-Arrays).
 */
export function useMinutenTakt(): number {
  const [jetzt, setJetzt] = useState(() => Date.now());
  useEffect(() => {
    let intervall: ReturnType<typeof setInterval> | undefined;
    const bisZurMinute = 60_000 - (Date.now() % 60_000);
    const start = setTimeout(() => {
      setJetzt(Date.now());
      intervall = setInterval(() => setJetzt(Date.now()), 60_000);
    }, bisZurMinute);
    return () => {
      clearTimeout(start);
      if (intervall) clearInterval(intervall);
    };
  }, []);
  return jetzt;
}
