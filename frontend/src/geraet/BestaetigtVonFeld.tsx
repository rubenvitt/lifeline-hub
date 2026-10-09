import { Form } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { ladeBestaetiger } from '../api/einsatzPerson';
import { einsatzKeys } from '../api/queryKeys';
import type { Bestaetiger, GeraetAnzeige } from '../api/types';
import { useAuthOptional } from '../auth/AuthContext';
import { Select } from '../components/Select';

/** Formularname des Felds; der Wert ist die Kennung im Einsatzpersonal. */
export const BESTAETIGT_FELD = 'bestaetigt_personal_id';

/** Ob die Sitzung eine Bestätigung nennen kann: nur ein UHS-Gerät (LFH-1046). Eine Person
 *  bestätigt durch ihre eigene Anmeldung; die übrigen Ansichten erreichen die Auswahl nicht. */
export function kannBestaetigen(geraet: GeraetAnzeige | null): boolean {
  return geraet?.ansicht === 'uhs-tablet' || geraet?.ansicht === 'uhs-laptop';
}

export function bestaetigerOptionen(liste: readonly Bestaetiger[]) {
  return liste.map((b) => ({
    value: b.id,
    label: b.funktion ? `${b.name} · ${b.funktion}` : b.name,
  }));
}

/**
 * „Bestätigt von“ am UHS-Gerät (LFH-1046, Spec `geraete-kopplung`): wer den Schritt namentlich
 * verantwortet, aus dem Personal des Einsatzes. Freiwillig und ohne Vorauswahl, damit niemand
 * unter fremdem Namen bestätigt. Für Personen und den Lagemonitor rendert das Feld nichts.
 */
export default function BestaetigtVonFeld({ einsatzId }: { einsatzId: number }) {
  const geraet = useAuthOptional()?.geraet ?? null;
  const aktiv = kannBestaetigen(geraet);
  const query = useQuery({
    queryKey: einsatzKeys.personenBestaetiger(einsatzId),
    queryFn: () => ladeBestaetiger(einsatzId),
    enabled: aktiv,
  });
  if (!aktiv) return null;
  return (
    <Form.Item label="Bestätigt von" name={BESTAETIGT_FELD}>
      <Select<number>
        allowClear
        loading={query.isPending}
        options={bestaetigerOptionen(query.data ?? [])}
      />
    </Form.Item>
  );
}
