import { Alert, Flex, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { einsatzKeys } from '../api/queryKeys';
import type { Einheit, Einsatzabschnitt } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import EinsatzSeite from '../components/EinsatzSeite';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import StatusTag from '../components/StatusTag';
import { Paneel, monoStil, useRollen } from '../components/instrument';
import { einheitStatusAnzeige } from '../kraefte/meldebildRaster';
import AbschnittDaten from '../pages/einsatzabschnitte/AbschnittDaten';
import { abschnittStaerken } from '../pages/einsatzabschnitte/abschnittStaerke';

/** Einheiten nach Abschnitt (der eigene zuerst), darin nach Sortierung und Name. */
export function ordneEinheiten(
  einheiten: readonly Einheit[],
  abschnittId: number | null,
): Einheit[] {
  return [...einheiten].sort(
    (a, b) =>
      Number(a.abschnitt_id !== abschnittId) - Number(b.abschnitt_id !== abschnittId) ||
      (a.abschnitt_name ?? '').localeCompare(b.abschnitt_name ?? '') ||
      a.sortier - b.sortier ||
      a.name.localeCompare(b.name),
  );
}

function EinheitZeile({
  einheit: e,
  zeigeAbschnitt,
}: {
  einheit: Einheit;
  zeigeAbschnitt: boolean;
}) {
  const { token, rollen } = useRollen();
  const status = einheitStatusAnzeige(e.status);
  return (
    <li
      style={{
        listStyle: 'none',
        padding: `${token.paddingSM}px 0`,
        borderBottom: `1px solid ${rollen.linie}`,
      }}
    >
      <Flex justify="space-between" align="center" gap={token.marginSM} wrap>
        <span>
          <strong>{e.name}</strong>
          {e.funkrufname && (
            <span style={{ ...monoStil(13), color: rollen.gedaempft }}> · {e.funkrufname}</span>
          )}
          {zeigeAbschnitt && e.abschnitt_name && (
            <span style={{ color: rollen.gedaempft }}> · {e.abschnitt_name}</span>
          )}
        </span>
        <StatusTag
          darstellung={{
            rolle: status.ton,
            label: status.code ? `${status.code} · ${status.wort}` : status.wort,
          }}
          farbe={e.status.quelle === 'hand' ? e.status.status?.farbe : null}
        />
      </Flex>
      <span style={monoStil(13)}>
        <StaerkeAnzeige wert={e.ist_kumuliert} />
      </span>
    </li>
  );
}

/**
 * Startseite des Abschnittsgeräts (LFH-1043, Spec `funktionsansichten`): die Angaben des eigenen
 * Abschnitts aus derselben Lesefläche wie die Abschnittsseite und darunter die Einheiten des
 * Teilbaums mit Status und Stärke. Was der Server liefert, ist schon auf den Teilbaum
 * zugeschnitten; die Seite zeigt es nur.
 */
export default function GeraetAbschnittPage() {
  const { geraet } = useAuth();
  const einsatzId = geraet?.einsatz_id ?? 0;
  const abschnittId = geraet?.stelle_id ?? null;

  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: geraet != null,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: geraet != null,
  });
  const abschnitte: Einsatzabschnitt[] = abschnitteQuery.data ?? [];
  const einheiten: Einheit[] = einheitenQuery.data ?? [];
  const abschnitt = abschnitte.find((a) => a.id === abschnittId);
  const staerken =
    abschnittId != null && einheitenQuery.isSuccess
      ? abschnittStaerken(abschnitte, einheiten, abschnittId)
      : undefined;
  const hatUnterabschnitte = abschnitte.some((a) => a.id !== abschnittId);

  return (
    <EinsatzSeite
      titel={abschnitt?.name ?? 'Abschnitt'}
      meta={abschnitt?.kurzbezeichnung ?? undefined}
      dataUpdatedAt={gemeinsamerDatenstand(
        abschnitteQuery.dataUpdatedAt,
        einheitenQuery.dataUpdatedAt,
      )}
    >
      {abschnitteQuery.isError ? (
        <Alert type="error" showIcon title="Abschnitt konnte nicht geladen werden" />
      ) : abschnitteQuery.isLoading ? (
        <Spin />
      ) : !abschnitt ? (
        <Alert type="warning" showIcon title="Abschnitt nicht mehr vorhanden" />
      ) : (
        <Flex vertical gap={12}>
          <Paneel titel="Abschnitt" koerperPolster>
            <AbschnittDaten
              abschnitt={abschnitt}
              staerken={staerken}
              staerkenErsatz={einheitenQuery.isError ? 'nicht geladen' : '—'}
              spalten={1}
            />
          </Paneel>
          <Paneel titel="Einheiten" koerperPolster>
            {einheitenQuery.isError ? (
              <Alert type="error" showIcon title="Einheiten konnten nicht geladen werden" />
            ) : einheitenQuery.isLoading ? (
              <Spin />
            ) : einheiten.length === 0 ? (
              <span>Keine Einheiten</span>
            ) : (
              <ul aria-label="Einheiten" style={{ margin: 0, padding: 0 }}>
                {ordneEinheiten(einheiten, abschnittId).map((e) => (
                  <EinheitZeile key={e.id} einheit={e} zeigeAbschnitt={hatUnterabschnitte} />
                ))}
              </ul>
            )}
          </Paneel>
        </Flex>
      )}
    </EinsatzSeite>
  );
}
