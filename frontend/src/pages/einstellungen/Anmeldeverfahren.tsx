import type { CSSProperties } from 'react';
import { Alert, Spin, Switch, theme, Tooltip, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { providerListeAdmin, providerSchalten } from '../../api/auth';
import AdminPage from '../../components/AdminPage';
import { SeitenHinweise } from '../../components/SpeicherHinweis';
import { useAuth } from '../../auth/AuthContext';
import { globalKeys } from '../../api/queryKeys';

/**
 * Trefflächenboden für die Beschriftungszeile — REIN und exportiert, damit die Zusicherung
 * über die Dichtestufen ohne Render prüfbar ist (`test/utils.tsx:31` montiert ein nacktes
 * `ConfigProvider`, jsdom rechnet kein Layout).
 *
 * ZWEI Angaben, nicht eine (Konvention aus LFH-365): `minHeight` aus `controlHeight` PLUS
 * die Polsterung. Aufgelöste Tokens, nie `var(--lfh-*)`.
 *
 * Bewusst lokal statt aus `pages/lagekarte/Sidebar.tsx` importiert: Lagekarte →
 * Einstellungen wäre eine Fremdkopplung. `Datensicht`, `SlashMenu` und `Sidebar` halten
 * je eine eigene.
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
 * Admin-Sektion `/admin/einstellungen/anmeldung` — Auth-Provider an-/abschalten (LFH-280).
 * Kein Form/Speichern-Button: jede Umschaltung speichert sofort (`providerSchalten`). Der
 * Passwort-Provider bleibt garantiert nicht-deaktivierbar (letzter Admin-Login-Weg). Edit nur
 * system_rolle=admin; Führungskräfte sehen read-only.
 *
 * DER SPERRGRUND STEHT SICHTBAR (LFH-370 · B5j, Befund M17). Vorher hing er allein im
 * Tooltip eines Wrapper-`<span>` — auf dem Führungs-Tablet gibt es kein Hover, der Grund
 * war dort überhaupt nicht erreichbar. Und er deckte nur EINEN der drei Sperrfälle ab:
 * eine Führungskraft sah die komplette Liste ausgegraut, ohne jede Begründung. „Ausgegraut"
 * allein ist zudem eine Ein-Kanal-Aussage (Grau ist eine Farbe, WCAG 1.4.1).
 *
 * Gewählt ist damit die Familie „Grund zusätzlich als sichtbarer gedämpfter Kurztext"
 * (Präzedenz `pages/lagekarte/Sidebar.tsx:558-572`, `karten/OfflineRegionPicker.tsx:244-247`)
 * statt „Grund am Element, Klick tut nichts" (`ModulPanel.tsx:141-142`, `AppLayout.tsx:29-38`)
 * — die trägt den Grund an einer Stelle, die Touch nicht erreicht.
 *
 * Die Ticket-Frage „was tut ein Label-Klick am GESPERRTEN Switch?" ist damit nicht
 * beantwortet, sondern aufgelöst: an gesperrten Zeilen entsteht gar kein `<label>`. Ein
 * Label-Klick auf ein `disabled` Steuerelement leitet der Browser ohnehin nicht weiter
 * (gemessen: 0 Aufrufe) — er wäre still, und ein stiller Klick ist keine definierte
 * Reaktion. Dieselbe Regel wie beim Lesezweig in LFH-369: ohne Aktion keine Aufforderung.
 */
export default function Anmeldeverfahren() {
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { token } = theme.useToken();
  const istAdmin = benutzer?.system_rolle === 'admin';

  // Admin-Endpoint (LFH-277): liefert die VOLLE Liste inkl. deaktivierter Provider — nur so
  // kann diese Seite Toggles für deaktivierte Verfahren rendern.
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
    // KEIN `onError`-Toast mehr (LFH-345 · C10, H14): die Ablehnung hängt an
    // `mutation.error` und steht als `<SpeicherFehler>` über der Liste, die betroffene
    // Zeile trägt zusätzlich eine Marke. Der Schalter selbst springt ohnehin von selbst
    // zurück — die Anzeige liest aus dem Query, es gibt kein optimistisches Update.
  });

  const provider = providerQuery.data ?? [];

  return (
    <AdminPage
      titel="Anmeldeverfahren"
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
      {providerQuery.isLoading ? (
        <Spin />
      ) : providerQuery.isError ? (
        <Alert type="error" title="Anmeldeverfahren nicht ladbar" showIcon />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
          {provider.map((p) => {
            const istPasswort = p.id === 'passwort';
            // Die drei Sperrquellen getrennt statt vermischt: nur zwei davon sind dauerhaft
            // und verdienen einen Text. `isPending` ist vorübergehend und bekommt keinen —
            // ein Grund, der nach 200 ms wieder verschwindet, ist Rauschen.
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
            // Nur die abgelehnte Zeile wird markiert (H14). `variables` trägt die Zeile,
            // an der die Mutation zuletzt gescheitert ist.
            const hatFehler =
              schaltenMutation.isError && schaltenMutation.variables?.id === p.id;
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
                {/* Ein `<label htmlFor>` NUR an der bedienbaren Zeile — sonst ein `<span>`
                    ohne Zeigerform. Das `aria-label` am Switch bleibt und schlägt das Label
                    (gemessen), die Bestandsnamen ändern sich also nicht. Wer es später als
                    „doppelt" entfernt, bekommt STILL einen anderen Accessible Name. */}
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
                  // Kurzwort sichtbar, lange Begründung im Tooltip darüber — und der Tooltip
                  // hängt an einem NICHT gesperrten Element, braucht also keinen Wrapper.
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
    </AdminPage>
  );
}
