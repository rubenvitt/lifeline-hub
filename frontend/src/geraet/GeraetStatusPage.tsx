import { useState } from 'react';
import { Alert, Button, Flex, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ladeEinsatz } from '../api/einsaetze';
import { listeEinheiten, setzeEinheitStatus } from '../api/einheiten';
import { listeFahrzeugStatus } from '../api/fahrzeugStatus';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { FahrzeugStatus } from '../api/types';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../anzeige/zeitDarstellung';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenLeer } from '../components/SeitenZustand';
import { ZeilenFehler } from '../components/SpeicherHinweis';
import { Paneel, StatusChip, monoStil, useRollen } from '../components/instrument';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { einheitStatusAnzeige, fmsEtikett } from '../kraefte/meldebildRaster';
import { OHNE_VERBINDUNG_NICHT_AENDERBAR, useOhneVerbindung } from '../offline/verbindung';

/**
 * Status der eigenen Einheit am Einheitengerät (LLH-1579, Spec `funktionsansichten`): der aktuelle
 * Status mit „seit“, darunter je Eintrag des Org-Statuskatalogs eine Fläche. Die Einsatzleitung
 * sieht den Wechsel live samt ETB-Eintrag (`PUT …/einheiten/{eid}/status`). Mit Fahrzeugen ist der
 * Status abgeleitet und nur Anzeige (F8, der Server lehnte mit 422 ab). „Kein Status“ fehlt: den
 * Handstatus zu löschen ist Sache der Führung (403). Ohne Verbindung gesperrt, mit letztem Stand
 * und nicht vorgemerkt (F5): ein Status von gestern wäre falsch.
 */
export default function GeraetStatusPage() {
  const { geraet } = useAuth();
  const einsatzId = geraet?.einsatz_id ?? 0;
  const einheitId = geraet?.stelle_id ?? null;
  const qc = useQueryClient();
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const ohneVerbindung = useOhneVerbindung();
  const [fehler, setFehler] = useState<unknown>(null);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
    enabled: geraet != null,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: geraet != null,
  });
  const katalogQuery = useQuery({
    queryKey: globalKeys.fahrzeugStatus(),
    queryFn: listeFahrzeugStatus,
    enabled: geraet != null,
  });
  const einheit = einheitenQuery.data?.find((e) => e.id === einheitId);
  const mitFahrzeug = (einheit?.fahrzeug_mitglieder.length ?? 0) > 0;
  const darfSetzen =
    darfImEinsatzSchreiben(einsatzQuery.data) && !ohneVerbindung && einheit != null && !mitFahrzeug;

  const setzen = useMutation({
    mutationFn: (statusId: number) => setzeEinheitStatus(einsatzId, einheitId!, statusId),
    onMutate: () => setFehler(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) }),
    onError: (e) => setFehler(e),
  });

  if (einheitenQuery.isLoading) {
    return (
      <EinsatzSeite titel="Status">
        <Spin />
      </EinsatzSeite>
    );
  }
  if (!einheit) {
    return (
      <EinsatzSeite titel="Status">
        {einheitenQuery.isError ? (
          <Alert type="error" showIcon title="Einheit konnte nicht geladen werden" />
        ) : (
          <SeitenLeer titel="Einheit nicht gefunden" />
        )}
      </EinsatzSeite>
    );
  }

  const s = einheitStatusAnzeige(einheit.status);
  const aktuell =
    einheit.status.quelle === 'hand' ? (einheit.status.status?.status_id ?? null) : null;
  const katalog: readonly FahrzeugStatus[] = katalogQuery.data ?? [];

  return (
    <EinsatzSeite titel="Status" dataUpdatedAt={einheitenQuery.dataUpdatedAt}>
      <Flex vertical gap="middle">
        <Paneel titel={einheit.name} koerperPolster>
          <Flex align="center" gap="small" wrap data-lfh="einheit-status-aktuell">
            <StatusChip ton={s.ton} code={s.code ?? undefined} wort={s.wort} trenner />
            {einheit.status.seit && (
              <span style={{ ...monoStil(13), color: rollen.gedaempft }}>
                seit {zeitKurz(einheit.status.seit, konventionen)}
              </span>
            )}
          </Flex>
          {s.verteilung && (
            <div style={{ ...monoStil(12), color: rollen.gedaempft, marginTop: token.marginXXS }}>
              {s.verteilung}
            </div>
          )}
        </Paneel>
        {ohneVerbindung && !mitFahrzeug && (
          <Alert type="warning" showIcon title={OHNE_VERBINDUNG_NICHT_AENDERBAR} />
        )}
        {!mitFahrzeug &&
          (katalogQuery.isError ? (
            <Alert type="error" showIcon title="Statusliste konnte nicht geladen werden" />
          ) : katalogQuery.isLoading ? (
            <Spin />
          ) : (
            <div
              role="group"
              aria-label="Status setzen"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: token.marginSM,
              }}
            >
              {katalog.map((k) => {
                const gewaehlt = k.id === aktuell;
                return (
                  <Button
                    key={k.id}
                    size="large"
                    type={gewaehlt ? 'primary' : 'default'}
                    aria-pressed={gewaehlt}
                    disabled={!darfSetzen || (setzen.isPending && setzen.variables !== k.id)}
                    loading={setzen.isPending && setzen.variables === k.id}
                    onClick={() => {
                      if (!gewaehlt) setzen.mutate(k.id);
                    }}
                    style={{
                      // Daumenziel wie die Gerätenavigation (LFH-384).
                      minHeight: Math.max(64, token.controlHeightLG),
                      whiteSpace: 'normal',
                      borderLeft: k.farbe ? `6px solid ${k.farbe}` : undefined,
                    }}
                  >
                    {fmsEtikett(k.label, k.fms_anker)}
                  </Button>
                );
              })}
            </div>
          ))}
        {fehler != null && <ZeilenFehler fehler={fehler} fallback="Status nicht gesetzt" />}
      </Flex>
    </EinsatzSeite>
  );
}
