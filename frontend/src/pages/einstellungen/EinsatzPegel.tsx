import { useMemo, useState } from 'react';
import { Alert, App, Button, Dropdown, Tag, Typography } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { Formularpaneel, useRollen } from '../../components/instrument';
import { Liste, ListenEintrag, ListenEintragMeta } from '../../components/Liste';
import { Select } from '../../components/Select';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { SeitenHinweise } from '../../components/SpeicherHinweis';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { formatUhrzeitMitTag } from '../../anzeige/format';
import { ladeFachebene } from '../../api/fachebenen';
import {
  PEGEL_MAX,
  fuegePegelHinzu,
  pegelAbfrage,
  setzePegel,
  type PegelWahl,
} from '../../api/pegel';
import { einsatzKeys, globalKeys } from '../../api/queryKeys';
import type { PegelAnzeige } from '../../api/types';
import { PEGEL_STAND_UNBEKANNT, trendText, wasserstandMeter } from '../../pegel/pegelKennzahl';
import { RECHTE_TEXT, useEinstellungenDaten } from '../EinsatzEinstellungenPage';

/** Eine wählbare PEGELONLINE-Station aus der Fachebene (`properties` der Features). */
export interface PegelStation {
  uuid: string;
  name: string;
  gewaesser: string | null;
  km: number | null;
}

const KM = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2, useGrouping: false });

/** Auswahl-Label „Name · Gewässer · km 134,02" — fehlende Teile fallen weg. Rein. */
export function stationsLabel(s: Pick<PegelStation, 'name' | 'gewaesser' | 'km'>): string {
  return [s.name, s.gewaesser, s.km != null ? `km ${KM.format(s.km)}` : null]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Stationen aus der Fachebenen-Antwort. Nur Features mit `uuid` sind wählbar — ohne sie
 * gäbe es nichts, was das Backend festlegen könnte. Die Eigenschaft heißt `titel`, nicht
 * `name` (`karte/normalisierung.rs`). Sortiert nach Name, Tiebreak uuid. Rein.
 */
export function stationenAus(features: readonly { properties?: unknown }[]): PegelStation[] {
  const aus: PegelStation[] = [];
  for (const f of features) {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const uuid = typeof p.uuid === 'string' ? p.uuid.trim().toLowerCase() : '';
    if (!uuid) continue;
    const titel = typeof p.titel === 'string' && p.titel.trim() ? p.titel.trim() : 'Pegel';
    const gewaesser =
      typeof p.gewaesser === 'string' && p.gewaesser.trim() ? p.gewaesser.trim() : null;
    const km = typeof p.km === 'number' && Number.isFinite(p.km) ? p.km : null;
    aus.push({ uuid, name: titel, gewaesser, km });
  }
  return aus.sort((a, b) => a.name.localeCompare(b.name, 'de') || a.uuid.localeCompare(b.uuid));
}

/** Server-Eintrag → Wahl für den Vollersatz-PUT (Snapshot-Name und Gewässer bleiben). */
function alsWahl(p: PegelAnzeige): PegelWahl {
  return { station_uuid: p.station_uuid, name: p.name, gewaesser: p.gewaesser ?? null };
}

/** Liste mit einem Eintrag um eine Stelle verschoben (`richtung` −1 hoch, +1 runter). Rein. */
export function verschiebe<T>(liste: readonly T[], index: number, richtung: -1 | 1): T[] {
  const ziel = index + richtung;
  if (ziel < 0 || ziel >= liste.length) return [...liste];
  const neu = [...liste];
  [neu[index], neu[ziel]] = [neu[ziel], neu[index]];
  return neu;
}

type Aenderung =
  { art: 'hinzufuegen'; station: PegelWahl } | { art: 'setzen'; stationen: PegelWahl[] };

/**
 * Sektion `…/einstellungen/pegel` (LFH-606) — die maßgeblichen Pegel des Einsatzes.
 *
 * ── SPEICHERWEG: SOFORT, WIE DIE MODUL-LISTE ───────────────────────────────────────
 * Die Sektion ist eine LISTE, kein Formular, und folgt deshalb der Bestandssektion, die
 * ebenfalls eine Liste ist (`EinsatzModule`, LFH-345 · H15): jede Handlung — Hinzufügen,
 * Entfernen, Hoch, Runter — speichert sofort, es gibt keine Speicher-Leiste. Drei Gründe:
 *
 *  1. **Kein Entwurf, der verloren gehen kann.** Eine Leiste hielte einen lokalen Entwurf
 *     neben dem Serverstand; wer nach dem Umordnen den Reiter wechselt, verlöre ihn still —
 *     und ein Verlustschutz (`useEntwurfVerlustschutz`) für höchstens fünf Zeilen wäre mehr
 *     Mechanik als Inhalt.
 *  2. **Der Karten-Schnellweg speichert ebenfalls sofort** (POST aus dem
 *     Fachebenen-Inspector). Zwei Bedienlogiken für dieselbe Liste wären der Fehlerfall, den
 *     H15 an der Modul-Liste beseitigt hat.
 *  3. **Die Enter-Zusicherung der Erfassungs-Norm (B4) greift hier gar nicht**: es gibt kein
 *     Textfeld, und das einzige Eingabeelement ist ein `Select` — rc-select schluckt Enter
 *     ohnehin (`BaseSelect/index.js:246`, CLAUDE.md). Ein `<form>` hätte nichts zu tragen.
 *
 * Der Preis ist ein Vollersatz-PUT je Pfeildruck; bei höchstens fünf Zeilen ist das kein
 * Preis. **Hinzufügen geht über POST** (hinten anfügen, idempotent), nicht über den PUT: es
 * braucht die eigene Liste nicht als Basis und überschreibt damit keine gleichzeitige
 * Änderung von anderer Stelle.
 *
 * Während eine Änderung läuft, ist die GANZE Liste gesperrt — anders als die Modul-Liste
 * („eine Zeile sperrt sich selbst", C10/H15): dort schreibt jede Zeile ihren eigenen
 * Datensatz, hier schreibt jede Handlung die ganze Liste. Es gibt kein optimistisches
 * Update: die Anzeige liest aus der Abfrage, eine gescheiterte Änderung ist also sichtbar
 * nicht geschehen, und der Grund steht als `SpeicherFehler` über der Liste.
 *
 * ── RECHTE ──────────────────────────────────────────────────────────────────────────
 * Dieselbe Achse wie die Formular-Sektionen (`darfImEinsatzSchreiben`) — das Backend-Gate
 * der Pegel-Routen ist das der Einsatz-Kopfdaten. Ohne Recht: `RechteHinweis`, Auswahl und
 * „Hinzufügen" stehen gesperrt da (C10/M16); die Zeilenaktionen entfallen ganz (C11/M45:
 * n gesperrte Menüs kosten Platz für null Handlung, der Grund steht einmal oben).
 *
 * ── ZEILENAKTIONEN ──────────────────────────────────────────────────────────────────
 * Drei Aktionen je Zeile (Nach oben, Nach unten, Entfernen) → gebündelt im Dreipunkt-Menü
 * (Bündelungsregel LFH-365). An den Enden ist „Nach oben"/„Nach unten" GESPERRT statt
 * weggelassen: sonst hätte die erste Zeile zwei Aktionen und bekäme nach der Kardinalitäts-
 * regel direkte Knöpfe, die zweite ein Menü — eine Liste mit wechselnder Bedienform.
 * Entfernen ist umkehrbar (wieder hinzufügen) und trägt deshalb keine Rückfrage (LFH-378).
 *
 * ── FACHEBENE NICHT ERREICHBAR ─────────────────────────────────────────────────────
 * Die Stationsliste kommt aus der Fachebene `pegelonline` (derselbe Cache-Eintrag wie auf
 * der Lagekarte). Antwortet sie nicht, sagt ein Hinweis das; die festgelegte Liste bleibt
 * bedienbar (Entfernen, Umordnen), nur das Hinzufügen wartet.
 */
export default function EinsatzPegel() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const daten = useEinstellungenDaten(einsatzId);
  const [auswahl, setAuswahl] = useState<string | null>(null);

  const pegelQ = useQuery(pegelAbfrage(einsatzId));
  const stationenQ = useQuery({
    queryKey: globalKeys.fachebene('pegelonline'),
    queryFn: () => ladeFachebene('pegelonline'),
  });

  // KEIN `onError`-Toast (H14): der Fehler steht als Alert über der Liste.
  const aendern = useMutation({
    mutationFn: (a: Aenderung) =>
      a.art === 'hinzufuegen'
        ? fuegePegelHinzu(einsatzId, a.station)
        : setzePegel(einsatzId, a.stationen),
    onSuccess: (liste, a) => {
      qc.setQueryData(einsatzKeys.pegel(einsatzId), liste);
      if (a.art === 'hinzufuegen') setAuswahl(null);
      message.success('Pegel gespeichert');
    },
  });

  const stationen = useMemo(
    () => stationenAus(stationenQ.data?.features.features ?? []),
    [stationenQ.data],
  );

  if (daten.laedt || pegelQ.isLoading) return <SeitenSkeleton />;
  /*
   * Ohne Bestand kein Bearbeiten: ein gescheiterter Abruf fiele sonst in die leere Liste,
   * und der nächste Pfeil schickte genau diese erfundene Leere als Vollersatz-PUT — die
   * festgelegten Pegel wären weg (dieselbe Falle wie in `EinsatzModule`).
   */
  if (pegelQ.isError || !pegelQ.data) {
    return (
      <SeitenFehler
        text="Pegel nicht ladbar — ohne den Bestand kann hier nichts geändert werden"
        ursache={pegelQ.error}
        onWiederholen={() => void pegelQ.refetch()}
      />
    );
  }

  const liste = pegelQ.data;
  const darf = daten.darfBearbeiten;
  const laeuft = aendern.isPending;
  const voll = liste.length >= PEGEL_MAX;
  const festgelegt = new Set(liste.map((p) => p.station_uuid.toLowerCase()));
  // Nicht erreichbar: der Abruf scheitert, oder das Backend meldet die Quelle `offline` und
  // hat keinen Bestand aus dem Cache — mit Cache-Bestand bleibt die Auswahl nutzbar.
  const stationenFehlen =
    stationenQ.isError || (stationenQ.data?.status === 'offline' && stationen.length === 0);
  const gewaehlt = stationen.find((s) => s.uuid === auswahl) ?? null;

  const setzen = (neu: PegelAnzeige[]) =>
    aendern.mutate({ art: 'setzen', stationen: neu.map(alsWahl) });

  const messText = (p: PegelAnzeige): string => {
    const m = p.messung;
    if (!m) return PEGEL_STAND_UNBEKANNT;
    return [
      `${wasserstandMeter(m.wasserstand_cm)} m`,
      trendText(m.trend_cm_pro_h),
      `Stand ${formatUhrzeitMitTag(m.zeitpunkt, konv)}`,
    ].join(' · ');
  };

  return (
    <>
      <SeitenHinweise
        fehler={aendern.error}
        rechteFehlt={daten.istAktiv && !darf}
        rechteText={RECHTE_TEXT}
      />
      <Formularpaneel
        titel="Maßgebliche Pegel"
        beschreibung={`Welche PEGELONLINE-Stationen für diesen Einsatz zählen. Der erste ist der Leitpegel: er steht als Kennzahl auf dem Lage-Dashboard und im Überblick. Höchstens ${PEGEL_MAX}. Änderungen werden sofort gespeichert.`}
        dataUpdatedAt={pegelQ.dataUpdatedAt}
      >
        <Liste<PegelAnzeige>
          bordered
          dataSource={liste}
          rowKey={(p) => p.station_uuid}
          emptyText="Noch kein Pegel festgelegt — unten eine Station wählen."
          renderItem={(p, index) => (
            <ListenEintrag
              actions={
                darf
                  ? [
                      <Dropdown
                        key="aktionen"
                        trigger={['click']}
                        autoFocus
                        disabled={laeuft}
                        menu={{
                          items: [
                            {
                              key: 'hoch',
                              icon: <ArrowUpOutlined />,
                              label: 'Nach oben',
                              disabled: index === 0,
                            },
                            {
                              key: 'runter',
                              icon: <ArrowDownOutlined />,
                              label: 'Nach unten',
                              disabled: index === liste.length - 1,
                            },
                            { type: 'divider' as const },
                            {
                              key: 'entfernen',
                              icon: <DeleteOutlined />,
                              label: 'Entfernen',
                              danger: true,
                            },
                          ],
                          // Zuordnung am MENÜ, nicht je Eintrag (LFH-365).
                          onClick: ({ key }) => {
                            if (key === 'hoch') setzen(verschiebe(liste, index, -1));
                            else if (key === 'runter') setzen(verschiebe(liste, index, 1));
                            else if (key === 'entfernen')
                              setzen(liste.filter((_, i) => i !== index));
                          },
                        }}
                      >
                        {/* Der Name trägt die Zeilenkennung (LFH-364). Kein `size`. */}
                        <Button
                          type="text"
                          icon={<MoreOutlined />}
                          aria-label={`Aktionen zu Pegel ${p.name}`}
                        />
                      </Dropdown>,
                    ]
                  : undefined
              }
            >
              <ListenEintragMeta
                title={
                  <span
                    style={{
                      display: 'inline-flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: token.marginXS,
                    }}
                  >
                    <span data-lfh="pegel-titel">{`${index + 1}. ${p.name}`}</span>
                    {index === 0 && <Tag data-lfh="leitpegel">Leitpegel</Tag>}
                  </span>
                }
                description={
                  <span style={{ color: rollen.gedaempft }}>
                    {[p.gewaesser, messText(p)].filter(Boolean).join(' · ')}
                  </span>
                }
              />
            </ListenEintrag>
          )}
        />

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: token.marginSM,
            marginBlockStart: token.margin,
          }}
        >
          <Select<string>
            aria-label="Station wählen"
            style={{ flex: '1 1 16rem', minWidth: 0 }}
            placeholder="Station suchen (Name, Gewässer, km)"
            value={auswahl ?? undefined}
            onChange={(v) => setAuswahl(v)}
            allowClear
            onClear={() => setAuswahl(null)}
            loading={stationenQ.isLoading}
            disabled={!darf || voll || laeuft || stationenFehlen}
            showSearch={{
              filterOption: (eingabe, option) =>
                String(option?.label ?? '')
                  .toLowerCase()
                  .includes(eingabe.trim().toLowerCase()),
            }}
            options={stationen.map((s) => ({
              value: s.uuid,
              label: stationsLabel(s),
              disabled: festgelegt.has(s.uuid),
            }))}
          />
          <Button
            type="primary"
            disabled={!darf || voll || !gewaehlt || festgelegt.has(gewaehlt.uuid)}
            loading={laeuft && aendern.variables?.art === 'hinzufuegen'}
            onClick={() => {
              if (!gewaehlt) return;
              aendern.mutate({
                art: 'hinzufuegen',
                station: {
                  station_uuid: gewaehlt.uuid,
                  name: gewaehlt.name,
                  gewaesser: gewaehlt.gewaesser,
                },
              });
            }}
          >
            Hinzufügen
          </Button>
        </div>

        {voll && darf && (
          <Typography.Paragraph
            data-lfh="pegel-grenze"
            style={{ marginBlockStart: token.marginXS, marginBlockEnd: 0, color: rollen.gedaempft }}
          >
            {`Höchstens ${PEGEL_MAX} maßgebliche Pegel — zum Hinzufügen zuerst einen entfernen.`}
          </Typography.Paragraph>
        )}

        {stationenFehlen && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBlockStart: token.marginSM }}
            title="Die Stationsliste von PEGELONLINE ist gerade nicht erreichbar."
            description="Neue Pegel lassen sich erst wieder hinzufügen, wenn sie antwortet. Die festgelegten Pegel bleiben bedienbar: umordnen und entfernen geht weiter."
            action={<Button onClick={() => void stationenQ.refetch()}>Erneut abrufen</Button>}
          />
        )}
      </Formularpaneel>
    </>
  );
}
