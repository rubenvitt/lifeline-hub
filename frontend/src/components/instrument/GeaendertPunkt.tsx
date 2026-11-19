import type { NamePath } from 'antd/es/form/interface';
import { useFeldGeaendert } from '../aenderungsstand';
import { useRollen } from './rollenwerte';
import { NUR_VORLESER } from './Status';

/**
 * Punkt am Etikett eines geänderten, noch nicht gespeicherten Felds (LLH-1829, Regel
 * `frontend/AGENTS.md`, „Formularseiten“, „Ungespeichertes ist sichtbar“). Form statt Farbe: der
 * Punkt „•“ ist für Vorleser stumm, dafür hören sie „(geändert)“ im Namen der Eingabe. Ohne
 * `AenderungsstandProvider` (`components/aenderungsstand.tsx`) rendert er nichts.
 */
export default function GeaendertPunkt({ name }: { name: NamePath | undefined }) {
  const geaendert = useFeldGeaendert(name);
  const { rollen } = useRollen();
  if (!geaendert) return null;
  return (
    <>
      {/* Abstand statt Leerzeichen: antds Etikett ist ein Flex-Container und verschluckt es. */}
      <span
        aria-hidden="true"
        style={{ color: rollen.bedienText, marginInlineStart: 'var(--lfh-luft-1)' }}
      >
        •
      </span>
      <span style={NUR_VORLESER}> (geändert)</span>
    </>
  );
}
