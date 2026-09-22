import { Alert, App, Breadcrumb, Button, Flex, Spin, Typography } from 'antd';
import { EditOutlined } from '@ant-design/icons';
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
import { ladeEinsatz } from '../api/einsaetze';
import { listeEinheiten } from '../api/einheiten';
import { einsatzKeys } from '../api/queryKeys';
import type { Abloesung, AbloesungVorgabe, EinsatzStatus } from '../api/types';
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
import { useAuth } from '../auth/AuthContext';
import EinsatzSeite from '../components/EinsatzSeite';
import { RechteHinweis } from '../components/SpeicherHinweis';
import { SeitenLeer } from '../components/SeitenZustand';
import { Paneel, PaneelZeile, Segmentleiste, useRollen } from '../components/instrument';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';

const { Text } = Typography;

/** Grund der fehlenden Schreibberechtigung als ganzer Satz (C10/M16). */
export function abloesungRechteText(status: EinsatzStatus): string {
  return status !== 'aktiv'
    ? 'Der Einsatz ist abgeschlossen — die Ablösungen sind nur noch lesbar.'
    : 'Nur Einsatzleitung und Führungspersonal können Schichten beginnen und Ablösungen vollziehen.';
}

type Rhythmusziel =
  | { art: 'schicht'; schicht: Abloesung; vorgabe: number | undefined }
  | { art: 'abschnitt'; vorgabe: AbloesungVorgabe };

/**
 * Fachmodul Ablösung (LFH-635): Schichten der Einheiten, nach Fälligkeit geordnet.
 *
 * FORM: eine LISTE, keine Tabelle (LFH-330/B2) — die Frage ist „was ist mit dieser Einheit?",
 * nicht „welche von diesen ist die richtige?", und die Ordnung ist die Fälligkeit, die der
 * Server festlegt. Die Liste ist klein (eine Karte je eingesetzter Einheit) und springt nicht
 * unter dem Cursor: neue Schichten landen an ihrem Fälligkeitsplatz, nicht oben.
 *
 * DIE UHR tickt alle 30 s (`useUhr`): Einstufung und „in x min" laufen mit, ohne Abruf.
 * Nichts blinkt — der Hinweis bei Fälligkeit kommt einmalig über die AlarmZentrale.
 */
export default function AbloesungPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { token } = useRollen();
  const jetzt = useUhr();

  const [ansicht, setAnsicht] = useState<'laufend' | 'abgeloest'>('laufend');
  const [beginnenOffen, setBeginnenOffen] = useState(false);
  const [vollzugSchicht, setVollzugSchicht] = useState<Abloesung | null>(null);
  const [abloeserSchicht, setAbloeserSchicht] = useState<Abloesung | null>(null);
  const [rhythmusZiel, setRhythmusZiel] = useState<Rhythmusziel | null>(null);

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
  const darfSchreiben = einsatzQuery.data
    ? darfImEinsatzSchreiben(einsatzQuery.data, benutzer)
    : false;
  // Die Einheiten braucht nur, wer Schichten beginnen oder Ablöser wählen darf.
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: darfSchreiben,
  });

  const laufende = useMemo(() => laufendQuery.data ?? [], [laufendQuery.data]);
  const vorgaben = useMemo(() => vorgabenQuery.data ?? [], [vorgabenQuery.data]);

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

  const invalidiere = () => qc.invalidateQueries({ queryKey: einsatzKeys.abloesungen(einsatzId) });

  // Fehler stehen IM jeweiligen Dialog (SpeicherFehler); `mutateAsync` lehnt ab, die Hülle
  // lässt die Felder stehen (LFH-332/B4).
  const beginnenMut = useMutation({
    mutationFn: (body: Parameters<typeof beginneSchicht>[1]) => beginneSchicht(einsatzId, body),
    onSuccess: (a) => {
      invalidiere();
      message.success(`Schicht von ${a.einheit_name} begonnen`);
    },
  });
  const zuruecknehmenMut = useMutation({
    mutationFn: (abloesungId: number) => nimmVollzugZurueck(einsatzId, abloesungId),
    onSuccess: (a) => {
      invalidiere();
      message.success(`Vollzug der Ablösung ${a.einheit_name} zurückgenommen`);
    },
    onError: (e) => {
      invalidiere();
      message.error(e instanceof Error ? e.message : 'Rücknahme fehlgeschlagen');
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
    // Der Vollzug hat einen serverseitigen Rückweg → Rückgängig-Toast statt Rückfrage
    // (LFH-343 · C8). Der Dialog davor ist keine Rückfrage, sondern die Erfassung von
    // Zeitpunkt und Ablöser.
    onSuccess: (v) => {
      invalidiere();
      const text = v.folgeschicht
        ? `Ablösung vollzogen: ${v.abgeloest.einheit_name} durch ${v.folgeschicht.einheit_name}`
        : `Ablösung vollzogen: ${v.abgeloest.einheit_name}`;
      zeigeRueckgaengig(message, text, () => zuruecknehmenMut.mutate(v.abgeloest.id));
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
    onSuccess: () => {
      invalidiere();
      message.success('Schicht geändert');
    },
  });
  const vorgabeMut = useMutation({
    mutationFn: ({ abschnittId, minuten }: { abschnittId: number; minuten: number | null }) =>
      setzeAbloesungVorgabe(einsatzId, abschnittId, minuten),
    onSuccess: () => {
      invalidiere();
      message.success('Rhythmus-Vorgabe gespeichert');
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
  const liste = ansicht === 'laufend' ? laufende : (abgeloestQuery.data ?? []);
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
      // Gesperrt statt versteckt (C10/M16): der Hinweis darunter nennt den Grund.
      aktionen={
        <Button type="primary" disabled={!darfSchreiben} onClick={oeffneBeginnen}>
          Schicht beginnen
        </Button>
      }
      neueZeile={darfSchreiben ? oeffneBeginnen : undefined}
      hinweis={
        !darfSchreiben && <RechteHinweis sichtbar text={abloesungRechteText(einsatz.status)} />
      }
    >
      <Flex wrap gap={token.marginSM} style={{ marginBottom: token.margin }} align="center">
        <Segmentleiste
          beschriftung="Ansicht"
          wert={ansicht}
          onWechsel={setAnsicht}
          optionen={[
            { wert: 'laufend', label: `Laufend (${laufende.length})` },
            { wert: 'abgeloest', label: 'Abgelöst' },
          ]}
        />
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
          hinweis={
            ansicht === 'laufend'
              ? 'Mit „Schicht beginnen" wird der Einsatzbeginn einer Einheit und ihr Rhythmus erfasst.'
              : undefined
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
            />
          ))}
        </section>
      )}

      <Paneel titel="Rhythmus je Abschnitt" style={{ marginTop: token.marginLG }}>
        {vorgaben.length === 0 ? (
          <Text type="secondary" style={{ display: 'block', padding: token.paddingSM }}>
            Noch keine Einsatzabschnitte angelegt.
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
                      ? `${rhythmusText(v.rhythmus_minuten)}-Rhythmus`
                      : 'keine Vorgabe'}
                    {v.laufende_schichten > 0 ? ` · ${v.laufende_schichten} laufend` : ''}
                  </Text>
                </span>
                {darfSchreiben && (
                  <Button
                    type="text"
                    icon={<EditOutlined />}
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

      {/* Dialoge werden je Ziel frisch montiert: `initialValues` greift nur beim Einhängen,
          und der Speicher von rc-field-form überlebt sonst ein Schließen (CLAUDE.md, B4). */}
      {beginnenOffen && (
        <SchichtBeginnenDialog
          offen
          einheiten={freieEinheiten}
          vorgabeJeEinheit={vorgabeJeEinheit}
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
          leerText={
            rhythmusZiel.vorgabe != null
              ? `Leer: Vorgabe des Abschnitts (${rhythmusText(rhythmusZiel.vorgabe)})`
              : 'Der Abschnitt hat keine Vorgabe'
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
          leerText="Leer: Vorgabe entfernen. Laufende Schichten behalten ihren Rhythmus."
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
