import { App, Button, Flex, Typography } from 'antd';
import { useId, useState } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchEinsatzSchichtmodell, setEinsatzSchichtmodell } from '../../api/abloesungen';
import { ladeModulFreigaben } from '../../api/einsaetze';
import { einsatzKeys, globalKeys } from '../../api/queryKeys';
import { fetchSchichtmodelle, werteBodyOf } from '../../api/schichtmodelle';
import type { AbloesungEinsatzVorgabe, EinsatzSchichtmodellBody } from '../../api/types';
import { formatDauer } from '../../abloesung/dauer';
import SchichtmodellModal from '../../abloesung/SchichtmodellModal';
import { formatRegel } from '../../abloesung/schichtmodellText';
import { Datenfeld, Datenraster, Formularpaneel, useRollen } from '../../components/instrument';
import { NUR_LEITUNG_FUEHRUNG } from '../../components/nurAnsicht';
import { Select } from '../../components/Select';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { SeitenHinweise } from '../../components/SpeicherHinweis';
import { istKeyFreigegeben, modulName } from '../../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { zeigeRueckgaengig } from '../../kommunikation/rueckgaengig';
import { demoGroupedOptions } from '../../stammdaten/demoAuswahl';
import { useEinstellungenDaten } from '../EinsatzEinstellungenPage';

const { Text } = Typography;

/**
 * Sektion `…/einstellungen/abloesung` — die Vorgabe des Einsatzes für die Ablösung (LLH-1122,
 * Spec `kraefte-abloesung`, „Vorgabe des Einsatzes“): die Kopie eines Schichtmodells, die beim
 * Anlegen aus der Vorgabe der Organisation kam. Sie gilt für jede Schicht ohne eigenen Rhythmus,
 * deren Abschnitt keine Vorgabe hat, und bestimmt die Vorwarnzeit aller Schichten.
 *
 * Drei Wege, jeder speichert sofort (wie „Pegel“, keine Speichern-Leiste): ein Modell aus den
 * Stammdaten übernehmen, eigene Werte setzen (`SchichtmodellModal`, vorbelegt mit der Vorgabe)
 * oder die Vorgabe entfernen. Entfernen ist über den Rückgängig-Toast umkehrbar (derselbe PUT mit
 * den alten Werten), deshalb ohne Rückfrage (LFH-343/LFH-363).
 *
 * Rechte wie die Abschnittsvorgabe (`EinsatzSchreibzugriff<Abloesung>`): Einsatzleitung und
 * Führungspersonal eines laufenden Einsatzes; der Admin ohne Rolle bekäme 403. Ohne Freigabe des
 * Moduls Ablösung gibt es nichts zu lesen: die Sektion sagt das, statt eine Anfrage zu stellen.
 */
export default function EinsatzAbloesung() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token } = useRollen();
  const daten = useEinstellungenDaten(einsatzId);
  const darf = darfImEinsatzSchreiben(daten.einsatz);
  const auswahlId = useId();
  const [auswahl, setAuswahl] = useState<number | null>(null);
  const [eigeneOffen, setEigeneOffen] = useState(false);

  const freigabenQ = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const freigegeben = istKeyFreigegeben('abloesung', freigabenQ.data);
  const vorgabeQ = useQuery({
    queryKey: einsatzKeys.abloesungEinsatzVorgabe(einsatzId),
    queryFn: () => fetchEinsatzSchichtmodell(einsatzId),
    enabled: freigegeben,
  });
  // Die Modelle braucht nur, wer übernehmen darf (Lesen dürfte jedes Mitglied).
  const modelleQ = useQuery({
    queryKey: globalKeys.schichtmodelle(),
    queryFn: fetchSchichtmodelle,
    enabled: freigegeben && darf,
  });

  // Kein `onError`-Toast: der Grund steht über dem Paneel (bzw. im Dialog der eigenen Werte).
  const setzen = useMutation({
    mutationFn: (body: EinsatzSchichtmodellBody) => setEinsatzSchichtmodell(einsatzId, body),
    onSuccess: (antwort: AbloesungEinsatzVorgabe, body) => {
      const alt = qc.getQueryData<AbloesungEinsatzVorgabe>(
        einsatzKeys.abloesungEinsatzVorgabe(einsatzId),
      )?.schichtmodell;
      qc.setQueryData(einsatzKeys.abloesungEinsatzVorgabe(einsatzId), antwort);
      // Schichten mit Quelle `einsatz` rechnen neu; die Seite Ablösung soll das ohne Live sehen.
      void qc.invalidateQueries({ queryKey: einsatzKeys.abloesungen(einsatzId) });
      if ('schichtmodell_id' in body) setAuswahl(null);
      if ('schichtmodell' in body && body.schichtmodell === null && alt) {
        zeigeRueckgaengig(message, 'Vorgabe des Einsatzes entfernt', () =>
          setzen.mutate({ schichtmodell: werteBodyOf(alt) }),
        );
      } else {
        message.success('Vorgabe des Einsatzes gespeichert');
      }
    },
  });
  // Eigener Weg für den Dialog: sein Fehler steht im Dialog, nicht über dem Paneel.
  const eigene = useMutation({
    mutationFn: (body: EinsatzSchichtmodellBody) => setEinsatzSchichtmodell(einsatzId, body),
    onSuccess: (antwort) => {
      qc.setQueryData(einsatzKeys.abloesungEinsatzVorgabe(einsatzId), antwort);
      void qc.invalidateQueries({ queryKey: einsatzKeys.abloesungen(einsatzId) });
      message.success('Vorgabe des Einsatzes gespeichert');
    },
  });

  if (daten.laedt || freigabenQ.isLoading || (freigegeben && vorgabeQ.isLoading)) {
    return <SeitenSkeleton />;
  }
  // Ohne Freigaben wüsste die Sektion nicht, ob das Modul gesperrt ist: kein „nicht freigegeben“
  // auf Verdacht.
  if (freigabenQ.isError) {
    return (
      <SeitenFehler
        text="Modulfreigaben nicht ladbar"
        ursache={freigabenQ.error}
        onWiederholen={() => void freigabenQ.refetch()}
      />
    );
  }
  if (!freigegeben) {
    return (
      <Formularpaneel titel="Schichtmodell des Einsatzes">
        <Text type="secondary" style={{ display: 'block', padding: token.paddingSM }}>
          {`Modul „${modulName('abloesung')}“ nicht freigegeben`}
        </Text>
      </Formularpaneel>
    );
  }
  if (vorgabeQ.isError || !vorgabeQ.data) {
    return (
      <SeitenFehler
        text="Vorgabe des Einsatzes nicht ladbar"
        ursache={vorgabeQ.error}
        onWiederholen={() => void vorgabeQ.refetch()}
      />
    );
  }

  const modell = vorgabeQ.data.schichtmodell ?? null;
  const laeuft = setzen.isPending || eigene.isPending;
  const optionen = demoGroupedOptions(modelleQ.data ?? [], (m) =>
    m.ist_vorgabe ? `${m.bezeichnung} · Vorgabe der Organisation` : m.bezeichnung,
  );

  return (
    <>
      <SeitenHinweise
        fehler={setzen.error}
        fehlerTitel="Vorgabe nicht geändert"
        fehlerFallback="Ändern fehlgeschlagen"
        rechteFehlt={daten.istAktiv && !darf}
        rechteText={NUR_LEITUNG_FUEHRUNG}
      />
      <Formularpaneel
        titel="Schichtmodell des Einsatzes"
        dataUpdatedAt={vorgabeQ.dataUpdatedAt}
        aktion={
          darf ? (
            <Button
              disabled={laeuft}
              onClick={() => {
                eigene.reset();
                setEigeneOffen(true);
              }}
            >
              {modell ? 'Werte ändern' : 'Eigene Werte setzen'}
            </Button>
          ) : undefined
        }
      >
        {modell ? (
          <Datenraster beschriftung="Schichtmodell des Einsatzes">
            <Datenfeld label="Bezeichnung">{modell.bezeichnung}</Datenfeld>
            <Datenfeld label="Regel">{formatRegel(modell)}</Datenfeld>
            <Datenfeld label="Vorwarnung" mono>
              {formatDauer(modell.vorwarnung_minuten)}
            </Datenfeld>
            <Datenfeld label="Planungsvorlauf" mono>
              {formatDauer(modell.planungsvorlauf_minuten)}
            </Datenfeld>
            <Datenfeld label="Laufende Schichten" mono>
              {vorgabeQ.data.laufende_schichten}
            </Datenfeld>
          </Datenraster>
        ) : (
          <Text type="secondary" style={{ display: 'block', padding: token.paddingSM }}>
            {`Keine Vorgabe · Vorwarnung ${formatDauer(vorgabeQ.data.vorwarnung_minuten)}`}
          </Text>
        )}

        {darf && (
          <>
            {/* Sichtbares Label über dem Feld, kein bloßes aria-label. */}
            <label
              htmlFor={auswahlId}
              style={{
                display: 'block',
                marginBlockStart: token.margin,
                marginBlockEnd: token.marginXS,
              }}
            >
              Schichtmodell der Organisation
            </label>
            <Flex wrap gap={token.marginSM}>
              <Select<number>
                id={auswahlId}
                style={{ flex: '1 1 16rem', minWidth: 0 }}
                placeholder="Schichtmodell wählen"
                value={auswahl ?? undefined}
                onChange={(v) => setAuswahl(v)}
                allowClear
                onClear={() => setAuswahl(null)}
                loading={modelleQ.isLoading}
                disabled={laeuft}
                notFoundContent="Keine Schichtmodelle in den Stammdaten"
                options={optionen}
              />
              <Button
                type="primary"
                disabled={laeuft || auswahl == null}
                loading={
                  setzen.isPending &&
                  setzen.variables != null &&
                  'schichtmodell_id' in setzen.variables
                }
                onClick={() => auswahl != null && setzen.mutate({ schichtmodell_id: auswahl })}
              >
                Übernehmen
              </Button>
            </Flex>
            {modell && (
              <Flex justify="flex-end" style={{ marginBlockStart: token.margin }}>
                <Button
                  danger
                  disabled={laeuft}
                  onClick={() => setzen.mutate({ schichtmodell: null })}
                >
                  Vorgabe entfernen
                </Button>
              </Flex>
            )}
          </>
        )}
      </Formularpaneel>

      {eigeneOffen && (
        <SchichtmodellModal
          titel="Schichtmodell des Einsatzes"
          vorlage={modell}
          speicherung={eigene}
          onErfassen={(werte) => eigene.mutateAsync({ schichtmodell: werte })}
          onSchliessen={() => setEigeneOffen(false)}
        />
      )}
    </>
  );
}
