import { Alert, App, Spin, Switch, Tooltip } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { providerListeAdmin, providerSchalten } from '../../api/auth';
import { ApiError } from '../../api/client';
import AdminPage from '../../components/AdminPage';
import { useAuth } from '../../auth/AuthContext';
import { globalKeys } from '../../api/queryKeys';

/**
 * Admin-Sektion `/admin/einstellungen/anmeldung` — Auth-Provider an-/abschalten (LFH-280).
 * Kein Form/Speichern-Button: jede Umschaltung speichert sofort (`providerSchalten`). Der
 * Passwort-Provider bleibt garantiert nicht-deaktivierbar (letzter Admin-Login-Weg). Edit nur
 * system_rolle=admin; Führungskräfte sehen read-only.
 */
export default function Anmeldeverfahren() {
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
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
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Umschalten fehlgeschlagen'),
  });

  const provider = providerQuery.data ?? [];

  return (
    <AdminPage
      titel="Anmeldeverfahren"
      beschreibung="Verfügbare Login-Wege an- und abschalten. Nur beim Serverstart konfigurierte Verfahren erscheinen hier. Änderungen werden sofort gespeichert."
    >
      {providerQuery.isLoading ? (
        <Spin />
      ) : providerQuery.isError ? (
        <Alert type="error" title="Anmeldeverfahren nicht ladbar" showIcon />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
          {provider.map((p) => {
            const istPasswort = p.id === 'passwort';
            const schalter = (
              <Switch
                aria-label={`Anmeldeverfahren: ${p.anzeigename}`}
                checked={p.aktiviert}
                disabled={!istAdmin || istPasswort || schaltenMutation.isPending}
                onChange={(aktiviert) => schaltenMutation.mutate({ id: p.id, aktiviert })}
              />
            );
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ flex: 1 }}>{p.anzeigename}</span>
                {istPasswort ? (
                  <Tooltip title="Garantierter Admin-Login-Weg — nicht deaktivierbar">
                    <span>{schalter}</span>
                  </Tooltip>
                ) : (
                  schalter
                )}
              </div>
            );
          })}
        </div>
      )}
    </AdminPage>
  );
}
