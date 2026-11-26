import { Alert, Checkbox, Form, Skeleton, Typography, theme } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { adminSektionPfad, anbindungenPfad } from '../admin/adminPfade';
import { ApiError } from '../api/client';
import { useKanaeleSammlung } from '../api/externeStellen';
import {
  ANBINDUNG_GRUENDE,
  AUSGANG_FEHLER_TEXT,
  anbindungKanal,
  useSendeVersaende,
  versandFehler,
  type QuelleFilter,
} from '../api/ausgang';
import type { AusgangFehler, KanalArt, KanalMitStelle } from '../api/types';
import { zahlText } from '../anzeige/zahl';
import { useAuth } from '../auth/AuthContext';
import { ErfassungsModal } from '../components/Erfassung';
import { Feld, Textstufe, schriftStil } from '../components/instrument';
import { neueClientId } from '../offline/clientId';
import { useOnline } from '../offline/useOnline';
import { empfaengerVorschlag } from './empfaengerVorschlag';
import { KANAL_REIHENFOLGE, kanalKurz } from './kanalAnzeige';

interface FormWerte {
  kanaele: number[];
}

const VORSCHAU_ZEILEN = 3;

function groesse(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${zahlText(bytes / (1024 * 1024), { stellen: 1 })} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

/**
 * Die Adressen je Stelle, Stellen nach Namen, in einer Stelle nach Kanal: Gesendet wird an eine
 * Stelle, und ihre Mail-, Fax- und Matrix-Adresse stehen so beieinander statt verstreut.
 */
function nachStelle(kanaele: readonly KanalMitStelle[]): KanalMitStelle[][] {
  const gruppen = new Map<number, KanalMitStelle[]>();
  for (const k of kanaele) {
    const gruppe = gruppen.get(k.agency_id);
    if (gruppe) gruppe.push(k);
    else gruppen.set(k.agency_id, [k]);
  }
  const rang = (k: KanalMitStelle) => KANAL_REIHENFOLGE.indexOf(k.channel.channel);
  return [...gruppen.values()]
    .map((g) => [...g].sort((a, b) => rang(a) - rang(b)))
    .sort((a, b) => a[0].agency_name.localeCompare(b[0].agency_name, 'de'));
}

/**
 * Senden eines freigegebenen Lageberichts, Befehls oder einer Nachforderung per E-Mail, Fax oder
 * Matrix (LLH-2093, LLH-2095, LLH-2094, Spec 7 und 8): Adressen der aktiven Externen Stellen zum
 * Anhaken, je Stelle beisammen unter ihrem Namen (Kanal als Wort davor), die Stellen des Verteilers bzw. der Adressat sind mit je einer
 * Adresse vorbelegt, nie mit einer Faxnummer, damit eine Stelle nicht doppelt Post bekommt. Fehlt
 * das Matrix-Konto, sind nur die Matrix-Adressen gesperrt. Nur online; ein Versand wird nie
 * vorgemerkt.
 */
export default function SendenDialog({
  offen,
  onClose,
  einsatzId,
  quelle,
  vorschlagNamen,
  betreff,
  vorschauText,
  anhaenge,
}: {
  offen: boolean;
  onClose: () => void;
  einsatzId: number;
  quelle: QuelleFilter;
  /** Namen aus dem Verteiler (`extern_bezeichnung`) bzw. `adressat_bezeichnung`. */
  vorschlagNamen: readonly string[];
  /** Betreff, soweit der Client ihn kennt; der Server baut den endgültigen. */
  betreff?: string;
  /** Der freigegebene Text; gezeigt werden die ersten Zeilen. */
  vorschauText?: string;
  anhaenge?: { anzahl: number; bytes: number };
}) {
  const { token } = theme.useToken();
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const online = useOnline();
  const [form] = Form.useForm<FormWerte>();
  const gewaehlt = Form.useWatch('kanaele', form) as number[] | undefined;
  const kanaeleQuery = useKanaeleSammlung();
  const sende = useSendeVersaende(einsatzId, quelle);
  // Der Server kennt heute E-Mail, Fax und Matrix; ein anderer Kanal bleibt aus der Auswahl.
  const kanaele = useMemo(
    () =>
      kanaeleQuery.data?.filter(
        (k) =>
          k.channel.channel === 'email' ||
          k.channel.channel === 'fax' ||
          k.channel.channel === 'matrix',
      ),
    [kanaeleQuery.data],
  );
  /** Grund, warum die Matrix-Adressen gesperrt sind, nachdem der Server das Konto abgelehnt hat. */
  const [matrixGesperrt, setMatrixGesperrt] = useState<string | null>(null);
  /** Kanäle der zuletzt gesendeten Adressen: nach ihnen richtet sich der Wortlaut einer Ablehnung. */
  const [gesendet, setGesendet] = useState<KanalArt[]>([]);

  // Ein Schlüssel je Öffnen: ein zweiter Versuch derselben Eingabe legt keine zweite Mail an.
  // `offen` ist der Auslöser; der Wert hängt nur an der Öffnung.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const clientId = useMemo(() => neueClientId(), [offen]);

  // Vorbelegung genau einmal je Öffnen, sobald die Adressen da sind; eine spätere Antwort
  // überschreibt keine Auswahl der Person.
  const vorbelegtFuer = useRef<string | null>(null);
  useEffect(() => {
    if (!offen || !kanaele || vorbelegtFuer.current === clientId) return;
    vorbelegtFuer.current = clientId;
    setMatrixGesperrt(null);
    form.setFieldValue('kanaele', [...empfaengerVorschlag(kanaele, vorschlagNamen)]);
  }, [offen, kanaele, clientId, form, vorschlagNamen]);

  const keineAdresse = kanaele !== undefined && kanaele.length === 0;
  const grund = !online
    ? 'Ohne Netz nicht möglich'
    : keineAdresse
      ? 'Keine Adresse hinterlegt'
      : null;
  const gesperrt = grund !== null || kanaele === undefined || (gewaehlt ?? []).length === 0;

  const fehler = versandFehler(sende.error, gesendet);
  const anbindungGestoert =
    sende.error instanceof ApiError &&
    !!sende.error.grund &&
    ANBINDUNG_GRUENDE.has(sende.error.grund);

  /** Eine Ablehnung wegen des Matrix-Kontos sperrt die Matrix-Adressen, nicht den Dialog. */
  const merkeMatrixSperre = (e: unknown, arten: readonly KanalArt[]) => {
    if (
      e instanceof ApiError &&
      e.grund &&
      ANBINDUNG_GRUENDE.has(e.grund) &&
      anbindungKanal(e, arten) === 'matrix'
    ) {
      setMatrixGesperrt(AUSGANG_FEHLER_TEXT.matrix[e.grund as AusgangFehler]);
      const kanalVon = (id: number) => kanaele?.find((k) => k.channel.id === id);
      const gewaehlteIds = (form.getFieldValue('kanaele') as number[] | undefined) ?? [];
      const rest = gewaehlteIds.filter((id) => kanalVon(id)?.channel.channel !== 'matrix');
      // Betroffene Stellen: die erste Mailadresse derselben Stelle ersetzt die Matrix-Adresse.
      const betroffen = new Set(
        gewaehlteIds
          .filter((id) => kanalVon(id)?.channel.channel === 'matrix')
          .map((id) => kanalVon(id)?.agency_id),
      );
      for (const stelleId of betroffen) {
        const stelleMails = (kanaele ?? []).filter(
          (k) => k.agency_id === stelleId && k.channel.channel === 'email',
        );
        if (stelleMails.length > 0 && !stelleMails.some((k) => rest.includes(k.channel.id))) {
          rest.push(stelleMails[0].channel.id);
        }
      }
      form.setFieldValue('kanaele', rest);
    }
  };

  const vorschau = (vorschauText ?? '')
    .split('\n')
    .filter((z) => z.trim() !== '')
    .slice(0, VORSCHAU_ZEILEN);

  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel="Senden"
      form={form}
      erfassenText="Senden"
      laeuft={sende.isPending}
      gesperrt={gesperrt}
      speicherung={{ error: fehler, isPending: sende.isPending, reset: sende.reset }}
      speicherFehlerTitel="Nicht gesendet"
      speicherFehlerFallback="Senden fehlgeschlagen"
      onErfassen={(w) => {
        const arten = w.kanaele.flatMap((id) => {
          const art = kanaele?.find((k) => k.channel.id === id)?.channel.channel;
          return art ? [art] : [];
        });
        setGesendet(arten);
        return sende
          .mutateAsync({
            client_id: clientId,
            recipients: w.kanaele.map((channel_id) => ({ channel_id })),
          })
          .catch((e: unknown) => {
            merkeMatrixSperre(e, arten);
            throw e;
          });
      }}
      onFertig={onClose}
      onAbbrechen={onClose}
    >
      {kanaele === undefined ? (
        <Skeleton active paragraph={{ rows: 2 }} title={false} />
      ) : keineAdresse ? (
        <Alert
          type="warning"
          showIcon
          title="Keine Adresse hinterlegt"
          description={
            istAdmin ? (
              <Link to={adminSektionPfad('stammdaten', 'externe-stellen')}>
                Adressen bei den Externen Stellen eintragen
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Feld label="An" name="kanaele">
          <Checkbox.Group style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}>
            {nachStelle(kanaele).map((gruppe) => (
              <div
                key={gruppe[0].agency_id}
                role="group"
                aria-label={gruppe[0].agency_name}
                data-lfh="senden-stelle"
                style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS }}
              >
                <Textstufe stufe="textKlein" ton="text2">
                  {gruppe[0].agency_name}
                </Textstufe>
                {gruppe.map((k) => {
                  const gesperrtMatrix = k.channel.channel === 'matrix' && matrixGesperrt !== null;
                  return (
                    <Checkbox
                      key={k.channel.id}
                      value={k.channel.id}
                      disabled={gesperrtMatrix}
                      aria-label={`${kanalKurz(k.channel.channel)} ${k.agency_name} · ${k.channel.address}`}
                    >
                      <Textstufe stufe="textKlein" ton="gedaempft">
                        {kanalKurz(k.channel.channel)}
                      </Textstufe>{' '}
                      {k.channel.address}
                      {k.channel.label ? ` (${k.channel.label})` : ''}
                      {gesperrtMatrix && (
                        <Typography.Text type="danger" style={schriftStil('textKlein')}>
                          {' '}
                          · {matrixGesperrt}
                        </Typography.Text>
                      )}
                    </Checkbox>
                  );
                })}
              </div>
            ))}
          </Checkbox.Group>
        </Feld>
      )}

      {grund && !keineAdresse && (
        <Typography.Text type="danger" role="status" style={{ display: 'block' }}>
          {grund}
        </Typography.Text>
      )}
      {anbindungGestoert && istAdmin && (
        <Link to={anbindungenPfad()} style={{ display: 'block', marginBottom: token.marginXS }}>
          Zu den Anbindungen
        </Link>
      )}

      {(betreff || vorschau.length > 0 || anhaenge) && (
        <div data-lfh="senden-vorschau" style={{ marginTop: token.marginSM }}>
          {betreff && (
            <Typography.Text strong style={{ display: 'block' }}>
              {betreff}
            </Typography.Text>
          )}
          {vorschau.map((z, i) => (
            <Typography.Text
              key={i}
              type="secondary"
              style={{ display: 'block', ...schriftStil('textKlein'), overflowWrap: 'anywhere' }}
            >
              {z}
            </Typography.Text>
          ))}
          {anhaenge && anhaenge.anzahl > 0 && (
            <Typography.Text
              type="secondary"
              style={{ display: 'block', ...schriftStil('textKlein') }}
            >
              {anhaenge.anzahl} {anhaenge.anzahl === 1 ? 'Anhang' : 'Anhänge'},{' '}
              {groesse(anhaenge.bytes)}
            </Typography.Text>
          )}
        </div>
      )}
    </ErfassungsModal>
  );
}
