// DIES ist der zentrale Wrapper; hier ist der direkte antd-Select-Import erwünscht — überall sonst
// sperrt no-restricted-imports ihn (LFH-288), damit neue Selects den Wrapper nutzen.
// eslint-disable-next-line no-restricted-imports
import { Select as AntSelect } from 'antd';
import type { RefSelectProps, SelectProps } from 'antd';
import type { BaseOptionType, DefaultOptionType } from 'antd/es/select';
import type { ReactElement, Ref } from 'react';

/**
 * Standard-Suchkonfiguration: Tippen filtert nach dem sichtbaren `label` (case-insensitive,
 * antd-intern). Bewusst `label` statt des antd-Defaults `value` — nahezu alle Selects nutzen
 * `{ value, label }`-Options, und Wert-Filterung träfe die Enum-Keys/IDs statt des Anzeigetexts.
 */
const SUCH_DEFAULT: NonNullable<SelectProps['showSearch']> = { optionFilterProp: 'label' };

/**
 * Projektweiter Select-Wrapper (LFH-288): schaltet Combobox-UX (Tippen-zum-Filtern) standardmäßig
 * an. Drop-in-Ersatz für antd `Select` — identische Props und Generics.
 *
 * Der Default greift NUR, wenn der Aufrufer `showSearch` gar nicht setzt. Eigene Objekt-Configs,
 * Remote-Filter (`showSearch={{ filterOption: false, onSearch }}`) und explizites
 * `showSearch={false}` (Suche aus) bleiben unangetastet — reine Ersetzung, kein Merge.
 *
 * Der direkte Import von `Select` aus 'antd' ist per ESLint gesperrt: immer hierher importieren,
 * damit neue Selects automatisch such-fähig sind.
 */
export function Select<
  ValueType = unknown,
  OptionType extends BaseOptionType | DefaultOptionType = DefaultOptionType,
>({
  showSearch,
  ref,
  ...rest
}: SelectProps<ValueType, OptionType> & { ref?: Ref<RefSelectProps> }): ReactElement {
  return (
    <AntSelect<ValueType, OptionType>
      ref={ref}
      showSearch={showSearch ?? SUCH_DEFAULT}
      {...rest}
    />
  );
}
