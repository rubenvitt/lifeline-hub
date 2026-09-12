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
  abgelehntWiederholen,
  queueNichtZugeordnetAlleVerwerfen,
  queueNichtZugeordnetZaehlen,
  schreibaktionAbgelehntVerwerfen,
  schreibaktionAbgelehntWiederholen,
  schreibaktionenAbgelehntLaden,
  type AbgelehnteSchreibaktion,
  type AbgelehnterEintrag,
} from './queue';

interface OfflineRecoveryDrawerProps {
  open: boolean;
  onClose: () => void;
  benutzerId?: number;
  einsatzId?: number;
}

function aktionsTitel(art: 'etb' | 'person' | 'meldung'): string {
  if (art === 'etb') return 'ETB-Eintrag';
  if (art === 'person') return 'Personenerfassung';
  return 'Meldung';
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

function RecoveryCard({
  titel,
  einsatzId,
  zeitpunkt,
  grund,
  daten,
  aktionen,
}: {
  titel: string;
  einsatzId: number;
  zeitpunkt?: string;
  grund: string;
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
    wiederholenText = 'Erneut versuchen',
  ) => (
    <Space size="small">
      <Button
        type="primary"
        loading={aktionLaeuft === `${schluessel}:retry`}
        onClick={() =>
          void ausfuehren(`${schluessel}:retry`, wiederholen, 'Aktion erneut vorgemerkt')
        }
      >
        {wiederholenText}
      </Button>
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

        {sichtbareEtb.map((eintrag) =>
          eintrag.id == null ? null : (
            <RecoveryCard
              key={`etb:${eintrag.id}`}
              titel="Abgelehnter ETB-Eintrag"
              einsatzId={eintrag.einsatz_id}
              zeitpunkt={eintrag.erstellt_at}
              grund={eintrag.grund}
              daten={eintrag.eintrag}
              aktionen={knoepfe(
                `etb:${eintrag.id}`,
                () => alsAktuellerBenutzer((id) => abgelehntWiederholen(id, eintrag.id!)),
                () => alsAktuellerBenutzer((id) => abgelehntEntfernen(id, eintrag.id!)),
              )}
            />
          ),
        )}

        {sichtbareSchreibaktionen.map((eintrag) =>
          eintrag.id == null ? null : (
            <RecoveryCard
              key={`schreiben:${eintrag.id}`}
              titel={`Abgelehnte ${aktionsTitel(eintrag.aktion.art)}`}
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
