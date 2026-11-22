import { useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, Modal } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErfassungsModal } from '../../components/Erfassung';
import { MenueAusloeser } from '../../components/MenueAusloeser';
import { OHNE_VERBINDUNG_NICHT_AENDERBAR, useOhneVerbindung } from '../../offline/verbindung';
import {
  BearbeitbaresPaneel,
  Datenfeld,
  Datenraster,
  Feld,
  monoStil,
  Paneel,
  PaneelZeile,
  Stapel,
  Status,
  type BearbeitbaresFeld,
  useRollen,
} from '../../components/instrument';
import { SeitenFehler } from '../../components/SeitenZustand';
import { RechteHinweis, SpeicherFehler } from '../../components/SpeicherHinweis';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../../anzeige/zeitDarstellung';
import {
  ARTEN,
  ART_TEXT,
  RUHT_TEXT,
  updateWebhook,
  artGesperrtGrund,
  deleteWebhook,
  loadWebhookVersuche,
  nimmWebhookWiederAuf,
  createWebhook,
  fingerabdruckGruppen,
  holeZertifikat,
  pinNormal,
  sendTestereignis,
  webhookFehlerText,
  type WebhookEingabe,
  type WebhookPatch,
} from '../../api/anbindungen';
import { WEBHOOK_URL_MAX } from '../../api/eingabegrenzen';
import { globalKeys } from '../../api/queryKeys';
import type {
  AnbindungAnzeige,
  AnbindungenListe,
  EventType,
  WebhookAnzeige,
  WebhookTestErgebnis,
  WebhookVersuch,
} from '../../api/types';
import { ANBINDUNGEN_ABRUF_MS, webhookZustandAnzeige } from './anbindungAnzeige';
import { pflicht } from '../../components/pflichtRegel';

// Webhook einer Anbindung (LLH-1656, Spec `webhook-zustellung`, design.md D9): einrichten im
// `ErfassungsModal`, bearbeiten im `BearbeitbaresPaneel`, dazu Zustand der Zustellung und der
// Verlauf. Schreiben darf nur der System-Admin; den Zustand sieht, wer die Seite sieht.

interface WebhookWerte {
  url: string;
  arten: EventType[];
  lan_erlaubt: boolean;
  /** Fingerabdruck des Zielzertifikats, wie eingegeben; leer = keiner (LLH-1872). */
  zertifikat_pin?: string;
}

/** Warnung an der LAN-Ausnahme; steht im Modal und im Paneel gleich. */
export const LAN_WARNUNG =
  'Nur für ein Fremdsystem im eigenen Netz, etwa im ELW. Rechner, Link-Local- und ' +
  'Metadatenadressen bleiben gesperrt. Das Ziel braucht ein Zertifikat, dem dieser Server vertraut, ' +
  'oder einen hinterlegten Fingerabdruck.';

/** Hinweis am Fingerabdruck; steht im Modal und im Paneel gleich (LLH-1872). */
export const PIN_HINWEIS =
  'Mit Fingerabdruck zählt nur dieses Zertifikat. Wechselt das Ziel sein Zertifikat, muss der ' +
  'Fingerabdruck neu hinterlegt werden.';

/** Hinweis, wenn die URL auf einen anderen Server zeigt als der hinterlegte Fingerabdruck. */
export const NEUER_SERVER =
  'Neuer Server: Der Fingerabdruck gilt dem alten und fällt beim Speichern weg. Neu holen oder ' +
  'leer lassen.';

/** Server einer URL, oder `null`, solange sie nicht lesbar ist. */
function hostVon(url: string | undefined): string | null {
  try {
    return new URL((url ?? '').trim()).hostname || null;
  } catch {
    return null;
  }
}

/** Zeigt die URL auf einen anderen Server als vorher? */
function neuerServer(vorher: WebhookWerte, nachher: WebhookWerte): boolean {
  const host = hostVon(nachher.url);
  return host != null && host !== hostVon(vorher.url);
}

/**
 * Fällt der Fingerabdruck beim Speichern weg? Ja, wenn die URL auf einen anderen Server zeigt und
 * das Feld unberührt den alten Fingerabdruck trägt (Entscheidung Ruben 22.11.2026: neuer Server,
 * neuer Pin). Unberührt heißt: derselbe Text wie geladen; wer ihn vom Ziel holt und übernimmt
 * oder eintippt, bestätigt ihn für den neuen Server, auch wenn er gleich ist.
 */
function pinFaelltWeg(vorher: WebhookWerte, nachher: WebhookWerte): boolean {
  const alt = vorher.zertifikat_pin ?? '';
  return !!pinNormal(alt) && (nachher.zertifikat_pin ?? '') === alt && neuerServer(vorher, nachher);
}

/**
 * Nur Geändertes: die URL getrimmt, die Arten als Menge in fester Reihenfolge. Rein und
 * exportiert für den Test.
 */
export function webhookPatch(vorher: WebhookWerte, nachher: WebhookWerte): WebhookPatch {
  const patch: WebhookPatch = {};
  const url = (nachher.url ?? '').trim();
  if (url !== vorher.url) patch.url = url;
  const arten = nachher.arten ?? [];
  const gleich =
    arten.length === vorher.arten.length && arten.every((a) => vorher.arten.includes(a));
  if (!gleich) patch.arten = ARTEN.filter((a) => arten.includes(a));
  if (Boolean(nachher.lan_erlaubt) !== vorher.lan_erlaubt)
    patch.lan_erlaubt = !!nachher.lan_erlaubt;
  const pinVorher = pinNormal(vorher.zertifikat_pin ?? '');
  const pinNachher = pinNormal(nachher.zertifikat_pin ?? '');
  if (pinFaelltWeg(vorher, nachher)) patch.zertifikat_pin = null;
  else if (pinNachher !== pinVorher || (pinNachher && neuerServer(vorher, nachher)))
    // Auf einem neuen Server braucht der Server eine Angabe zum Fingerabdruck, auch die gleiche.
    patch.zertifikat_pin = pinNachher || null;
  return patch;
}

/**
 * Arten zur Auswahl; was die Rechte des Zugangs nicht öffnen, steht ausgegraut mit Grund. Reicht
 * `id`, `value` und `onChange` des Formulars an die Gruppe weiter.
 */
function ArtenAuswahl({
  scopes,
  id,
  value,
  onChange,
}: {
  scopes: readonly string[];
  id?: string;
  value?: EventType[];
  onChange?: (arten: EventType[]) => void;
}) {
  const { rollen } = useRollen();
  return (
    <div id={id}>
      <Checkbox.Group<EventType> value={value} onChange={(arten) => onChange?.(arten)}>
        <Stapel abstand="xxs">
          {ARTEN.map((a) => {
            const grund = artGesperrtGrund(a, scopes);
            return (
              <Checkbox key={a} value={a} disabled={grund != null} data-lfh={`webhook-art-${a}`}>
                {ART_TEXT[a]}{' '}
                <span style={{ ...monoStil('meta', 500), color: rollen.schwach }}>{a}</span>
                {grund && <span style={{ color: rollen.gedaempft }}>{` · ${grund}`}</span>}
              </Checkbox>
            );
          })}
        </Stapel>
      </Checkbox.Group>
    </div>
  );
}

const PIN_REGELN = [
  {
    validator: (_: unknown, wert?: string) =>
      !wert || /^[0-9a-f]{64}$/.test(pinNormal(wert))
        ? Promise.resolve()
        : Promise.reject(
            new Error(
              'Der Fingerabdruck besteht aus 64 Hex-Zeichen (SHA-256), mit oder ohne Doppelpunkte.',
            ),
          ),
  },
];

const URL_REGELN = [
  pflicht('Ziel-URL', { whitespace: true }),
  { max: WEBHOOK_URL_MAX, message: `Höchstens ${WEBHOOK_URL_MAX} Zeichen` },
  { pattern: /^\s*https:\/\//i, message: 'Die Ziel-URL muss mit https:// beginnen' },
];

// `pflicht` lehnt auch eine leere Auswahl (`[]`) ab; eine zweite Regel `min: 1` zeigte nur
// denselben Fehler ein zweites Mal (LLH-1766).
const ARTEN_REGELN = [pflicht('Ereignisarten')];

function ArtenText({ arten }: { arten: readonly EventType[] }) {
  return <>{arten.map((a) => ART_TEXT[a] ?? a).join(', ')}</>;
}

/** Ergebnis eines Versuchs in einer Zeile: „zugestellt (204)“ oder der Fehler. */
export function versuchText(v: Pick<WebhookVersuch, 'erfolg' | 'status' | 'fehler_art'>): string {
  if (v.erfolg) return v.status != null ? `zugestellt (${v.status})` : 'zugestellt';
  return v.fehler_art ? webhookFehlerText(v.fehler_art, v.status) : 'gescheitert';
}

/**
 * Setzt den Webhook einer Anbindung in die Liste und lässt sie danach neu laden: die Antwort zeigt
 * den neuen Stand sofort (auch als Basis der nächsten Bearbeitung), der Abruf alles Übrige.
 */
function uebernimmWebhook(
  qc: ReturnType<typeof useQueryClient>,
  zugangId: string,
  webhook: WebhookAnzeige | null,
): void {
  qc.setQueryData<AnbindungenListe>(globalKeys.anbindungen(), (alt) =>
    alt
      ? {
          ...alt,
          zugaenge: alt.zugaenge.map((z) =>
            z.id === zugangId ? { ...z, webhook: webhook ?? undefined } : z,
          ),
        }
      : alt,
  );
  void qc.invalidateQueries({ queryKey: globalKeys.anbindungen() });
}

type ZustellungAktion = 'weiter' | 'test' | 'entfernen';

interface Props {
  zugang: AnbindungAnzeige;
  darfSchreiben: boolean;
  /** Kurzgrund ohne Schreibrecht. */
  grund?: string;
  /** Neu laden nach einem 409. */
  onNeuLaden: () => void;
}

/**
 * Paneel „Webhook“ der Anbindungs-Ansicht. Ohne Webhook: ein Satz, was er tut, und für den Admin
 * „Webhook einrichten“. Mit Webhook: Ziel, Arten und LAN-Ausnahme zum Bearbeiten, Zustand der
 * Zustellung mit Aktionen und der Verlauf der letzten Versuche.
 */
export default function AnbindungWebhook({ zugang, darfSchreiben, grund, onNeuLaden }: Props) {
  const qc = useQueryClient();
  const { token, rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const zeit = (wert: string) => zeitKurz(wert, konv);
  const [form] = Form.useForm<WebhookWerte>();
  const [einrichtenOffen, setEinrichtenOffen] = useState(false);
  const [entfernenOffen, setEntfernenOffen] = useState(false);
  // Das Ergebnis eines Tests gilt dem Ziel, an das er ging; ein neues Ziel blendet es aus.
  const [test, setTest] = useState<{ ergebnis: WebhookTestErgebnis; ziel: string } | null>(null);
  const ohneNetz = useOhneVerbindung();
  const webhook = zugang.webhook ?? null;
  const ziel = webhook ? `${webhook.id}|${webhook.url ?? webhook.host}` : '';
  // Ohne Netz pausierten die Aufrufe und gingen später an ein womöglich anderes Ziel.
  const darfAendern = darfSchreiben && !ohneNetz;

  const versucheNeu = () =>
    void qc.invalidateQueries({ queryKey: globalKeys.anbindungWebhookVersuche(zugang.id) });

  const einrichten = useMutation({
    mutationFn: (e: WebhookEingabe) => createWebhook(zugang.id, e),
    onSuccess: (w) => uebernimmWebhook(qc, zugang.id, w),
  });
  const entfernen = useMutation({
    mutationFn: () => deleteWebhook(zugang.id),
    onSuccess: () => {
      setEntfernenOffen(false);
      setTest(null);
      uebernimmWebhook(qc, zugang.id, null);
    },
  });
  const weiter = useMutation({
    mutationFn: () => nimmWebhookWiederAuf(zugang.id),
    // Einen alten Testfehler räumen, nie einen laufenden Test.
    onMutate: () => {
      if (!testen.isPending) testen.reset();
    },
    onSuccess: (w) => uebernimmWebhook(qc, zugang.id, w),
  });
  const testen = useMutation({
    mutationFn: () => sendTestereignis(zugang.id),
    onMutate: () => {
      setTest(null);
      if (!weiter.isPending) weiter.reset();
    },
    onSuccess: (e) => {
      setTest({ ergebnis: e, ziel });
      versucheNeu();
    },
  });
  const aktionWaehlen = (a: ZustellungAktion) => {
    if (a === 'weiter') weiter.mutate();
    else if (a === 'test') testen.mutate();
    else {
      entfernen.reset();
      setEntfernenOffen(true);
    }
  };

  if (!webhook) {
    return (
      <Paneel
        titel="Webhook"
        koerperPolster
        aktion={
          darfSchreiben && (
            <Button disabled={ohneNetz} onClick={() => setEinrichtenOffen(true)}>
              Webhook einrichten
            </Button>
          )
        }
      >
        {darfSchreiben && ohneNetz && (
          <div style={{ marginBlockEnd: token.marginSM }}>
            <RechteHinweis sichtbar text={OHNE_VERBINDUNG_NICHT_AENDERBAR} />
          </div>
        )}
        <span style={{ color: rollen.gedaempft }} data-lfh="webhook-leer">
          Ein Webhook stellt die Ereignisse dieser Anbindung als signierte Anfrage an das
          Fremdsystem zu, statt dass es selbst abruft.
        </span>
        <ErfassungsModal<WebhookWerte>
          offen={einrichtenOffen}
          titel="Webhook einrichten"
          form={form}
          erfassenText="Einrichten"
          laeuft={einrichten.isPending}
          speicherung={einrichten}
          speicherFehlerTitel="Nicht eingerichtet"
          onErfassen={(w) => {
            const pin = pinNormal(w.zertifikat_pin ?? '');
            return einrichten.mutateAsync({
              url: w.url.trim(),
              arten: ARTEN.filter((a) => (w.arten ?? []).includes(a)),
              lan_erlaubt: !!w.lan_erlaubt,
              ...(pin ? { zertifikat_pin: pin } : {}),
            });
          }}
          onFertig={() => setEinrichtenOffen(false)}
          onAbbrechen={() => setEinrichtenOffen(false)}
        >
          <Feld label="Ziel-URL" name="url" rules={URL_REGELN}>
            <Input
              placeholder="https://fremdsystem.example/lifeline"
              maxLength={WEBHOOK_URL_MAX}
              autoComplete="off"
            />
          </Feld>
          <Feld label="Ereignisarten" name="arten" rules={ARTEN_REGELN}>
            <ArtenAuswahl scopes={zugang.scopes} />
          </Feld>
          <Feld name="lan_erlaubt" initialValue={false}>
            <LanSchalter />
          </Feld>
          <Feld label="Zertifikat" name="zertifikat_pin" initialValue="" rules={PIN_REGELN}>
            <PinEingabe zugangId={zugang.id} gesperrt={ohneNetz} />
          </Feld>
        </ErfassungsModal>
      </Paneel>
    );
  }

  const zustand = webhookZustandAnzeige(webhook);
  const felder: BearbeitbaresFeld<WebhookWerte>[] = [
    {
      name: 'url',
      label: 'Ziel-URL',
      breit: true,
      mono: true,
      // Die ganze URL bekommt nur der System-Admin; sonst steht der Server des Ziels da.
      anzeige: <span data-lfh="webhook-url">{webhook.url ?? webhook.host}</span>,
      eingabe: <Input maxLength={WEBHOOK_URL_MAX} autoComplete="off" />,
      regeln: URL_REGELN,
    },
    {
      name: 'arten',
      label: 'Ereignisarten',
      breit: true,
      anzeige: <ArtenText arten={webhook.arten} />,
      eingabe: <ArtenAuswahl scopes={zugang.scopes} />,
      regeln: ARTEN_REGELN,
    },
    {
      name: 'lan_erlaubt',
      label: 'Lokales Netz',
      breit: true,
      anzeige: webhook.lan_erlaubt ? 'erlaubt' : 'nicht erlaubt',
      // `BearbeitbaresPaneel` reicht `value`/`onChange` durch, nicht `checked`.
      eingabe: <LanSchalter />,
    },
    {
      name: 'zertifikat_pin',
      label: 'Zertifikat',
      breit: true,
      mono: !!webhook.zertifikat_pin,
      anzeige: (
        <span data-lfh="webhook-pin">
          {webhook.zertifikat_pin
            ? fingerabdruckGruppen(webhook.zertifikat_pin)
            : 'kein Fingerabdruck – es gelten die Vertrauensanker des Servers'}
        </span>
      ),
      eingabe: (
        <PinEingabe
          zugangId={zugang.id}
          gesperrt={ohneNetz}
          gespeichert={{ url: webhook.url ?? '', pin: webhook.zertifikat_pin ?? '' }}
        />
      ),
      regeln: PIN_REGELN,
    },
  ];

  return (
    <>
      <BearbeitbaresPaneel<WebhookWerte, WebhookPatch>
        key={webhook.id}
        titel="Webhook"
        meta={<Status groesse="klein" ton={zustand.ton} wort={zustand.wort} />}
        datensatz={webhook}
        werte={{
          url: webhook.url ?? '',
          arten: [...webhook.arten],
          lan_erlaubt: webhook.lan_erlaubt,
          zertifikat_pin: webhook.zertifikat_pin ?? '',
        }}
        felder={felder}
        patch={webhookPatch}
        onSpeichern={async (patch, basis) => {
          // Ohne Basis („Meine Änderung übernehmen“ nach dem 409) schreibt der Server ohne Vergleich.
          const w = await updateWebhook(zugang.id, {
            ...patch,
            ...(basis !== undefined ? { basis_geaendert_at: basis } : {}),
          });
          uebernimmWebhook(qc, zugang.id, w);
        }}
        onNeuLaden={onNeuLaden}
        darfSchreiben={darfAendern}
        grund={darfSchreiben && ohneNetz ? OHNE_VERBINDUNG_NICHT_AENDERBAR : grund}
        modus="paneel"
        spalten={2}
      />
      <Paneel
        titel="Zustellung"
        aktion={
          darfSchreiben && (
            <span style={{ display: 'inline-flex', gap: token.marginXS, alignItems: 'center' }}>
              {/* Eine Hauptaktion, der Rest gebündelt (frontend/AGENTS.md, LFH-365). */}
              {webhook.zustand === 'angehalten' ? (
                <Button
                  type="primary"
                  disabled={ohneNetz}
                  loading={weiter.isPending}
                  onClick={() => aktionWaehlen('weiter')}
                >
                  Wieder aufnehmen
                </Button>
              ) : (
                <Button
                  disabled={ohneNetz}
                  loading={testen.isPending}
                  onClick={() => aktionWaehlen('test')}
                >
                  Testereignis senden
                </Button>
              )}
              <MenueAusloeser<ZustellungAktion>
                eintraege={[
                  ...(webhook.zustand === 'angehalten'
                    ? [{ key: 'test' as const, label: 'Testereignis senden' }]
                    : []),
                  { key: 'entfernen', label: 'Webhook entfernen …', gefahr: true },
                ]}
                zugaenglicherName={`Weitere Aktionen zum Webhook von ${zugang.name}`}
                gesperrt={ohneNetz}
                laeuft={testen.isPending || entfernen.isPending || weiter.isPending}
                onWahl={aktionWaehlen}
              />
            </span>
          )
        }
      >
        {darfSchreiben && ohneNetz && (
          <PaneelZeile>
            <RechteHinweis sichtbar text={OHNE_VERBINDUNG_NICHT_AENDERBAR} />
          </PaneelZeile>
        )}
        {weiter.error && (
          <PaneelZeile>
            <SpeicherFehler fehler={weiter.error} titel="Nicht wieder aufgenommen" />
          </PaneelZeile>
        )}
        {testen.error && (
          <PaneelZeile>
            <SpeicherFehler fehler={testen.error} titel="Testereignis nicht gesendet" />
          </PaneelZeile>
        )}
        {test && test.ziel === ziel && (
          <PaneelZeile>
            <span
              data-lfh="webhook-test"
              style={{ color: test.ergebnis.erfolg ? rollen.text : rollen.achtungText }}
            >
              {`Testereignis: ${versuchText(test.ergebnis)} · ${test.ergebnis.dauer_ms} ms`}
            </span>
          </PaneelZeile>
        )}
        {webhook.verlust_at && (
          <PaneelZeile>
            <Alert
              type="warning"
              showIcon
              data-lfh="webhook-verlust"
              message={`Ereignisse verloren (${zeit(webhook.verlust_at)})`}
              description="Sie lagen länger als sieben Tage unzugestellt und sind gelöscht. Das Fremdsystem muss den Stand über die Leserouten neu lesen."
            />
          </PaneelZeile>
        )}
        <Datenraster spalten={2} beschriftung="Zustellung">
          <Datenfeld label="Zustand">
            <span data-lfh="webhook-zustand">
              {webhook.zustand === 'ruht' && webhook.ruht_grund
                ? `ruht: ${RUHT_TEXT[webhook.ruht_grund]}`
                : webhook.zustand === 'angehalten'
                  ? `angehalten${webhook.angehalten_at ? ` seit ${zeit(webhook.angehalten_at)}` : ''}${webhook.fehler_seit ? ` · erster Fehlschlag ${zeit(webhook.fehler_seit)}` : ''} · 24 h ohne Erfolg`
                  : webhook.zustand === 'fehler'
                    ? `gestört${webhook.fehler_seit ? ` seit ${zeit(webhook.fehler_seit)}` : ''} · ${webhook.fehlversuche} Fehlversuch(e)`
                    : 'stellt zu'}
            </span>
          </Datenfeld>
          <Datenfeld label="Nächster Versuch">
            {webhook.naechster_versuch_at ? zeit(webhook.naechster_versuch_at) : '—'}
          </Datenfeld>
          <Datenfeld label="Letzter Fehler" breit>
            {webhook.letzter_fehler ? (
              <span data-lfh="webhook-fehler" style={{ color: rollen.achtungText }}>
                {`${webhookFehlerText(webhook.letzter_fehler.art, webhook.letzter_fehler.status)} · ${zeit(webhook.letzter_fehler.at)}`}
              </span>
            ) : (
              'keiner'
            )}
            {/* Der Text bleibt neutral: ob beim Versuch schon ein Fingerabdruck galt, steht
                nirgends (Design-Doc LLH-1872, D5). Nur in der laufenden Störung der Hinweis. */}
            {/* Nur ein Fehler nach der letzten Änderung kann dem hinterlegten Fingerabdruck
                gelten; ein angehaltener Webhook behält den Fehler von davor (Review #2). */}
            {webhook.zertifikat_pin &&
              webhook.letzter_fehler?.art === 'tls' &&
              webhook.letzter_fehler.at >= webhook.geaendert_at &&
              (webhook.zustand === 'fehler' || webhook.zustand === 'angehalten') && (
                <div data-lfh="webhook-pin-hinweis" style={{ color: rollen.gedaempft }}>
                  Hat das Ziel sein Zertifikat gewechselt? Fingerabdruck neu holen.
                </div>
              )}
          </Datenfeld>
          <Datenfeld label="Zuletzt zugestellt">
            {webhook.letzter_erfolg_at ? zeit(webhook.letzter_erfolg_at) : 'noch nie'}
          </Datenfeld>
          <Datenfeld label="Webhook-Kennung (aud)" mono>
            {webhook.id}
          </Datenfeld>
        </Datenraster>
      </Paneel>
      <Zustellungen zugangId={zugang.id} />
      <Modal
        open={entfernenOffen}
        title="Webhook entfernen?"
        okText="Entfernen"
        okButtonProps={{ danger: true, loading: entfernen.isPending }}
        cancelButtonProps={{ disabled: entfernen.isPending }}
        cancelText="Abbrechen"
        // Solange das Entfernen läuft, bleibt die Rückfrage offen: ihr Fehler stünde sonst nirgends.
        closable={!entfernen.isPending}
        maskClosable={!entfernen.isPending}
        keyboard={!entfernen.isPending}
        onOk={() => entfernen.mutate()}
        onCancel={() => {
          if (!entfernen.isPending) setEntfernenOffen(false);
        }}
      >
        <p>
          Das Fremdsystem bekommt keine Ereignisse mehr zugestellt. Ein neuer Webhook beginnt beim
          aktuellen Stand; was dazwischen geschieht, holt das Fremdsystem über den Abruf nach.
        </p>
        {entfernen.error && <SpeicherFehler fehler={entfernen.error} titel="Nicht entfernt" />}
      </Modal>
    </>
  );
}

/**
 * Fingerabdruck des Zielzertifikats (LLH-1872): Textfeld und „Vom Ziel holen“. Der Abruf nimmt
 * URL und LAN-Ausnahme, wie sie gerade im Formular stehen; übernommen wird erst nach
 * Bestätigung, gespeichert mit dem Formular. `gespeichert` (nur beim Bearbeiten) zeigt, wenn die
 * URL auf einen anderen Server zeigt und der alte Fingerabdruck beim Speichern wegfällt.
 */
function PinEingabe({
  zugangId,
  gesperrt,
  gespeichert,
  id,
  value,
  onChange,
}: {
  zugangId: string;
  gesperrt: boolean;
  gespeichert?: { url: string; pin: string };
  id?: string;
  value?: string;
  onChange?: (wert: string) => void;
}) {
  const { rollen } = useRollen();
  const form = Form.useFormInstance<WebhookWerte>();
  const url = Form.useWatch('url', form);
  const [gefunden, setGefunden] = useState<string | null>(null);
  const abruf = useMutation({
    mutationFn: () =>
      holeZertifikat(
        zugangId,
        String(form.getFieldValue('url') ?? '').trim(),
        !!form.getFieldValue('lan_erlaubt'),
      ),
    onSuccess: (e) => {
      if (e.fingerabdruck) setGefunden(e.fingerabdruck);
    },
  });
  const faelltWeg =
    gespeichert != null &&
    pinFaelltWeg(
      { url: gespeichert.url, arten: [], lan_erlaubt: false, zertifikat_pin: gespeichert.pin },
      { url: url ?? '', arten: [], lan_erlaubt: false, zertifikat_pin: value ?? '' },
    );
  const fehlerArt = abruf.data?.fehler_art;
  return (
    <div>
      <Stapel richtung="zeile" abstand="xs" ausrichten="mitte">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder="AB:CD:… (SHA-256)"
          autoComplete="off"
          spellCheck={false}
          style={monoStil('monoKlein')}
          data-lfh="webhook-pin-eingabe"
        />
        <Button
          disabled={gesperrt || !String(url ?? '').trim()}
          loading={abruf.isPending}
          onClick={() => {
            abruf.reset();
            abruf.mutate();
          }}
        >
          Vom Ziel holen
        </Button>
      </Stapel>
      <div style={{ color: rollen.gedaempft, marginBlockStart: 'var(--lfh-luft-1)' }}>
        {PIN_HINWEIS}
      </div>
      {faelltWeg && (
        <div
          style={{ color: rollen.achtungText, marginBlockStart: 'var(--lfh-luft-1)' }}
          data-lfh="webhook-pin-neuer-server"
        >
          {NEUER_SERVER}
        </div>
      )}
      {fehlerArt && (
        <div style={{ color: rollen.achtungText, marginBlockStart: 'var(--lfh-luft-1)' }}>
          {`Kein Zertifikat gelesen: ${webhookFehlerText(fehlerArt)}`}
        </div>
      )}
      {abruf.error && <SpeicherFehler fehler={abruf.error} titel="Zertifikat nicht abgerufen" />}
      <Modal
        open={gefunden != null}
        title="Zertifikat des Ziels"
        okText="Übernehmen"
        cancelText="Abbrechen"
        onOk={() => {
          if (gefunden) onChange?.(fingerabdruckGruppen(gefunden));
          setGefunden(null);
        }}
        onCancel={() => setGefunden(null)}
      >
        <p>Das Ziel zeigt dieses Zertifikat. Fingerabdruck mit dem am Zielgerät vergleichen.</p>
        <p style={monoStil('monoKlein')} data-lfh="webhook-pin-gefunden">
          {gefunden ? fingerabdruckGruppen(gefunden) : ''}
        </p>
      </Modal>
    </div>
  );
}

/** Die LAN-Ausnahme im Bearbeiten: ein Checkbox mit Warnung, gesteuert über `value`. */
function LanSchalter({
  id,
  value,
  onChange,
}: {
  id?: string;
  value?: boolean;
  onChange?: (wert: boolean) => void;
}) {
  const { rollen } = useRollen();
  return (
    <Checkbox
      id={id}
      checked={!!value}
      onChange={(e) => onChange?.(e.target.checked)}
      data-lfh="webhook-lan"
    >
      Ziel im lokalen Netz erlauben
      <div style={{ color: rollen.achtungText, marginBlockStart: 'var(--lfh-luft-1)' }}>
        {LAN_WARNUNG}
      </div>
    </Checkbox>
  );
}

/** Paneel „Zustellungen“: die letzten Versuche, neueste zuerst, ohne Rumpf der Antwort. */
function Zustellungen({ zugangId }: { zugangId: string }) {
  const { rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const q = useQuery({
    queryKey: globalKeys.anbindungWebhookVersuche(zugangId),
    queryFn: () => loadWebhookVersuche(zugangId),
    refetchInterval: ANBINDUNGEN_ABRUF_MS,
  });
  const versuche = q.data ?? [];
  return (
    <Paneel titel="Zustellungen" meta={q.data ? `${versuche.length} von höchstens 50` : undefined}>
      {q.isError && (
        <PaneelZeile>
          <SeitenFehler
            text={q.data ? 'Stand nicht aktuell: neu laden gescheitert' : 'Verlauf nicht ladbar'}
            ursache={q.error}
            onWiederholen={() => void q.refetch()}
            laedt={q.isFetching}
          />
        </PaneelZeile>
      )}
      {!q.data ? (
        !q.isError && (
          <PaneelZeile>
            <span style={{ color: rollen.gedaempft }} data-lfh="webhook-verlauf-laedt">
              {/* Ohne Netz pausiert die Abfrage: dann nicht „lädt“ behaupten. */}
              {q.fetchStatus === 'paused'
                ? 'Ohne Verbindung nicht geladen.'
                : 'Verlauf wird geladen …'}
            </span>
          </PaneelZeile>
        )
      ) : versuche.length === 0 ? (
        <PaneelZeile>
          <span style={{ color: rollen.gedaempft }}>Noch kein Zustellversuch.</span>
        </PaneelZeile>
      ) : (
        versuche.map((v, i) => (
          <PaneelZeile key={`${v.at}-${i}`}>
            <div data-lfh="webhook-versuch">
              <Stapel richtung="zeile" umbruch abstand="md" ausrichten="baseline">
                <span style={monoStil('monoKlein')}>{zeitKurz(v.at, konv)}</span>
                <span style={monoStil('monoKlein')}>
                  {v.test ? 'Test' : v.ereignis_id != null ? `#${v.ereignis_id}` : '—'}
                </span>
                <span style={{ color: v.erfolg ? rollen.text : rollen.achtungText }}>
                  {versuchText(v)}
                </span>
                <span
                  style={{ ...monoStil('monoKlein'), color: rollen.gedaempft }}
                >{`${v.dauer_ms} ms`}</span>
              </Stapel>
            </div>
          </PaneelZeile>
        ))
      )}
    </Paneel>
  );
}
