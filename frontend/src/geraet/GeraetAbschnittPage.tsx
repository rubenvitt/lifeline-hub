import { StaerkeSchreibweise } from '../anzeige/KuerzelErklaerung';
import { Alert, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { einsatzKeys } from '../api/queryKeys';
import type { Einheit, Einsatzabschnitt } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import EinsatzSeite from '../components/EinsatzSeite';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import { Paneel, Stapel, monoStil, schriftStil, useRollen } from '../components/instrument';
import { abschnittDerEinheit } from '../kraefte/kraeftebaumKern';
import { einheitStatusAnzeige } from '../kraefte/meldebildRaster';
import AbschnittDaten from '../pages/einsatzabschnitte/AbschnittDaten';
import { abschnittStaerken } from '../pages/einsatzabschnitte/abschnittStaerke';
import { Status } from '../components/instrument/Status';

/**
 * Einheiten nach Abschnitt (der eigene zuerst), darin nach Sortierung und Name. Es zählt der
 * wirksame Abschnitt (LLH-1744): eine Untereinheit ohne eigenen steht bei dem ihrer Obereinheit.
 */
export function ordneEinheiten(
  einheiten: readonly Einheit[],
  abschnittId: number | null,
): Einheit[] {
  const wirksam = abschnittDerEinheit(einheiten);
  const id = (e: Einheit) => wirksam.get(e.id)?.id ?? null;
  const name = (e: Einheit) => wirksam.get(e.id)?.name ?? '';
  return [...einheiten].sort(
    (a, b) =>
      Number(id(a) !== abschnittId) - Number(id(b) !== abschnittId) ||
      name(a).localeCompare(name(b)) ||
      a.sortier - b.sortier ||
      a.name.localeCompare(b.name),
  );
}

function EinheitZeile({
  einheit: e,
  abschnittName,
  ueber,
}: {
  einheit: Einheit;
  /** Wirksamer Abschnitt, nur wenn der Teilbaum Unterabschnitte hat. */
  abschnittName: string | null;
  /** Name der Obereinheit, wenn die Einheit deren Abschnitt erbt (LLH-1744). */
  ueber: string | null;
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
      <Stapel richtung="zeile" umbruch abstand="sm" ausrichten="mitte" verteilen="between">
        <span>
          <strong>{e.name}</strong>
          {e.funkrufname && (
            <span data-schrift="kennung" style={{ ...monoStil('mono'), color: rollen.gedaempft }}>
              {' '}
              · {e.funkrufname}
            </span>
          )}
          {abschnittName && <span style={{ color: rollen.gedaempft }}> · {abschnittName}</span>}
          {ueber && <span style={{ color: rollen.gedaempft }}> · über {ueber}</span>}
        </span>
        <Status
          darstellung={{
            rolle: status.ton,
            label: status.code ? `${status.code} · ${status.wort}` : status.wort,
          }}
          farbe={e.status.quelle === 'hand' ? e.status.status?.farbe : null}
        />
      </Stapel>
      {/* Eigene Stärke wie „Zugeordnete Einheiten“ der Abschnittsseite (LLH-1744): die Zeilen
          ergeben die Stärke im Kopf, eine Untereinheit zählt nicht zusätzlich bei ihrem Zug. */}
      {/* Das Wort in der Textschrift, die Stärke in Mono (ADR-0094). */}
      <span style={schriftStil('text')}>
        eigene{' '}
        <span style={monoStil('mono')}>
          <StaerkeAnzeige wert={e.ist} />
        </span>
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
  const wirksam = abschnittDerEinheit(einheiten);
  const einheitName = new Map(einheiten.map((e) => [e.id, e.name]));

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
        <Stapel abstand="md">
          <Paneel titel="Abschnitt" koerperPolster>
            <AbschnittDaten
              abschnitt={abschnitt}
              staerken={staerken}
              staerkenErsatz={einheitenQuery.isError ? 'nicht geladen' : '—'}
              spalten={1}
            />
          </Paneel>
          <Paneel
            titel="Einheiten"
            meta={
              <>
                Stärke <StaerkeSchreibweise />
              </>
            }
            koerperPolster
          >
            {einheitenQuery.isError ? (
              <Alert type="error" showIcon title="Einheiten konnten nicht geladen werden" />
            ) : einheitenQuery.isLoading ? (
              <Spin />
            ) : einheiten.length === 0 ? (
              <span>Keine Einheiten</span>
            ) : (
              <ul aria-label="Einheiten" style={{ margin: 0, padding: 0 }}>
                {ordneEinheiten(einheiten, abschnittId).map((e) => (
                  <EinheitZeile
                    key={e.id}
                    einheit={e}
                    abschnittName={hatUnterabschnitte ? (wirksam.get(e.id)?.name ?? null) : null}
                    ueber={
                      e.abschnitt_id == null && e.ueber_einheit_id != null
                        ? (einheitName.get(e.ueber_einheit_id) ?? null)
                        : null
                    }
                  />
                ))}
              </ul>
            )}
          </Paneel>
        </Stapel>
      )}
    </EinsatzSeite>
  );
}
