import { Form } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { einsatzKeys } from '../api/queryKeys';
import type { VerteilerEintrag } from '../api/types';
import { Datenfeld, Datenraster } from '../components/instrument';
import { EmpfaengerWahl } from '../fuehrung/EmpfaengerWahl';
import { ExterneEmpfaenger, externeEmpfaengerRule } from '../fuehrung/ExterneEmpfaenger';
import { useFunktionsVorschlaege } from '../fuehrung/useFunktionsVorschlaege';
import { VERTEILER_MAX } from '../api/eingabegrenzen';
import { VERTEILER_FIELD, verteilerNames, type VerteilerSources } from './verteilerKern';

/**
 * Verteiler an Befehl und Lagebericht (LLH-1172, Spec `dokument-verteiler`, Herleitung
 * `openspec/changes/kz5udbog-verteiler-vorlagendokument/design.md`, D7): Feld im Entwurf und
 * Anzeige im Lesezweig, gemeinsam für beide Entwurfsseiten.
 */

/**
 * Abschnitte, Einheiten und Funktionsvorschläge des Einsatzes: Optionen des Felds und Namen
 * ungespeicherter Tags im Druckkopf. Geladen wird nur im Entwurf mit Schreibrecht.
 */
export function useVerteilerSources(einsatzId: number, aktiv: boolean): VerteilerSources {
  const abschnitte = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: aktiv,
  });
  const einheiten = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: aktiv,
  });
  const vorschlaege = useFunktionsVorschlaege(aktiv ? einsatzId : undefined);
  return useMemo(
    () => ({
      abschnitte: (abschnitte.data ?? []).map((a) => ({ id: a.id, name: a.name })),
      einheiten: (einheiten.data ?? []).map((e) => ({ id: e.id, name: e.name })),
      vorschlaege,
    }),
    [abschnitte.data, einheiten.data, vorschlaege],
  );
}

/**
 * Das Feld „Verteiler“ im Entwurfsformular: Empfängerwahl (Abschnitt, Einheit, Funktion,
 * Freitext) und darunter die externen Stellen. Beides ist Bedienung und erscheint nicht auf dem
 * Papier; dort steht der Verteiler im Druckkopf.
 */
export function VerteilerField({
  quellen,
  ohneDruckKlasse,
}: {
  quellen: VerteilerSources;
  /** Klasse, mit der die Seite Bedienung aus dem Druck nimmt (`befehl-no-print` …). */
  ohneDruckKlasse: string;
}) {
  return (
    <div className={ohneDruckKlasse} data-lfh="verteiler-feld">
      <Form.Item label="Verteiler" name={[VERTEILER_FIELD, 'intern']}>
        <EmpfaengerWahl
          abschnitte={quellen.abschnitte}
          einheiten={quellen.einheiten}
          vorschlaege={quellen.vorschlaege}
          maxCount={VERTEILER_MAX}
          placeholder="Abschnitt, Einheit oder Funktion"
        />
      </Form.Item>
      <Form.Item name={[VERTEILER_FIELD, 'extern']} rules={[externeEmpfaengerRule]}>
        <ExterneEmpfaenger />
      </Form.Item>
    </div>
  );
}

/** Der gespeicherte Verteiler am Bildschirm; ohne Verteiler nichts. */
export function VerteilerAnzeige({
  verteiler,
  className,
}: {
  verteiler: readonly VerteilerEintrag[] | undefined;
  className?: string;
}) {
  const namen = verteilerNames(verteiler);
  if (namen.length === 0) return null;
  return (
    <div className={className} style={{ marginBottom: 16 }}>
      <Datenraster spalten={1}>
        <Datenfeld label="Verteiler" breit>
          {namen.join(', ')}
        </Datenfeld>
      </Datenraster>
    </div>
  );
}
