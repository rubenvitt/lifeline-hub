import { Flex, Typography } from 'antd';
import { Link } from 'react-router';
import type { SchichtplanGrenzwerte } from '../../api/types';
import { useRollen } from '../../components/instrument';
import { einsatzEinstellungenPfad } from '../../routing/deeplinks';
import { grenzwerteZeile } from '../grenzwerte';

const { Text } = Typography;

/**
 * Lesezeile des Schichtplans (LLH-1603, design.md D1/D6): nennt Höchstdienst und Mindestruhe, gegen
 * die der Befund „zu lange im Dienst“ prüft. Bedient werden sie nur in Einstellungen › Ablösung,
 * Paneel „Dienst und Ruhe“. Mit Schreibrecht springt „ändern“ dorthin. Kein zweiter Schreibweg.
 */

interface GrenzwerteZeileProps {
  einsatzId: number;
  grenzwerte: SchichtplanGrenzwerte;
  darfSchreiben: boolean;
}

export default function GrenzwerteZeile({
  einsatzId,
  grenzwerte,
  darfSchreiben,
}: GrenzwerteZeileProps) {
  const { token } = useRollen();
  return (
    <Flex
      gap={token.marginXS}
      wrap
      align="baseline"
      data-lfh="schichtplan-grenzwerte"
      style={{ marginBottom: token.marginSM }}
    >
      <Text type="secondary">{grenzwerteZeile(grenzwerte)}</Text>
      {darfSchreiben && (
        <Link
          to={einsatzEinstellungenPfad(einsatzId, 'abloesung')}
          aria-label="Dienst und Ruhe ändern"
        >
          ändern
        </Link>
      )}
    </Flex>
  );
}
