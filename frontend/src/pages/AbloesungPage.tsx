import { IconStift } from '../icons';
import { Alert, App, Breadcrumb, Button, Flex, Spin, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  aendereSchicht,
  beginneSchicht,
  listeAbloesungen,
  listeAbloesungVorgaben,
  nimmVollzugZurueck,
  setzeAbloesungVorgabe,
  vollzieheAbloesung,
} from '../api/abloesungen';
import { ladeEinsatz, ladeModulFreigaben } from '../api/einsaetze';
import { listeEinheiten } from '../api/einheiten';
import { listeEinheitenPerioden } from '../api/kraefteZeitachse';
import { einsatzKeys } from '../api/queryKeys';
import type { Abloesung, AbloesungVorgabe } from '../api/types';
import AbloesungKarte from '../abloesung/AbloesungKarte';
import {
  AbloeserDialog,
  RhythmusDialog,
  SchichtBeginnenDialog,
  VollzugDialog,
  type EinheitOption,
} from '../abloesung/AbloesungDialoge';
import { rhythmusText, zaehleFaellige } from '../abloesung/einstufung';
import { useUhr } from '../abloesung/useUhr';
import {
  eingeordnet,
  freigegeben,
  LEERER_ZUFLUSSSTAND,
  nachgefuehrt,
  teileZufluss,
  zuflussText,
  type Zuflussstand,
} from '../abloesung/zufluss';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { useZeilenFehler } from '../components/useZeilenFehler';
import { SeitenLeer } from '../components/SeitenZustand';
import {
  Paneel,
  PaneelZeile,
  Sammelbanner,
  sammelbannerKurz,
  Segmentleiste,
  useRollen,
} from '../components/instrument';
import { useViewport } from '../components/useViewport';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import { einsatzRechteGrund } from '../components/nurAnsicht';
import { abschnittVorgabe } from '../components/vorgabeText';

const { Text } = Typography;

/** Grund der fehlenden Schreibberechtigung (`components/nurAnsicht.ts`). */
const abloesungRechteText = einsatzRechteGrund;

type Rhythmusziel =
  | { art: 'schicht'; schicht: Abloesung; vorgabe: number | undefined }
  | { art: 'abschnitt'; vorgabe: AbloesungVorgabe };

/**
 * Fachmodul Ablösung (LFH-635): Schichten der Einheiten, nach Fälligkeit geordnet.
 *
 * Form: eine Liste, keine Tabelle — die Frage ist „was ist mit dieser Einheit?", und die Ordnung
 * ist die Fälligkeit, die der Server festlegt. Neue Schichten landen an ihrem Fälligkeitsplatz,
 * auch oberhalb gezeigter Karten; fremde Neuzugänge warten deshalb hinter dem Sammelbanner, eigene
 * stehen sofort (LFH-647). Die Folge der gezeigten Karten ist eingefroren, ihr Inhalt frisch: eine
 * fremde Änderung von Rhythmus oder Beginn ordnet erst mit dem Banner um, eine eigene sofort
 * (LFH-660). Regeln in `abloesung/zufluss.ts`.
 *
 * Das Banner nimmt keine eigene Zeile: es steht in der immer gerenderten Segmentzeile, deren Höhe
 * es nicht ändert — sonst schöbe es die Karten weg, die es schützen soll. Kein `sticky`-Overlay: es
 * verdeckte die oberste, also dringlichste Karte. Die Höhe misst `e2e/abloesung-zufluss.spec.ts`.
 * Auf dem Handschirm (unter `md`) bleibt neben der Segmentleiste kein Platz für Satz und Knopf
 * (LFH-694: im Handschuh-Betrieb 0 px Text); dort steht die Kurzform „1 neu" als ein Knopf, der
 * volle Satz bleibt für Hilfstechnik im Status. Gemessen in `e2e/gate1-ueberlauf.spec.ts`.
 *
 * Die Uhr tickt alle 30 s (`useUhr`): Einstufung und „in x min" laufen ohne Abruf mit. Nichts
 * blinkt; der Hinweis bei Fälligkeit kommt einmalig über die AlarmZentrale.
 */
export default function AbloesungPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { token } = useRollen();
  const jetzt = useUhr();
  const { istSchmal } = useViewport();

  const [ansicht, setAnsicht] = useState<'laufend' | 'abgeloest'>('laufend');
  const [beginnenOffen, setBeginnenOffen] = useState(false);
  const [vollzugSchicht, setVollzugSchicht] = useState<Abloesung | null>(null);
  const [abloeserSchicht, setAbloeserSchicht] = useState<Abloesung | null>(null);
  const [rhythmusZiel, setRhythmusZiel] = useState<Rhythmusziel | null>(null);
  // An den Einsatz gebunden: wechselt die Route den Einsatz bei stehender Komponente, wären sonst
  // alle Schichten des neuen Einsatzes „fremde Neuzugänge".
  const [zuflussZustand, setZuflussZustand] = useState<{ einsatzId: number } & Zuflussstand>({
    einsatzId,
    ...LEERER_ZUFLUSSSTAND,
  });

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const laufendQuery = useQuery({
    queryKey: einsatzKeys.abloesungListe(einsatzId, 'laufend'),
    queryFn: () => listeAbloesungen(einsatzId, 'laufend'),
  });
  const abgeloestQuery = useQuery({
    queryKey: einsatzKeys.abloesungListe(einsatzId, 'abgeloest'),
    queryFn: () => listeAbloesungen(einsatzId, 'abgeloest'),
    enabled: ansicht === 'abgeloest',
  });
  const vorgabenQuery = useQuery({
    queryKey: einsatzKeys.abloesungVorgaben(einsatzId),
    queryFn: () => listeAbloesungVorgaben(einsatzId),
  });
  const darfSchreiben = einsatzQuery.data ? darfImEinsatzSchreiben(einsatzQuery.data) : false;
  // Die Einheiten braucht nur, wer Schichten beginnen oder Ablöser wählen darf.
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: darfSchreiben,
  });

  // Nur für den Platzhalter „Im Einsatz seit“ des offenen Beginnen-Dialogs (LFH-1078). Die
  // Zeitachse gehört dem Modul Einheiten: ohne dessen Freigabe keine Anfrage (Spec
  // `modul-freigabe`), der Platzhalter bleibt dann leer.
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
    enabled: darfSchreiben && beginnenOffen,
  });
  const periodenQuery = useQuery({
    queryKey: einsatzKeys.kraefteZeitachseEinheiten(einsatzId),
    queryFn: () => listeEinheitenPerioden(einsatzId),
    enabled: darfSchreiben && beginnenOffen && istKeyFreigegeben('einheiten', freigabenQuery.data),
  });

  const laufende = useMemo(() => laufendQuery.data ?? [], [laufendQuery.data]);
  const vorgaben = useMemo(() => vorgabenQuery.data ?? [], [vorgabenQuery.data]);

  // ── Live-Zufluss ── Nur die gerenderte Liste nimmt `sichtbar`. Kopfzeile, Zähler,
  // Fälligkeitszahl und freie Einheiten rechnen mit der vollen Menge: die Zahlen dürfen nicht
  // lügen, und „Schicht beginnen" für eine Einheit mit nur zurückgehaltener Schicht lehnte der
  // Server ab.
  const zufluss: Zuflussstand =
    zuflussZustand.einsatzId === einsatzId ? zuflussZustand : LEERER_ZUFLUSSSTAND;
  const { sichtbar, zurueckgehalten, umgeordnet } = teileZufluss(laufende, zufluss);
  // Nachführen im Render (Muster `EtbZeitachse`), nicht im Effekt: der ließe einen Bildaufbau mit
  // veraltetem Stand durch. `nachgefuehrt` liefert `null`, wenn nichts zu tun ist — der Riegel
  // gegen die Schleife.
  if (laufendQuery.data) {
    const neu = nachgefuehrt(zufluss, sichtbar, umgeordnet);
    if (neu || zuflussZustand.einsatzId !== einsatzId) {
      setZuflussZustand({ einsatzId, ...(neu ?? zufluss) });
    }
  }
  const merkeEigene = (id: number) =>
    setZuflussZustand((z) => {
      const basis = z.einsatzId === einsatzId ? z : { einsatzId, ...LEERER_ZUFLUSSSTAND };
      return { ...basis, eigene: new Set([...basis.eigene, id]) };
    });
  // Eine eigene Änderung ordnet ihre Karten sofort ein. Gerufen nach dem Refetch mit dessen Daten;
  // `laufende` ist dann veraltet.
  const ordneEin = (auswahl: (s: Abloesung) => boolean) => {
    const frisch =
      qc.getQueryData<Abloesung[]>(einsatzKeys.abloesungListe(einsatzId, 'laufend')) ?? [];
    setZuflussZustand((z) =>
      z.einsatzId === einsatzId ? { einsatzId, ...eingeordnet(z, frisch.filter(auswahl)) } : z,
    );
  };
  // Funktional: eine gerade eingereihte Vormerkung (`merkeEigene`) darf die Freigabe nicht
  // überschreiben.
  const gibFrei = () =>
    setZuflussZustand((z) => ({
      einsatzId,
      ...freigegeben(z.einsatzId === einsatzId ? z : LEERER_ZUFLUSSSTAND, laufende),
    }));

  // Einheiten ohne laufende Schicht — nur sie können beginnen oder ablösen.
  const freieEinheiten: EinheitOption[] = useMemo(() => {
    const belegt = new Set(laufende.map((a) => a.einheit_id));
    return (einheitenQuery.data ?? [])
      .filter((e) => !belegt.has(e.id))
      .map((e) => ({ value: e.id, label: e.name }));
  }, [einheitenQuery.data, laufende]);
  const vorgabeJeEinheit = useMemo(() => {
    const jeAbschnitt = new Map(
      vorgaben
        .filter((v) => v.rhythmus_minuten != null)
        .map((v) => [v.abschnitt_id, v.rhythmus_minuten!]),
    );
    const m = new Map<number, number>();
    for (const e of einheitenQuery.data ?? []) {
      const v = e.abschnitt_id != null ? jeAbschnitt.get(e.abschnitt_id) : undefined;
      if (v != null) m.set(e.id, v);
    }
    return m;
  }, [einheitenQuery.data, vorgaben]);
  // Wie `offenes_eintreffen` im Server: das Eintreffen der letzten, noch offenen Periode.
  const eintreffenJeEinheit = useMemo(() => {
    if (!periodenQuery.data) return null;
    const m = new Map<number, string>();
    for (const { einheit_id, perioden } of periodenQuery.data) {
      const letzte = perioden[perioden.length - 1];
      if (letzte && !letzte.ende_at && letzte.eintreffen_at)
        m.set(einheit_id, letzte.eintreffen_at);
    }
    return m;
  }, [periodenQuery.data]);

  const invalidiere = () => qc.invalidateQueries({ queryKey: einsatzKeys.abloesungen(einsatzId) });

  // Fehler stehen im jeweiligen Dialog (SpeicherFehler); `mutateAsync` lehnt ab, die Hülle lässt
  // die Felder stehen.
  const beginnenMut = useMutation({
    mutationFn: (body: Parameters<typeof beginneSchicht>[1]) => beginneSchicht(einsatzId, body),
    onSuccess: (a) => {
      merkeEigene(a.id);
      invalidiere();
      message.success(`Schicht von ${a.einheit_name} begonnen`);
    },
  });
  /*
   * Die Rücknahme hat zwei Wege mit je eigenem Fehlerort (LFH-1077, `frontend/AGENTS.md`,
   * „Rückwege und Fehler“): der Knopf an der abgelösten Karte meldet an der Karte, Rückgängig aus
   * dem Toast im Hinweis der Seite — die Karte ist dann meist nicht zu sehen. Beide Gründe kommen
   * aus den Callbacks, nicht aus `mutation.error`: der kennt nur den letzten Aufruf.
   */
  const kartenFehler = useZeilenFehler<number>();
  const [rueckgaengigFehler, setRueckgaengigFehler] = useState<unknown>(null);
  const ruecknahmeErfolg = (a: Abloesung) => {
    // Die zurückgenommene Schicht kehrt in die laufenden zurück — als eigene Handlung.
    merkeEigene(a.id);
    invalidiere();
    message.success(`Vollzug der Ablösung ${a.einheit_name} zurückgenommen`);
  };
  const zuruecknehmenMut = useMutation({
    mutationFn: (abloesungId: number) => nimmVollzugZurueck(einsatzId, abloesungId),
    onMutate: (abloesungId) => kartenFehler.beginne(abloesungId),
    onSuccess: ruecknahmeErfolg,
    onError: (e, abloesungId) => {
      kartenFehler.melde(abloesungId, e, 'Rücknahme fehlgeschlagen');
      invalidiere();
    },
  });
  // Die nächste Rücknahme aus dem Toast räumt den Grund der vorigen.
  const rueckgaengigMut = useMutation({
    mutationFn: (abloesungId: number) => nimmVollzugZurueck(einsatzId, abloesungId),
    onMutate: () => setRueckgaengigFehler(null),
    onSuccess: ruecknahmeErfolg,
    onError: (e) => {
      setRueckgaengigFehler(e);
      invalidiere();
    },
  });
  const vollzugMut = useMutation({
    mutationFn: ({
      abloesungId,
      body,
    }: {
      abloesungId: number;
      body: Parameters<typeof vollzieheAbloesung>[2];
    }) => vollzieheAbloesung(einsatzId, abloesungId, body),
    // Der Vollzug hat einen serverseitigen Rückweg → Rückgängig-Toast statt Rückfrage. Der Dialog
    // davor erfasst Zeitpunkt und Ablöser, er ist keine Rückfrage.
    onSuccess: (v) => {
      if (v.folgeschicht) merkeEigene(v.folgeschicht.id);
      invalidiere();
      const text = v.folgeschicht
        ? `Ablösung vollzogen: ${v.abgeloest.einheit_name} durch ${v.folgeschicht.einheit_name}`
        : `Ablösung vollzogen: ${v.abgeloest.einheit_name}`;
      zeigeRueckgaengig(message, text, () => rueckgaengigMut.mutate(v.abgeloest.id));
    },
  });
  const aendernMut = useMutation({
    mutationFn: ({
      abloesungId,
      body,
    }: {
      abloesungId: number;
      body: Parameters<typeof aendereSchicht>[2];
    }) => aendereSchicht(einsatzId, abloesungId, body),
    // Rhythmus oder Beginn verschieben die Fälligkeit: die eigene Karte rückt erst nach dem Refetch
    // an ihren Platz, sonst stünde sie mit altem Inhalt am neuen. Trifft der Live-Refetch vor der
    // eigenen Antwort ein, meldet das Banner diese eine Rundreise lang „Reihenfolge geändert".
    // Scheitert der Refetch, zeigt der nächste Abruf die Änderung wie eine fremde hinter dem
    // Banner.
    onSuccess: async (a, { body }) => {
      message.success('Schicht geändert');
      if (body.rhythmus_minuten === undefined && body.beginn_at === undefined) {
        void invalidiere();
        return;
      }
      await invalidiere();
      ordneEin((s) => s.id === a.id);
    },
  });
  const vorgabeMut = useMutation({
    mutationFn: ({ abschnittId, minuten }: { abschnittId: number; minuten: number | null }) =>
      setzeAbloesungVorgabe(einsatzId, abschnittId, minuten),
    // Eine neue Vorgabe schreibt der Server nur in die Schichten ihres Abschnitts, die ihr folgen
    // (`rhythmus_quelle = 'abschnitt'`); eine entfernte lässt jede Schicht stehen. Genau diese
    // werden eingeordnet — eine fremd umgeordnete Schicht mit eigenem Rhythmus bleibt eingefroren.
    // Nach dem Refetch, wie bei `aendernMut`.
    onSuccess: async (_, { abschnittId, minuten }) => {
      message.success('Rhythmus-Vorgabe gespeichert');
      if (minuten == null) {
        void invalidiere();
        return;
      }
      await invalidiere();
      ordneEin((s) => s.abschnitt_id === abschnittId && s.rhythmus_quelle === 'abschnitt');
    },
  });

  if (einsatzQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const faellig = zaehleFaellige(laufende, jetzt);
  const liste = ansicht === 'laufend' ? sichtbar : (abgeloestQuery.data ?? []);
  const bannerText = zuflussText(zurueckgehalten, jetzt, umgeordnet ? sichtbar : null);
  const listenQuery = ansicht === 'laufend' ? laufendQuery : abgeloestQuery;
  const oeffneBeginnen = () => {
    beginnenMut.reset();
    setBeginnenOffen(true);
  };

  return (
    <EinsatzSeite
      titel="Ablösung"
      meta={`${laufende.length} laufend · ${faellig} fällig`}
      dataUpdatedAt={laufendQuery.dataUpdatedAt}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Ablösung' },
          ]}
        />
      }
      // Gesperrt statt versteckt: der Hinweis darunter nennt den Grund.
      aktionen={
        <Button type="primary" disabled={!darfSchreiben} onClick={oeffneBeginnen}>
          Schicht beginnen
        </Button>
      }
      neueZeile={darfSchreiben ? oeffneBeginnen : undefined}
      // Nur mit Inhalt gesetzt: ein leerer Slot rendert in `EinsatzSeite` trotzdem seinen Rahmen.
      hinweis={
        (!darfSchreiben || rueckgaengigFehler != null) && (
          <SeitenHinweise
            rechteFehlt={!darfSchreiben}
            rechteText={abloesungRechteText(einsatz.status)}
            fehler={rueckgaengigFehler}
            fehlerTitel="Nicht zurückgenommen"
            fehlerFallback="Rücknahme fehlgeschlagen"
          />
        )
      }
    >
      {/* Die Werkzeugzeile: immer gerendert, `nowrap`, Mindesthöhe = Steuerhöhe + 2 px Rahmen
          (Segmentleiste und Banner tragen beide einen 1-px-Rand). Das Banner ändert ihre Höhe
          nicht, also verschiebt es keine Karte. */}
      <Flex
        gap={token.marginSM}
        align="center"
        data-lfh="abloesung-werkzeugzeile"
        style={{ marginBottom: token.margin, minHeight: token.controlHeight + 2 }}
      >
        <Segmentleiste
          beschriftung="Ansicht"
          wert={ansicht}
          onWechsel={(w) => {
            // Ein Ansichtswechsel ist die Bitte, den aktuellen Stand zu sehen.
            gibFrei();
            setAnsicht(w);
          }}
          optionen={[
            { wert: 'laufend', label: `Laufend (${laufende.length})` },
            { wert: 'abgeloest', label: 'Abgelöst' },
          ]}
          style={{ flex: 'none' }}
        />
        {ansicht === 'laufend' && (zurueckgehalten.length > 0 || umgeordnet) && (
          <Sammelbanner
            aktion={{ label: 'anzeigen', onKlick: gibFrei }}
            kurz={istSchmal ? sammelbannerKurz(zurueckgehalten.length, umgeordnet) : undefined}
            style={{ flex: '1 1 0', minWidth: 0, flexWrap: 'nowrap', paddingBlock: 0 }}
          >
            <span
              title={bannerText}
              style={{
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {bannerText}
            </span>
          </Sammelbanner>
        )}
      </Flex>

      {listenQuery.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: token.marginSM }}
          title="Ablösungen konnten nicht geladen werden"
        />
      )}
      {listenQuery.isLoading ? (
        <Spin />
      ) : liste.length === 0 ? (
        <SeitenLeer
          titel={
            ansicht === 'laufend' ? 'Keine laufenden Schichten' : 'Noch keine Ablösung vollzogen'
          }
        />
      ) : (
        <section aria-label={ansicht === 'laufend' ? 'Laufende Schichten' : 'Abgelöste Schichten'}>
          {liste.map((s) => (
            <AbloesungKarte
              key={s.id}
              schicht={s}
              jetzt={jetzt}
              darfSchreiben={darfSchreiben}
              onVollziehen={(x) => {
                vollzugMut.reset();
                setVollzugSchicht(x);
              }}
              onAbloeserPlanen={(x) => {
                aendernMut.reset();
                setAbloeserSchicht(x);
              }}
              onRhythmusAendern={(x) => {
                aendernMut.reset();
                const v = vorgaben.find((g) => g.abschnitt_id === x.abschnitt_id)?.rhythmus_minuten;
                setRhythmusZiel({ art: 'schicht', schicht: x, vorgabe: v ?? undefined });
              }}
              onZuruecknehmen={(x) => zuruecknehmenMut.mutate(x.id)}
              fehlerGrund={kartenFehler.grund(s.id)}
            />
          ))}
        </section>
      )}

      <Paneel titel="Rhythmus je Abschnitt" style={{ marginTop: token.marginLG }}>
        {vorgaben.length === 0 ? (
          <Text type="secondary" style={{ display: 'block', padding: token.paddingSM }}>
            Keine Einsatzabschnitte
          </Text>
        ) : (
          vorgaben.map((v) => (
            <PaneelZeile key={v.abschnitt_id}>
              <Flex
                justify="space-between"
                align="center"
                gap={token.marginXS}
                wrap
                style={{ width: '100%' }}
              >
                <span>
                  <Text strong>{v.abschnitt_name}</Text>{' '}
                  <Text type="secondary">
                    {v.rhythmus_minuten != null
                      ? `Rhythmus ${rhythmusText(v.rhythmus_minuten)}`
                      : 'keine Vorgabe'}
                    {v.laufende_schichten > 0 ? ` · ${v.laufende_schichten} laufend` : ''}
                  </Text>
                </span>
                {darfSchreiben && (
                  <Button
                    type="text"
                    icon={<IconStift />}
                    aria-label={`Rhythmus-Vorgabe ${v.abschnitt_name} ändern`}
                    onClick={() => {
                      vorgabeMut.reset();
                      setRhythmusZiel({ art: 'abschnitt', vorgabe: v });
                    }}
                  />
                )}
              </Flex>
            </PaneelZeile>
          ))
        )}
      </Paneel>

      {/* Dialoge werden je Ziel frisch montiert: `initialValues` greift nur beim Einhängen, und
          der Speicher von rc-field-form überlebt sonst ein Schließen. */}
      {beginnenOffen && (
        <SchichtBeginnenDialog
          offen
          einheiten={freieEinheiten}
          vorgabeJeEinheit={vorgabeJeEinheit}
          eintreffenJeEinheit={eintreffenJeEinheit}
          laeuft={beginnenMut.isPending}
          fehler={beginnenMut.error}
          onErfassen={(body) => beginnenMut.mutateAsync(body)}
          onSchliessen={() => setBeginnenOffen(false)}
        />
      )}
      {vollzugSchicht && (
        <VollzugDialog
          key={vollzugSchicht.id}
          schicht={vollzugSchicht}
          einheiten={freieEinheiten.filter((e) => e.value !== vollzugSchicht.einheit_id)}
          laeuft={vollzugMut.isPending}
          fehler={vollzugMut.error}
          onErfassen={(body) => vollzugMut.mutateAsync({ abloesungId: vollzugSchicht.id, body })}
          onSchliessen={() => setVollzugSchicht(null)}
        />
      )}
      {abloeserSchicht && (
        <AbloeserDialog
          key={abloeserSchicht.id}
          schicht={abloeserSchicht}
          einheiten={freieEinheiten.filter((e) => e.value !== abloeserSchicht.einheit_id)}
          laeuft={aendernMut.isPending}
          fehler={aendernMut.error}
          onErfassen={(abloesendeEinheitId) =>
            aendernMut.mutateAsync({
              abloesungId: abloeserSchicht.id,
              body: { abloesende_einheit_id: abloesendeEinheitId },
            })
          }
          onSchliessen={() => setAbloeserSchicht(null)}
        />
      )}
      {rhythmusZiel?.art === 'schicht' && (
        <RhythmusDialog
          key={`s-${rhythmusZiel.schicht.id}`}
          offen
          titel={`Rhythmus ${rhythmusZiel.schicht.einheit_name}`}
          // Folgt die Schicht der Vorgabe, bleibt das Feld leer — sonst machte ein unverändertes
          // Speichern aus der Vorgabe still einen eigenen Wert.
          minuten={
            rhythmusZiel.schicht.rhythmus_quelle === 'abschnitt'
              ? null
              : rhythmusZiel.schicht.rhythmus_minuten
          }
          leerErlaubt={rhythmusZiel.vorgabe != null}
          platzhalter={
            rhythmusZiel.vorgabe != null
              ? abschnittVorgabe(rhythmusText(rhythmusZiel.vorgabe))
              : undefined
          }
          laeuft={aendernMut.isPending}
          fehler={aendernMut.error}
          onErfassen={(minuten) =>
            aendernMut.mutateAsync({
              abloesungId: rhythmusZiel.schicht.id,
              body: { rhythmus_minuten: minuten },
            })
          }
          onSchliessen={() => setRhythmusZiel(null)}
        />
      )}
      {rhythmusZiel?.art === 'abschnitt' && (
        <RhythmusDialog
          key={`a-${rhythmusZiel.vorgabe.abschnitt_id}`}
          offen
          titel={`Rhythmus-Vorgabe ${rhythmusZiel.vorgabe.abschnitt_name}`}
          minuten={rhythmusZiel.vorgabe.rhythmus_minuten ?? null}
          leerErlaubt
          platzhalter="keine Vorgabe"
          laeuft={vorgabeMut.isPending}
          fehler={vorgabeMut.error}
          onErfassen={(minuten) =>
            vorgabeMut.mutateAsync({ abschnittId: rhythmusZiel.vorgabe.abschnitt_id, minuten })
          }
          onSchliessen={() => setRhythmusZiel(null)}
        />
      )}
    </EinsatzSeite>
  );
}
