import { Breadcrumb, Button, Flex, Space, Typography, theme } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ladeEinsatz, ladeModulFreigaben } from '../api/einsaetze';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import { ladeStab } from '../api/stab';
import type { Sachgebiet } from '../api/types';
import EinsatzSeite from '../components/EinsatzSeite';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import { Paneel } from '../components/instrument';
import { RechteHinweis } from '../components/SpeicherHinweis';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import StatusTag from '../components/StatusTag';
import { useViewport } from '../components/useViewport';
import { istSprungGesperrt, modulZielRoute, modulName } from '../einsatz/modulRegistry';
import { GesperrterSprung } from '../components/Sprung';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { einsatzModulPfad } from '../routing/deeplinks';
import LagebesprechungZeile from '../lagebesprechung/LagebesprechungZeile';
import BesetzungModal from '../stab/BesetzungModal';
import ChecklistePaneel from '../stab/ChecklistePaneel';
import { besetzungDarstellung, besetzungRechteText, zeileFuer } from '../stab/besetzung';
import { mitWirksamemLabel } from '../stab/sachgebiete';
import { ladeFuehrungsfunktionen } from '../api/fuehrungsfunktionen';
import { werkzeugeFuer } from '../stab/werkzeuge';
import { unterseitenFuer } from '../stab/unterseiten';
import { stabZeilenzielStil } from '../stab/zeilenziel';

/**
 * Modul „Stab" (LFH-46): Führungsorganisation S1–S6.
 *
 * Eine Vollseite: oben die Zeile „Nächste Lagebesprechung“ mit Sprung in das eigene Modul
 * (LLH-1111, `lagebesprechung/LagebesprechungZeile.tsx`) — Vorbereitung, Abschluss und Verlauf trägt
 * seit LLH-1111 die Seite Lagebesprechung, nicht mehr der Stab. Darunter Besetzung und
 * Arbeitsaufnahme.
 *
 * Die Besetzung ist eine `Liste` mit sechs festen Zeilen — hier wird nichts verglichen. Die Zeile
 * ist kein Klickziel; genau eine Aktion „Besetzung ändern" je Zeile, ohne Schreibrecht entfällt sie
 * und ein Satz nennt den Grund.
 *
 * Das Paneel „Arbeitsaufnahme" (LFH-551) steht ganz unten: die Checkliste ist nach zehn Minuten
 * erledigt und soll dann die Besetzung nicht nach unten drücken. Eigene Abfrage, eigener Endpunkt.
 *
 * Live: das `stab`-Ereignis invalidiert `einsatz-stab` samt Checkliste; den Termin der Zeile frischt
 * `einsatz` mit dem Kopf auf (LFH-555).
 */
export default function StabPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { token } = theme.useToken();
  const { istSchmal } = useViewport();
  const [offenFuer, setOffenFuer] = useState<Sachgebiet | null>(null);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const stabQuery = useQuery({
    queryKey: einsatzKeys.stab(einsatzId),
    queryFn: () => ladeStab(einsatzId),
  });
  // Modul-Freigaben vom Server (LFH-669): filtern die Werkzeuge der Zeilen und sperren den Sprung in
  // die Lagebesprechung.
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  // Wirksame Mandantenlabels der Zeilen (LFH-549); ohne Katalog das Standardlabel.
  const katalogQuery = useQuery({
    queryKey: globalKeys.fuehrungsfunktionen(),
    queryFn: ladeFuehrungsfunktionen,
    staleTime: 5 * 60_000,
  });

  const darfSchreiben = darfImEinsatzSchreiben(einsatzQuery.data);

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
      titel={modulName('stab')}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('stab') },
          ]}
        />
      }
      // Bedingt übergeben, nicht über `sichtbar` allein: `EinsatzSeite` rendert den Slot, sobald er
      // truthy ist — ein JSX-Element ist das immer, auch wenn es `null` zurückgibt, und hinterließe
      // ein leeres `div` mit Außenabstand.
      hinweis={
        !darfSchreiben && <RechteHinweis sichtbar text={besetzungRechteText(einsatz.status)} />
      }
    >
      <LagebesprechungZeile
        einsatzId={einsatzId}
        termin={einsatz.naechste_lagebesprechung_at}
        freigaben={freigabenQuery.data}
      />

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
              // Unter dem Paneel (h2): jedes Sachgebiet ein Gegenstand mit Besetzung und
              // Werkzeugen darunter, sein Titel h3 (LFH-826).
              unterEbene={2}
              dataSource={sachgebiete}
              rowKey={(s) => s.sachgebiet}
              loading={stabQuery.isLoading}
              renderItem={(s) => {
                const zeile = zeileFuer(stabQuery.data, s.sachgebiet);
                const werkzeuge = werkzeugeFuer(s.werkzeuge, freigabenQuery.data);
                // Arbeitsseiten des Sachgebiets (`stab/unterseiten.ts`): S5 als Unterroute des
                // Stabs, S6 als Sprung ins Modul Fernmeldewesen (LLH-1180). Ein Sprung erbt Sperre
                // und Sichtbarkeit seines Ziels: ausgeblendet fehlt er, gesperrt steht er mit
                // Grund da (Spec `fernmeldewesen`, „Einstiege von der Stab-Seite …“).
                const unterseiten = unterseitenFuer(s.sachgebiet).filter(
                  (u) => freigabenQuery.data?.[u.modul]?.sichtbar !== false,
                );
                return (
                  <ListenEintrag
                    // Unter `md` steht „Besetzung ändern“ unter dem Inhalt (LFH-978): rechts
                    // daneben blieben der Beschreibung auf 390 px rund 190 px, die Seite wurde
                    // über 5 000 px lang.
                    gestapelt={istSchmal}
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
                          {/* Fundstelle ist Quelle, keine Bedienerklärung: sichtbar, auch bei Touch. */}
                          <span>
                            {s.aufgaben}{' '}
                            <Typography.Text type="secondary">
                              (FwDV 100 Anl. 2, S. {s.seite})
                            </Typography.Text>
                          </span>
                          {(werkzeuge.length > 0 || unterseiten.length > 0) && (
                            <Flex wrap role="group" aria-label={`Werkzeuge ${s.kuerzel}`}>
                              {unterseiten.map((u) =>
                                istSprungGesperrt(u.modul, freigabenQuery.data) ? (
                                  <GesperrterSprung key={u.key}>{u.label}</GesperrterSprung>
                                ) : (
                                  <Link
                                    key={u.key}
                                    to={u.pfad(einsatzId)}
                                    style={stabZeilenzielStil(token)}
                                  >
                                    {u.label}
                                  </Link>
                                ),
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

      <ChecklistePaneel
        einsatzId={einsatzId}
        darfSchreiben={darfSchreiben}
        style={{ marginTop: token.margin }}
      />
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
