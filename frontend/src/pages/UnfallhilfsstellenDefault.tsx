import { Navigate, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { listeUhs } from '../api/einsatzUhs';
import { einsatzKeys } from '../api/queryKeys';
import { SeitenFehler, SeitenLeer, SeitenSkeleton } from '../components/SeitenZustand';
import UhsAnlegenDrawer from './uhs/UhsAnlegenDrawer';
import { liesLetzteUhs, waehleDefaultUhs } from './uhs/uhsAuswahl';

/**
 * Index-Route /einsaetze/:id/unfallhilfsstellen.
 * Springt direkt in die passende UHS (zuletzt ausgewählte → älteste aktive →
 * zuletzt angelegte) oder zeigt bei 0 UHS einen Leerzustand mit Anlegen-Drawer.
 *
 * Bewusst kein Live-Resync der Auswahl: die Entscheidung wird einmalig aus dem ersten
 * geladenen Stand getroffen (siehe `entscheidung`-Ref). So reißt eine live angelegte UHS
 * die Ansicht nicht weg — der Nutzer ist beim Anlegen evtl. gerade im Detail einer anderen
 * UHS, wo diese Index-Route ohnehin nicht gemountet ist. (Der konsolidierte
 * useEinsatzLiveStream im EinsatzLayout hält die Listen anderswo aktuell.)
 */
export default function UnfallhilfsstellenDefault() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const basis = `/einsaetze/${einsatzId}/unfallhilfsstellen`;

  const uhsQuery = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
  });

  const entscheidung = useRef<{ uhsId: number | null } | null>(null);
  if (!entscheidung.current && uhsQuery.data) {
    entscheidung.current = { uhsId: waehleDefaultUhs(uhsQuery.data, liesLetzteUhs(einsatzId)) };
  }

  const [anlegen, setAnlegen] = useState(false);

  if (!entscheidung.current) {
    if (uhsQuery.error) {
      return (
        <SeitenFehler
          text="Unfallhilfsstellen konnten nicht geladen werden"
          ursache={uhsQuery.error}
          onWiederholen={() => void uhsQuery.refetch()}
        />
      );
    }
    return <SeitenSkeleton />;
  }

  const { uhsId } = entscheidung.current;
  if (uhsId != null) return <Navigate to={`${basis}/${uhsId}`} replace />;

  return (
    <div style={{ padding: 16 }}>
      {/* Der einzige Leerzustand im Bestand, der zur Aktion führt — und er tut das ohne
          Route: der Drawer öffnet über lokalen Zustand. Genau dafür trägt die Aktion des
          Primitivs neben `pfad` auch `onClick`; ihm hier eine Route anzudichten hieße,
          eine zu erfinden, die es nicht gibt (LFH-331 · B3, D2). */}
      <SeitenLeer
        titel="Noch keine Unfallhilfsstellen erfasst"
        aktion={{ label: 'Erste UHS anlegen', onClick: () => setAnlegen(true) }}
      />
      <UhsAnlegenDrawer
        einsatzId={einsatzId}
        open={anlegen}
        onClose={() => setAnlegen(false)}
        onAngelegt={(uhs) => navigate(`${basis}/${uhs.id}`)}
      />
    </div>
  );
}
