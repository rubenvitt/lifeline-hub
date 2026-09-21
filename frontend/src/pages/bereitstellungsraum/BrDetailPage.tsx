import { Alert, App, Breadcrumb, Button, Popconfirm, Space, Spin, Tag } from 'antd';
import { Liste, ListenEintrag } from '../../components/Liste';
import { Link, Navigate, useParams } from 'react-router';
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../../api/einsaetze';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { useAuth } from '../../auth/AuthContext';
import { parseRouteId, bereitstellungsraeumeListePfad } from '../../routing/deeplinks';
import { ladeBr, setzeBrStatus, storniereBr, belegeBr } from '../../api/einsatzBereitstellungsraum';
import { listeEinheiten } from '../../api/einheiten';
import { listeEinsatzFahrzeuge } from '../../api/einsatzFahrzeuge';
import { ApiError } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import type { BrStatus, Einheit, EinsatzFahrzeug } from '../../api/types';
import KraefteOhneBrSidebar from './KraefteOhneBrSidebar';
import EinsatzSeite from '../../components/EinsatzSeite';
import SektionHeader from '../../components/SektionHeader';
import { Kennzahl, Kennzahlenband, monoStil, useRollen } from '../../components/instrument';
import Datenraster, { Datenfeld } from '../datenraster/Datenraster';
import StatusTag from '../../components/StatusTag';
import { useViewport } from '../../components/useViewport';
import { brStatus } from '../../theme/statusFarben';
import { abstand, flaeche } from '../../theme/tokens';
import BrSwitcher from './BrSwitcher';
import { merkeLetztenBr } from './brAuswahl';
import StaerkeAnzeige from '../../anzeige/StaerkeAnzeige';
import { summiereStaerke } from '../../anzeige/staerke';

export default function BrDetailPage() {
  const { id, brId: brIdParam } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const { rollen } = useRollen();
  const brId = Number(brIdParam);
  const idGueltig = parseRouteId(brIdParam) != null;
  const listenPfad = bereitstellungsraeumeListePfad(einsatzId);
  const { abBreite } = useViewport();
  const breit = abBreite('md');

  const qc = useQueryClient();
  const { message } = App.useApp();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const detailQuery = useQuery({
    queryKey: einsatzKeys.brDetail(einsatzId, brId),
    queryFn: () => ladeBr(einsatzId, brId),
    enabled: idGueltig,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });

  // Diesen BR als „zuletzt ausgewählt" merken — der Default-Einstieg landet beim
  // nächsten Mal wieder hier (Muster `UhsDetailPage.tsx`).
  useEffect(() => {
    if (detailQuery.isSuccess) merkeLetztenBr(einsatzId, brId);
  }, [detailQuery.isSuccess, einsatzId, brId]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.br(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.brDetail(einsatzId, brId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.fahrzeuge(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }

  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const statusMut = useMutation({
    mutationFn: (status: BrStatus) => setzeBrStatus(einsatzId, brId, status),
    onSuccess: () => {
      message.success('Status gewechselt');
      invalidate();
    },
    onError: fehler,
  });

  const stornoMut = useMutation({
    mutationFn: () => storniereBr(einsatzId, brId),
    onSuccess: () => {
      message.success('BR storniert');
      invalidate();
    },
    onError: fehler,
  });

  const belegungMut = useMutation({
    mutationFn: belegeBr.bind(null, einsatzId, brId),
    // Fester Schlüssel (N8): ein serieller Zuweisen/Entfernen-Lauf ERSETZT den stehenden
    // Toast statt ihn zu stapeln — dieselbe Bauform wie `kommunikation/rueckgaengig.tsx`.
    onSuccess: () => {
      message.success({ content: 'Erfolgreich', key: 'br-belegung' });
      invalidate();
    },
    onError: fehler,
  });

  // Deeplink-Robustheit (LFH-25): ungültige BR-ID → zurück zur Liste (nach allen Hooks).
  if (!idGueltig) {
    return <Navigate to={listenPfad} replace />;
  }
  if (einsatzQuery.isLoading || detailQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.error || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  if (detailQuery.error || !detailQuery.data) {
    return <Alert type="error" title="Bereitstellungsraum konnte nicht geladen werden" showIcon />;
  }

  const einsatz = einsatzQuery.data;
  const br = detailQuery.data;
  const schreibgeschuetzt =
    !darfImEinsatzSchreiben(einsatz, benutzer) ||
    br.status === 'geplant' ||
    br.status === 'aufgeloest';

  function onZuweisenEinheit(einheit: Einheit) {
    belegungMut.mutate({ objekt_typ: 'einheit', objekt_id: einheit.id, art: 'eintritt' });
  }

  function onZuweisenFahrzeug(fahrzeug: EinsatzFahrzeug) {
    belegungMut.mutate({ objekt_typ: 'fahrzeug', objekt_id: fahrzeug.id, art: 'eintritt' });
  }

  function onEntfernenEinheit(einheitId: number) {
    belegungMut.mutate({ objekt_typ: 'einheit', objekt_id: einheitId, art: 'austritt' });
  }

  function onEntfernenFahrzeug(fahrzeugId: number) {
    belegungMut.mutate({ objekt_typ: 'fahrzeug', objekt_id: fahrzeugId, art: 'austritt' });
  }

  // Typ und Stärke aus der Einheiten-/Fahrzeugliste (LFH-347 · M58): `BrEinheitKurz` trägt nur
  // id+name, die vollen Daten liegen in Queries, die die Sidebar ohnehin braucht.
  const einheitVon = new Map((einheitenQuery.data ?? []).map((e) => [e.id, e]));
  const fahrzeugVon = new Map((fahrzeugeQuery.data ?? []).map((f) => [f.id, f]));
  const bereitgestellt = br.einheiten
    .map((e) => einheitVon.get(e.id))
    .filter((e): e is Einheit => e != null);
  // Final-Review Befund A: `bereitgestellt` verwirft lautlos jede Einheit, die in
  // `einheitenQuery.data` fehlt (Query lädt noch, ist gescheitert, oder der Cache ist
  // nur teilweise gefüllt). Eine Summe über diese verkürzte Menge wäre eine zu kleine,
  // aber vollständig aussehende Zahl neben Namen, die die Liste sehr wohl zeigt — die
  // MENGE entscheidet, nicht `isSuccess`: auch ein Teilausfall ist unvollständig.
  const unvollstaendig = bereitgestellt.length < br.einheiten.length;
  const summe = unvollstaendig ? null : summiereStaerke(bereitgestellt);
  const fahrzeugZahl = br.fahrzeuge.length;

  return (
    <EinsatzSeite
      breite={flaeche.seiteBreit}
      titel={
        <Space>
          <BrSwitcher einsatzId={einsatzId} aktuellerBr={br} />
          <StatusTag darstellung={brStatus[br.status]} />
        </Space>
      }
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: <Link to={`/einsaetze/${einsatzId}`}>{einsatz.bezeichnung}</Link> },
            { title: <Link to={listenPfad}>Bereitstellungsräume</Link> },
            { title: br.bezeichnung },
          ]}
        />
      }
      aktionen={
        <Space>
          {!schreibgeschuetzt && br.status === 'aktiv' && (
            <Popconfirm
              title="BR auflösen?"
              description="Nur möglich, wenn keine Kraft mehr belegt ist."
              okButtonProps={{ danger: true }}
              onConfirm={() => statusMut.mutate('aufgeloest')}
            >
              <Button danger loading={statusMut.isPending}>
                Auflösen
              </Button>
            </Popconfirm>
          )}
          {darfImEinsatzSchreiben(einsatz, benutzer) && br.status === 'geplant' && (
            <>
              <Button
                type="primary"
                onClick={() => statusMut.mutate('aktiv')}
                loading={statusMut.isPending}
              >
                In Betrieb nehmen
              </Button>
              <Popconfirm
                title="BR stornieren?"
                okButtonProps={{ danger: true }}
                onConfirm={() => stornoMut.mutate()}
              >
                <Button danger loading={stornoMut.isPending}>
                  Stornieren
                </Button>
              </Popconfirm>
            </>
          )}
        </Space>
      }
    >
      <Datenraster spalten={2} beschriftung="Raumdaten" style={{ marginBottom: abstand.lg }}>
        <Datenfeld label="Standort">{br.standort ?? '—'}</Datenfeld>
        <Datenfeld label="Notiz">{br.notiz ?? '—'}</Datenfeld>
      </Datenraster>

      {/* Unter `md` stapeln statt der 240-px-Sidebar neben dem Hauptbereich (LFH-341 · H40) —
          dieselbe Form wie Gefahrengebietsliste und Gliederungsbaum. Ohne diese Weiche würde
          die volle Breite der `KraefteOhneBrSidebar`-Karte den Flex-Container weiterhin in
          eine Spalte quetschen, obwohl die Karte selbst schon auf `100%` steht. */}
      <div
        data-testid="br-detail-rahmen"
        style={{
          display: 'flex',
          flexDirection: breit ? 'row' : 'column',
          gap: abstand.lg,
          alignItems: breit ? 'flex-start' : 'stretch',
        }}
      >
        {/* Hauptbereich: bereitgestellte Kräfte */}
        <div style={{ flex: 1 }}>
          {/* Zahl führt (Neuentwurf S1): Stärke und Fahrzeugzahl als Kennzahlen. Bei
              unvollständiger Einheitenliste steht „—" mit dem Grund als Notiz — eine zu
              kleine Summe sähe sonst vollständig aus (Final-Review Befund A). */}
          <div data-testid="br-summe" style={{ marginBottom: abstand.md }}>
            <Kennzahlenband beschriftung="Bereitgestellte Kräfte">
              <Kennzahl
                titel="Bereitgestellt"
                groesse="klein"
                wert={unvollstaendig ? '—' : <StaerkeAnzeige wert={summe} />}
                einheit={unvollstaendig ? undefined : 'F/UF/M//Σ'}
                ton={unvollstaendig ? 'achtung' : 'neutral'}
                notiz={
                  unvollstaendig
                    ? '(Stärke unvollständig — Einheitenliste nicht geladen)'
                    : undefined
                }
              />
              <Kennzahl
                titel={fahrzeugZahl === 1 ? 'Fahrzeug' : 'Fahrzeuge'}
                groesse="klein"
                wert={fahrzeugZahl}
              />
            </Kennzahlenband>
          </div>
          <SektionHeader titel="Bereitgestellte Einheiten" />
          <Liste
            style={{ marginBottom: abstand.lg }}
            dataSource={br.einheiten}
            emptyText="Keine Einheiten bereitgestellt"
            renderItem={(e) => (
              <ListenEintrag
                actions={
                  !schreibgeschuetzt
                    ? [
                        <Button
                          key="entfernen"
                          danger
                          onClick={() => onEntfernenEinheit(e.id)}
                          loading={belegungMut.isPending}
                        >
                          entfernen
                        </Button>,
                      ]
                    : []
                }
              >
                <Space wrap>
                  <span>{e.name}</span>
                  {einheitVon.get(e.id)?.typ_label && <Tag>{einheitVon.get(e.id)!.typ_label}</Tag>}
                  <span style={{ ...monoStil(12), color: rollen.gedaempft }}>
                    <StaerkeAnzeige wert={einheitVon.get(e.id)?.ist_kumuliert ?? null} />
                  </span>
                </Space>
              </ListenEintrag>
            )}
          />

          <SektionHeader titel="Bereitgestellte Fahrzeuge" />
          <Liste
            dataSource={br.fahrzeuge}
            emptyText="Keine Fahrzeuge bereitgestellt"
            renderItem={(f) => (
              <ListenEintrag
                actions={
                  !schreibgeschuetzt
                    ? [
                        <Button
                          key="entfernen"
                          danger
                          onClick={() => onEntfernenFahrzeug(f.id)}
                          loading={belegungMut.isPending}
                        >
                          entfernen
                        </Button>,
                      ]
                    : []
                }
              >
                <Space wrap>
                  <span style={monoStil(13)}>{f.funkrufname}</span>
                  {fahrzeugVon.get(f.id)?.fahrzeugtyp && (
                    <Tag>{fahrzeugVon.get(f.id)!.fahrzeugtyp}</Tag>
                  )}
                </Space>
              </ListenEintrag>
            )}
          />
        </div>

        {/* Sidebar: freie Kräfte */}
        <KraefteOhneBrSidebar
          alleEinheiten={einheitenQuery.data ?? []}
          alleFahrzeuge={fahrzeugeQuery.data ?? []}
          brEinheiten={br.einheiten}
          brFahrzeuge={br.fahrzeuge}
          schreibgeschuetzt={schreibgeschuetzt}
          onZuweisenEinheit={onZuweisenEinheit}
          onZuweisenFahrzeug={onZuweisenFahrzeug}
        />
      </div>
    </EinsatzSeite>
  );
}
