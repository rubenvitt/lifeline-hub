import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { listePersonen } from '../api/einsatzPerson';
import { einsatzKeys } from '../api/queryKeys';
import type { Person } from '../api/types';
import Datensicht, { spaltenFuer } from '../components/Datensicht';
import { PaneelZustand } from '../components/instrument';
import { personenKarte, personenSpalten } from '../personen/personenSpalten';
import { personDetailPfad } from '../routing/deeplinks';

/** Spalten des Registers, die das Paneel zeigt; Zustand, Fundort und Vermerk stehen im Detail. */
const STELLEN_SPALTEN = new Set(['reg', 'person', 'seit']);

/**
 * „Betroffene hier" einer Betreuungsstelle (LLH-1044): die Personen, deren aktueller Verbleib
 * die Notunterkunft an dieser Stelle ist — dieselbe Menge, die „davon namentlich" zählt.
 *
 * Gefiltert wird auf dem Server (`?betreuungsstelle_id=`): bei großen Lagen lüde die Vollliste
 * alle Personen für eine Stelle. Der Abruf läuft nur mit Personenrecht (der Aufrufer rendert den
 * Baustein sonst nicht) und ist wie die Liste nicht protokolliert; erst der Sprung in die Person
 * öffnet das auditierte Detail.
 */
export default function StelleBetroffene({
  einsatzId,
  stelleId,
}: {
  einsatzId: number;
  stelleId: number;
}) {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: einsatzKeys.personenDerStelle(einsatzId, stelleId),
    queryFn: () => listePersonen(einsatzId, { betreuungsstelleId: stelleId }),
  });
  const spalten = spaltenFuer<Person>()(
    personenSpalten(() => undefined).filter((s) => STELLEN_SPALTEN.has(s.key)),
  );

  const daten = query.data ?? [];
  const zustand =
    query.isError && query.data == null
      ? 'fehler'
      : query.isLoading
        ? 'laden'
        : daten.length === 0
          ? 'leer'
          : 'daten';
  return (
    <PaneelZustand
      zustand={zustand}
      titel="Betroffene hier"
      // Kein Ausweg im Leerzustand: hierher kommt eine Person über ihren Verbleib, nicht von hier.
      leerText="Niemand namentlich hier untergebracht"
      onNeuladen={() => void query.refetch()}
    >
      <Datensicht
        bezeichnung="Betroffene hier"
        spalten={spalten}
        daten={daten}
        zeilenSchluessel="id"
        ladend={false}
        leerText="Niemand namentlich hier untergebracht"
        standardSortierung={{ spalte: 'seit', richtung: 'auf' }}
        onZeileKlick={(p) => navigate(personDetailPfad(einsatzId, p.id))}
        karte={{ ...personenKarte(einsatzId), sekundaer: ['person', 'seit'] }}
      />
    </PaneelZustand>
  );
}
