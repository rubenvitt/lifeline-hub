import { Alert, Checkbox, Form, Skeleton, Typography, theme } from 'antd';
import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router';
import { adminSektionPfad, anbindungenPfad } from '../admin/adminPfade';
import { ApiError } from '../api/client';
import { useKanaeleSammlung } from '../api/externeStellen';
import { useSendeVersaende, versandFehler, type QuelleFilter } from '../api/ausgang';
import { useAuth } from '../auth/AuthContext';
import { ErfassungsModal } from '../components/Erfassung';
import { Feld, schriftStil } from '../components/instrument';
import { neueClientId } from '../offline/clientId';
import { useOnline } from '../offline/useOnline';
import { empfaengerVorschlag } from './empfaengerVorschlag';

interface FormWerte {
  kanaele: number[];
}

/** Gründe, die auf eine fehlende oder gestörte Mailanbindung deuten: Admins bekommen den Weg dorthin. */
const ANBINDUNG_GRUENDE = new Set(['anbindung_fehlt', 'anbindung_angehalten', 'anbindung_fehler']);

const VORSCHAU_ZEILEN = 3;

function groesse(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

/**
 * Senden eines freigegebenen Lageberichts, Befehls oder einer Nachforderung per E-Mail
 * (LLH-2093, Spec 7): Mailadressen der aktiven Externen Stellen zum Anhaken, die Stellen des
 * Verteilers bzw. der Adressat sind vorbelegt. Nur online; eine Mail wird nie vorgemerkt.
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
  const kanaeleQuery = useKanaeleSammlung('email');
  const sende = useSendeVersaende(einsatzId, quelle);
  const kanaele = kanaeleQuery.data;

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
    form.setFieldValue('kanaele', [...empfaengerVorschlag(kanaele, vorschlagNamen)]);
  }, [offen, kanaele, clientId, form, vorschlagNamen]);

  const keineAdresse = kanaele !== undefined && kanaele.length === 0;
  const grund = !online
    ? 'Ohne Netz nicht möglich'
    : keineAdresse
      ? 'Keine Mailadresse hinterlegt'
      : null;
  const gesperrt = grund !== null || kanaele === undefined || (gewaehlt ?? []).length === 0;

  const fehler = versandFehler(sende.error);
  const anbindungGestoert =
    sende.error instanceof ApiError &&
    !!sende.error.grund &&
    ANBINDUNG_GRUENDE.has(sende.error.grund);

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
      onErfassen={(w) =>
        sende.mutateAsync({
          client_id: clientId,
          recipients: w.kanaele.map((channel_id) => ({ channel_id })),
        })
      }
      onFertig={onClose}
      onAbbrechen={onClose}
    >
      {kanaele === undefined ? (
        <Skeleton active paragraph={{ rows: 2 }} title={false} />
      ) : keineAdresse ? (
        <Alert
          type="warning"
          showIcon
          title="Keine Mailadresse hinterlegt"
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
          <Checkbox.Group style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
            {kanaele.map((k) => (
              <Checkbox key={k.channel.id} value={k.channel.id}>
                {k.agency_name} · {k.channel.address}
                {k.channel.label ? ` (${k.channel.label})` : ''}
              </Checkbox>
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
