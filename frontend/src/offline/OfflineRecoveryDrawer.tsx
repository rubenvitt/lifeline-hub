import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Popconfirm,
  Space,
  Typography,
} from 'antd';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  OFFLINE_QUEUE_EVENT,
  abgelehntEntfernen,
  abgelehntLaden,
  abgelehntOhneAnhaengeWiederholen,
  abgelehntWiederholen,
  queueNichtZugeordnetAlleVerwerfen,
  queueNichtZugeordnetZaehlen,
  schreibaktionAbgelehntVerwerfen,
  schreibaktionAbgelehntWiederholen,
  schreibaktionenAbgelehntLaden,
  type AbgelehnteSchreibaktion,
  type AbgelehnterEintrag,
  type OfflineSchreibaktion,
} from './queue';

interface OfflineRecoveryDrawerProps {
  open: boolean;
  onClose: () => void;
  benutzerId?: number;
  einsatzId?: number;
}

/** Kartentitel einer abgelehnten Schreibaktion; exhaustiv über die Art. Stand- und
 *  Belegungsmeldungen nennen ihr Objekt — `bezirk_id: 3` im Inhalt sagt niemandem etwas. */
function aktionsTitel(aktion: OfflineSchreibaktion): string {
  switch (aktion.art) {
    case 'person':
      return 'Abgelehnte Personenerfassung';
    case 'meldung':
      return 'Abgelehnte Meldung';
    case 'stand':
      return `Abgelehnte Standmeldung: ${aktion.bezeichnung}`;
    case 'belegung':
      return `Abgelehnte Belegungsmeldung: ${aktion.bezeichnung}`;
    case 'ausgabe':
      return `Abgelehnte Verpflegungsausgabe: ${aktion.bezeichnung}`;
    default: {
      const nie: never = aktion;
      return `Abgelehnte Offline-Aktion ${JSON.stringify(nie)}`;
    }
  }
}

function vollstaendigerInhalt(daten: unknown): ReactNode {
  return (
    <Typography.Text
      code
      style={{ display: 'block', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
    >
      {JSON.stringify(daten, null, 2)}
    </Typography.Text>
  );
}

const dateien = (anzahl: number) => (anzahl === 1 ? '1 Datei' : `${anzahl} Dateien`);

function ohneAnhaengeHinweis(anzahl: number): string {
  const fehlt =
    anzahl === 1 ? 'Die angehängte Datei geht' : `Die ${anzahl} angehängten Dateien gehen`;
  return `${fehlt} nicht mit. Der Eintrag entsteht nur mit seinem Text und lässt sich danach nur per Berichtigung ergänzen.`;
}

function RecoveryCard({
  titel,
  einsatzId,
  zeitpunkt,
  grund,
  anhaenge = 0,
  daten,
  aktionen,
}: {
  titel: string;
  einsatzId: number;
  zeitpunkt?: string;
  grund: string;
  /** Anzahl der `anhang_ids` eines ETB-Eintrags (LFH-746). */
  anhaenge?: number;
  daten: unknown;
  aktionen: ReactNode;
}) {
  return (
    <Card size="small" title={titel} extra={aktionen}>
      <Descriptions
        size="small"
        column={1}
        items={[
          { key: 'einsatz', label: 'Einsatz', children: `#${einsatzId}` },
          ...(zeitpunkt ? [{ key: 'zeitpunkt', label: 'Vorgemerkt', children: zeitpunkt }] : []),
          {
            key: 'grund',
            label: 'Grund',
            children: <Typography.Text type="danger">{grund}</Typography.Text>,
          },
          ...(anhaenge > 0
            ? [
                {
                  key: 'anhaenge',
                  label: 'Anhänge',
                  children: `${dateien(anhaenge)}, gehen beim Senden ohne Anhänge nicht mit`,
                },
              ]
            : []),
          { key: 'inhalt', label: 'Vollständiger Inhalt', children: vollstaendigerInhalt(daten) },
        ]}
      />
    </Card>
  );
}

/** Globale Recovery-Oberfläche für fachlich abgelehnte Aktionen. Von den
 * quarantänisierten v1-v3-Zeilen ohne sichere Benutzerzuordnung werden nur die
 * Anzahl und eine bestätigte Gesamt-Löschaktion angeboten — niemals Rohdaten. */
export default function OfflineRecoveryDrawer({
  open,
  onClose,
  benutzerId,
  einsatzId,
}: OfflineRecoveryDrawerProps) {
  const { message } = App.useApp();
  const scopeKey = `${benutzerId ?? 'anonym'}:${einsatzId ?? 'alle'}`;
  const [etb, setEtb] = useState<AbgelehnterEintrag[]>([]);
  const [schreibaktionen, setSchreibaktionen] = useState<AbgelehnteSchreibaktion[]>([]);
  const [nichtZugeordnet, setNichtZugeordnet] = useState(0);
  const [laedt, setLaedt] = useState(false);
  const [aktionLaeuft, setAktionLaeuft] = useState<string | null>(null);
  const [geladenerScope, setGeladenerScope] = useState<string | null>(null);
  const ladeGeneration = useRef(0);

  const laden = useCallback(async () => {
    const generation = ++ladeGeneration.current;
    if (benutzerId == null) {
      setEtb([]);
      setSchreibaktionen([]);
      setNichtZugeordnet(0);
      setGeladenerScope(scopeKey);
      setLaedt(false);
      return;
    }
    setLaedt(true);
    try {
      const [etbEintraege, fachaktionen, legacy] = await Promise.all([
        abgelehntLaden(benutzerId, einsatzId),
        schreibaktionenAbgelehntLaden(benutzerId, einsatzId),
        queueNichtZugeordnetZaehlen(),
      ]);
      if (ladeGeneration.current !== generation) return;
      setEtb(etbEintraege);
      setSchreibaktionen(fachaktionen);
      setNichtZugeordnet(legacy);
      setGeladenerScope(scopeKey);
    } finally {
      if (ladeGeneration.current === generation) setLaedt(false);
    }
  }, [benutzerId, einsatzId, scopeKey]);

  useEffect(() => {
    if (!open) return;
    const neuLaden = () =>
      void laden().catch(() => message.error('Recovery-Daten konnten nicht geladen werden'));
    neuLaden();
    window.addEventListener(OFFLINE_QUEUE_EVENT, neuLaden);
    return () => window.removeEventListener(OFFLINE_QUEUE_EVENT, neuLaden);
  }, [laden, message, open]);

  const ausfuehren = async (schluessel: string, aktion: () => Promise<boolean>, erfolg: string) => {
    setAktionLaeuft(schluessel);
    try {
      if (!(await aktion())) throw new Error('Eintrag ist nicht mehr verfügbar');
      await laden();
      message.success(erfolg);
    } catch {
      message.error('Aktion konnte nicht ausgeführt werden');
    } finally {
      setAktionLaeuft(null);
    }
  };

  const knoepfe = (
    schluessel: string,
    wiederholen: () => Promise<boolean>,
    verwerfen: () => Promise<boolean>,
    ohneAnhaenge?: { anzahl: number; senden: () => Promise<boolean> },
  ) => (
    <Space size="middle">
      <Button
        type="primary"
        loading={aktionLaeuft === `${schluessel}:retry`}
        onClick={() =>
          void ausfuehren(`${schluessel}:retry`, wiederholen, 'Aktion erneut vorgemerkt')
        }
      >
        Erneut versuchen
      </Button>
      {ohneAnhaenge && (
        // LFH-746: Nach der Karenz des Verwaisten-Sweeps sind die Dateien weg, „Erneut versuchen“
        // liefe wieder in dieselbe 400. Die Rückfrage sagt, was fehlen wird; der Eintrag ist
        // danach append-only.
        <Popconfirm
          title="Ohne Anhänge senden?"
          description={ohneAnhaengeHinweis(ohneAnhaenge.anzahl)}
          okText="Nur den Text senden"
          cancelText="Abbrechen"
          onConfirm={() =>
            ausfuehren(
              `${schluessel}:ohne-anhaenge`,
              ohneAnhaenge.senden,
              'Eintrag ohne Anhänge erneut vorgemerkt',
            )
          }
        >
          <Button loading={aktionLaeuft === `${schluessel}:ohne-anhaenge`}>
            Ohne Anhänge senden
          </Button>
        </Popconfirm>
      )}
      <Popconfirm
        title="Offline-Aktion endgültig verwerfen?"
        description="Der lokal gespeicherte Inhalt kann danach nicht wiederhergestellt werden."
        okText="Endgültig verwerfen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true }}
        onConfirm={() => ausfuehren(`${schluessel}:discard`, verwerfen, 'Offline-Aktion verworfen')}
      >
        <Button danger loading={aktionLaeuft === `${schluessel}:discard`}>
          Verwerfen
        </Button>
      </Popconfirm>
    </Space>
  );
  const alsAktuellerBenutzer = (
    aktion: (aktuellerBenutzerId: number) => Promise<boolean>,
  ): Promise<boolean> => (benutzerId == null ? Promise.resolve(false) : aktion(benutzerId));

  const scopeAktuell = geladenerScope === scopeKey;
  const sichtbareEtb = scopeAktuell ? etb : [];
  const sichtbareSchreibaktionen = scopeAktuell ? schreibaktionen : [];
  const sichtbareNichtZugeordnet = scopeAktuell ? nichtZugeordnet : 0;
  const leer =
    !laedt &&
    sichtbareEtb.length === 0 &&
    sichtbareSchreibaktionen.length === 0 &&
    sichtbareNichtZugeordnet === 0;

  return (
    <Drawer
      title="Offline-Aktionen wiederherstellen"
      open={open}
      onClose={onClose}
      size="large"
      loading={laedt}
      destroyOnHidden
    >
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        {sichtbareNichtZugeordnet > 0 && (
          <Alert
            type="warning"
            showIcon
            title="Nicht attribuierbare Alt-Daten"
            description={
              <Space orientation="vertical" size="small">
                <Typography.Text>
                  {sichtbareNichtZugeordnet} lokale Offline-Aktion(en) aus einer früheren
                  App-Version sind keinem Benutzer sicher zuordenbar. Inhalt, Einsatz und weitere
                  Metadaten werden nicht angezeigt und können nicht übernommen werden.
                </Typography.Text>
                <Popconfirm
                  title="Alle nicht attribuierbaren Alt-Daten endgültig verwerfen?"
                  description="Die lokal gespeicherten Inhalte werden unwiderruflich gelöscht. Daten mit bekannter Benutzerzuordnung bleiben erhalten."
                  okText="Alle Alt-Daten endgültig verwerfen"
                  cancelText="Abbrechen"
                  okButtonProps={{ danger: true }}
                  onConfirm={() =>
                    ausfuehren(
                      'legacy:discard-all',
                      async () => (await queueNichtZugeordnetAlleVerwerfen()) > 0,
                      'Nicht attribuierbare Alt-Daten verworfen',
                    )
                  }
                >
                  <Button danger loading={aktionLaeuft === 'legacy:discard-all'}>
                    Alle Alt-Daten verwerfen
                  </Button>
                </Popconfirm>
              </Space>
            }
          />
        )}

        {sichtbareEtb.map((eintrag) => {
          if (eintrag.id == null) return null;
          const anhaenge = eintrag.eintrag.anhang_ids?.length ?? 0;
          return (
            <RecoveryCard
              key={`etb:${eintrag.id}`}
              titel="Abgelehnter ETB-Eintrag"
              einsatzId={eintrag.einsatz_id}
              zeitpunkt={eintrag.erstellt_at}
              grund={eintrag.grund}
              anhaenge={anhaenge}
              daten={eintrag.eintrag}
              aktionen={knoepfe(
                `etb:${eintrag.id}`,
                () => alsAktuellerBenutzer((id) => abgelehntWiederholen(id, eintrag.id!)),
                () => alsAktuellerBenutzer((id) => abgelehntEntfernen(id, eintrag.id!)),
                anhaenge > 0
                  ? {
                      anzahl: anhaenge,
                      senden: () =>
                        alsAktuellerBenutzer((id) =>
                          abgelehntOhneAnhaengeWiederholen(id, eintrag.id!),
                        ),
                    }
                  : undefined,
              )}
            />
          );
        })}

        {sichtbareSchreibaktionen.map((eintrag) =>
          eintrag.id == null ? null : (
            <RecoveryCard
              key={`schreiben:${eintrag.id}`}
              titel={aktionsTitel(eintrag.aktion)}
              einsatzId={eintrag.einsatz_id}
              zeitpunkt={eintrag.erstellt_at}
              grund={eintrag.grund}
              daten={eintrag.aktion.daten}
              aktionen={knoepfe(
                `schreiben:${eintrag.id}`,
                () =>
                  alsAktuellerBenutzer((id) => schreibaktionAbgelehntWiederholen(id, eintrag.id!)),
                () =>
                  alsAktuellerBenutzer((id) => schreibaktionAbgelehntVerwerfen(id, eintrag.id!)),
              )}
            />
          ),
        )}

        {leer && <Empty description="Keine wiederherzustellenden Offline-Aktionen" />}
      </Space>
    </Drawer>
  );
}
