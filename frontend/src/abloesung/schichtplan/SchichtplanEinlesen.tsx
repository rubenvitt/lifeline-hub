import { Alert, Button, Flex, Modal, Spin, Tag, Typography, Upload } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { SCHICHTPLAN_DATEI_MAX_BYTES } from '../../api/eingabegrenzen';
import { einsatzKeys } from '../../api/queryKeys';
import { schichtplanEinlesen, schichtplanEinlesenVorschau } from '../../api/schichtplan';
import type { SchichtplanEntscheidungenEingabe, SchichtplanImportErgebnis } from '../../api/types';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { useRollen } from '../../components/instrument';
import { IconHochladen } from '../../icons';
import { ImportVorschauAnsicht, LEERE_WAHL, zaehlungMarken } from './ImportVorschauAnsicht';

/**
 * „Schichtplan einlesen“ (LLH-1556, design.md D10): Knopf und Dialog in drei Stufen — Datei,
 * Vorschau, Ergebnis. Die Vorschau schreibt nichts; jede Wahl fragt sie neu ab, der Server
 * gleicht ab und zählt. „Übernehmen“ schickt dieselbe Datei mit der Wahl, der Plan aus der
 * Antwort ersetzt den Cache. Das Format steht in der Anwenderdoku, nicht hier.
 */

const ACCEPT =
  '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const BEISPIEL = '/beispiele/schichtplan-stadtfest';
const ZU_GROSS = `Datei ist zu groß (${SCHICHTPLAN_DATEI_MAX_BYTES / 1024 / 1024} MiB erlaubt)`;

interface SchichtplanEinlesenProps {
  einsatzId: number;
}

/** Knopf „Schichtplan einlesen“ mit seinem Dialog. */
export default function SchichtplanEinlesen({ einsatzId }: SchichtplanEinlesenProps) {
  const qc = useQueryClient();
  const { token } = useRollen();
  const grundId = useId();
  const [offen, setOffen] = useState(false);
  const [datei, setDatei] = useState<File | null>(null);
  const [dateiFehler, setDateiFehler] = useState<string | null>(null);
  const [wahl, setWahl] = useState<SchichtplanEntscheidungenEingabe>(LEERE_WAHL);
  const [ergebnis, setErgebnis] = useState<SchichtplanImportErgebnis | null>(null);

  const vorschauMut = useMutation({
    mutationFn: (v: { datei: File; wahl: SchichtplanEntscheidungenEingabe }) =>
      schichtplanEinlesenVorschau(einsatzId, v.datei, v.wahl),
  });
  const uebernehmenMut = useMutation({
    mutationFn: (v: { datei: File; wahl: SchichtplanEntscheidungenEingabe }) =>
      schichtplanEinlesen(einsatzId, v.datei, v.wahl),
    onSuccess: (r) => {
      qc.setQueryData(einsatzKeys.schichtplan(einsatzId), r.plan);
      setErgebnis(r);
    },
  });
  const vorschau = vorschauMut.data ?? null;
  const laeuft = vorschauMut.isPending || uebernehmenMut.isPending;

  const zuruecksetzen = () => {
    setDatei(null);
    setDateiFehler(null);
    setWahl(LEERE_WAHL);
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
    if (f.size > SCHICHTPLAN_DATEI_MAX_BYTES) {
      setDateiFehler(ZU_GROSS);
      return;
    }
    setDatei(f);
    vorschauMut.mutate({ datei: f, wahl: LEERE_WAHL });
  };
  const aendereWahl = (neu: SchichtplanEntscheidungenEingabe) => {
    if (datei == null) return;
    setWahl(neu);
    uebernehmenMut.reset();
    vorschauMut.mutate({ datei, wahl: neu });
  };

  const sperrGrund =
    vorschau == null
      ? null
      : !vorschau.uebernehmbar
        ? 'Fehler in der Datei'
        : vorschau.zaehlung.aenderungen === 0
          ? 'Keine Änderungen'
          : null;

  const fuss = ergebnis ? (
    <Button type="primary" onClick={schliessen}>
      Schließen
    </Button>
  ) : (
    <Flex gap={token.marginSM} justify="end" align="center" wrap>
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
        onClick={() => datei && uebernehmenMut.mutate({ datei, wahl })}
      >
        Übernehmen
      </Button>
    </Flex>
  );

  return (
    <>
      <Button
        icon={
          <span aria-hidden="true">
            <IconHochladen />
          </span>
        }
        onClick={() => setOffen(true)}
      >
        Schichtplan einlesen
      </Button>
      <Modal
        open={offen}
        title="Schichtplan einlesen"
        onCancel={schliessen}
        footer={fuss}
        width={760}
        destroyOnHidden
        maskClosable={false}
        closable={!uebernehmenMut.isPending}
      >
        <div data-lfh="schichtplan-einlesen">
          {ergebnis ? (
            <Flex vertical gap={token.marginSM} data-lfh="einlesen-ergebnis">
              <Typography.Text strong>
                {ergebnis.zaehlung.aenderungen === 0 ? 'Nichts geändert' : 'Übernommen'}
              </Typography.Text>
              <Flex gap={token.marginXS} wrap>
                {zaehlungMarken(ergebnis.zaehlung).map((m) => (
                  <Tag key={m}>{m}</Tag>
                ))}
              </Flex>
            </Flex>
          ) : (
            <Flex vertical gap={token.margin}>
              <Flex gap={token.marginSM} align="center" wrap>
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
              </Flex>
              {dateiFehler != null && <Alert type="error" showIcon title={dateiFehler} />}
              <SpeicherFehler fehler={vorschauMut.error} titel="Datei nicht gelesen" />
              <SpeicherFehler fehler={uebernehmenMut.error} titel="Nicht übernommen" />
              {vorschauMut.isPending && vorschau == null && <Spin />}
              {vorschau != null && (
                <Spin spinning={vorschauMut.isPending}>
                  <ImportVorschauAnsicht
                    vorschau={vorschau}
                    wahl={wahl}
                    gesperrt={laeuft}
                    onWahl={aendereWahl}
                  />
                </Spin>
              )}
            </Flex>
          )}
        </div>
      </Modal>
    </>
  );
}
