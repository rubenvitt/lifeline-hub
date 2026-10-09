import { useMemo } from 'react';
import { FUNDSTELLE_KLASSE, suchphrasen, zerlegeNachFundstellen } from './volltextFundstellen';

/**
 * Ein Text mit markierten Fundstellen der Volltextsuche (LFH-1056, Regeln in
 * `volltextFundstellen.ts`). Ohne Begriff steht der Text unverändert da. `<mark>` trägt die
 * Aussage selbst; eine Ansage je Fundstelle gibt es nicht.
 *
 * `ab`: vor diesem Versatz wird nicht markiert (Palettenzeile: die Nummer vor dem Inhalt).
 */
export default function Fundstellen({
  text,
  begriff,
  ab = 0,
}: {
  text: string;
  begriff?: string | null;
  ab?: number;
}) {
  const stuecke = useMemo(
    () => (begriff ? zerlegeNachFundstellen(text, suchphrasen(begriff), ab) : null),
    [text, begriff, ab],
  );
  if (!stuecke) return <>{text}</>;
  return (
    <>
      {stuecke.map((s, i) =>
        s.fund ? (
          <mark key={i} className={FUNDSTELLE_KLASSE}>
            {s.text}
          </mark>
        ) : (
          s.text
        ),
      )}
    </>
  );
}
