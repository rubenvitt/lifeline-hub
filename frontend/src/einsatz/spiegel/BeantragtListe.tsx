import { Typography } from 'antd';
import ZeitAnzeige from '../../anzeige/ZeitAnzeige';
import { useRollen } from '../../components/instrument';

/** Eine beantragte Erfassung in der Liste: kurzer Text, Erfassungszeit. */
export interface BeantragtEintrag {
  schluessel: string;
  text: string;
  zeit?: string | null;
}

/**
 * Was an diesem Ort am Spiegel beantragt ist (LLH-1492, Spec `spiegel-antraege`, „Anträge stehen
 * dort, wo Vorgemerktes steht“): über der Liste, getrennt von ihren Daten und nicht in ihren
 * Kennzahlen, in der Form der Quittung „Offline vorgemerkt“ (`personen/Patientenkopf.tsx`). Es
 * verschwindet, sobald die übernommene Zeile im Spiegel steht. Leer steht nichts da.
 */
export default function BeantragtListe({
  titel = 'Beantragt',
  eintraege,
}: {
  titel?: string;
  eintraege: readonly BeantragtEintrag[];
}) {
  const { token, rollen } = useRollen();
  if (eintraege.length === 0) return null;
  return (
    <section
      aria-label={titel}
      data-lfh="beantragt"
      style={{
        borderInlineStart: `3px solid ${token.colorWarning}`,
        paddingInlineStart: token.paddingSM,
        marginBottom: token.margin,
        color: rollen.text2,
      }}
    >
      <Typography.Text strong>{titel}</Typography.Text>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {eintraege.map((e) => (
          <li key={e.schluessel}>
            {e.text}
            {e.zeit && (
              <>
                {' · '}
                <ZeitAnzeige wert={e.zeit} rolle="kurz" />
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
