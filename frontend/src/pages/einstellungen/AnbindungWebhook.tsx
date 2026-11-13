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
  Paneel,
  PaneelZeile,
  StatusChip,
  monoStil,
  useRollen,
  type BearbeitbaresFeld,
} from '../../components/instrument';
import { SeitenFehler } from '../../components/SeitenZustand';
import { RechteHinweis, SpeicherFehler } from '../../components/SpeicherHinweis';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../../anzeige/zeitDarstellung';
import {
  ARTEN,
  ART_TEXT,
  RUHT_TEXT,
  aendereWebhook,
  artGesperrtGrund,
  entferneWebhook,
  ladeWebhookVersuche,
  nimmWebhookWiederAuf,
  richteWebhookEin,
  sendeTestereignis,
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

// Webhook einer Anbindung (LLH-1656, Spec `webhook-zustellung`, design.md D9): einrichten im
// `ErfassungsModal`, bearbeiten im `BearbeitbaresPaneel`, dazu Zustand der Zustellung und der
// Verlauf. Schreiben darf nur der System-Admin; den Zustand sieht, wer die Seite sieht.

interface WebhookWerte {
  url: string;
  arten: EventType[];
  lan_erlaubt: boolean;
}

/** Warnung an der LAN-Ausnahme; steht im Modal und im Paneel gleich. */
export const LAN_WARNUNG =
  'Nur für ein Fremdsystem im eigenen Netz, etwa im ELW. Rechner, Link-Local- und ' +
  'Metadatenadressen bleiben gesperrt. Das Ziel braucht ein Zertifikat, dem dieser Server vertraut.';

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
  const { token, rollen } = useRollen();
  return (
    <div id={id}>
      <Checkbox.Group<EventType>
        value={value}
        onChange={(arten) => onChange?.(arten)}
        style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS }}
      >
        {ARTEN.map((a) => {
          const grund = artGesperrtGrund(a, scopes);
          return (
            <Checkbox key={a} value={a} disabled={grund != null} data-lfh={`webhook-art-${a}`}>
              {ART_TEXT[a]} <span style={{ ...monoStil(11, 500), color: rollen.schwach }}>{a}</span>
              {grund && <span style={{ color: rollen.gedaempft }}>{` · ${grund}`}</span>}
            </Checkbox>
          );
        })}
      </Checkbox.Group>
    </div>
  );
}

const URL_REGELN = [
  { required: true, whitespace: true, message: 'Ziel-URL angeben' },
  { max: WEBHOOK_URL_MAX, message: `Höchstens ${WEBHOOK_URL_MAX} Zeichen` },
  { pattern: /^\s*https:\/\//i, message: 'Die Ziel-URL muss mit https:// beginnen' },
];

const ARTEN_REGELN = [
  { required: true, type: 'array' as const, min: 1, message: 'Mindestens eine Art wählen' },
];

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
    mutationFn: (e: WebhookEingabe) => richteWebhookEin(zugang.id, e),
    onSuccess: (w) => uebernimmWebhook(qc, zugang.id, w),
  });
  const entfernen = useMutation({
    mutationFn: () => entferneWebhook(zugang.id),
    onSuccess: () => {
      setEntfernenOffen(false);
      setTest(null);
      uebernimmWebhook(qc, zugang.id, null);
    },
  });
  const weiter = useMutation({
    mutationFn: () => nimmWebhookWiederAuf(zugang.id),
    onMutate: () => testen.reset(),
    onSuccess: (w) => uebernimmWebhook(qc, zugang.id, w),
  });
  const testen = useMutation({
    mutationFn: () => sendeTestereignis(zugang.id),
    onMutate: () => {
      setTest(null);
      weiter.reset();
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
            <Button size="small" disabled={ohneNetz} onClick={() => setEinrichtenOffen(true)}>
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
          onErfassen={(w) =>
            einrichten.mutateAsync({
              url: w.url.trim(),
              arten: ARTEN.filter((a) => (w.arten ?? []).includes(a)),
              lan_erlaubt: !!w.lan_erlaubt,
            })
          }
          onFertig={() => setEinrichtenOffen(false)}
          onAbbrechen={() => setEinrichtenOffen(false)}
        >
          <Form.Item label="Ziel-URL" name="url" rules={URL_REGELN}>
            <Input
              placeholder="https://fremdsystem.example/lifeline"
              maxLength={WEBHOOK_URL_MAX}
              autoComplete="off"
            />
          </Form.Item>
          <Form.Item label="Ereignisarten" name="arten" rules={ARTEN_REGELN}>
            <ArtenAuswahl scopes={zugang.scopes} />
          </Form.Item>
          <Form.Item name="lan_erlaubt" initialValue={false}>
            <LanSchalter />
          </Form.Item>
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
  ];

  return (
    <>
      <BearbeitbaresPaneel<WebhookWerte, WebhookPatch>
        key={webhook.id}
        titel="Webhook"
        meta={<StatusChip ton={zustand.ton} wort={zustand.wort} />}
        datensatz={webhook}
        werte={{
          url: webhook.url ?? '',
          arten: [...webhook.arten],
          lan_erlaubt: webhook.lan_erlaubt,
        }}
        felder={felder}
        patch={webhookPatch}
        onSpeichern={async (patch, basis) => {
          // Ohne Basis („Meine Änderung übernehmen“ nach dem 409) schreibt der Server ohne Vergleich.
          const w = await aendereWebhook(zugang.id, {
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
                  size="small"
                  type="primary"
                  disabled={ohneNetz}
                  loading={weiter.isPending}
                  onClick={() => aktionWaehlen('weiter')}
                >
                  Wieder aufnehmen
                </Button>
              ) : (
                <Button
                  size="small"
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
                laeuft={testen.isPending || entfernen.isPending}
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
      <div style={{ color: rollen.achtungText, marginBlockStart: 4 }}>{LAN_WARNUNG}</div>
    </Checkbox>
  );
}

/** Paneel „Zustellungen“: die letzten Versuche, neueste zuerst, ohne Rumpf der Antwort. */
function Zustellungen({ zugangId }: { zugangId: string }) {
  const { rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const q = useQuery({
    queryKey: globalKeys.anbindungWebhookVersuche(zugangId),
    queryFn: () => ladeWebhookVersuche(zugangId),
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
              Verlauf wird geladen …
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
            <span
              data-lfh="webhook-versuch"
              style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}
            >
              <span style={monoStil(12)}>{zeitKurz(v.at, konv)}</span>
              <span style={monoStil(12)}>
                {v.test ? 'Test' : v.ereignis_id != null ? `#${v.ereignis_id}` : '—'}
              </span>
              <span style={{ color: v.erfolg ? rollen.text : rollen.achtungText }}>
                {versuchText(v)}
              </span>
              <span style={{ ...monoStil(12), color: rollen.gedaempft }}>{`${v.dauer_ms} ms`}</span>
            </span>
          </PaneelZeile>
        ))
      )}
    </Paneel>
  );
}
