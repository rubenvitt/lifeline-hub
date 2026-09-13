import { Breadcrumb, Button, Flex, Space, Typography, theme } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ladeEinsatz, ladeModulOverrides } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import { ladeStab } from '../api/stab';
import type { Sachgebiet } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import EinsatzSeite from '../components/EinsatzSeite';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import SektionHeader from '../components/SektionHeader';
import { RechteHinweis } from '../components/SpeicherHinweis';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import StatusTag from '../components/StatusTag';
import { modulZielRoute } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { einsatzModulPfad } from '../routing/deeplinks';
import BesetzungModal from '../stab/BesetzungModal';
import { besetzungDarstellung, besetzungRechteText, zeileFuer } from '../stab/besetzung';
import { SACHGEBIETE } from '../stab/sachgebiete';
import { werkzeugeFuer } from '../stab/werkzeuge';
import { stabZeilenzielStil } from '../stab/zeilenziel';
import { einsatzStatus } from '../theme/statusFarben';

/**
 * Modul „Stab" (LFH-46): Führungsorganisation S1–S6 als sechs feste Zeilen.
 *
 * UI-Form (Spec Entscheidung 16): eine Vollseite, eine `Liste` — hier wird nichts verglichen,
 * sortiert oder gefiltert (LFH-330/B2), also keine Tabelle. Die Zeile selbst ist kein Klickziel;
 * genau eine Aktion „Besetzung ändern" je Zeile, ohne Schreibrecht entfällt sie und ein Satz
 * nennt den Grund (LFH-346 · C11). Die Kopfaktion „Lagebesprechung abschließen" und die
 * Lagebesprechungs-Sektion folgen in ST5 (LFH-543), die Lücken-Kennzahlen in ST6 (LFH-544).
 *
 * Live: das `stab`-Ereignis invalidiert `einsatz-stab` über den Einsatz-Stream (Bestand).
 */
export default function StabPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const { token } = theme.useToken();
  const [offenFuer, setOffenFuer] = useState<Sachgebiet | null>(null);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const stabQuery = useQuery({
    queryKey: einsatzKeys.stab(einsatzId),
    queryFn: () => ladeStab(einsatzId),
  });
  const overridesQuery = useQuery({
    queryKey: einsatzKeys.modulOverrides(einsatzId),
    queryFn: () => ladeModulOverrides(einsatzId),
  });

  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  // Fehler ≠ leer (LFH-331 · B3): ohne Daten tritt der Fehler an die Stelle der Liste — sechs
  // „nicht vergeben" wären sonst eine Aussage über eine Menge, die nie ankam.
  const stabGescheitert = stabQuery.isError && !stabQuery.data;
  const standVeraltet = stabQuery.isError && stabQuery.data != null;
  const offenerEintrag = SACHGEBIETE.find((s) => s.sachgebiet === offenFuer);

  return (
    <EinsatzSeite
      dataUpdatedAt={stabQuery.dataUpdatedAt}
      titel={
        <Space>
          Stab
          <StatusTag darstellung={einsatzStatus[einsatz.status]} />
        </Space>
      }
      beschreibung="Führungsorganisation (S1–S6) und Lagebesprechungen der Einsatzleitung"
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Stab' },
          ]}
        />
      }
      // Bedingt übergeben, nicht über `sichtbar` allein: `EinsatzSeite` rendert den Slot, sobald
      // er truthy ist — ein JSX-Element ist das immer, auch wenn es `null` zurückgibt, und
      // hinterliesse mit Schreibrecht ein leeres `div` mit Aussenabstand (Muster `SchaedenPage`).
      hinweis={
        !darfSchreiben && <RechteHinweis sichtbar text={besetzungRechteText(einsatz.status)} />
      }
    >
      <SektionHeader titel="Besetzung S1–S6" />
      <section aria-label="Besetzung S1–S6">
        {stabGescheitert ? (
          <SeitenFehler
            text="Führungsorganisation konnte nicht geladen werden"
            ursache={stabQuery.error}
            onWiederholen={() => void stabQuery.refetch()}
          />
        ) : (
          <>
            {standVeraltet && (
              <SeitenStandVeraltet onWiederholen={() => void stabQuery.refetch()} />
            )}
            <Liste
              dataSource={SACHGEBIETE}
              rowKey={(s) => s.sachgebiet}
              loading={stabQuery.isLoading}
              renderItem={(s) => {
                const zeile = zeileFuer(stabQuery.data, s.sachgebiet);
                const werkzeuge = werkzeugeFuer(s.werkzeuge, benutzer, overridesQuery.data);
                return (
                  <ListenEintrag
                    actions={
                      darfSchreiben
                        ? [
                            <Button
                              key="aendern"
                              aria-label={`Besetzung ändern – ${s.kuerzel} ${s.label}`}
                              onClick={() => setOffenFuer(s.sachgebiet)}
                            >
                              Besetzung ändern
                            </Button>,
                          ]
                        : undefined
                    }
                  >
                    <ListenEintragMeta
                      title={
                        <Space wrap>
                          {`${s.kuerzel} · ${s.label}`}
                          {/* Solange nichts angekommen ist, wird nichts über die Besetzung
                              behauptet (LFH-331 · B3/D4) — „nicht vergeben" vor dem Laden wäre
                              eine Aussage über eine Menge, die noch gar nicht da ist. */}
                          {stabQuery.data && (
                            <StatusTag darstellung={besetzungDarstellung(zeile)} />
                          )}
                        </Space>
                      }
                      description={
                        <Flex vertical gap={token.marginXXS}>
                          <span>
                            {s.aufgaben}{' '}
                            <Typography.Text type="secondary">
                              (FwDV 100 Anl. 2, S. {s.seite})
                            </Typography.Text>
                          </span>
                          {werkzeuge.length > 0 && (
                            <Flex wrap role="group" aria-label={`Werkzeuge ${s.kuerzel}`}>
                              {werkzeuge.map((m) => (
                                <Link
                                  key={m.key}
                                  to={einsatzModulPfad(einsatzId, modulZielRoute(m))}
                                  style={stabZeilenzielStil(token)}
                                >
                                  {m.label}
                                </Link>
                              ))}
                            </Flex>
                          )}
                        </Flex>
                      }
                    />
                  </ListenEintrag>
                );
              }}
            />
          </>
        )}
      </section>
      {offenerEintrag && darfSchreiben && (
        <BesetzungModal
          key={offenerEintrag.sachgebiet}
          einsatzId={einsatzId}
          eintrag={offenerEintrag}
          zeile={zeileFuer(stabQuery.data, offenerEintrag.sachgebiet)}
          onSchliessen={() => setOffenFuer(null)}
        />
      )}
    </EinsatzSeite>
  );
}
