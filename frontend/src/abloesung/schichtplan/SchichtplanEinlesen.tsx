import { Alert, Button, Flex, Modal, Spin, Tag, Typography, Upload } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { SCHICHTPLAN_DATEI_MAX_BYTES } from '../../api/eingabegrenzen';
import { einsatzKeys } from '../../api/queryKeys';
import { schichtplanEinlesen, schichtplanEinlesenVorschau } from '../../api/schichtplan';
import type {
  SchichtplanEntscheidungenEingabe,
  SchichtplanImportErgebnis,
  SchichtplanImportMeldung,
  SchichtplanImportPerson,
  SchichtplanImportPersonZiel,
  SchichtplanImportPosten,
  SchichtplanImportPostenZiel,
  SchichtplanImportTreffer,
  SchichtplanImportVorschau,
  SchichtplanImportZaehlung,
  SchichtplanPersonWahlEingabe,
  SchichtplanPostenWahlEingabe,
} from '../../api/types';
import { Select } from '../../components/Select';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { useRollen } from '../../components/instrument';
import { IconHochladen } from '../../icons';

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

const LEER: SchichtplanEntscheidungenEingabe = { posten: {}, personen: {} };

const TREFFER: Record<SchichtplanImportTreffer, string> = {
  sicher: 'Gefunden',
  unsicher: 'Unsicher',
  neu: 'Neu',
};

function mehrzahl(n: number, eins: string, viele: string): string {
  return `${n.toLocaleString('de-DE')} ${n === 1 ? eins : viele}`;
}

/** Die Zählung als kurze Marken; ohne Änderung genau eine. */
export function zaehlungMarken(z: SchichtplanImportZaehlung): string[] {
  if (z.aenderungen === 0) return ['Keine Änderungen'];
  const marken: string[] = [];
  if (z.bloecke_neu > 0) marken.push(`${mehrzahl(z.bloecke_neu, 'Schicht', 'Schichten')} neu`);
  if (z.bloecke_ergaenzt > 0)
    marken.push(`${mehrzahl(z.bloecke_ergaenzt, 'Schicht', 'Schichten')} ergänzt`);
  if (z.bloecke_unveraendert > 0)
    marken.push(`${mehrzahl(z.bloecke_unveraendert, 'Schicht', 'Schichten')} unverändert`);
  if (z.einteilungen_neu > 0)
    marken.push(`${mehrzahl(z.einteilungen_neu, 'Einteilung', 'Einteilungen')}`);
  if (z.helfer_neu > 0) marken.push(`${mehrzahl(z.helfer_neu, 'Helfer', 'Helfer')} neu`);
  if (z.einheiten_neu > 0) marken.push(`${mehrzahl(z.einheiten_neu, 'Einheit', 'Einheiten')} neu`);
  if (z.uhs_neu > 0) marken.push(`${mehrzahl(z.uhs_neu, 'UHS', 'UHS')} neu`);
  return marken;
}

/** Wert eines Postenziels in der Auswahl. */
function postenWert(z: SchichtplanImportPostenZiel): string {
  switch (z.art) {
    case 'einheit':
      return `einheit:${z.einheit_id}`;
    case 'uhs':
      return `uhs:${z.uhs_id}`;
    case 'neu':
      return z.einheit_vorlage_id != null ? `neu:${z.einheit_vorlage_id}` : 'neu';
    case 'pause':
      return 'pause';
  }
}

function postenWahl(wert: string): SchichtplanPostenWahlEingabe {
  const [art, id] = wert.split(':');
  if (art === 'einheit') return { art: 'einheit', einheit_id: Number(id) };
  if (art === 'uhs') return { art: 'uhs', uhs_id: Number(id) };
  return { art: 'neu', einheit_vorlage_id: id != null ? Number(id) : null };
}

function personWert(z: SchichtplanImportPersonZiel): string {
  switch (z.art) {
    case 'stamm':
      return `stamm:${z.personal_id}`;
    case 'helfer':
      return `helfer:${z.helfer_id}`;
    case 'einsatz':
      return `einsatz:${z.einsatz_personal_id}`;
    case 'neu':
      return 'neu';
  }
}

function personWahl(wert: string): SchichtplanPersonWahlEingabe {
  const [art, id] = wert.split(':');
  if (art === 'stamm') return { art: 'stamm', personal_id: Number(id) };
  if (art === 'helfer') return { art: 'helfer', helfer_id: Number(id) };
  if (art === 'einsatz') return { art: 'einsatz', einsatz_personal_id: Number(id) };
  return { art: 'neu' };
}

function personLabel(z: SchichtplanImportPersonZiel): string {
  if (z.art === 'neu') return 'Neu als Helfer';
  if (z.art === 'einsatz') return `${z.name} (Einsatzkraft)`;
  return z.art === 'stamm' ? z.name : `${z.name} (Helfer)`;
}

function Treffer({ treffer }: { treffer: SchichtplanImportTreffer }) {
  return <Tag data-lfh={`einlesen-treffer-${treffer}`}>{TREFFER[treffer]}</Tag>;
}

function PostenZeile({
  posten,
  vorschau,
  gesperrt,
  onWahl,
}: {
  posten: SchichtplanImportPosten;
  vorschau: SchichtplanImportVorschau;
  gesperrt: boolean;
  onWahl: (wert: string) => void;
}) {
  const { token } = useRollen();
  const istUhs = posten.art === 'uhs';
  const a = vorschau.auswahl;
  const einheiten = {
    label: 'Einheiten',
    options: a.einheiten.map((e) => ({ value: `einheit:${e.id}`, label: e.bezeichnung })),
  };
  const uhs = {
    label: 'UHS',
    options: a.uhs.map((u) => ({ value: `uhs:${u.id}`, label: u.bezeichnung })),
  };
  const neu = {
    label: 'Neu',
    options: [
      { value: 'neu', label: istUhs ? 'Neue UHS' : 'Neue Einheit' },
      ...(istUhs
        ? []
        : a.vorlagen.map((v) => ({
            value: `neu:${v.id}`,
            label: `Neu aus Vorlage ${v.bezeichnung}`,
          }))),
    ],
  };
  const optionen = istUhs ? [uhs, einheiten, neu] : [einheiten, uhs, neu];
  return (
    <Flex
      gap={token.marginSM}
      align="center"
      wrap
      data-lfh="einlesen-posten"
      style={{ paddingBlock: token.paddingXXS }}
    >
      <span style={{ flex: '1 1 12rem', minWidth: 0 }}>
        <Typography.Text strong>{posten.art === 'pause' ? 'Pause' : posten.name}</Typography.Text>
        {posten.abschnitt != null && (
          <Typography.Text type="secondary"> · {posten.abschnitt}</Typography.Text>
        )}
      </span>
      <Treffer treffer={posten.treffer} />
      {posten.art !== 'pause' && (
        <Select
          aria-label={`Ziel für ${posten.name}`}
          value={postenWert(posten.ziel)}
          onChange={onWahl}
          disabled={gesperrt}
          options={optionen}
          style={{ flex: '1 1 14rem', minWidth: 0 }}
        />
      )}
    </Flex>
  );
}

function PersonZeile({
  person,
  gesperrt,
  onWahl,
}: {
  person: SchichtplanImportPerson;
  gesperrt: boolean;
  onWahl: (wert: string) => void;
}) {
  const { token } = useRollen();
  const ziele: SchichtplanImportPersonZiel[] = [person.ziel, ...person.kandidaten];
  if (!ziele.some((z) => z.art === 'neu')) ziele.push({ art: 'neu' });
  const optionen = ziele
    .filter((z, i) => ziele.findIndex((y) => personWert(y) === personWert(z)) === i)
    .map((z) => ({ value: personWert(z), label: personLabel(z) }));
  const kennung = [person.herkunft, person.kennung].filter(Boolean).join(' ');
  return (
    <Flex
      gap={token.marginSM}
      align="center"
      wrap
      data-lfh="einlesen-person"
      style={{ paddingBlock: token.paddingXXS }}
    >
      <span style={{ flex: '1 1 12rem', minWidth: 0 }}>
        <Typography.Text strong>{person.name}</Typography.Text>
        {kennung !== '' && <Typography.Text type="secondary"> · {kennung}</Typography.Text>}
      </span>
      <Treffer treffer={person.treffer} />
      <Select
        aria-label={`Person für ${person.name}`}
        value={personWert(person.ziel)}
        onChange={onWahl}
        disabled={gesperrt}
        options={optionen}
        style={{ flex: '1 1 14rem', minWidth: 0 }}
      />
    </Flex>
  );
}

function Meldungen({
  meldungen,
  stufe,
}: {
  meldungen: readonly SchichtplanImportMeldung[];
  stufe: 'fehler' | 'hinweis';
}) {
  const liste = meldungen.filter((m) => m.stufe === stufe);
  if (liste.length === 0) return null;
  return (
    <Alert
      type={stufe === 'fehler' ? 'error' : 'warning'}
      showIcon
      data-lfh={`einlesen-${stufe}`}
      title={
        stufe === 'fehler'
          ? mehrzahl(liste.length, 'Fehler', 'Fehler')
          : mehrzahl(liste.length, 'Hinweis', 'Hinweise')
      }
      description={
        <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
          {liste.map((m, i) => (
            <li key={i}>{m.zeile != null ? `Zeile ${m.zeile}: ${m.text}` : m.text}</li>
          ))}
        </ul>
      }
    />
  );
}

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
  const [wahl, setWahl] = useState<SchichtplanEntscheidungenEingabe>(LEER);
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
    setWahl(LEER);
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
    vorschauMut.mutate({ datei: f, wahl: LEER });
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
                  <Flex vertical gap={token.margin} data-lfh="einlesen-vorschau">
                    <Flex gap={token.marginXS} wrap data-lfh="einlesen-zaehlung">
                      {zaehlungMarken(vorschau.zaehlung).map((m) => (
                        <Tag key={m}>{m}</Tag>
                      ))}
                    </Flex>
                    <Meldungen meldungen={vorschau.meldungen} stufe="fehler" />
                    {vorschau.posten.length > 0 && (
                      <section aria-label="Posten">
                        <Typography.Title level={5}>Posten</Typography.Title>
                        {vorschau.posten.map((p) => (
                          <PostenZeile
                            key={p.schluessel}
                            posten={p}
                            vorschau={vorschau}
                            gesperrt={laeuft}
                            onWahl={(w) =>
                              aendereWahl({
                                ...wahl,
                                posten: { ...wahl.posten, [p.schluessel]: postenWahl(w) },
                              })
                            }
                          />
                        ))}
                      </section>
                    )}
                    {vorschau.personen.length > 0 && (
                      <section aria-label="Personen">
                        <Typography.Title level={5}>Personen</Typography.Title>
                        {vorschau.personen.map((p) => (
                          <PersonZeile
                            key={p.schluessel}
                            person={p}
                            gesperrt={laeuft}
                            onWahl={(w) =>
                              aendereWahl({
                                ...wahl,
                                personen: { ...wahl.personen, [p.schluessel]: personWahl(w) },
                              })
                            }
                          />
                        ))}
                      </section>
                    )}
                    <Meldungen meldungen={vorschau.meldungen} stufe="hinweis" />
                  </Flex>
                </Spin>
              )}
            </Flex>
          )}
        </div>
      </Modal>
    </>
  );
}
