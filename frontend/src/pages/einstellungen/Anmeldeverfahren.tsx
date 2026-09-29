import type { CSSProperties } from 'react';
import { Alert, Spin, Switch, theme, Tooltip, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { providerListeAdmin, providerSchalten } from '../../api/auth';
import AdminPage from '../../components/AdminPage';
import { SeitenHinweise } from '../../components/SpeicherHinweis';
import { useAuth } from '../../auth/AuthContext';
import { globalKeys } from '../../api/queryKeys';
import { Paneel } from '../../components/instrument';

/**
 * Trefflächenboden für die Beschriftungszeile — rein und exportiert, damit die Zusicherung ohne
 * Render prüfbar ist. Zwei Angaben: `minHeight` aus `controlHeight` plus Polsterung, aus
 * aufgelösten Tokens. Bewusst lokal statt aus `pages/lagekarte/Sidebar.tsx` importiert.
 */
export function zeilenzielStil(token: {
  controlHeight: number;
  paddingSM: number;
  padding: number;
}): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    minHeight: token.controlHeight,
    padding: `${token.paddingSM}px ${token.padding}px`,
  };
}

/**
 * Admin-Sektion `/admin/einstellungen/anmeldung` — Auth-Provider an-/abschalten. Jede Umschaltung
 * speichert sofort. Der Passwort-Provider bleibt nicht deaktivierbar (letzter Admin-Login-Weg).
 * Bearbeiten nur für `system_rolle=admin`, Führungskräfte sehen read-only.
 *
 * Der Sperrgrund steht sichtbar als gedämpfter Kurztext, nicht nur im Tooltip: auf dem Tablet gibt
 * es kein Hover, und „ausgegraut" allein ist eine Ein-Kanal-Aussage (WCAG 1.4.1). An gesperrten
 * Zeilen entsteht kein `<label>`: den Klick auf ein `disabled` Steuerelement leitet der Browser
 * ohnehin nicht weiter — ohne Aktion keine Aufforderung.
 */
export default function Anmeldeverfahren() {
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { token } = theme.useToken();
  const istAdmin = benutzer?.system_rolle === 'admin';

  // Admin-Endpoint: liefert die volle Liste inkl. deaktivierter Provider — nur so gibt es Toggles
  // für sie.
  const providerQuery = useQuery({
    queryKey: globalKeys.authProvider(),
    queryFn: providerListeAdmin,
  });

  const schaltenMutation = useMutation({
    mutationFn: (vars: { id: string; aktiviert: boolean }) =>
      providerSchalten(vars.id, vars.aktiviert),
    onSuccess: (liste) => {
      // Server-Wahrheit (inkl. abgelehntem Zustand) direkt übernehmen.
      qc.setQueryData(globalKeys.authProvider(), liste);
    },
    // Kein `onError`-Toast: die Ablehnung steht als `<SpeicherFehler>` über der Liste, die Zeile
    // trägt eine Marke. Der Schalter springt von selbst zurück (die Anzeige liest aus dem Query,
    // kein optimistisches Update).
  });

  const provider = providerQuery.data ?? [];

  return (
    <AdminPage
      titel="Anmeldeverfahren"
      breite="schmal"
      beschreibung="Verfügbare Login-Wege an- und abschalten. Nur beim Serverstart konfigurierte Verfahren erscheinen hier. Änderungen werden sofort gespeichert."
      hinweis={
        <SeitenHinweise
          fehler={schaltenMutation.error}
          fehlerTitel="Nicht umgeschaltet"
          rechteFehlt={!istAdmin}
          rechteText="Nur Benutzer mit der Systemrolle „Admin“ dürfen Anmeldeverfahren umschalten — die Liste steht hier zum Nachlesen."
        />
      }
    >
      <Paneel
        titel="Login-Wege"
        meta={providerQuery.isSuccess ? provider.length : undefined}
        koerperPolster
      >
        {providerQuery.isLoading ? (
          <Spin />
        ) : providerQuery.isError ? (
          <Alert type="error" title="Anmeldeverfahren nicht ladbar" showIcon />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
            {provider.map((p) => {
              const istPasswort = p.id === 'passwort';
              // Die drei Sperrquellen getrennt: nur zwei sind dauerhaft und verdienen einen Text.
              // `isPending` ist vorübergehend — ein Grund, der nach 200 ms verschwindet, ist
              // Rauschen.
              const bedienbar = istAdmin && !istPasswort;
              const gesperrt = !bedienbar || schaltenMutation.isPending;
              const sperrGrund = !istAdmin
                ? 'nur Admins'
                : istPasswort
                  ? 'nicht deaktivierbar'
                  : null;
              const langGrund = !istAdmin
                ? 'Nur Benutzer mit der Systemrolle „Admin" dürfen Anmeldeverfahren umschalten'
                : 'Garantierter Admin-Login-Weg — nicht deaktivierbar';
              const feldId = `anmeldeverfahren-${p.id}`;
              // Nur die abgelehnte Zeile markieren; `variables` trägt die zuletzt gescheiterte
              // Zeile.
              const hatFehler = schaltenMutation.isError && schaltenMutation.variables?.id === p.id;
              return (
                <div
                  key={p.id}
                  data-provider-zeile={p.id}
                  data-fehler={hatFehler ? 'true' : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    borderInlineStart: hatFehler ? `3px solid ${token.colorError}` : undefined,
                  }}
                >
                  {/* Ein `<label htmlFor>` nur an der bedienbaren Zeile, sonst ein `<span>`. Das
                      `aria-label` am Switch bleibt und schlägt das Label — wer es als „doppelt"
                      entfernt, ändert still den Accessible Name. */}
                  {bedienbar ? (
                    <label
                      htmlFor={feldId}
                      style={{ ...zeilenzielStil(token), flex: 1, cursor: 'pointer' }}
                    >
                      {p.anzeigename}
                    </label>
                  ) : (
                    <span style={{ ...zeilenzielStil(token), flex: 1 }}>{p.anzeigename}</span>
                  )}
                  {sperrGrund && (
                    // Kurzwort sichtbar, lange Begründung im Tooltip — an einem nicht gesperrten
                    // Element, also ohne Wrapper.
                    <Tooltip title={langGrund}>
                      <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        {sperrGrund}
                      </Typography.Text>
                    </Tooltip>
                  )}
                  <Switch
                    id={feldId}
                    aria-label={`Anmeldeverfahren: ${p.anzeigename}`}
                    checked={p.aktiviert}
                    disabled={gesperrt}
                    onChange={(aktiviert) => schaltenMutation.mutate({ id: p.id, aktiviert })}
                  />
                </div>
              );
            })}
          </div>
        )}
      </Paneel>
    </AdminPage>
  );
}
