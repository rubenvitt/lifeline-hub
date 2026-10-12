import { Form, type FormRule } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { einsatzKeys } from '../api/queryKeys';
import type { NeuerEmpfaenger, VerteilerEintrag } from '../api/types';
import { Datenfeld, Datenraster } from '../components/instrument';
import { EmpfaengerWahl } from '../fuehrung/EmpfaengerWahl';
import { ExterneEmpfaenger, externeEmpfaengerRule } from '../fuehrung/ExterneEmpfaenger';
import { useFunktionsVorschlaege } from '../fuehrung/useFunktionsVorschlaege';
import { FUNKTION_TEXT_MAX, VERTEILER_MAX } from '../api/eingabegrenzen';
import { dekodiere } from '../fuehrung/funktionsOptionenKern';
import {
  VERTEILER_FIELD,
  exceedsVerteilerLimits,
  isVerteilerChanged,
  keepOpenRows,
  toVerteilerFormValues,
  toVerteilerRequest,
  verteilerNames,
  type VerteilerFormValues,
  type VerteilerSources,
} from './verteilerKern';

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
 * Abgleich des Verteilers zwischen Formular und Server für den Verlustschutz beider Entwurfsseiten.
 *
 * - `fromServer` liefert den Formularwert zum Serverstand, samt der unfertigen externen Zeilen im
 *   Formular (sonst löschte die Übernahme nach dem ersten Autosave eine eben hinzugefügte Zeile),
 *   und merkt ihn als Basis.
 * - `forPatch` entscheidet, ob ein Speichern den Verteiler mitschickt: nur bei einer Änderung
 *   gegenüber der Basis und innerhalb der Grenzen des Servers. Die Basis rückt schon beim Senden
 *   vor, damit ein Entfernen vor dem Rücklesen nicht verloren geht; scheitert das Speichern, nimmt
 *   `settle(false)` sie zurück.
 */
export function useVerteilerSync(sources: VerteilerSources) {
  const basis = useRef<VerteilerFormValues | undefined>(undefined);
  const katalog = sources.vorschlaege.katalog;

  const fromServer = useCallback(
    (verteiler: readonly VerteilerEintrag[], formular: VerteilerFormValues | undefined) => {
      const server = toVerteilerFormValues(verteiler);
      basis.current = server;
      return keepOpenRows(server, formular);
    },
    [],
  );

  const forPatch = useCallback(
    (
      werte: VerteilerFormValues | undefined,
      gespeichert: readonly VerteilerEintrag[],
    ): { verteiler?: NeuerEmpfaenger[]; settle: (ok: boolean) => void } => {
      if (!isVerteilerChanged(werte, basis.current) || exceedsVerteilerLimits(werte, katalog)) {
        return { settle: () => {} };
      }
      const vorher = basis.current;
      const gesendet = structuredClone(werte);
      basis.current = gesendet;
      return {
        verteiler: toVerteilerRequest(werte, katalog, gespeichert),
        settle: (ok) => {
          if (!ok && basis.current === gesendet) basis.current = vorher;
        },
      };
    },
    [katalog],
  );

  return { fromServer, forPatch };
}

/**
 * Grenzen des Servers am Tag-Feld (Spec `dokument-verteiler`, „Grenzen und Prüfung“): Freitext und
 * Bezeichnung höchstens {@link FUNKTION_TEXT_MAX} Zeichen, zusammen mit den fertigen externen Zeilen
 * höchstens {@link VERTEILER_MAX} Einträge. Nie gekürzt; die Regel sperrt Speichern und Freigabe.
 */
function internRule(sources: VerteilerSources): FormRule {
  return ({ getFieldValue }) => ({
    validator: (_: unknown, wert: unknown) => {
      const tags = Array.isArray(wert) ? (wert as string[]) : [];
      if (
        tags.some(
          (t) => (dekodiere(t, sources.vorschlaege.katalog).text ?? '').length > FUNKTION_TEXT_MAX,
        )
      ) {
        return Promise.reject(
          new Error(`Ein Empfänger darf höchstens ${FUNKTION_TEXT_MAX} Zeichen lang sein`),
        );
      }
      const extern = (getFieldValue([VERTEILER_FIELD, 'extern']) ?? []) as {
        kategorie?: string;
        bezeichnung: string;
      }[];
      const fertig = extern.filter((z) => z.kategorie && z.bezeichnung.trim()).length;
      if (tags.length + fertig > VERTEILER_MAX) {
        return Promise.reject(new Error(`Höchstens ${VERTEILER_MAX} Empfänger im Verteiler`));
      }
      return Promise.resolve();
    },
  });
}

/**
 * Das Feld „Verteiler“ im Entwurfsformular: Empfängerwahl (Abschnitt, Einheit, Funktion,
 * Freitext) und darunter die externen Stellen. Beides ist Bedienung und erscheint nicht auf dem
 * Papier; dort steht der Verteiler im Druckkopf.
 */
export function VerteilerField({
  sources,
  ohneDruckKlasse,
}: {
  sources: VerteilerSources;
  /** Klasse, mit der die Seite Bedienung aus dem Druck nimmt (`befehl-no-print` …). */
  ohneDruckKlasse: string;
}) {
  return (
    <div className={ohneDruckKlasse} data-lfh="verteiler-feld">
      <Form.Item
        label="Verteiler"
        name={[VERTEILER_FIELD, 'intern']}
        dependencies={[[VERTEILER_FIELD, 'extern']]}
        rules={[internRule(sources)]}
      >
        <EmpfaengerWahl
          abschnitte={sources.abschnitte}
          einheiten={sources.einheiten}
          vorschlaege={sources.vorschlaege}
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
