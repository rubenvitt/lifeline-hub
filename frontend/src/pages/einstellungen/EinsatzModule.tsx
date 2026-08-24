import { App } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import SektionHeader from '../../components/SektionHeader';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { SeitenHinweise } from '../../components/SpeicherHinweis';
import ModulEinstellungsListe from './ModulEinstellungsListe';
import { ladeModulOverrides, setzeModulOverride } from '../../api/einsaetze';
import { ladeOrgModulEinstellungen } from '../../api/orgEinstellungen';
import { einsatzKeys, globalKeys } from '../../api/queryKeys';
import { useAuth } from '../../auth/AuthContext';
import { darfEinsatzLeiten } from '../../einsatz/schreibrecht';
import { useEinstellungenDaten } from '../EinsatzEinstellungenPage';
import type { ModulOverrideUpdate, OrgModulEinstellungen } from '../../api/types';

/** Org-Rollen-Hinweis im Modul-Override (z. B. „Org: Führungskraft"). */
function orgRollenHinweis(
  rolle: 'admin' | 'fuehrungskraft' | null | undefined,
): string | undefined {
  if (rolle == null) return undefined;
  if (rolle === 'fuehrungskraft') return 'Org: Führungskraft';
  if (rolle === 'admin') return 'Org: Admin';
  return undefined;
}

/**
 * Sektion `…/einstellungen/module` (LFH-345 · C10, Befund H15) — Modul-Sichtbarkeit und
 * Rollen-Schranke je Modul.
 *
 * **Sie hat als einzige Sektion keine Speicher-Leiste**, und das ist der Befund selbst: die
 * Liste speichert je Zeile SOFORT und stand bis dahin unter einem Speichern-Knopf, der sie
 * gar nicht betraf — zweierlei Bedienlogik unter einer Überschrift, von außen nicht zu
 * unterscheiden. Dieselbe Trennung hat LFH-339/M26 an der Einheiten-Detailseite gezogen.
 *
 * **Die Rechte-Achse ist eine ANDERE als in den drei Formular-Sektionen** (`darfEinsatzLeiten`
 * statt `darfImEinsatzSchreiben`): Modul-Overrides darf nur die Einsatzleitung oder ein
 * System-Admin verwalten — das deckt das Backend-Gate `einsatzleitung|admin`. Führungspersonal
 * darf die Einstellungen ändern, die Modulsichtbarkeit aber nicht; beim Aufteilen der Seite
 * dürfen die beiden Achsen nicht verschmelzen.
 */
export default function EinsatzModule() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const daten = useEinstellungenDaten(einsatzId);

  const overridesQuery = useQuery({
    queryKey: einsatzKeys.modulOverrides(einsatzId),
    queryFn: () => ladeModulOverrides(einsatzId),
  });
  // Org-Modul-Rollen-Defaults (optional, nicht-blockierend).
  const orgModulQuery = useQuery({
    queryKey: globalKeys.orgModulEinstellungen(),
    queryFn: () => ladeOrgModulEinstellungen(),
  });

  // KEIN `onError`-Toast (H14): eine gescheiterte Zeile bleibt als Alert stehen, zusätzlich
  // markiert `fehlerKey` genau die betroffene Zeile.
  const overrideMutation = useMutation({
    mutationFn: (vars: { modulKey: string; update: ModulOverrideUpdate }) =>
      setzeModulOverride(einsatzId, vars.modulKey, vars.update),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.modulOverrides(einsatzId) });
      message.success('Modul-Einstellung gespeichert');
    },
  });

  if (daten.laedt || overridesQuery.isLoading) return <SeitenSkeleton />;
  /**
   * Ein gescheiterter Override-Abruf darf NICHT in die Liste fallen (gefunden im Review zu
   * C10, im Bestand seit je so). Das `?? {}` unten liest sich sonst als „alle Module
   * sichtbar, keine Rollenschranke" — und der nächste Schalterklick schickt genau diesen
   * erfundenen Zustand als Bestandswert in einen Vollersatz-PUT. Eine gepflegte
   * Rollenschranke wäre damit weg, ohne dass irgendwo ein Fehler steht: dieselbe stumme
   * Fehlerklasse, gegen die dieses ganze Ticket antritt.
   */
  if (overridesQuery.isError) {
    return (
      <SeitenFehler
        text="Modul-Einstellungen nicht ladbar — ohne den Bestand kann hier nichts geändert werden"
        onWiederholen={() => void overridesQuery.refetch()}
      />
    );
  }

  const overrides = overridesQuery.data ?? {};
  const orgModulDefaults: OrgModulEinstellungen = orgModulQuery.data ?? {};
  const darfModuleVerwalten = darfEinsatzLeiten(daten.einsatz, benutzer);

  /** Sichtbarkeit einer Modul-Zeile aus dem Override-Bestand (Default: sichtbar). */
  const sichtbarVon = (modulKey: string) => overrides[modulKey]?.sichtbar ?? true;

  return (
    <>
      <SeitenHinweise
        fehler={overrideMutation.error}
        rechteFehlt={daten.istAktiv && !darfModuleVerwalten}
        rechteText="Nur die Einsatzleitung oder ein System-Admin darf die Modul-Sichtbarkeit dieses Einsatzes ändern — die Werte stehen hier zum Nachlesen."
      />
      <SektionHeader
        titel="Modul-Sichtbarkeit & Berechtigungen"
        beschreibung="Module für diesen Einsatz ausblenden oder auf eine Rolle beschränken. Einsatzdaten und Einstellungen lassen sich nicht ausblenden. Änderungen werden sofort gespeichert."
      />
      <ModulEinstellungsListe
        rollenSpalte="Benötigte Rolle"
        rolleVon={(key) => overrides[key]?.benoetigte_rolle ?? ''}
        aufRolle={(modulKey, val) =>
          overrideMutation.mutate({
            modulKey,
            update: {
              // Die Sichtbarkeit MUSS mitfahren: der PUT ist Vollersatz — ohne den
              // Bestandswert nullt eine reine Rollen-Änderung das Ausblenden.
              sichtbar: sichtbarVon(modulKey),
              benoetigte_rolle: (val || null) as ModulOverrideUpdate['benoetigte_rolle'],
            },
          })
        }
        sichtbarSpalte={{
          titel: 'Sichtbar',
          sichtbarVon,
          aufSichtbar: (modulKey, checked) =>
            overrideMutation.mutate({
              modulKey,
              update: {
                sichtbar: checked,
                // LFH-120: Backend typisiert benoetigte_rolle als freien Option<String>
                // (generiert `string | null`); FE verengt auf die gültigen Rollen-Codes.
                benoetigte_rolle: (overrides[modulKey]?.benoetigte_rolle ??
                  null) as ModulOverrideUpdate['benoetigte_rolle'],
              },
            }),
        }}
        darfVerwalten={darfModuleVerwalten}
        // Nur die schreibende Zeile ist gesperrt (H15), nur die gescheiterte markiert (H14).
        laeuftKey={overrideMutation.isPending ? overrideMutation.variables.modulKey : null}
        fehlerKey={overrideMutation.isError ? overrideMutation.variables.modulKey : null}
        hinweisVon={(key) => orgRollenHinweis(orgModulDefaults[key])}
      />
    </>
  );
}
