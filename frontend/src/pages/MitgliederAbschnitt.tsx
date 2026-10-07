import { Alert, App, Button, Flex, Form, Popconfirm, Space } from 'antd';
import { Select } from '../components/Select';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { EinsatzRolle, MitgliedAnzeige } from '../api/types';
import { ApiError, fehlerText } from '../api/client';
import {
  entferneMitglied,
  ladeMitglieder,
  setzeMitglied,
  type FuehrungsstelleUpdate,
} from '../api/einsaetze';
import { EinWertAuswahl, letzterWert } from '../fuehrung/EinWertAuswahl';
import { dekodiere, kodiere } from '../fuehrung/funktionsOptionenKern';
import { useFunktionsVorschlaege } from '../fuehrung/useFunktionsVorschlaege';
import { listeBenutzer } from '../api/benutzer';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import KatalogTabelle, { type KatalogSpalte } from '../components/KatalogTabelle';
import { useViewport } from '../components/useViewport';
import Datenstand from '../components/Datenstand';
import { Paneel, useRollen } from '../components/instrument';
import { ErfassungsModal } from '../components/Erfassung';
import { EINSATZ_ROLLE_OPTIONEN } from '../einsatz/einsatzRolle';
import { anzahl } from '../anzeige/anzahl';

interface Props {
  einsatzId: number;
  darfVerwalten: boolean;
  darfFuehrungsstelleVerwalten: boolean;
}

/**
 * Spaltenbreiten unter `md` (LFH-964), gegen 390 px gewählt: die Spalte Rolle · Aktion hält
 * „Führungspersonal“ ungekürzt, der Name fließt im Rest (≈ 190 px bei 390).
 */
const SCHMAL_ROLLE = 172;
const SCHMAL_NAME_MIN = 96;

type StellenZiel = MitgliedAnzeige & { einsatzId: number };
/** Höchstens EIN Wert: Katalogwahl `funktion:<code>[:<Bezeichnung>]` oder Freitext (LFH-549). */
type StellenWerte = { fuehrungsstelle: string[] };

/** Der gespeicherte Stand eines Mitglieds als Feldwert. */
function stellenWert(m: MitgliedAnzeige): string | undefined {
  return kodiere({
    funktion: m.fuehrungsfunktion ?? undefined,
    text: m.fuehrungsstelle ?? undefined,
  });
}

function FuehrungsstelleModal({
  mitglied,
  speichern,
  schliessen,
  laeuft,
  fehler,
}: {
  mitglied: StellenZiel;
  speichern: (werte: StellenWerte) => Promise<unknown>;
  schliessen: () => void;
  laeuft: boolean;
  fehler: Error | null;
}) {
  const [form] = Form.useForm<StellenWerte>();
  const funktionen = useFunktionsVorschlaege(mitglied.einsatzId);
  const bisher = stellenWert(mitglied);
  // Der gespeicherte Wert trägt seine Anzeige selbst — auch bevor der Katalog geladen ist.
  const zusatz = bisher
    ? [{ value: bisher, label: mitglied.fuehrungsstelle_anzeige ?? bisher }]
    : [];
  return (
    <ErfassungsModal
      offen
      titel={`Führungsstelle für ${mitglied.anzeigename}`}
      form={form}
      initialValues={{ fuehrungsstelle: bisher ? [bisher] : [] }}
      onErfassen={speichern}
      onFertig={schliessen}
      onAbbrechen={schliessen}
      erfassenText="Speichern"
      laeuft={laeuft}
    >
      <Form.Item
        name="fuehrungsstelle"
        label="Führungsstelle"
        // EIN Wert: eine neue Wahl ersetzt die alte, statt sich daneben zu stellen.
        getValueFromEvent={letzterWert}
        extra="Wird beim ersten neuen ETB-Eintrag als Empfänger vorbelegt und hat Vorrang vor dem eigenen Sachgebiet aus der Stab-Besetzung. Leer lassen entfernt die Vorbelegung."
      >
        <EinWertAuswahl
          vorschlaege={funktionen}
          zusatz={zusatz}
          aria-label="Führungsstelle"
          placeholder="Funktion (z. B. S2) oder Freitext"
          disabled={laeuft}
        />
      </Form.Item>
      {fehler && <Alert type="error" title={fehler.message} showIcon />}
    </ErfassungsModal>
  );
}

/**
 * Zugriffsverwaltung eines Einsatzes (gemountet in `EinsatzdatenPage`).
 *
 * ── Keine Karten unter `md` ──
 *
 * Träger ist `KatalogTabelle`, und für die gilt: auf schmalem Schirm wird eine Tabelle angepasst,
 * nicht in Karten aufgelöst. Das Primitiv bringt Scrollcontainer, stehende Kopfzeile und fixierte
 * Kennungsspalte mit. Ab `md` vier Spalten (Name · Führungsstelle · Rolle · Aktion). Unter `md`
 * zwei (LFH-964): die Führungsstelle steht als zweite Zeile in der Namenszelle, „Entfernen“ unter
 * dem Rollenfeld — vier Spalten reichten bei 390 px bis 606 px, „Entfernen“ lag außerhalb. Die
 * Breiten folgen dann der Regel „Fließende Spalte“ (LFH-523): der Name fließt, Rolle · Aktion
 * trägt eine Zahlbreite gegen 390 px ({@link SCHMAL_ROLLE}).
 */
export default function MitgliederAbschnitt({
  einsatzId,
  darfVerwalten,
  darfFuehrungsstelleVerwalten,
}: Props) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const { istSchmal } = useViewport();
  const [neuerBenutzer, setNeuerBenutzer] = useState<number | undefined>();
  const [neueRolle, setNeueRolle] = useState<EinsatzRolle>('fuehrungspersonal');
  const [stelleZiel, setStelleZiel] = useState<StellenZiel | null>(null);

  const stelleSetzen = useMutation({
    mutationFn: ({ mitglied, wert }: { mitglied: StellenZiel; wert: FuehrungsstelleUpdate }) =>
      setzeMitglied(mitglied.einsatzId, mitglied.benutzer_id, mitglied.einsatz_rolle, wert),
    onSuccess: (liste, { mitglied }) => {
      qc.setQueryData(einsatzKeys.mitglieder(mitglied.einsatzId), liste);
      void qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(mitglied.einsatzId) });
    },
  });

  const katalog = useFunktionsVorschlaege(stelleZiel?.einsatzId).katalog;
  const stelleSpeichern = async ({ fuehrungsstelle }: StellenWerte) => {
    if (
      !stelleZiel ||
      stelleZiel.einsatzId !== einsatzId ||
      !darfFuehrungsstelleVerwalten ||
      stelleSetzen.isPending
    )
      return;
    const roh = fuehrungsstelle?.[0] ?? '';
    if (roh === (stellenWert(stelleZiel) ?? '')) return;
    // Eine neue Katalogwahl stammt aus den Optionen, also aus dem geladenen Katalog; der
    // unveränderte gespeicherte Wert ist oben schon ausgestiegen.
    const angabe = dekodiere(roh, katalog);
    await stelleSetzen.mutateAsync({
      mitglied: stelleZiel,
      wert: {
        fuehrungsfunktion: angabe.funktion ?? null,
        fuehrungsstelle: angabe.text ?? null,
      },
    });
  };

  const mitgliederQuery = useQuery({
    queryKey: einsatzKeys.mitglieder(einsatzId),
    queryFn: () => ladeMitglieder(einsatzId),
  });
  const benutzerQuery = useQuery({
    queryKey: globalKeys.benutzer(),
    queryFn: listeBenutzer,
    enabled: darfVerwalten,
  });

  const setzen = useMutation({
    mutationFn: (v: { benutzerId: number; rolle: EinsatzRolle }) =>
      setzeMitglied(einsatzId, v.benutzerId, v.rolle),
    onSuccess: (liste) => {
      qc.setQueryData(einsatzKeys.mitglieder(einsatzId), liste);
      setNeuerBenutzer(undefined);
    },
    onError: (e) => message.error(fehlerText(e)),
  });
  const entfernen = useMutation({
    mutationFn: (benutzerId: number) => entferneMitglied(einsatzId, benutzerId),
    onSuccess: (liste) => qc.setQueryData(einsatzKeys.mitglieder(einsatzId), liste),
    onError: (e) => message.error(fehlerText(e)),
  });

  const mitglieder = mitgliederQuery.data ?? [];
  const mitgliedIds = new Set(mitglieder.map((m) => m.benutzer_id));
  const verfuegbar = (benutzerQuery.data ?? []).filter((b) => b.aktiv && !mitgliedIds.has(b.id));

  const fuehrungsstelle = (m: MitgliedAnzeige) =>
    darfFuehrungsstelleVerwalten ? (
      <Button
        type="link"
        disabled={stelleSetzen.isPending}
        aria-label={`Führungsstelle für ${m.anzeigename} bearbeiten`}
        // Darf umbrechen: unter `md` steht der Knopf in der schmalen Namenszelle. `minHeight`
        // hält die Trefffläche auf der Dichte-Staffel, die `height: auto` sonst aufgibt.
        style={{
          height: 'auto',
          minHeight: token.controlHeight,
          maxWidth: '100%',
          whiteSpace: 'normal',
          textAlign: 'start',
          overflowWrap: 'anywhere',
          ...(istSchmal ? { paddingInline: 0 } : {}),
        }}
        onClick={() => {
          stelleSetzen.reset();
          setStelleZiel({ ...m, einsatzId });
        }}
      >
        {m.fuehrungsstelle_anzeige || m.fuehrungsstelle || 'Führungsstelle festlegen'}
      </Button>
    ) : (
      m.fuehrungsstelle_anzeige || m.fuehrungsstelle || '—'
    );

  const rolleFeld = (m: MitgliedAnzeige) => (
    <Select
      value={m.einsatz_rolle}
      disabled={!darfVerwalten}
      aria-label={`Rolle von ${m.anzeigename}`}
      // `minWidth` statt fester `width`: eine feste Breite drückt die Zelle am schmalen Schirm
      // auf. Der Boden bleibt, damit „Führungspersonal" nicht abgeschnitten wird; unter `md`
      // füllt das Feld die Zahlbreite der Spalte.
      style={istSchmal ? { width: '100%' } : { minWidth: 170, maxWidth: '100%' }}
      options={EINSATZ_ROLLE_OPTIONEN}
      onChange={(rolle) => setzen.mutate({ benutzerId: m.benutzer_id, rolle })}
    />
  );
  const aktion = (m: MitgliedAnzeige) =>
    darfVerwalten ? (
      <Popconfirm
        title="Mitglied entfernen?"
        okText="Ja"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true }}
        onConfirm={() => entfernen.mutate(m.benutzer_id)}
      >
        {/* Regulärer Knopf statt `type="link"`: ein Textlink sieht aus wie Fließtext,
            obwohl er die einzige destruktive Handlung der Zeile auslöst. `danger` bleibt,
            die Rückfrage ist der zweite Handgriff. */}
        <Button danger>Entfernen</Button>
      </Popconfirm>
    ) : null;

  const spalten: KatalogSpalte<MitgliedAnzeige>[] = istSchmal
    ? [
        {
          title: 'Name',
          key: 'name',
          mindestBreite: SCHMAL_NAME_MIN,
          render: (_, m) => (
            <div style={{ minWidth: 0, overflowWrap: 'break-word' }}>
              <div>{m.anzeigename}</div>
              <div
                data-lfh="mitglied-fuehrungsstelle"
                style={{ fontSize: token.fontSizeSM, color: rollen.text2 }}
              >
                {fuehrungsstelle(m)}
              </div>
            </div>
          ),
        },
        {
          // Rolle und Aktion teilen sich eine Spalte: zwei Zahlbreiten nebeneinander ließen dem
          // Namen bei 390 px keine 90 px.
          title: darfVerwalten ? 'Rolle · Aktion' : 'Rolle',
          key: 'rolle',
          width: SCHMAL_ROLLE,
          render: (_, m) => (
            <Flex vertical gap={token.marginXS} align="flex-start">
              {rolleFeld(m)}
              {aktion(m)}
            </Flex>
          ),
        },
      ]
    : [
        { title: 'Name', dataIndex: 'anzeigename' },
        {
          title: 'Führungsstelle',
          key: 'fuehrungsstelle',
          render: (_, m) => fuehrungsstelle(m),
        },
        { title: 'Rolle', key: 'rolle', render: (_, m) => rolleFeld(m) },
        {
          // Beschriftet: eine namenlose Spalte ist für einen Screenreader eine Zelle ohne
          // Zugehörigkeit.
          title: 'Aktion',
          key: 'aktion',
          render: (_, m) => aktion(m),
        },
      ];

  return (
    // Ein Paneel mit Augenbraue: Zählung und Datenstand stehen im Kopf rechts, die Hinzufügen-Zeile
    // ist die erste Paneelzeile.
    <Paneel
      titel="Zugriff"
      meta={
        mitgliederQuery.isSuccess ? (
          <>
            {anzahl(mitglieder.length, 'Mitglied', 'Mitglieder')}{' '}
            <Datenstand dataUpdatedAt={mitgliederQuery.dataUpdatedAt} />
          </>
        ) : undefined
      }
      style={{ marginTop: token.marginLG }}
    >
      {darfVerwalten && (
        <Space style={{ padding: token.padding }} wrap>
          <Select
            placeholder="Benutzer …"
            style={{ width: 200 }}
            value={neuerBenutzer}
            options={verfuegbar.map((b) => ({ value: b.id, label: b.anzeigename }))}
            onChange={(v) => setNeuerBenutzer(v)}
            notFoundContent={
              benutzerQuery.error instanceof ApiError && benutzerQuery.error.status === 403
                ? 'Benutzerliste nur für Admins'
                : benutzerQuery.isError
                  ? 'Benutzerliste nicht verfügbar'
                  : undefined
            }
          />
          <Select
            value={neueRolle}
            style={{ width: 170 }}
            options={EINSATZ_ROLLE_OPTIONEN}
            onChange={setNeueRolle}
          />
          <Button
            type="primary"
            disabled={neuerBenutzer == null}
            loading={setzen.isPending}
            onClick={() =>
              neuerBenutzer != null &&
              setzen.mutate({ benutzerId: neuerBenutzer, rolle: neueRolle })
            }
          >
            Hinzufügen
          </Button>
        </Space>
      )}
      <KatalogTabelle<MitgliedAnzeige>
        rowKey="benutzer_id"
        size="small"
        pagination={false}
        loading={mitgliederQuery.isLoading}
        columns={spalten}
        dataSource={mitglieder}
      />
      {stelleZiel !== null &&
        stelleZiel.einsatzId === einsatzId &&
        darfFuehrungsstelleVerwalten && (
          <FuehrungsstelleModal
            key={`${stelleZiel.einsatzId}:${stelleZiel.benutzer_id}`}
            mitglied={stelleZiel}
            speichern={stelleSpeichern}
            schliessen={() => setStelleZiel((aktuell) => (aktuell === stelleZiel ? null : aktuell))}
            laeuft={stelleSetzen.isPending}
            fehler={stelleSetzen.error}
          />
        )}
    </Paneel>
  );
}
