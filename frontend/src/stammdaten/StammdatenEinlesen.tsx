import { Alert, Button, Input, Modal, Spin, Typography, Upload } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { STAMMDATEN_DATEI_MAX_BYTES } from '../api/eingabegrenzen';
import { globalKeys } from '../api/queryKeys';
import {
  LEERE_ENTSCHEIDUNGEN,
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

/**
 * „Stammdaten einlesen“ (LLH-1633): Knopf und Dialog in drei Schritten — Datei und Herkunft,
 * Vorschau mit Entscheidungen, Ergebnis. Die Vorschau schreibt nichts; jede Wahl schickt Datei,
 * Herkunft und Entscheidungen neu, der Server gleicht ab und zählt. „Übernehmen“ schickt
 * dieselben Teile. Das Dateiformat steht in der Anwenderdoku, nicht hier.
 */

const ACCEPT =
  '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const BEISPIEL = '/beispiele/stammdaten-beispiel';
const ZU_GROSS = `Datei ist zu groß (${STAMMDATEN_DATEI_MAX_BYTES / 1024 / 1024} MiB erlaubt)`;

interface StammdatenEinlesenProps {
  /** Ohne Recht gesperrt; den Grund nennt der Hinweis der Seite. */
  disabled?: boolean;
}

/** Knopf „Stammdaten einlesen“ mit seinem Dialog. */
export default function StammdatenEinlesen({ disabled = false }: StammdatenEinlesenProps) {
  const qc = useQueryClient();
  const grundId = useId();
  const herkunftId = useId();
  const [offen, setOffen] = useState(false);
  const [datei, setDatei] = useState<File | null>(null);
  const [dateiFehler, setDateiFehler] = useState<string | null>(null);
  const [herkunft, setHerkunft] = useState('');
  const [herkunftGesendet, setHerkunftGesendet] = useState('');
  const [herkunftZeigen, setHerkunftZeigen] = useState(false);
  const [entscheidungen, setEntscheidungen] =
    useState<StammdatenEntscheidungen>(LEERE_ENTSCHEIDUNGEN);
  const [ergebnis, setErgebnis] = useState<StammdatenErgebnis | null>(null);

  const vorschauMut = useMutation({
    mutationFn: (v: { datei: File; herkunft: string; e: StammdatenEntscheidungen }) =>
      stammdatenEinlesenVorschau(v.datei, v.herkunft.trim() || undefined, v.e),
  });
  const uebernehmenMut = useMutation({
    mutationFn: (v: { datei: File; herkunft: string; e: StammdatenEntscheidungen }) =>
      stammdatenEinlesen(v.datei, v.herkunft.trim() || undefined, v.e),
    onSuccess: (r) => {
      setErgebnis(r);
      void qc.invalidateQueries({ queryKey: globalKeys.fahrzeuge() });
      void qc.invalidateQueries({ queryKey: globalKeys.personal() });
      void qc.invalidateQueries({ queryKey: globalKeys.qualifikationen() });
    },
  });
  const vorschau = vorschauMut.data ?? null;
  const laeuft = vorschauMut.isPending || uebernehmenMut.isPending;

  const frage = (f: File, h: string, e: StammdatenEntscheidungen) => {
    setHerkunftGesendet(h.trim());
    uebernehmenMut.reset();
    vorschauMut.mutate(
      { datei: f, herkunft: h, e },
      {
        onSuccess: (v) => {
          if (v.herkunft_noetig) setHerkunftZeigen(true);
          // Der zuletzt genutzte Name der Quelle wird vorbelegt und gleich mitgeprüft.
          if (v.herkunft_noetig && h.trim() === '' && v.herkunft_vorschlag) {
            setHerkunft(v.herkunft_vorschlag);
            frage(f, v.herkunft_vorschlag, e);
          }
        },
      },
    );
  };

  const zuruecksetzen = () => {
    setDatei(null);
    setDateiFehler(null);
    setHerkunft('');
    setHerkunftGesendet('');
    setHerkunftZeigen(false);
    setEntscheidungen(LEERE_ENTSCHEIDUNGEN);
    setErgebnis(null);
    vorschauMut.reset();
    uebernehmenMut.reset();
  };
  const schliessen = () => {
    if (uebernehmenMut.isPending) return;
    setOffen(false);
    zuruecksetzen();
  };
  const waehleDatei = (f: File) => {
    zuruecksetzen();
    if (f.size > STAMMDATEN_DATEI_MAX_BYTES) {
      setDateiFehler(ZU_GROSS);
      return;
    }
    setDatei(f);
    frage(f, '', LEERE_ENTSCHEIDUNGEN);
  };
  const aendereEntscheidungen = (neu: StammdatenEntscheidungen) => {
    if (datei == null) return;
    setEntscheidungen(neu);
    frage(datei, herkunft, neu);
  };
  const bestaetigeHerkunft = () => {
    if (datei != null && herkunft.trim() !== herkunftGesendet) {
      frage(datei, herkunft, entscheidungen);
    }
  };

  const sperrGrund =
    vorschau == null
      ? null
      : artZaehlungen(vorschau.zaehlung).some((a) => a.fehler > 0) ||
          vorschau.meldungen.some((m) => m.stufe === 'fehler')
        ? 'Fehler in der Datei'
        : offeneEntscheidungen(vorschau, entscheidungen) > 0
          ? 'Entscheidungen offen'
          : vorschau.herkunft_noetig && herkunft.trim() === ''
            ? 'Herkunft fehlt'
            : herkunft.trim() !== herkunftGesendet
              ? 'Herkunft wird geprüft'
              : !vorschau.uebernehmbar
                ? 'Nicht übernehmbar'
                : artZaehlungen(vorschau.zaehlung).reduce((s, a) => s + artAenderungen(a), 0) === 0
                  ? 'Keine Änderungen'
                  : null;

  const fuss = ergebnis ? (
    <Button type="primary" onClick={schliessen}>
      Schließen
    </Button>
  ) : (
    <Stapel richtung="zeile" umbruch abstand="sm" verteilen="ende" ausrichten="mitte">
      {sperrGrund != null && (
        <Typography.Text type="secondary" id={grundId} data-lfh="einlesen-gesperrt">
          {sperrGrund}
        </Typography.Text>
      )}
      <Button onClick={schliessen} disabled={uebernehmenMut.isPending}>
        Abbrechen
      </Button>
      <Button
        type="primary"
        disabled={vorschau == null || sperrGrund != null || vorschauMut.isPending}
        loading={uebernehmenMut.isPending}
        aria-describedby={sperrGrund != null ? grundId : undefined}
        onClick={() => datei && uebernehmenMut.mutate({ datei, herkunft, e: entscheidungen })}
      >
        Übernehmen
      </Button>
    </Stapel>
  );

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
      <Modal
        open={offen}
        title="Stammdaten einlesen"
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
              <SpeicherFehler fehler={vorschauMut.error} titel="Datei nicht gelesen" />
              <SpeicherFehler fehler={uebernehmenMut.error} titel="Nicht übernommen" />
              {vorschauMut.isPending && vorschau == null && <Spin />}
              {vorschau != null && (
                <Spin spinning={vorschauMut.isPending}>
                  <StammdatenVorschauAnsicht
                    vorschau={vorschau}
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
