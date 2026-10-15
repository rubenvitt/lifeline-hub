import { Switch, Typography, theme } from 'antd';
import type { CSSProperties } from 'react';
import AdminPage from '../components/AdminPage';
import { Paneel, PaneelZeile, PaneelZustand } from '../components/instrument';
import { ALLE_ARTEN, BENACHRICHTIGUNG_ARTEN } from '../alarm/benachrichtigungKatalog';
import { useBenachrichtigungsEinstellungen } from '../alarm/useBenachrichtigungsEinstellungen';

const ALARM_ARTEN = ALLE_ARTEN.filter((a) => BENACHRICHTIGUNG_ARTEN[a].stufe === 'alarm');
const HINWEIS_ARTEN = ALLE_ARTEN.filter(
  (a) => BENACHRICHTIGUNG_ARTEN[a].stufe === 'hinweis' && BENACHRICHTIGUNG_ARTEN[a].einstellbar,
);

/** Zustandswort der Alarm-Arten; sie lassen sich nicht abschalten (Spec, design.md D6). */
export const IMMER_AN = 'immer an';

/**
 * Benachrichtigungen des angemeldeten Nutzers (design.md D6), erreichbar über das Benutzermenü.
 * Je Hinweis-Art ein Schalter mit kurzem Namen; die Alarm-Arten stehen mit „immer an“ ohne
 * Schalter. Was die Arten bedeuten und wann sie kommen, steht in der Anwenderdoku
 * (`docs/anwender/kapitel/einsatz-oberflaeche.md`), nicht hier.
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
      </div>
    </AdminPage>
  );
}
