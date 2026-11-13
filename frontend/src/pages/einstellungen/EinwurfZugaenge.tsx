import { useState } from 'react';
import { Alert, App, Button, Form, Input, Modal, Radio, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { IconKreuz, IconPlus } from '../../icons';
import { Paneel, StatusChip, monoStil, useRollen } from '../../components/instrument';
import { Liste, ListenEintrag, ListenEintragMeta } from '../../components/Liste';
import type { WeitereAktionen } from '../../components/Datensicht';
import { ZeilenMenueAusloeser } from '../../components/ZeilenMenueAusloeser';
import { useZeilenMenueKontext } from '../../components/useDatensatzKontextMenue';
import { ErfassungsModal } from '../../components/Erfassung';
import KopierbarerText from '../../components/KopierbarerText';
import { SeitenFehler } from '../../components/SeitenZustand';
import { RechteHinweis, SpeicherFehler } from '../../components/SpeicherHinweis';
import { useAuth } from '../../auth/AuthContext';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { zeitKurz, zeitpunkt } from '../../anzeige/zeitDarstellung';
import { ZeitpunktEingabe } from '../../anzeige/ZeitpunktEingabe';
import { alsBackendZeit } from '../../anzeige/zeitEingabe';
import { SCOPE_TEXT } from '../../api/anbindungen';
import {
  EINWURF_ZWECKE,
  createEinwurfZugang,
  einwurfAdresse,
  loadEinwurfZugaenge,
  widerrufeEinwurfZugang,
  wechsleEinwurfSchluessel,
  type EinwurfZugangEingabe,
  type EinwurfZweck,
} from '../../api/einwurfZugaenge';
import { ANBINDUNG_NAME_MAX } from '../../api/eingabegrenzen';
import { globalKeys } from '../../api/queryKeys';
import { OHNE_VERBINDUNG_NICHT_AENDERBAR, useOhneVerbindung } from '../../offline/verbindung';
import type {
  EinwurfTransport,
  EinwurfZugaengeListe,
  EinwurfZugangAnzeige,
  EinwurfZugangSchluessel,
} from '../../api/types';
import { RechteText } from './AnbindungDialoge';
import { ANBINDUNGEN_ABRUF_MS } from './anbindungAnzeige';

interface FormWerte {
  name?: string;
  scope?: EinwurfZweck;
  gueltig_bis?: Dayjs | null;
}

function eingabe(w: FormWerte): EinwurfZugangEingabe {
  return {
    name: (w.name ?? '').trim(),
    scope: w.scope ?? 'alarmmeldungen:write',
    gueltig_bis: w.gueltig_bis ? alsBackendZeit(w.gueltig_bis) : null,
  };
}

/** Wort und Ton des Zustands, rein und exportiert für den Test. */
export function einwurfZustand(z: Pick<EinwurfZugangAnzeige, 'widerrufen_at' | 'is_abgelaufen'>): {
  wort: string;
  ton: 'normal' | 'neutral' | 'achtung';
} {
  if (z.widerrufen_at) return { wort: 'widerrufen', ton: 'neutral' };
  if (z.is_abgelaufen) return { wort: 'abgelaufen', ton: 'achtung' };
  return { wort: 'aktiv', ton: 'normal' };
}

/**
 * Was die Seite zur Transportlage sagt (Spec `einwurf-zugang`): `http` nimmt Schlüssel und Inhalt
 * unverschlüsselt an, `keiner` lehnt jeden Einwurf ab. `tls` und `proxy` sind der Normalfall und
 * brauchen keinen Hinweis.
 */
export function transportHinweis(
  transport: EinwurfTransport,
): { titel: string; text: string } | null {
  if (transport === 'http') {
    return {
      titel: 'Einwürfe ohne TLS erlaubt',
      text: 'Schlüssel und Inhalt kommen unverschlüsselt an (--einwurf-allow-http).',
    };
  }
  if (transport === 'keiner') {
    return {
      titel: 'Einwürfe werden abgelehnt',
      text: 'Die Instanz kennt keinen Weg mit TLS: weder --tls noch --trusted-proxies.',
    };
  }
  return null;
}

/**
 * Die Seite ist über http geöffnet, der Server nimmt Einwürfe aber nur über https an
 * (Transportlage `proxy`): Die Adresse im Dialog beginnt dann mit `http://` und gäbe beim
 * Absender 403, nachdem der Schlüssel im Klartext über die Leitung ging. Rein und exportiert
 * für den Test.
 */
export function adresseBrauchtHttps(transport: EinwurfTransport, protokoll: string): boolean {
  return protokoll === 'http:' && transport !== 'http';
}

/**
 * Wechsel, Widerruf und Anlegen gehen sofort hinaus oder scheitern sofort, nie später: Eine
 * angehaltene Mutation ginge sonst bei der Rückkehr des Netzes hinaus, auch nach Verlassen der
 * Seite, und der neue Schlüssel landete im Nichts, während der alte schon nicht mehr gilt
 * (`frontend/src/offline/AGENTS.md`, „Schreiben ohne Netz“; Muster `FuehrungPaneel`).
 */
const SOFORT_ODER_NIE = { networkMode: 'always' } as const;

/** Setzt die Antwort einer eigenen Änderung in die Liste und lässt sie danach neu laden. */
function uebernimmZugang(qc: QueryClient, z: EinwurfZugangAnzeige): void {
  qc.setQueryData<EinwurfZugaengeListe>(globalKeys.einwurfZugaenge(), (alt) =>
    alt
      ? {
          ...alt,
          zugaenge: alt.zugaenge.some((x) => x.id === z.id)
            ? alt.zugaenge.map((x) => (x.id === z.id ? z : x))
            : [z, ...alt.zugaenge],
        }
      : alt,
  );
  void qc.invalidateQueries({ queryKey: globalKeys.einwurfZugaenge() });
}

/**
 * Die Adresse mit Schlüssel, genau einmal sichtbar. Schließen nur über „Fertig“: ein Escape oder
 * ein Klick neben den Dialog verlöre den Schlüssel, bevor er beim Absender eingetragen ist.
 */
function AdresseDialog({
  neu,
  transport,
  onFertig,
}: {
  neu: EinwurfZugangSchluessel | null;
  transport: EinwurfTransport | undefined;
  onFertig: () => void;
}) {
  const { token, rollen } = useRollen();
  const adresse = neu
    ? einwurfAdresse(window.location.origin, neu.schluessel, neu.zugang.scope)
    : '';
  return (
    <Modal
      open={neu != null}
      title={neu ? `Adresse für ${neu.zugang.name}` : 'Adresse'}
      closable={false}
      mask={{ closable: false }}
      keyboard={false}
      footer={
        <Button type="primary" onClick={onFertig}>
          Fertig
        </Button>
      }
      destroyOnHidden
    >
      {neu && (
        <div
          data-lfh="einwurf-adresse"
          style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}
        >
          <span style={{ color: rollen.gedaempft }}>Nur jetzt sichtbar.</span>
          {transport && adresseBrauchtHttps(transport, window.location.protocol) && (
            <Alert
              type="warning"
              showIcon
              title="Adresse beginnt mit http"
              description="Der Server nimmt Einwürfe nur über https an."
            />
          )}
          <KopierbarerText text={adresse} bezeichnung="Adresse">
            <span
              data-lfh="einwurf-adresse-text"
              style={{ ...monoStil(13, 500), wordBreak: 'break-all' }}
            >
              {adresse}
            </span>
          </KopierbarerText>
          <KopierbarerText text={neu.schluessel} bezeichnung="Schlüssel">
            <span style={{ ...monoStil(12, 500), color: rollen.gedaempft, wordBreak: 'break-all' }}>
              {neu.schluessel}
            </span>
          </KopierbarerText>
        </div>
      )}
    </Modal>
  );
}

/** Rückfrage vor Wechsel oder Widerruf; solange die Aktion läuft, bleibt der Dialog offen. */
function Rueckfrage({
  zugang,
  titel,
  okText,
  folge,
  fehlerTitel,
  laeuft,
  fehler,
  onOk,
  onAbbrechen,
}: {
  zugang: EinwurfZugangAnzeige | null;
  titel: (name: string) => string;
  okText: string;
  /** Ein Satz zur Folge des unumkehrbaren Schritts. */
  folge: string;
  fehlerTitel: string;
  laeuft: boolean;
  fehler: unknown;
  onOk: (z: EinwurfZugangAnzeige) => void;
  onAbbrechen: () => void;
}) {
  return (
    <Modal
      open={zugang != null}
      title={zugang ? titel(zugang.name) : okText}
      okText={okText}
      cancelText="Abbrechen"
      okButtonProps={{ danger: true, loading: laeuft }}
      cancelButtonProps={{ disabled: laeuft }}
      closable={!laeuft}
      mask={{ closable: !laeuft }}
      keyboard={!laeuft}
      onOk={() => zugang && onOk(zugang)}
      onCancel={() => {
        if (!laeuft) onAbbrechen();
      }}
      destroyOnHidden
    >
      <p>{folge}</p>
      <SpeicherFehler fehler={fehler} titel={fehlerTitel} />
    </Modal>
  );
}

/**
 * Paneel „Einwurf-Zugänge“ der Seite „Anbindungen“ (LLH-1654, Spec `einwurf-zugang`, ADR-0023):
 * Zugänge für Absender, die nur eine URL aufrufen können. Anlegen, Schlüssel wechseln und
 * widerrufen nur der System-Admin; lesen, wer in die Verwaltung darf. Die Adresse mit Schlüssel
 * steht genau einmal im Dialog. Es gibt keine eigene Ansicht: Name, Zweck und Frist ändert, wer
 * widerruft und neu anlegt.
 */
export default function EinwurfZugaenge() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [neu, setNeu] = useState<EinwurfZugangSchluessel | null>(null);
  const [wechselFuer, setWechselFuer] = useState<EinwurfZugangAnzeige | null>(null);
  const [widerrufFuer, setWiderrufFuer] = useState<EinwurfZugangAnzeige | null>(null);
  const [form] = Form.useForm<FormWerte>();
  const ohneNetz = useOhneVerbindung();

  const listeQ = useQuery({
    queryKey: globalKeys.einwurfZugaenge(),
    queryFn: loadEinwurfZugaenge,
    refetchInterval: ANBINDUNGEN_ABRUF_MS,
  });

  const anlegen = useMutation({
    ...SOFORT_ODER_NIE,
    mutationFn: createEinwurfZugang,
    onSuccess: (antwort) => {
      uebernimmZugang(qc, antwort.zugang);
      setNeu(antwort);
    },
  });
  const wechseln = useMutation({
    ...SOFORT_ODER_NIE,
    mutationFn: (z: EinwurfZugangAnzeige) => wechsleEinwurfSchluessel(z.id),
    onSuccess: (antwort) => {
      uebernimmZugang(qc, antwort.zugang);
      setWechselFuer(null);
      setNeu(antwort);
    },
  });
  const widerrufen = useMutation({
    ...SOFORT_ODER_NIE,
    mutationFn: (z: EinwurfZugangAnzeige) => widerrufeEinwurfZugang(z.id),
    onSuccess: (z) => {
      uebernimmZugang(qc, z);
      setWiderrufFuer(null);
      message.success(`${z.name} widerrufen`);
    },
  });

  const liste = listeQ.data;
  const zugaenge = liste?.zugaenge ?? [];
  const gesperrt = liste?.gesperrt_grund ?? null;
  const hinweis = liste ? transportHinweis(liste.transport) : null;
  // Ohne Netz und ohne Cache bleibt die Abfrage pausiert (die Liste liegt bewusst nicht auf der
  // Platte): dann sagt das Paneel das, statt endlos zu laden.
  const ohneNetzUngeladen = liste == null && listeQ.isPending && listeQ.fetchStatus === 'paused';
  const zeit = (wert: string) => zeitKurz(wert, konv);
  // Frist und Widerruf mit Monat und Jahr: Die Zeile ist die einzige Stelle, die sie zeigt, und
  // „gültig bis“ liegt oft Monate entfernt.
  const zeitVoll = (wert: string) => zeitpunkt(wert, konv);

  /** Ohne Netz stehen die Einträge da, aber gesperrt (Spec `datensatz-aktionsmenue`). */
  const ohneNetzGesperrt = ohneNetz ? ({ gesperrt: true } as const) : {};

  /** Aktionen eines Zugangs, EINE Quelle für ⋮ und Kontextmenü (LLH-1599). */
  const menue: WeitereAktionen<EinwurfZugangAnzeige> | undefined = istAdmin
    ? {
        // Ein abgelaufener Zugang bekommt keinen neuen Schlüssel: Die neue Adresse gälte nicht,
        // und „gültig bis“ lässt sich nicht ändern. Dafür wird widerrufen und neu angelegt.
        eintraege: (z) =>
          z.widerrufen_at
            ? []
            : [
                ...(gesperrt || z.is_abgelaufen
                  ? []
                  : [{ key: 'wechseln', label: 'Schlüssel wechseln …', ...ohneNetzGesperrt }]),
                {
                  key: 'widerrufen',
                  icon: <IconKreuz />,
                  label: 'Widerrufen …',
                  gefahr: true,
                  ...ohneNetzGesperrt,
                },
              ],
        zugaenglicherName: (z) => `Aktionen zu Einwurf-Zugang ${z.name}`,
        laeuft: () => wechseln.isPending || widerrufen.isPending,
        onWahl: (key, z) => {
          if (key === 'wechseln') {
            wechseln.reset();
            setWechselFuer(z);
          } else {
            widerrufen.reset();
            setWiderrufFuer(z);
          }
        },
      }
    : undefined;
  const kontext = useZeilenMenueKontext(menue, {
    finde: (id) => zugaenge.find((z) => z.id === id),
    schluessel: (z) => z.id,
  });

  return (
    <div data-lfh="einwurf-zugaenge" style={{ marginBlockStart: token.margin }}>
      <Paneel
        titel="Einwurf-Zugänge"
        meta={liste != null ? zugaenge.length : undefined}
        aktion={
          istAdmin ? (
            <Button
              icon={<IconPlus />}
              disabled={liste == null || gesperrt != null || ohneNetz}
              aria-describedby={
                ohneNetz ? 'einwurf-ohne-netz' : gesperrt ? 'einwurf-gesperrt' : undefined
              }
              onClick={() => {
                anlegen.reset();
                setAnlegenOffen(true);
              }}
            >
              Einwurf-Zugang anlegen
            </Button>
          ) : null
        }
        koerperPolster
      >
        {ohneNetz && (
          <div
            id="einwurf-ohne-netz"
            data-lfh="einwurf-ohne-netz"
            style={{ marginBlockEnd: token.marginSM }}
          >
            <RechteHinweis sichtbar text={OHNE_VERBINDUNG_NICHT_AENDERBAR} />
          </div>
        )}
        {gesperrt && (
          <div
            id="einwurf-gesperrt"
            data-lfh="einwurf-gesperrt"
            style={{ marginBlockEnd: token.marginSM }}
          >
            <RechteHinweis sichtbar marke="Am Hub anbinden" text={gesperrt} />
          </div>
        )}
        {liste == null ? (
          ohneNetzUngeladen ? (
            <span data-lfh="einwurf-ungeladen" style={{ color: rollen.gedaempft }}>
              Einwurf-Zugänge ohne Verbindung nicht geladen
            </span>
          ) : listeQ.isError ? (
            <SeitenFehler
              text="Einwurf-Zugänge nicht ladbar"
              ursache={listeQ.error}
              onWiederholen={() => void listeQ.refetch()}
              laedt={listeQ.isFetching}
            />
          ) : (
            <Spin />
          )
        ) : (
          <>
            {listeQ.isError && (
              <div style={{ marginBlockEnd: token.marginSM }}>
                <SeitenFehler
                  text="Stand nicht aktuell: neu laden gescheitert"
                  ursache={listeQ.error}
                  onWiederholen={() => void listeQ.refetch()}
                  laedt={listeQ.isFetching}
                />
              </div>
            )}
            {hinweis && (
              <div data-lfh="einwurf-transport" style={{ marginBlockEnd: token.marginSM }}>
                <Alert type="warning" showIcon title={hinweis.titel} description={hinweis.text} />
              </div>
            )}
            <Liste<EinwurfZugangAnzeige>
              bordered
              dataSource={zugaenge}
              rowKey={(z) => z.id}
              emptyText="Noch kein Einwurf-Zugang"
              renderItem={(z) => {
                const zustand = einwurfZustand(z);
                const widerrufenAm = z.widerrufen_at != null;
                return (
                  <div data-lfh="einwurf-eintrag" {...(menue ? kontext.ausloeser(z) : {})}>
                    <ListenEintrag
                      actions={
                        menue && !widerrufenAm
                          ? [<ZeilenMenueAusloeser key="aktionen" menue={menue} zeile={z} />]
                          : undefined
                      }
                    >
                      <ListenEintragMeta
                        title={
                          <span
                            style={{
                              display: 'inline-flex',
                              gap: token.marginXS,
                              alignItems: 'center',
                              flexWrap: 'wrap',
                            }}
                          >
                            <span data-lfh="einwurf-name">{z.name}</span>
                            <StatusChip ton={zustand.ton} wort={zustand.wort} />
                          </span>
                        }
                        description={
                          <span
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 2,
                              color: rollen.gedaempft,
                            }}
                          >
                            <RechteText scopes={[z.scope]} />
                            <span>
                              {z.zuletzt_genutzt_at
                                ? `zuletzt genutzt ${zeit(z.zuletzt_genutzt_at)}`
                                : 'noch nie genutzt'}
                              {z.gueltig_bis && ` · gültig bis ${zeitVoll(z.gueltig_bis)}`}
                              {z.schluessel_gewechselt_at &&
                                !widerrufenAm &&
                                ` · Schlüssel gewechselt ${zeit(z.schluessel_gewechselt_at)}`}
                              {z.widerrufen_at &&
                                ` · widerrufen ${zeitVoll(z.widerrufen_at)}${z.widerrufen_von_name ? ` von ${z.widerrufen_von_name}` : ''}`}
                            </span>
                          </span>
                        }
                      />
                    </ListenEintrag>
                  </div>
                );
              }}
            />
          </>
        )}
        {kontext.menue}
      </Paneel>

      <ErfassungsModal<FormWerte>
        offen={anlegenOffen}
        titel="Einwurf-Zugang anlegen"
        form={form}
        initialValues={{ scope: 'alarmmeldungen:write' }}
        erfassenText="Anlegen und Adresse zeigen"
        laeuft={anlegen.isPending}
        speicherung={anlegen}
        speicherFehlerTitel="Nicht angelegt"
        onErfassen={(w) => anlegen.mutateAsync(eingabe(w))}
        onFertig={() => setAnlegenOffen(false)}
        onAbbrechen={() => setAnlegenOffen(false)}
      >
        <Form.Item
          label="Name"
          name="name"
          rules={[
            { required: true, whitespace: true, message: 'Name angeben' },
            { max: ANBINDUNG_NAME_MAX, message: `Höchstens ${ANBINDUNG_NAME_MAX} Zeichen` },
          ]}
        >
          <Input placeholder="BOSWatch Wache 1" maxLength={ANBINDUNG_NAME_MAX} />
        </Form.Item>
        <Form.Item label="Zweck" name="scope" rules={[{ required: true, message: 'Zweck wählen' }]}>
          <Radio.Group style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS }}>
            {EINWURF_ZWECKE.map((s) => (
              <Radio key={s} value={s}>
                {SCOPE_TEXT[s]}{' '}
                <span style={{ ...monoStil(11, 500), color: rollen.schwach }}>{s}</span>
              </Radio>
            ))}
          </Radio.Group>
        </Form.Item>
        <Form.Item label="Gültig bis" name="gueltig_bis">
          <ZeitpunktEingabe art="frist" placeholder="bis zum Widerruf" style={{ width: '100%' }} />
        </Form.Item>
      </ErfassungsModal>

      <Rueckfrage
        zugang={wechselFuer}
        titel={(name) => `Schlüssel von ${name} wechseln?`}
        okText="Schlüssel wechseln"
        folge="Der bisherige Schlüssel gilt ab sofort nicht mehr, der Absender braucht die neue Adresse."
        fehlerTitel="Schlüssel nicht gewechselt"
        laeuft={wechseln.isPending}
        fehler={wechseln.error}
        onOk={(z) => wechseln.mutate(z)}
        onAbbrechen={() => setWechselFuer(null)}
      />
      <Rueckfrage
        zugang={widerrufFuer}
        titel={(name) => `${name} widerrufen?`}
        okText="Widerrufen"
        folge="Der Absender kommt ab sofort nicht mehr herein."
        fehlerTitel="Nicht widerrufen"
        laeuft={widerrufen.isPending}
        fehler={widerrufen.error}
        onOk={(z) => widerrufen.mutate(z)}
        onAbbrechen={() => setWiderrufFuer(null)}
      />
      <AdresseDialog neu={neu} transport={liste?.transport} onFertig={() => setNeu(null)} />
    </div>
  );
}
