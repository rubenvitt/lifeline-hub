import { App, Breadcrumb, Button, Flex, Skeleton, Space, Typography, theme } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ladeEinsatz, ladeModulOverrides } from '../api/einsaetze';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import { ladeStab } from '../api/stab';
import type { Sachgebiet } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import EinsatzSeite from '../components/EinsatzSeite';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import { Paneel } from '../components/instrument';
import { RechteHinweis } from '../components/SpeicherHinweis';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import StatusTag from '../components/StatusTag';
import { modulZielRoute } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { einsatzModulPfad, funkplanPfad } from '../routing/deeplinks';
import BesetzungModal from '../stab/BesetzungModal';
import LagebesprechungHistorie from '../stab/LagebesprechungHistorie';
import LagebesprechungModal from '../stab/LagebesprechungModal';
import LagebesprechungStand from '../stab/LagebesprechungStand';
import { zeigeAbschlussToast } from '../stab/abschlussToast';
import { besetzungDarstellung, besetzungRechteText, zeileFuer } from '../stab/besetzung';
import { mitWirksamemLabel } from '../stab/sachgebiete';
import { ladeFuehrungsfunktionen } from '../api/fuehrungsfunktionen';
import { werkzeugeFuer } from '../stab/werkzeuge';
import { stabZeilenzielStil } from '../stab/zeilenziel';
import { einsatzStatus } from '../theme/statusFarben';

/**
 * Modul „Stab" (LFH-46): Lagebesprechung und Führungsorganisation S1–S6.
 *
 * Eine Vollseite, zwei Sektionen, zwei Masken. Die Besetzung ist eine `Liste` mit sechs festen
 * Zeilen — hier wird nichts verglichen. Die Zeile ist kein Klickziel; genau eine Aktion „Besetzung
 * ändern" je Zeile, ohne Schreibrecht entfällt sie und ein Satz nennt den Grund.
 *
 * Der Kopf trägt genau eine Primäraktion „Lagebesprechung abschließen". Sie öffnet ein Modal und
 * gehört deshalb in den Kopf; ohne Schreibrecht steht sie gesperrt da, und `neueZeile` der
 * Kommandopalette trägt denselben Riegel.
 *
 * Live: das `stab`-Ereignis invalidiert `einsatz-stab` samt Historie.
 */
export default function StabPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [offenFuer, setOffenFuer] = useState<Sachgebiet | null>(null);
  const [abschlussOffen, setAbschlussOffen] = useState(false);

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
  // Wirksame Mandantenlabels der Zeilen (LFH-549); ohne Katalog das Standardlabel.
  const katalogQuery = useQuery({
    queryKey: globalKeys.fuehrungsfunktionen(),
    queryFn: ladeFuehrungsfunktionen,
    staleTime: 5 * 60_000,
  });

  // Vor den frühen Returns (Hook-Reihenfolge): der `?neu=1`-Leser darunter braucht das Recht, bevor
  // der Einsatz sicher geladen ist. `darfImEinsatzSchreiben` liefert für `undefined` false.
  const darfSchreiben = darfImEinsatzSchreiben(einsatzQuery.data, benutzer);
  const stabDa = stabQuery.data != null;
  // Ohne Stand fehlte der bestehende Termin zur Vorbelegung — ein unverändertes Absenden schickte
  // `naechste_at: null` und löschte ihn.
  const abschlussErlaubt = darfSchreiben && stabDa;
  const oeffneAbschluss = useCallback(() => setAbschlussOffen(true), []);

  // Fällt das Recht (oder der Stand) bei offener Maske weg, hängt der Render sie aus — der Merker
  // bliebe aber stehen, und kämen die Rechte zurück, stünde die Maske ungefragt wieder auf. Deshalb
  // auch den Merker räumen.
  useEffect(() => {
    if (abschlussOffen && !abschlussErlaubt) setAbschlussOffen(false);
  }, [abschlussOffen, abschlussErlaubt]);

  // Schnellaktion: ?neu=1 öffnet den Abschluss der Lagebesprechung (Kommandopalette). Das Literal
  // `searchParams.get('neu')` muss in dieser Datei stehen: `schnellaktionen.guard.test.ts` ordnet
  // den Leser über den Dateinamen dem Modul zu. Warten, bis Einsatz und Stand geladen sind;
  // Parameter immer räumen (apply-then-clean), die Maske nur mit Schreibrecht und Stand öffnen.
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading || stabQuery.isLoading) return;
    if (darfSchreiben && stabDa) setAbschlussOffen(true);
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [
    searchParams,
    setSearchParams,
    einsatzQuery.isLoading,
    stabQuery.isLoading,
    darfSchreiben,
    stabDa,
  ]);

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

  // Fehler ≠ leer: ohne Daten tritt der Fehler an die Stelle der Liste — sechs „nicht vergeben"
  // wären sonst eine Aussage über eine Menge, die nie ankam.
  const stabGescheitert = stabQuery.isError && !stabQuery.data;
  const standVeraltet = stabQuery.isError && stabQuery.data != null;
  const sachgebiete = mitWirksamemLabel(katalogQuery.data ?? []);
  const offenerEintrag = sachgebiete.find((s) => s.sachgebiet === offenFuer);
  const vergeben = sachgebiete.filter((s) => zeileFuer(stabQuery.data, s.sachgebiet)).length;

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
      // Gesperrt statt versteckt: der Hinweis darunter nennt den Grund.
      aktionen={
        <Button type="primary" disabled={!abschlussErlaubt} onClick={oeffneAbschluss}>
          Lagebesprechung abschließen
        </Button>
      }
      // Derselbe Riegel wie am Knopf — die Palette ist ein zweiter Weg auf dieselbe Aktion.
      neueZeile={abschlussErlaubt ? oeffneAbschluss : undefined}
      // Bedingt übergeben, nicht über `sichtbar` allein: `EinsatzSeite` rendert den Slot, sobald er
      // truthy ist — ein JSX-Element ist das immer, auch wenn es `null` zurückgibt, und hinterließe
      // ein leeres `div` mit Außenabstand.
      hinweis={
        !darfSchreiben && <RechteHinweis sichtbar text={besetzungRechteText(einsatz.status)} />
      }
    >
      {/* Paneele statt Sektionskopf + `<section>`: das Paneel ist die benannte Region
          (`aria-labelledby` auf seine Augenbraue). */}
      <Paneel titel="Lagebesprechung" koerperPolster style={{ marginBottom: token.margin }}>
        <Flex vertical gap={token.margin}>
          {stabGescheitert ? (
            <SeitenFehler
              text="Stand der Lagebesprechung konnte nicht geladen werden"
              ursache={stabQuery.error}
              onWiederholen={() => void stabQuery.refetch()}
            />
          ) : stabQuery.data ? (
            <LagebesprechungStand einsatzId={einsatzId} stab={stabQuery.data} />
          ) : (
            // Vor dem Laden wird kein Termin behauptet.
            <Skeleton title={false} paragraph={{ rows: 3 }} />
          )}
          <LagebesprechungHistorie einsatzId={einsatzId} />
        </Flex>
      </Paneel>

      <Paneel
        titel="Besetzung S1–S6"
        meta={stabQuery.data ? `${vergeben}/${sachgebiete.length} vergeben` : undefined}
        koerperPolster
      >
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
              dataSource={sachgebiete}
              rowKey={(s) => s.sachgebiet}
              loading={stabQuery.isLoading}
              renderItem={(s) => {
                const zeile = zeileFuer(stabQuery.data, s.sachgebiet);
                const werkzeuge = werkzeugeFuer(s.werkzeuge, benutzer, overridesQuery.data);
                // Das Arbeitsergebnis der S6 (LFH-548): ein Einstieg in eine Unterroute des
                // Stabs, kein Modul. Deshalb nicht über `werkzeugeFuer`, und es bleibt stehen,
                // wenn die Modul-Werkzeuge der Zeile ausgeblendet sind; die Sperre erbt es vom
                // Stab selbst.
                const funkplan = s.sachgebiet === 's6';
                return (
                  <ListenEintrag
                    actions={
                      // Erst mit Daten: vor dem Laden belegte die Maske „nicht vergeben" vor. Die
                      // Tastatur erreicht den Knopf auch unter dem Ladeindikator.
                      darfSchreiben && stabQuery.data
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
                              behauptet — „nicht vergeben" vor dem Laden wäre eine Aussage über
                              eine Menge, die noch nicht da ist. */}
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
                          {(werkzeuge.length > 0 || funkplan) && (
                            <Flex wrap role="group" aria-label={`Werkzeuge ${s.kuerzel}`}>
                              {funkplan && (
                                <Link
                                  to={funkplanPfad(einsatzId)}
                                  style={stabZeilenzielStil(token)}
                                >
                                  Funkplan
                                </Link>
                              )}
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
      </Paneel>
      {offenerEintrag && darfSchreiben && (
        <BesetzungModal
          key={offenerEintrag.sachgebiet}
          einsatzId={einsatzId}
          eintrag={offenerEintrag}
          zeile={zeileFuer(stabQuery.data, offenerEintrag.sachgebiet)}
          onSchliessen={() => setOffenFuer(null)}
        />
      )}
      {/* Montiert = offen: die Maske friert Vorbelegung und Basis beim Montieren ein, und jede
          Öffnung hat eine frische Mutation ohne alten Fehler. Der Toast nimmt das `navigate`
          dieser Seite — `<AntApp>` liegt außerhalb des Routers. */}
      {abschlussOffen && darfSchreiben && stabQuery.data && (
        <LagebesprechungModal
          einsatzId={einsatzId}
          stab={stabQuery.data}
          onAbgeschlossen={(eigene) =>
            zeigeAbschlussToast(message, { einsatzId, eigene, navigate })
          }
          onSchliessen={() => setAbschlussOffen(false)}
        />
      )}
    </EinsatzSeite>
  );
}
