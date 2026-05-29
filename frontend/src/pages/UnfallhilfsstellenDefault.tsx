import { Alert, Button, Empty, Spin } from 'antd';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { listeUhs } from '../api/einsatzUhs';
import type { Uhs } from '../api/types';

type Ziel =
  | { art: 'detail'; uhsId: number }
  | { art: 'liste' }
  | { art: 'leer' };

/** Entscheidet, wohin der Default-Einstieg führt. Bei mehreren aktiven UHS die
 *  alphabetisch erste nach Bezeichnung — deterministisch und stabil. */
function bestimmeZiel(uhsListe: Uhs[]): Ziel {
  if (uhsListe.length === 0) return { art: 'leer' };
  const aktive = uhsListe.filter((u) => u.status === 'aktiv');
  if (aktive.length === 0) return { art: 'liste' };
  const ziel = [...aktive].sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de'))[0];
  return { art: 'detail', uhsId: ziel.id };
}

/**
 * Index-Route /einsaetze/:id/unfallhilfsstellen.
 * Springt bei vorhandener aktiver UHS direkt ins Detail, zeigt sonst die Liste
 * bzw. einen Leerzustand.
 *
 * Bewusst KEIN useUhsStream: die Entscheidung wird einmalig aus dem ersten
 * geladenen Stand getroffen (siehe `entscheidung`-Ref). So reißt eine live
 * angelegte UHS die Ansicht nicht weg — der Nutzer ist beim Anlegen evtl. gerade
 * im Detail einer anderen UHS, wo diese Index-Route ohnehin nicht gemountet ist.
 */
export default function UnfallhilfsstellenDefault() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const basis = `/einsaetze/${einsatzId}/unfallhilfsstellen`;

  const uhsQuery = useQuery({
    queryKey: ['einsatz-uhs', einsatzId],
    queryFn: () => listeUhs(einsatzId),
  });

  const entscheidung = useRef<Ziel | null>(null);
  if (!entscheidung.current && uhsQuery.data) {
    entscheidung.current = bestimmeZiel(uhsQuery.data);
  }

  if (!entscheidung.current) {
    if (uhsQuery.error) {
      return <Alert type="error" message="Unfallhilfsstellen konnten nicht geladen werden" showIcon />;
    }
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }

  const ziel = entscheidung.current;
  if (ziel.art === 'detail') return <Navigate to={`${basis}/${ziel.uhsId}`} replace />;
  if (ziel.art === 'liste') return <Navigate to={`${basis}/liste`} replace />;

  return (
    <div style={{ padding: 16 }}>
      <Empty description="Noch keine Unfallhilfsstellen erfasst">
        <Link to={`${basis}/liste`}>
          <Button type="primary">Erste UHS anlegen</Button>
        </Link>
      </Empty>
    </div>
  );
}
