import { useId, useMemo, useState } from 'react';
import { Alert, App, Button, Dropdown, Tag, Typography } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
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
import { ladeFachebene } from '../../api/fachebenen';
import {
  PEGEL_MAX,
  fuegePegelHinzu,
  loeschePrognose,
  pegelAbfrage,
  pegelSchreibScope,
  setzePegel,
  setzePrognose,
  type PegelEingabe,
} from '../../api/pegel';
import { einsatzKeys, globalKeys } from '../../api/queryKeys';
import type { PegelAnzeige } from '../../api/types';
import { zeigeRueckgaengig } from '../../kommunikation/rueckgaengig';
import {
  PEGEL_STAND_UNBEKANNT,
  prognoseOffen,
  prognoseText,
  standZeit,
  trendText,
  wasserstandMeter,
} from '../../pegel/pegelKennzahl';
import { RECHTE_TEXT, useEinstellungenDaten } from '../EinsatzEinstellungenPage';
import PegelPrognoseModal from './PegelPrognoseModal';
import { wiederherstellBody } from './pegelPrognoseKern';

/** Eine wählbare PEGELONLINE-Station aus der Fachebene (`properties` der Features). */
interface PegelStation {
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
 * Stationen aus der Fachebenen-Antwort. Nur Features mit `uuid` sind wählbar. Die Eigenschaft heißt
 * `titel`, nicht `name` (`karte/normalisierung.rs`). Sortiert nach Name, Tiebreak uuid. Rein.
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
function alsWahl(p: PegelAnzeige): PegelEingabe {
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

/** Eine Listenoperation, benannt über die STATION, nicht über ihren Index im alten Stand. */
type PegelOperation =
  { art: 'verschieben'; uuid: string; richtung: -1 | 1 } | { art: 'entfernen'; uuid: string };

/**
 * Wendet eine Operation auf eine (frisch geholte) Liste an. `null`, wenn die gemeinte Station
 * dort nicht mehr steht — dann gibt es nichts zu senden. Rein.
 */
export function wendeAn<T extends { station_uuid: string }>(
  liste: readonly T[],
  op: PegelOperation,
): T[] | null {
  const index = liste.findIndex((p) => p.station_uuid.toLowerCase() === op.uuid.toLowerCase());
  if (index < 0) return null;
  return op.art === 'entfernen'
    ? liste.filter((_, i) => i !== index)
    : verschiebe(liste, index, op.richtung);
}

type Aenderung = { art: 'hinzufuegen'; station: PegelEingabe } | PegelOperation;

/**
 * Sektion `…/einstellungen/pegel` — die maßgeblichen Pegel des Einsatzes.
 *
 * Speicherweg: sofort, wie die Modul-Liste. Jede Handlung (Hinzufügen, Entfernen, Hoch, Runter)
 * speichert sofort, es gibt keine Speicher-Leiste:
 * 1. Kein Entwurf, der verloren gehen kann — ein Verlustschutz für höchstens fünf Zeilen wäre mehr
 *    Mechanik als Inhalt.
 * 2. Der Karten-Schnellweg (Fachebenen-Inspector) speichert ebenfalls sofort; zwei Bedienlogiken
 *    für dieselbe Liste wären der Fehlerfall.
 * 3. Die Enter-Zusicherung der Erfassungs-Norm greift nicht: das einzige Eingabeelement ist ein
 *    `Select`, und rc-select schluckt Enter.
 *
 * Hinzufügen geht über POST (hinten anfügen, idempotent) und überschreibt so keine gleichzeitige
 * Änderung. Umordnen und Entfernen holen die Liste vor dem PUT frisch und benennen die Station über
 * ihre uuid — der Cache kann bis zu 5 min alt sein. Während eine Änderung läuft, ist die ganze
 * Liste gesperrt (jede Handlung schreibt die ganze Liste). Kein optimistisches Update; der Grund
 * einer gescheiterten Änderung steht als `SpeicherFehler` über der Liste.
 *
 * Rechte: dieselbe Achse wie die Formular-Sektionen (`darfImEinsatzSchreiben`). Ohne Recht:
 * `RechteHinweis`, Auswahl und „Hinzufügen" gesperrt, die Zeilenaktionen entfallen.
 *
 * Zeilenaktionen (Nach oben, Nach unten, Entfernen, Prognose) gebündelt im Menü. An den Enden ist
 * „Nach oben"/„Nach unten" gesperrt statt weggelassen, sonst wechselte die Bedienform je Zeile.
 * Entfernen ist umkehrbar (wieder hinzufügen), deshalb ohne Rückfrage.
 *
 * Prognose: eigene Routen am Pegel, nicht der Vollersatz-PUT der Liste — Umordnen lässt sie stehen.
 * Löschen ist über den Rückgängig-Toast umkehrbar. Eine verstrichene Prognose steht als
 * „abgelaufen" da, bis jemand sie löscht oder erneuert.
 *
 * Ist die Fachebene `pegelonline` nicht erreichbar, sagt ein Hinweis das; die festgelegte Liste
 * bleibt bedienbar, nur das Hinzufügen wartet.
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
  const [prognoseFuer, setPrognoseFuer] = useState<PegelAnzeige | null>(null);
  const auswahlId = useId();

  const pegelQ = useQuery(pegelAbfrage(einsatzId));
  const stationenQ = useQuery({
    queryKey: globalKeys.fachebene('pegelonline'),
    queryFn: () => ladeFachebene('pegelonline'),
  });

  // Kein `onError`-Toast: der Fehler steht als Alert über der Liste.
  //
  // Alle Schreibwege laufen durch eine Mutation mit gemeinsamem `scope` (auch der Karten-
  // Schnellweg): TanStack reiht sie hintereinander. Parallel nähme ein PUT mit der Altliste die
  // gerade hinzugefügte Station wieder heraus.
  //
  // Umordnen und Entfernen bauen ihren PUT nicht aus dem Cache (nicht live, 5-min-Frische), sondern
  // holen frisch und wenden die Operation über die `station_uuid` an. Steht die Station nicht mehr
  // dort, wird nichts gesendet.
  const aendern = useMutation({
    scope: pegelSchreibScope(einsatzId),
    mutationFn: async (a: Aenderung): Promise<{ liste: PegelAnzeige[]; gesendet: boolean }> => {
      if (a.art === 'hinzufuegen') {
        return { liste: await fuegePegelHinzu(einsatzId, a.station), gesendet: true };
      }
      const frisch = await qc.fetchQuery({ ...pegelAbfrage(einsatzId), staleTime: 0 });
      const neu = wendeAn(frisch, a);
      if (neu == null) return { liste: frisch, gesendet: false };
      return { liste: await setzePegel(einsatzId, neu.map(alsWahl)), gesendet: true };
    },
    onSuccess: ({ liste, gesendet }, a) => {
      qc.setQueryData(einsatzKeys.pegel(einsatzId), liste);
      // Die Festlegung löst die Lagekennzahl am Einsatz aus — sonst sähe das Lage-Dashboard den
      // neuen Zuschnitt erst beim nächsten Einsatz-Abruf.
      if (gesendet) void qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      if (a.art === 'hinzufuegen') setAuswahl(null);
      if (gesendet) message.success('Pegel gespeichert');
      else message.info('Diese Station ist nicht mehr festgelegt — die Liste ist aktualisiert.');
    },
  });

  // Prognose löschen mit Rückgängig-Weg (derselbe PUT mit dem alten Wert). Beide laufen im
  // Schreib-Scope der Liste, damit ein gleichzeitiges Umordnen sie nicht überholt.
  const prognoseLoeschen = useMutation({
    scope: pegelSchreibScope(einsatzId),
    mutationFn: (p: PegelAnzeige) => loeschePrognose(einsatzId, p.id),
    onSuccess: (liste, p) => {
      qc.setQueryData(einsatzKeys.pegel(einsatzId), liste);
      const alt = p.prognose;
      if (!alt) return;
      zeigeRueckgaengig(message, `Prognose an ${p.name} gelöscht`, () =>
        prognoseWiederherstellen.mutate({ id: p.id, body: wiederherstellBody(alt) }),
      );
    },
  });
  const prognoseWiederherstellen = useMutation({
    scope: pegelSchreibScope(einsatzId),
    mutationFn: (v: { id: number; body: ReturnType<typeof wiederherstellBody> }) =>
      setzePrognose(einsatzId, v.id, v.body),
    onSuccess: (liste) => qc.setQueryData(einsatzKeys.pegel(einsatzId), liste),
  });

  const stationen = useMemo(
    () => stationenAus(stationenQ.data?.features.features ?? []),
    [stationenQ.data],
  );

  if (daten.laedt || pegelQ.isLoading) return <SeitenSkeleton />;
  /*
   * Ohne Bestand kein Bearbeiten: ein gescheiterter Abruf fiele sonst in die leere Liste, und der
   * nächste Pfeil schickte diese erfundene Leere als Vollersatz-PUT.
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
  const laeuft =
    aendern.isPending || prognoseLoeschen.isPending || prognoseWiederherstellen.isPending;
  const voll = liste.length >= PEGEL_MAX;
  const festgelegt = new Set(liste.map((p) => p.station_uuid.toLowerCase()));
  // Keine Auswahl möglich: Abruf gescheitert, oder keine wählbare Station (`offline` ohne
  // Cache-Bestand, `leer`, oder nur Punkte ohne uuid). Mit Cache-Bestand bleibt die Auswahl
  // nutzbar, auch wenn die Quelle `offline` meldet.
  const stationenFehlen = stationenQ.isError || (stationenQ.data != null && stationen.length === 0);
  const quelleOffline = stationenQ.isError || stationenQ.data?.status === 'offline';
  const gewaehlt = stationen.find((s) => s.uuid === auswahl) ?? null;

  const messText = (p: PegelAnzeige): string => {
    const m = p.messung;
    if (!m) return PEGEL_STAND_UNBEKANNT;
    return [
      `${wasserstandMeter(m.wasserstand_cm)} m`,
      trendText(m.trend_cm_pro_h),
      `Stand ${standZeit(m.zeitpunkt, Date.now(), konv)}`,
    ].join(' · ');
  };

  return (
    <>
      <SeitenHinweise
        fehler={aendern.error ?? prognoseLoeschen.error ?? prognoseWiederherstellen.error}
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
                              key: 'prognose',
                              icon: <EditOutlined />,
                              label: p.prognose ? 'Prognose ändern …' : 'Prognose erfassen …',
                            },
                            ...(p.prognose
                              ? [
                                  {
                                    key: 'prognose-loeschen',
                                    icon: <DeleteOutlined />,
                                    label: 'Prognose löschen',
                                    danger: true,
                                  },
                                ]
                              : []),
                            { type: 'divider' as const },
                            {
                              key: 'entfernen',
                              icon: <DeleteOutlined />,
                              label: 'Entfernen',
                              danger: true,
                            },
                          ],
                          // Zuordnung am Menü, nicht je Eintrag.
                          onClick: ({ key }) => {
                            const uuid = p.station_uuid;
                            if (key === 'hoch')
                              aendern.mutate({ art: 'verschieben', uuid, richtung: -1 });
                            else if (key === 'runter')
                              aendern.mutate({ art: 'verschieben', uuid, richtung: 1 });
                            else if (key === 'entfernen')
                              aendern.mutate({ art: 'entfernen', uuid });
                            else if (key === 'prognose') setPrognoseFuer(p);
                            else if (key === 'prognose-loeschen') prognoseLoeschen.mutate(p);
                          },
                        }}
                      >
                        {/* Der Name trägt die Zeilenkennung. Kein `size`. */}
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
                    {p.prognose && (
                      <span data-lfh="pegel-prognose" style={{ display: 'block' }}>
                        {prognoseOffen(p.prognose, Date.now())
                          ? prognoseText(p.prognose, Date.now(), konv)
                          : `${prognoseText(p.prognose, Date.now(), konv)} · abgelaufen`}
                      </span>
                    )}
                  </span>
                }
              />
            </ListenEintrag>
          )}
        />

        {/* Sichtbares Label über dem Feld, kein bloßes aria-label. */}
        <label
          htmlFor={auswahlId}
          style={{
            display: 'block',
            marginBlockStart: token.margin,
            marginBlockEnd: token.marginXS,
          }}
        >
          Station wählen
        </label>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: token.marginSM,
          }}
        >
          <Select<string>
            id={auswahlId}
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
            disabled={!darf || voll || laeuft || !gewaehlt || festgelegt.has(gewaehlt.uuid)}
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
            title={
              quelleOffline
                ? 'Die Stationsliste von PEGELONLINE ist gerade nicht erreichbar.'
                : 'PEGELONLINE liefert gerade keine wählbare Station.'
            }
            description="Neue Pegel lassen sich erst wieder hinzufügen, wenn die Liste zurück ist. Die festgelegten Pegel bleiben bedienbar: umordnen und entfernen geht weiter."
            action={<Button onClick={() => void stationenQ.refetch()}>Erneut abrufen</Button>}
          />
        )}
      </Formularpaneel>
      {prognoseFuer && (
        <PegelPrognoseModal
          einsatzId={einsatzId}
          pegel={prognoseFuer}
          onSchliessen={() => setPrognoseFuer(null)}
        />
      )}
    </>
  );
}
