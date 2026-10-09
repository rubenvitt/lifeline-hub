import { Alert, Button } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { IconPersonPlus } from '../icons';
import { useAuth } from '../auth/AuthContext';
import { listePersonen } from '../api/einsatzPerson';
import { einsatzKeys } from '../api/queryKeys';
import type { Person } from '../api/types';
import Datensicht, { spaltenFuer } from '../components/Datensicht';
import EinsatzSeite from '../components/EinsatzSeite';
import { personenKarte, personenSpalten, verbleibText } from '../personen/personenSpalten';
import { geraetBetroffenAufnahmePfad, geraetBetroffenerPfad } from '../routing/deeplinks';

/** Spalten des Registers, die das Gerät zeigt; Zustand, Fundort und Vermerk stehen im Detail. */
const GERAET_SPALTEN = new Set(['reg', 'person', 'seit']);

const HIER = 'hier';
const WEITER = 'weiter';

/**
 * Ob die Person gerade in dieser Stelle untergebracht ist: ihr jüngster Verbleib ist die
 * Notunterkunft hier. Rein, damit Liste und Test dieselbe Antwort lesen.
 */
export function istHier(p: Person, stelleId: number | null | undefined): boolean {
  return (
    stelleId != null &&
    p.aktuelle_verbleib_art === 'notunterkunft' &&
    p.aktuelle_verbleib_betreuungsstelle_id === stelleId
  );
}

/**
 * Startseite der Betreuungsstelle (LFH-1041, Spec `funktionsansichten`): die Betroffenen der
 * eigenen Stelle mit „Aufnehmen“ als Primäraktion. Der Server liefert nur Personen, die je hier
 * untergebracht waren; wer weitergezogen ist, steht in der zweiten Gruppe mit seinem Verbleib.
 */
export default function GeraetBetroffenePage() {
  const { geraet } = useAuth();
  const navigate = useNavigate();
  const einsatzId = geraet?.einsatz_id ?? 0;
  const stelleId = geraet?.stelle_id ?? null;

  const personenQuery = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
    enabled: geraet != null,
  });

  const register = personenSpalten(() => undefined);
  const spalten = spaltenFuer<Person>()([
    ...register.filter((s) => GERAET_SPALTEN.has(s.key)),
    {
      title: 'Verbleib',
      key: 'ort',
      width: 160,
      immerSichtbar: true,
      suchText: (p) => (istHier(p, stelleId) ? 'hier' : (verbleibText(p, () => undefined) ?? '')),
      render: (_, p) =>
        istHier(p, stelleId) ? 'hier' : (verbleibText(p, () => undefined) ?? 'weitergezogen'),
    },
  ]);

  return (
    <EinsatzSeite
      titel="Betroffene"
      meta={geraet?.stelle ?? undefined}
      dataUpdatedAt={personenQuery.dataUpdatedAt}
      aktionen={
        <Button
          type="primary"
          icon={<IconPersonPlus />}
          onClick={() => navigate(geraetBetroffenAufnahmePfad(einsatzId))}
        >
          Aufnehmen
        </Button>
      }
    >
      {personenQuery.isError ? (
        <Alert type="error" showIcon title="Betroffene konnten nicht geladen werden" />
      ) : (
        <Datensicht
          bezeichnung="Betroffene"
          spalten={spalten}
          daten={(personenQuery.data ?? []).filter((p) => !p.storniert_at)}
          zeilenSchluessel="id"
          ladend={personenQuery.isLoading}
          leerText="Noch keine Betroffenen in dieser Stelle"
          suche={{ platzhalter: 'R-Nr., Name' }}
          standardSortierung={{ spalte: 'seit', richtung: 'auf' }}
          gruppen={{
            schluessel: (p) => (istHier(p, stelleId) ? HIER : WEITER),
            etikett: (g) => (g === HIER ? 'In der Stelle' : 'Weitergezogen'),
            reihenfolge: [HIER, WEITER],
            unterEbene: 1,
          }}
          onZeileKlick={(p) => navigate(geraetBetroffenerPfad(einsatzId, p.id))}
          karte={{
            ...personenKarte(einsatzId),
            titel: { spalte: 'reg', ziel: (p) => geraetBetroffenerPfad(einsatzId, p.id) },
            sekundaer: ['person', 'ort'],
          }}
        />
      )}
    </EinsatzSeite>
  );
}
