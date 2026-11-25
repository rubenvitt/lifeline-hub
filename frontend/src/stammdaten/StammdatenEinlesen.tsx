import { Alert, Button, Input, Modal, Spin, Typography, Upload } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useId, useState } from 'react';
import { ApiError, fehlerText, istKonflikt } from '../api/client';
import { STAMMDATEN_DATEI_MAX_BYTES } from '../api/eingabegrenzen';
import { listeQualifikationen } from '../api/qualifikationen';
import { globalKeys } from '../api/queryKeys';
import {
  LEERE_ENTSCHEIDUNGEN,
  schnappschussUebernehmen,
  schnappschussVorschau,
  stammdatenEinlesen,
  stammdatenEinlesenVorschau,
} from '../api/stammdatenEingang';
import type { StammdatenEntscheidungen, StammdatenErgebnis } from '../api/types';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { FELD_KLASSE, Stapel } from '../components/instrument';
import Feldetikett from '../components/instrument/Feldetikett';
import { Marke } from '../components/instrument/Marke';
import { IconHochladen } from '../icons';
import {
  NichtUebernommen,
  StammdatenVorschauAnsicht,
  artAenderungen,
  artZaehlungen,
  offeneEntscheidungen,
  zaehlungMarken,
} from './StammdatenVorschauAnsicht';
import { useVorschauStand } from './useVorschauStand';

/**
 * „Stammdaten einlesen“ (LLH-1633): Knopf und Dialog in drei Schritten — Datei und Herkunft,
 * Vorschau mit Entscheidungen, Ergebnis. Die Vorschau schreibt nichts; jede Wahl schickt Datei,
 * Herkunft und Entscheidungen neu, der Server gleicht ab und zählt. „Übernehmen“ schickt
 * dieselben Teile. Das Dateiformat steht in der Anwenderdoku, nicht hier.
 *
 * Die Ansicht zeigt immer die letzte gelungene Vorschau mit den Entscheidungen, aus denen sie
 * entstand: schlägt eine Abfrage fehl (etwa eine Wahl, die der Server ablehnt), bleibt die
 * Vorschau stehen, der Fehler steht darüber und die letzte Wahl ist zurückgenommen. Lehnt das
 * Übernehmen mit Zeilen ab (422), stehen die Zeilen da und die Vorschau wird neu abgefragt.
 *
 * Quelle „Schnappschuss“ (LLH-1194): derselbe Dialog für einen Stand, den ein Adapter
 * „Stammdaten-Abruf“ abgeholt hat. Den ersten Schritt (Datei und Herkunft) gibt es dann nicht,
 * die Vorschau lädt beim Öffnen. Ist der Schnappschuss inzwischen ersetzt (409), sagt der Dialog
 * das und lädt die Liste der offenen neu.
 */

const ACCEPT =
  '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const BEISPIEL = '/beispiele/stammdaten-beispiel';
const ZU_GROSS = `Datei ist zu groß (${STAMMDATEN_DATEI_MAX_BYTES / 1024 / 1024} MiB erlaubt)`;

interface StammdatenEinlesenProps {
  /** Ohne Recht gesperrt; den Grund nennt der Hinweis der Seite. */
  disabled?: boolean;
}

/** Woher die Stammdaten kommen: eine Datei oder ein abgerufener Schnappschuss. */
export type StammdatenQuelle = { art: 'datei' } | { art: 'schnappschuss'; id: string };

/** Was außer den Entscheidungen zu einer Anfrage gehört; die Herkunft getrimmt. */
type Anfrage =
  { art: 'datei'; datei: File; herkunft: string } | { art: 'schnappschuss'; id: string };

function dateiAnfrage(f: File, h: string): Anfrage {
  return { art: 'datei', datei: f, herkunft: h.trim() };
}

function vorschauFuer(a: Anfrage, e: StammdatenEntscheidungen) {
  return a.art === 'datei'
    ? stammdatenEinlesenVorschau(a.datei, a.herkunft || undefined, e)
    : schnappschussVorschau(a.id, e);
}

function uebernimm(a: Anfrage, e: StammdatenEntscheidungen) {
  return a.art === 'datei'
    ? stammdatenEinlesen(a.datei, a.herkunft || undefined, e)
    : schnappschussUebernehmen(a.id, e);
}

/** Knopf „Stammdaten einlesen“ mit seinem Dialog. */
export default function StammdatenEinlesen({ disabled = false }: StammdatenEinlesenProps) {
  const [offen, setOffen] = useState(false);
  return (
    <>
      <Button
        disabled={disabled}
        icon={
          <span aria-hidden="true">
            <IconHochladen />
          </span>
        }
        onClick={() => setOffen(true)}
      >
        Stammdaten einlesen
      </Button>
      <StammdatenEinlesenDialog quelle={DATEI} offen={offen} onSchliessen={() => setOffen(false)} />
    </>
  );
}

const DATEI: StammdatenQuelle = { art: 'datei' };

interface StammdatenEinlesenDialogProps {
  quelle: StammdatenQuelle;
  offen: boolean;
  onSchliessen: () => void;
}

/** Der Dialog allein; die Quelle bestimmt, ob er mit der Datei oder gleich mit der Vorschau beginnt. */
export function StammdatenEinlesenDialog({
  quelle,
  offen,
  onSchliessen,
}: StammdatenEinlesenDialogProps) {
  const qc = useQueryClient();
  const grundId = useId();
  const herkunftId = useId();
  const ausDatei = quelle.art === 'datei';
  const schnappschussId = quelle.art === 'schnappschuss' ? quelle.id : null;
  const [datei, setDatei] = useState<File | null>(null);
  const [dateiFehler, setDateiFehler] = useState<string | null>(null);
  const [herkunft, setHerkunft] = useState('');
  const [herkunftGesendet, setHerkunftGesendet] = useState('');
  const [herkunftZeigen, setHerkunftZeigen] = useState(false);
  /** Die letzte gelungene Vorschau, mit der Anfrage und den Entscheidungen, aus denen sie entstand. */
  const vorschauStand = useVorschauStand<Anfrage>(vorschauFuer);
  const { entscheidungen, setEntscheidungen, stand } = vorschauStand;
  const standHerkunft = stand?.anfrage.art === 'datei' ? stand.anfrage.herkunft : '';
  const [ergebnis, setErgebnis] = useState<StammdatenErgebnis | null>(null);

  const katalog = useQuery({
    queryKey: globalKeys.qualifikationen(),
    queryFn: listeQualifikationen,
    enabled: offen,
  });

  const schnappschuesseNeu = () =>
    void qc.invalidateQueries({ queryKey: globalKeys.stammdatenSchnappschuesse() });

  const uebernehmenMut = useMutation({
    mutationFn: (v: { anfrage: Anfrage; e: StammdatenEntscheidungen }) => uebernimm(v.anfrage, v.e),
    onSuccess: (r, v) => {
      setErgebnis(r);
      void qc.invalidateQueries({ queryKey: globalKeys.fahrzeuge() });
      void qc.invalidateQueries({ queryKey: globalKeys.personal() });
      void qc.invalidateQueries({ queryKey: globalKeys.qualifikationen() });
      if (v.anfrage.art === 'schnappschuss') schnappschuesseNeu();
    },
    onError: (fehler, v) => {
      // Der Stand hat sich seit der Vorschau geändert: neu abfragen, die Zeilen bleiben stehen.
      if (fehler instanceof ApiError && fehler.status === 422) {
        frage(v.anfrage, v.e, { fehlerBehalten: true });
      }
      // Ein neuerer Abruf hat den Schnappschuss ersetzt: die Liste zeigt den neuen.
      if (v.anfrage.art === 'schnappschuss' && istKonflikt(fehler)) schnappschuesseNeu();
    },
  });
  const vorschau = vorschauStand.vorschau;
  const laeuft = vorschauStand.laeuft || uebernehmenMut.isPending;
  const ersetzt = !ausDatei && istKonflikt(uebernehmenMut.error);

  const frage = (
    a: Anfrage,
    e: StammdatenEntscheidungen,
    { fehlerBehalten = false }: { fehlerBehalten?: boolean } = {},
  ) => {
    if (a.art === 'datei') setHerkunftGesendet(a.herkunft);
    if (!fehlerBehalten) uebernehmenMut.reset();
    vorschauStand.frage(a, e, {
      onError: (vorher) => {
        setHerkunftGesendet(vorher?.anfrage.art === 'datei' ? vorher.anfrage.herkunft : '');
      },
      onSuccess: (v) => {
        if (a.art !== 'datei') return;
        if (v.herkunft_noetig) setHerkunftZeigen(true);
        // Der zuletzt genutzte Name der Quelle wird vorbelegt und gleich mitgeprüft.
        if (v.herkunft_noetig && a.herkunft === '' && v.herkunft_vorschlag) {
          setHerkunft(v.herkunft_vorschlag);
          frage(dateiAnfrage(a.datei, v.herkunft_vorschlag), e);
        }
      },
    });
  };
  /** Die Anfrage zum aktuellen Stand des Dialogs; `null`, solange keine Datei gewählt ist. */
  const anfrageJetzt = (): Anfrage | null =>
    schnappschussId != null
      ? { art: 'schnappschuss', id: schnappschussId }
      : datei != null
        ? dateiAnfrage(datei, herkunft)
        : null;

  // Beim Schnappschuss gibt es keinen ersten Schritt: die Vorschau lädt beim Öffnen.
  const starteSchnappschuss = useEffectEvent((id: string) => {
    if (vorschauStand.stand == null && !vorschauStand.laeuft) {
      frage({ art: 'schnappschuss', id }, LEERE_ENTSCHEIDUNGEN);
    }
  });
  useEffect(() => {
    if (offen && schnappschussId != null) starteSchnappschuss(schnappschussId);
  }, [offen, schnappschussId]);

  const zuruecksetzen = () => {
    setDatei(null);
    setDateiFehler(null);
    setHerkunft('');
    setHerkunftGesendet('');
    setHerkunftZeigen(false);
    vorschauStand.zuruecksetzen();
    setErgebnis(null);
    uebernehmenMut.reset();
  };
  const schliessen = () => {
    if (uebernehmenMut.isPending) return;
    onSchliessen();
    zuruecksetzen();
  };
  const waehleDatei = (f: File) => {
    zuruecksetzen();
    if (f.size > STAMMDATEN_DATEI_MAX_BYTES) {
      setDateiFehler(ZU_GROSS);
      return;
    }
    setDatei(f);
    frage(dateiAnfrage(f, ''), LEERE_ENTSCHEIDUNGEN);
  };
  const aendereEntscheidungen = (neu: StammdatenEntscheidungen) => {
    const a = anfrageJetzt();
    if (a == null) return;
    setEntscheidungen(neu);
    frage(a, neu);
  };
  const bestaetigeHerkunft = () => {
    if (datei != null && herkunft.trim() !== herkunftGesendet) {
      frage(dateiAnfrage(datei, herkunft), entscheidungen);
    }
  };

  const sperrGrund =
    vorschau == null
      ? null
      : artZaehlungen(vorschau.zaehlung).some((a) => a.fehler > 0) ||
          vorschau.meldungen.some((m) => m.stufe === 'fehler')
        ? ausDatei
          ? 'Fehler in der Datei'
          : 'Fehler in den abgerufenen Daten'
        : offeneEntscheidungen(vorschau, entscheidungen) > 0
          ? 'Entscheidungen offen'
          : vorschau.herkunft_noetig && herkunft.trim() === ''
            ? 'Herkunft fehlt'
            : herkunft.trim() !== standHerkunft
              ? 'Herkunft wird geprüft'
              : !vorschau.uebernehmbar
                ? 'Nicht übernehmbar'
                : artZaehlungen(vorschau.zaehlung).reduce((s, a) => s + artAenderungen(a), 0) === 0
                  ? 'Keine Änderungen'
                  : null;
  const gesperrt = ersetzt ? 'Neuer Stand liegt vor' : sperrGrund;

  const fuss = ergebnis ? (
    <Button type="primary" onClick={schliessen}>
      Schließen
    </Button>
  ) : (
    <Stapel richtung="zeile" umbruch abstand="sm" verteilen="ende" ausrichten="mitte">
      {gesperrt != null && (
        <Typography.Text type="secondary" id={grundId} data-lfh="einlesen-gesperrt">
          {gesperrt}
        </Typography.Text>
      )}
      <Button onClick={schliessen} disabled={uebernehmenMut.isPending}>
        Abbrechen
      </Button>
      <Button
        type="primary"
        disabled={vorschau == null || gesperrt != null || vorschauStand.laeuft}
        loading={uebernehmenMut.isPending}
        aria-describedby={gesperrt != null ? grundId : undefined}
        onClick={() =>
          stand && uebernehmenMut.mutate({ anfrage: stand.anfrage, e: stand.entscheidungen })
        }
      >
        Übernehmen
      </Button>
    </Stapel>
  );

  return (
    <>
      <Modal
        open={offen}
        title={ausDatei ? 'Stammdaten einlesen' : 'Abgerufene Stammdaten prüfen'}
        onCancel={schliessen}
        footer={fuss}
        width={760}
        destroyOnHidden
        mask={{ closable: false }}
        closable={!uebernehmenMut.isPending}
      >
        <div data-lfh="stammdaten-einlesen">
          {ergebnis ? (
            <div data-lfh="einlesen-ergebnis">
              <Stapel abstand="sm">
                <Typography.Text strong>
                  {artZaehlungen(ergebnis.zaehlung).reduce((s, a) => s + artAenderungen(a), 0) === 0
                    ? 'Nichts geändert'
                    : 'Übernommen'}
                </Typography.Text>
                <Stapel richtung="zeile" umbruch abstand="xs">
                  {zaehlungMarken(ergebnis.zaehlung).map((m) => (
                    <Marke key={m}>{m}</Marke>
                  ))}
                </Stapel>
                <NichtUebernommen spalten={vorschau?.nicht_uebernommen ?? []} />
              </Stapel>
            </div>
          ) : (
            <Stapel abstand="md">
              {ausDatei && (
                <Stapel richtung="zeile" umbruch abstand="sm" ausrichten="mitte">
                  <Upload
                    accept={ACCEPT}
                    showUploadList={false}
                    maxCount={1}
                    disabled={laeuft}
                    beforeUpload={(f) => {
                      waehleDatei(f);
                      return false;
                    }}
                  >
                    <Button
                      icon={
                        <span aria-hidden="true">
                          <IconHochladen />
                        </span>
                      }
                    >
                      {datei == null ? 'Datei wählen' : 'Andere Datei'}
                    </Button>
                  </Upload>
                  {datei != null && (
                    <Typography.Text data-lfh="einlesen-datei">{datei.name}</Typography.Text>
                  )}
                  <Typography.Text type="secondary" style={{ marginInlineStart: 'auto' }}>
                    Beispieldatei:{' '}
                    <a href={`${BEISPIEL}.csv`} download>
                      CSV
                    </a>{' '}
                    ·{' '}
                    <a href={`${BEISPIEL}.xlsx`} download>
                      Excel
                    </a>
                  </Typography.Text>
                </Stapel>
              )}
              {dateiFehler != null && <Alert type="error" showIcon title={dateiFehler} />}
              {herkunftZeigen && (
                <div data-lfh="einlesen-herkunft">
                  <Stapel abstand="xxs">
                    <Feldetikett als="label" htmlFor={herkunftId}>
                      Herkunft
                    </Feldetikett>
                    <div className={FELD_KLASSE} style={{ maxWidth: 'var(--lfh-feld-mittel)' }}>
                      <Input
                        id={herkunftId}
                        value={herkunft}
                        disabled={laeuft}
                        maxLength={100}
                        onChange={(ev) => setHerkunft(ev.target.value)}
                        onBlur={bestaetigeHerkunft}
                        onPressEnter={bestaetigeHerkunft}
                      />
                    </div>
                    <Typography.Text type="secondary">
                      Name der Quelle, aus der die Datei stammt; die Kennungen der Datei gelten nur
                      für diese Quelle.
                    </Typography.Text>
                  </Stapel>
                </div>
              )}
              <SpeicherFehler
                fehler={vorschauStand.fehler}
                titel={
                  vorschau != null
                    ? 'Wahl nicht übernommen'
                    : ausDatei
                      ? 'Datei nicht gelesen'
                      : 'Abgerufene Daten nicht gelesen'
                }
              />
              {ersetzt ? (
                <Alert
                  type="warning"
                  showIcon
                  data-lfh="einlesen-ersetzt"
                  title="Inzwischen gibt es einen neueren Stand"
                  description={
                    <Stapel abstand="xxs">
                      <span>{fehlerText(uebernehmenMut.error)}</span>
                      <span>
                        Übernommen ist nichts. Schließe den Dialog und prüfe den neuen Stand.
                      </span>
                    </Stapel>
                  }
                />
              ) : (
                <UebernehmenFehler fehler={uebernehmenMut.error} />
              )}
              {vorschauStand.laeuft && vorschau == null && <Spin />}
              {vorschau != null && (
                <Spin spinning={vorschauStand.laeuft}>
                  <StammdatenVorschauAnsicht
                    vorschau={vorschau}
                    katalog={katalog.data ?? []}
                    entscheidungen={entscheidungen}
                    onEntscheidungen={aendereEntscheidungen}
                    gesperrt={laeuft}
                  />
                </Spin>
              )}
            </Stapel>
          )}
        </div>
      </Modal>
    </>
  );
}

/** Fehler des Übernehmens; bei einem 422 mit den Zeilen, die es sperren. */
function UebernehmenFehler({ fehler }: { fehler: unknown }) {
  const zeilen = fehler instanceof ApiError ? fehler.zeilen : [];
  if (zeilen.length === 0) return <SpeicherFehler fehler={fehler} titel="Nicht übernommen" />;
  return (
    <Alert
      type="error"
      showIcon
      data-lfh="einlesen-abgelehnt"
      title="Nicht übernommen"
      description={
        <Stapel abstand="xxs">
          <span>{(fehler as ApiError).message}</span>
          <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
            {zeilen.map((z, i) => (
              <li key={i}>{z.id > 0 ? `Zeile ${z.id}: ${z.grund}` : z.grund}</li>
            ))}
          </ul>
        </Stapel>
      }
    />
  );
}
