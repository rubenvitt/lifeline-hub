import { Button, Switch, Typography, theme } from 'antd';
import { useEffect, useState, type CSSProperties } from 'react';
import AdminPage from '../components/AdminPage';
import { Paneel, PaneelZeile, PaneelZustand } from '../components/instrument';
import { spieleAlarmTon } from '../alarm/alarmTon';
import { ALLE_ARTEN, BENACHRICHTIGUNG_ARTEN } from '../alarm/benachrichtigungKatalog';
import {
  desktopPermission,
  fordereDesktopPermission,
  showTestMeldung,
} from '../alarm/desktopAlarm';
import { useBenachrichtigungsEinstellungen } from '../alarm/useBenachrichtigungsEinstellungen';
import {
  ladePushStand,
  pushAusschalten,
  pushEinschalten,
  pushInhaltSetzen,
  type PushZustand,
} from '../alarm/webPush';
import { useAuthOptional } from '../auth/AuthContext';

const ALARM_ARTEN = ALLE_ARTEN.filter((a) => BENACHRICHTIGUNG_ARTEN[a].stufe === 'alarm');
const HINWEIS_ARTEN = ALLE_ARTEN.filter(
  (a) => BENACHRICHTIGUNG_ARTEN[a].stufe === 'hinweis' && BENACHRICHTIGUNG_ARTEN[a].einstellbar,
);

/** Zustandswort der Alarm-Arten; sie lassen sich nicht abschalten (Spec, design.md D6). */
export const IMMER_AN = 'immer an';

/** Name des Push-Schalters (LLH-1223, design.md D8). */
export const PUSH_SCHALTER = 'Auch bei geschlossener App';

/**
 * Name des Schalters für den Inhalt in Push-Meldungen (LLH-1369, Spec `web-push`, „Inhalt der
 * Meldung nur auf Wunsch“). Nur bei eingeschaltetem Push, Vorgabe aus.
 */
export const PUSH_INHALT_SCHALTER = 'Mit Absender und Wortlaut';

/** Eine Zeile mit Beschriftung, „nicht gespeichert“ bei Fehler, und dem Schalter rechts. */
function SchalterZeile({
  zeile,
  feldId,
  name,
  fehler,
  marke,
  an,
  laeuft,
  gesperrt,
  setze,
}: {
  zeile: CSSProperties;
  feldId: string;
  name: string;
  fehler: boolean;
  marke?: string;
  an: boolean;
  laeuft: boolean;
  gesperrt: boolean;
  setze: (an: boolean) => void;
}) {
  const { token } = theme.useToken();
  return (
    <PaneelZeile
      style={fehler ? { borderInlineStart: `3px solid ${token.colorError}` } : undefined}
    >
      <div style={zeile} data-fehler={fehler ? 'true' : undefined}>
        <label htmlFor={feldId} style={{ cursor: 'pointer', minWidth: 0 }}>
          {name}
          {fehler && (
            <Typography.Text type="danger" style={{ display: 'block', fontSize: token.fontSizeSM }}>
              nicht gespeichert
            </Typography.Text>
          )}
        </label>
        <span style={{ display: 'flex', alignItems: 'center', gap: token.marginXS }}>
          {marke && <Typography.Text type="warning">{marke}</Typography.Text>}
          <Switch
            id={feldId}
            aria-label={name}
            checked={an}
            loading={laeuft}
            disabled={laeuft || gesperrt}
            onChange={setze}
          />
        </span>
      </div>
    </PaneelZeile>
  );
}

/**
 * Web Push für diesen Browser (LLH-1223, design.md D8). Fehlt, wo es kein Push gibt (Browser,
 * Hülle, Server ohne Schalter). Erlaubnis, iOS und was der Schalter bewirkt, erklärt die
 * Anwenderdoku.
 */
function PushSchalter({ zeile }: { zeile: CSSProperties }) {
  const benutzerId = useAuthOptional()?.benutzer?.id ?? null;
  const [zustand, setZustand] = useState<PushZustand | null>(null);
  const [inhalt, setInhalt] = useState(false);
  const [laeuft, setLaeuft] = useState<'push' | 'inhalt' | null>(null);
  const [fehler, setFehler] = useState<'push' | 'inhalt' | null>(null);

  useEffect(() => {
    let aktiv = true;
    ladePushStand().then(
      (s) => {
        if (!aktiv) return;
        setZustand(s.zustand);
        setInhalt(s.inhalt);
      },
      () => aktiv && setZustand('fehlt'),
    );
    return () => {
      aktiv = false;
    };
  }, []);

  if (zustand == null || zustand === 'fehlt' || benutzerId == null) return null;
  const blockiert = zustand === 'blockiert';
  const setzePush = (an: boolean) => {
    setLaeuft('push');
    setFehler(null);
    (an ? pushEinschalten(benutzerId) : pushAusschalten(benutzerId))
      .then(
        (z) => {
          setZustand(z);
          // Neu eingeschaltet oder aus: die Vorgabe gilt, ohne Inhalt.
          setInhalt(false);
        },
        () => setFehler('push'),
      )
      .finally(() => setLaeuft(null));
  };
  const setzeInhalt = (an: boolean) => {
    setLaeuft('inhalt');
    setFehler(null);
    pushInhaltSetzen(benutzerId, an)
      .then(setInhalt, () => setFehler('inhalt'))
      .finally(() => setLaeuft(null));
  };
  return (
    <Paneel titel="Dieses Gerät">
      <SchalterZeile
        zeile={zeile}
        feldId="benachrichtigung-push"
        name={PUSH_SCHALTER}
        fehler={fehler === 'push'}
        marke={blockiert ? 'Vom Browser blockiert' : undefined}
        an={zustand === 'an'}
        laeuft={laeuft === 'push'}
        gesperrt={laeuft != null || blockiert}
        setze={setzePush}
      />
      {zustand === 'an' && (
        <SchalterZeile
          zeile={zeile}
          feldId="benachrichtigung-push-inhalt"
          name={PUSH_INHALT_SCHALTER}
          fehler={fehler === 'inhalt'}
          an={inhalt}
          laeuft={laeuft === 'inhalt'}
          gesperrt={laeuft != null}
          setze={setzeInhalt}
        />
      )}
    </Paneel>
  );
}

/** Titel und Text der Testbenachrichtigung (LLH-1284): kurz, ohne Bedienerklärung. */
export const TEST_TITEL = 'Testbenachrichtigung';
export const TEST_TEXT = 'Lifeline Hub';

/**
 * Ausgang der Testbenachrichtigung. Die Wörter ohne „gesendet“ sind die der Kopfleiste
 * (`einsatz/AlarmZentrale.tsx`, `DESKTOP_WORT`): „aus“ heißt, die Abfrage der Erlaubnis blieb
 * ohne Antwort.
 */
type TestZustand = 'gesendet' | 'aus' | 'blockiert' | 'nicht-verfuegbar';

export const TEST_WORT: Record<TestZustand, string> = {
  gesendet: 'gesendet',
  aus: 'aus',
  blockiert: 'blockiert',
  'nicht-verfuegbar': 'nicht verfügbar',
};

/**
 * Knopf „Testbenachrichtigung“ (LLH-1284): zeigt eine Meldung des Systems auch bei sichtbarem
 * Fenster und spielt den Hinweiston (Stummschaltung wie überall). Ohne Entscheidung fragt der
 * Klick erst die Erlaubnis an (Bediengeste). Daneben steht nur das Zustandswort; was es bedeutet,
 * steht in der Anwenderdoku.
 */
function Testbenachrichtigung({ zeile }: { zeile: CSSProperties }) {
  const [zustand, setZustand] = useState<TestZustand | null>(null);

  const senden = () => {
    if (!showTestMeldung(TEST_TITEL, TEST_TEXT)) {
      setZustand('nicht-verfuegbar');
      return;
    }
    spieleAlarmTon('dezent');
    setZustand('gesendet');
  };

  const ausloesen = () => {
    const permission = desktopPermission();
    if (permission === 'default') {
      fordereDesktopPermission((neu) => {
        if (neu === 'granted') senden();
        else setZustand(neu === 'denied' ? 'blockiert' : 'aus');
      });
      return;
    }
    if (permission === 'denied') setZustand('blockiert');
    else if (permission === 'unsupported') setZustand('nicht-verfuegbar');
    else senden();
  };

  return (
    <PaneelZeile>
      <div style={zeile}>
        <Button onClick={ausloesen}>{TEST_TITEL}</Button>
        <Typography.Text
          role="status"
          type={zustand === 'blockiert' ? 'warning' : 'secondary'}
          data-zustand={zustand ?? undefined}
        >
          {zustand ? TEST_WORT[zustand] : null}
        </Typography.Text>
      </div>
    </PaneelZeile>
  );
}

/**
 * Benachrichtigungen des angemeldeten Nutzers (design.md D6), erreichbar über das Benutzermenü.
 * Je Hinweis-Art ein Schalter mit kurzem Namen; die Alarm-Arten stehen mit „immer an“ ohne
 * Schalter; darunter die Testbenachrichtigung. Was die Arten bedeuten und wann sie kommen, steht
 * in der Anwenderdoku (`docs/anwender/kapitel/einsatz-oberflaeche.md`), nicht hier.
 */
export default function BenachrichtigungenPage() {
  const { token } = theme.useToken();
  const e = useBenachrichtigungsEinstellungen();
  const zeile: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: token.margin,
    minHeight: token.controlHeight,
  };

  return (
    <AdminPage titel="Benachrichtigungen" breite="schmal">
      <div style={{ display: 'flex', flexDirection: 'column', gap: token.margin }}>
        <PushSchalter zeile={zeile} />
        <Paneel titel="Alarme">
          {ALARM_ARTEN.map((art) => (
            <PaneelZeile key={art}>
              <div style={zeile} data-art={art}>
                <span>{BENACHRICHTIGUNG_ARTEN[art].name}</span>
                <Typography.Text type="secondary">{IMMER_AN}</Typography.Text>
              </div>
            </PaneelZeile>
          ))}
        </Paneel>
        <Paneel titel="Hinweise">
          <PaneelZustand
            zustand={e.fehler ? 'fehler' : e.geladen ? 'daten' : 'laden'}
            titel="Hinweise"
            leerText=""
            onNeuladen={e.neuLaden}
          >
            {HINWEIS_ARTEN.map((art) => {
              const name = BENACHRICHTIGUNG_ARTEN[art].name;
              const feldId = `benachrichtigung-${art}`;
              const fehler = e.fehlgeschlagen === art;
              return (
                <PaneelZeile
                  key={art}
                  style={
                    fehler ? { borderInlineStart: `3px solid ${token.colorError}` } : undefined
                  }
                >
                  <div style={zeile} data-art={art} data-fehler={fehler ? 'true' : undefined}>
                    <label htmlFor={feldId} style={{ cursor: 'pointer', minWidth: 0 }}>
                      {name}
                      {fehler && (
                        <Typography.Text
                          type="danger"
                          style={{ display: 'block', fontSize: token.fontSizeSM }}
                        >
                          nicht gespeichert
                        </Typography.Text>
                      )}
                    </label>
                    <Switch
                      id={feldId}
                      aria-label={name}
                      checked={e.istAn(art)}
                      loading={e.laeuft === art}
                      disabled={e.laeuft === art}
                      onChange={(an) => e.setze(art, an)}
                    />
                  </div>
                </PaneelZeile>
              );
            })}
          </PaneelZustand>
        </Paneel>
        <Paneel titel="Test">
          <Testbenachrichtigung zeile={zeile} />
        </Paneel>
      </div>
    </AdminPage>
  );
}
