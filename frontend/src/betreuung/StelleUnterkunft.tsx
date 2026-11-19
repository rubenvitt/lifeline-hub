import { Typography } from 'antd';
import { useNavigate } from 'react-router';
import { Paneel, PaneelLink, monoStil } from '../components/instrument';
import { unterkunftPlanenPfad } from '../routing/deeplinks';
import { personenZahl } from './betreuungText';

/**
 * Paneel „Unterkunft“ einer Betreuungsstelle (LLH-1520, Spec `betreuung-evakuierung`): die
 * Kapazität und der Sprung in den Rechner „Unterkunft planen“. Der berechnete Bedarf ist kein
 * Feld der Stelle; er wird über Nachforderungen angefordert (Paneel „Bedarf“ darüber).
 */
export default function StelleUnterkunft({
  einsatzId,
  stelleId,
  kapazitaet,
  planbar = true,
}: {
  einsatzId: number;
  stelleId: number;
  kapazitaet: number | null;
  /** `false` an einer stornierten Stelle (LLH-1832): kein Sprung in den Rechner. */
  planbar?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <Paneel
      titel="Unterkunft"
      koerperPolster
      aktion={
        planbar ? (
          <PaneelLink
            label="Unterkunft planen"
            onKlick={() => navigate(unterkunftPlanenPfad(einsatzId, stelleId))}
          />
        ) : undefined
      }
    >
      {kapazitaet != null ? (
        <Typography.Text>
          Kapazität <span style={monoStil('monoGross')}>{personenZahl(kapazitaet)}</span>
        </Typography.Text>
      ) : (
        <Typography.Text type="secondary">keine Kapazität festgelegt</Typography.Text>
      )}
    </Paneel>
  );
}
