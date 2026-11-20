import { AUFTRAG_EMPFAENGER_MAX } from '../api/eingabegrenzen';
import { abschnittTag, einheitTag, type ZielOption } from './empfaengerKern';
import {
  bezeichnungsOptionen,
  funktionsOptionen,
  type FunktionsVorschlaege,
} from './funktionsOptionenKern';
import { VorschlagsSelect } from './VorschlagsSelect';

/**
 * Empfängerwahl für Auftrag und Verteiler (Change `kz5udbog-verteiler-vorlagendokument`,
 * design.md D7): EIN Feld für Einsatzabschnitte, Einheiten, Funktionen aus dem Katalog
 * (Besetzung nur im Vorschlag, LFH-549) und Freitext. Kontrolliert für `Form.Item`; die Werte
 * kodiert `fuehrung/empfaengerKern.ts`.
 *
 * Tastatur und Freitext nach der Regel der Vorschlagsfelder (LLH-1753, `VorschlagsSelect`): Enter
 * und Tab nehmen den markierten Treffer, nie das Tippfragment; Freitext nur über „„…“ als
 * Freitext übernehmen“. Das Komma trennt, damit „S3, Fachberater“ zwei Empfänger ergibt. Der
 * Tipptext speist „Fachberater: <Text>“/„Führungshilfspersonal: <Text>“.
 *
 * **Verlassen übernimmt keinen Tipptext** (auch im Auftrag, Entscheidung 20.11.2026): ein halb
 * getippter Empfänger ginge sonst ungefragt hinaus.
 */
export function EmpfaengerWahl({
  abschnitte,
  einheiten,
  vorschlaege,
  value,
  onChange,
  maxCount = AUFTRAG_EMPFAENGER_MAX,
  ...rest
}: {
  abschnitte: readonly ZielOption[];
  einheiten: readonly ZielOption[];
  vorschlaege: FunktionsVorschlaege;
  value?: string[];
  onChange?: (werte: string[]) => void;
  /** Grenze des Servers vor dem Entdoppeln (LFH-937); kappt auch eine eingefügte Liste. */
  maxCount?: number;
  id?: string;
  'aria-label'?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const gruppen = [
    {
      label: 'Einsatzabschnitte',
      options: abschnitte.map((a) => ({ value: abschnittTag(a.id), label: a.name })),
    },
    {
      label: 'Einheiten',
      options: einheiten.map((e) => ({ value: einheitTag(e.id), label: e.name })),
    },
    { label: 'Funktionen', options: funktionsOptionen(vorschlaege) },
  ];

  return (
    <VorschlagsSelect
      {...rest}
      gruppen={gruppen}
      zusatz={(text) => bezeichnungsOptionen(vorschlaege, text)}
      value={value}
      onChange={onChange}
      maxCount={maxCount}
    />
  );
}
