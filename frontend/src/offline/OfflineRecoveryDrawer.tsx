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
import { anzahl } from '../anzeige/anzahl';
import { SpeicherFehler, ZeilenFehler } from '../components/SpeicherHinweis';
import { useZeilenFehler, type ZeilenGrund } from '../components/useZeilenFehler';
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

/** Folge vor dem unumkehrbaren Schritt in einem Satz (LFH-1078): nachreichen nur per Berichtigung. */
function ohneAnhaengeHinweis(anzahl: number): string {
  return `${dateien(anzahl)} ${anzahl === 1 ? 'fehlt' : 'fehlen'} dann, nachreichen nur per Berichtigung.`;
}

function RecoveryCard({
  titel,
  einsatzId,
  zeitpunkt,
  grund,
  anhaenge = 0,
  daten,
  aktionen,
  fehler,
}: {
  titel: string;
  einsatzId: number;
  zeitpunkt?: string;
  grund: string;
  /** Anzahl der `anhang_ids` eines ETB-Eintrags (LFH-746). */
  anhaenge?: number;
  daten: unknown;
  aktionen: ReactNode;
  /** Grund der letzten gescheiterten Aktion an dieser Karte (LFH-1077). */
  fehler: ZeilenGrund | null;
}) {
  return (
    <Card size="small" title={titel} extra={aktionen}>
      {fehler && <ZeilenFehler fehler={fehler.fehler} fallback={fehler.fallback} />}
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
                  children: dateien(anhaenge),
                },
              ]
            : []),
          { key: 'inhalt', label: 'Vollständiger Inhalt', children: vollstaendigerInhalt(daten) },
        ]}
      />
    </Card>
  );
}

/** Die Aktion fand ihren Eintrag nicht mehr (anderer Tab, schon gesendet). */
class NichtMehrVorhanden extends Error {}

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
  const [ladeFehler, setLadeFehler] = useState<unknown>(null);
  const ladeGeneration = useRef(0);
  // Gründe je Karte (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“); der Titel nennt eine
  // Karte, die nach dem Fehler nicht mehr in der Liste steht.
  const zeilen = useZeilenFehler<string>();
  const { leere } = zeilen;
  const titelJeZeile = useRef(new Map<string, string>());
  const aktuellerScope = useRef(scopeKey);
  aktuellerScope.current = scopeKey;

  // Öffnen und ein Wechsel von Benutzer oder Einsatz räumen alte Gründe.
  useEffect(() => {
    if (open) leere();
  }, [leere, open, scopeKey]);

  /** Lädt die Liste; ein Fehler steht im Drawer, bis das nächste Laden beginnt. */
  const laden = useCallback(async () => {
    const generation = ++ladeGeneration.current;
    setLadeFehler(null);
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
    } catch (e) {
      if (ladeGeneration.current === generation) setLadeFehler(e);
    } finally {
      if (ladeGeneration.current === generation) setLaedt(false);
    }
  }, [benutzerId, einsatzId, scopeKey]);

  useEffect(() => {
    if (!open) return;
    const neuLaden = () => void laden();
    neuLaden();
    window.addEventListener(OFFLINE_QUEUE_EVENT, neuLaden);
    return () => window.removeEventListener(OFFLINE_QUEUE_EVENT, neuLaden);
  }, [laden, open]);

  const ausfuehren = async (
    zeile: { schluessel: string; titel: string },
    schluessel: string,
    aktion: () => Promise<boolean>,
    erfolg: string,
  ) => {
    const scope = scopeKey;
    zeilen.beginne(zeile.schluessel);
    setAktionLaeuft(schluessel);
    try {
      if (!(await aktion())) throw new NichtMehrVorhanden();
      await laden();
      message.success(erfolg);
    } catch (e) {
      // Nach einem Wechsel von Benutzer oder Einsatz meldet eine späte Ablehnung nicht hier.
      if (aktuellerScope.current !== scope) return;
      titelJeZeile.current.set(zeile.schluessel, zeile.titel);
      const weg = e instanceof NichtMehrVorhanden;
      zeilen.melde(zeile.schluessel, e, weg ? 'Eintrag nicht mehr vorhanden' : 'Nicht ausgeführt');
      // Ein anderer Tab hat ihn schon gesendet oder verworfen, sein Ereignis kommt hier nicht an:
      // neu laden. Fehlt die Karte danach, steht der Grund über der Liste (`ohneKarte`).
      if (weg) void laden();
    } finally {
      setAktionLaeuft(null);
    }
  };

  const knoepfe = (
    zeile: { schluessel: string; titel: string },
    wiederholen: () => Promise<boolean>,
    verwerfen: () => Promise<boolean>,
    ohneAnhaenge?: { anzahl: number; senden: () => Promise<boolean> },
  ) => {
    const { schluessel } = zeile;
    return (
      <Space size="middle">
        <Button
          type="primary"
          loading={aktionLaeuft === `${schluessel}:retry`}
          onClick={() =>
            void ausfuehren(zeile, `${schluessel}:retry`, wiederholen, 'Aktion erneut vorgemerkt')
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
                zeile,
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
          okText="Endgültig verwerfen"
          cancelText="Abbrechen"
          okButtonProps={{ danger: true }}
          onConfirm={() =>
            ausfuehren(zeile, `${schluessel}:discard`, verwerfen, 'Offline-Aktion verworfen')
          }
        >
          <Button danger loading={aktionLaeuft === `${schluessel}:discard`}>
            Verwerfen
          </Button>
        </Popconfirm>
      </Space>
    );
  };
  const alsAktuellerBenutzer = (
    aktion: (aktuellerBenutzerId: number) => Promise<boolean>,
  ): Promise<boolean> => (benutzerId == null ? Promise.resolve(false) : aktion(benutzerId));

  const scopeAktuell = geladenerScope === scopeKey;
  const sichtbareEtb = scopeAktuell ? etb : [];
  const sichtbareSchreibaktionen = scopeAktuell ? schreibaktionen : [];
  const sichtbareNichtZugeordnet = scopeAktuell ? nichtZugeordnet : 0;
  const legacyZeile = { schluessel: 'legacy', titel: 'Alte Offline-Daten ohne Zuordnung' };
  const legacyGrund = zeilen.grund(legacyZeile.schluessel);
  const sichtbareZeilen = new Set([
    ...(sichtbareNichtZugeordnet > 0 ? [legacyZeile.schluessel] : []),
    ...sichtbareEtb.map((e) => `etb:${e.id}`),
    ...sichtbareSchreibaktionen.map((e) => `schreiben:${e.id}`),
  ]);
  // Gründe, deren Karte nach dem Fehler nicht mehr in der Liste steht.
  const ohneKarte = zeilen.gemeldet().filter((s) => !sichtbareZeilen.has(s));
  const leer =
    !laedt &&
    ladeFehler == null &&
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
        <SpeicherFehler
          fehler={ladeFehler}
          titel="Nicht geladen"
          fallback="Offline-Daten konnten nicht geladen werden"
        />
        {ohneKarte.map((s) => {
          const grund = zeilen.grund(s);
          return (
            grund && (
              <ZeilenFehler
                key={s}
                fehler={grund.fehler}
                fallback={grund.fallback}
                kennung={titelJeZeile.current.get(s)}
              />
            )
          );
        })}
        {sichtbareNichtZugeordnet > 0 && (
          <Alert
            type="warning"
            showIcon
            title="Alte Offline-Daten ohne Zuordnung"
            description={
              <Space orientation="vertical" size="small">
                <Typography.Text>
                  {`${anzahl(sichtbareNichtZugeordnet, 'Offline-Aktion', 'Offline-Aktionen')} · Inhalt nicht einsehbar, nicht übernehmbar`}
                </Typography.Text>
                <Popconfirm
                  title="Alle alten Offline-Daten ohne Zuordnung endgültig verwerfen?"
                  description="Zugeordnete Offline-Daten bleiben erhalten."
                  okText="Alle alten Offline-Daten endgültig verwerfen"
                  cancelText="Abbrechen"
                  okButtonProps={{ danger: true }}
                  onConfirm={() =>
                    ausfuehren(
                      legacyZeile,
                      'legacy:discard-all',
                      async () => (await queueNichtZugeordnetAlleVerwerfen()) > 0,
                      'Alte Offline-Daten ohne Zuordnung verworfen',
                    )
                  }
                >
                  <Button danger loading={aktionLaeuft === 'legacy:discard-all'}>
                    Alle alten Offline-Daten verwerfen
                  </Button>
                </Popconfirm>
                {legacyGrund && (
                  <ZeilenFehler fehler={legacyGrund.fehler} fallback={legacyGrund.fallback} />
                )}
              </Space>
            }
          />
        )}

        {sichtbareEtb.map((eintrag) => {
          if (eintrag.id == null) return null;
          const anhaenge = eintrag.eintrag.anhang_ids?.length ?? 0;
          const zeile = { schluessel: `etb:${eintrag.id}`, titel: 'Abgelehnter ETB-Eintrag' };
          return (
            <RecoveryCard
              key={zeile.schluessel}
              titel={zeile.titel}
              einsatzId={eintrag.einsatz_id}
              zeitpunkt={eintrag.erstellt_at}
              grund={eintrag.grund}
              anhaenge={anhaenge}
              daten={eintrag.eintrag}
              fehler={zeilen.grund(zeile.schluessel)}
              aktionen={knoepfe(
                zeile,
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

        {sichtbareSchreibaktionen.map((eintrag) => {
          if (eintrag.id == null) return null;
          const zeile = {
            schluessel: `schreiben:${eintrag.id}`,
            titel: aktionsTitel(eintrag.aktion),
          };
          return (
            <RecoveryCard
              key={zeile.schluessel}
              titel={zeile.titel}
              einsatzId={eintrag.einsatz_id}
              zeitpunkt={eintrag.erstellt_at}
              grund={eintrag.grund}
              daten={eintrag.aktion.daten}
              fehler={zeilen.grund(zeile.schluessel)}
              aktionen={knoepfe(
                zeile,
                () =>
                  alsAktuellerBenutzer((id) => schreibaktionAbgelehntWiederholen(id, eintrag.id!)),
                () =>
                  alsAktuellerBenutzer((id) => schreibaktionAbgelehntVerwerfen(id, eintrag.id!)),
              )}
            />
          );
        })}

        {leer && <Empty description="Keine wiederherzustellenden Offline-Aktionen" />}
      </Space>
    </Drawer>
  );
}
