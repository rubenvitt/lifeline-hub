import { useRef, useState } from 'react';
import { AUFTRAG_EMPFAENGER_MAX } from '../api/eingabegrenzen';
import { Select } from '../components/Select';
import { abschnittTag, einheitTag, type ZielOption } from './empfaengerKern';
import { funktionsOptionen, type FunktionsVorschlaege } from './funktionsOptionenKern';

const KEINE_WERTE: string[] = [];

/**
 * Empfängerwahl für Auftrag und Verteiler (Change `kz5udbog-verteiler-vorlagendokument`,
 * design.md D7): EIN Tags-Feld für Einsatzabschnitte, Einheiten, Funktionen aus dem Katalog
 * (Besetzung nur im Vorschlag, LFH-549) und Freitext. Kontrolliert für `Form.Item`; die Werte
 * kodiert `fuehrung/empfaengerKern.ts`.
 *
 * Das Komma trennt, damit „S3, Fachberater“ zwei Empfänger ergibt. Der Tipptext speist
 * „Fachberater: <Text>“/„Führungshilfspersonal: <Text>“.
 *
 * **Verlassen übernimmt keinen Tipptext:** rc-select macht im Tags-Modus beim Blur aus dem
 * getippten Text einen Tag. Auf einer Entwurfsseite mit Speichern beim Verlassen ginge so ein
 * halb getippter Empfänger ungefragt hinaus. Ein Tag entsteht nur über Enter, Komma oder eine
 * Wahl. Das Auftragsformular behält sein bisheriges Verhalten über `commitSearchOnBlur`.
 */
export function EmpfaengerWahl({
  abschnitte,
  einheiten,
  vorschlaege,
  value,
  onChange,
  maxCount = AUFTRAG_EMPFAENGER_MAX,
  commitSearchOnBlur = false,
  ...rest
}: {
  abschnitte: readonly ZielOption[];
  einheiten: readonly ZielOption[];
  vorschlaege: FunktionsVorschlaege;
  value?: string[];
  onChange?: (werte: string[]) => void;
  /** Grenze des Servers vor dem Entdoppeln (LFH-937); kappt auch eine eingefügte Liste. */
  maxCount?: number;
  /** Verlassen macht aus dem Tipptext einen Tag (Verhalten des Auftragsformulars). */
  commitSearchOnBlur?: boolean;
  id?: string;
  'aria-label'?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState('');
  // Steht, solange rc-select das Verlassen verarbeitet: die Änderung daraus ist der Tipptext.
  const isBlurring = useRef(false);

  const optionen = [
    {
      label: 'Einsatzabschnitte',
      options: abschnitte.map((a) => ({ value: abschnittTag(a.id), label: a.name })),
    },
    {
      label: 'Einheiten',
      options: einheiten.map((e) => ({ value: einheitTag(e.id), label: e.name })),
    },
    { label: 'Funktionen', options: funktionsOptionen(vorschlaege, search) },
  ];

  return (
    // Die Erfassungsphase läuft vor rc-selects Blur-Zweig an der Wurzel des Selects; nur so lässt
    // sich die Änderung aus dem Verlassen von einer Wahl unterscheiden.
    <div
      onBlurCapture={() => {
        isBlurring.current = !commitSearchOnBlur;
      }}
    >
      <Select<string[]>
        {...rest}
        mode="tags"
        maxCount={maxCount}
        // Ohne Wert bliebe rc-select unkontrolliert und zeigte den verworfenen Tag trotzdem.
        value={value ?? KEINE_WERTE}
        onChange={(werte) => {
          if (isBlurring.current) return;
          onChange?.(werte);
        }}
        options={optionen}
        allowClear
        tokenSeparators={[',']}
        onSearch={setSearch}
        onFocus={() => {
          isBlurring.current = false;
        }}
        onBlur={() => {
          isBlurring.current = false;
          setSearch('');
        }}
      />
    </div>
  );
}
