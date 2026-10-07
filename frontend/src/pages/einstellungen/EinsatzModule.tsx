import { App } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { Formularpaneel } from '../../components/instrument';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { SeitenHinweise } from '../../components/SpeicherHinweis';
import ModulEinstellungsListe from './ModulEinstellungsListe';
import { quittiereModulGespeichert } from './modulQuittung';
import { ladeModulOverrides, setzeModulOverride } from '../../api/einsaetze';
import { ladeOrgModulEinstellungen } from '../../api/orgEinstellungen';
import { orgVorgabe } from '../../components/vorgabeText';
import { EINSATZ_ABGESCHLOSSEN, NUR_LEITUNG_ORG_ADMIN } from '../../components/nurAnsicht';
import { einsatzKeys, globalKeys } from '../../api/queryKeys';
import { useAuth } from '../../auth/AuthContext';
import { darfModuleVerwalten } from '../../einsatz/schreibrecht';
import { useEinstellungenDaten } from '../EinsatzEinstellungenPage';
import type { ModulOverrideUpdate, OrgModulEinstellungen } from '../../api/types';

/** Org-Rollen-Hinweis im Modul-Override („Vorgabe der Organisation: Führungskraft“, LFH-944). */
function orgRollenHinweis(
  rolle: 'admin' | 'fuehrungskraft' | null | undefined,
): string | undefined {
  if (rolle == null) return undefined;
  if (rolle === 'fuehrungskraft') return orgVorgabe('Führungskraft');
  if (rolle === 'admin') return orgVorgabe('Admin');
  return undefined;
}

/**
 * Grund des `RechteHinweis`: Modul-Overrides verwalten Einsatzleitung und System-Admin der
 * Einsatz-Org (LFH-995), nicht Führungspersonal — anders als die Formular-Sektionen.
 */
const RECHTE_TEXT = NUR_LEITUNG_ORG_ADMIN;

/**
 * Sektion `…/einstellungen/module` — Modul-Sichtbarkeit und Rollen-Schranke je Modul.
 *
 * Keine Speicher-Leiste: die Liste speichert je Zeile sofort; ein Speichern-Knopf darüber beträfe
 * sie nicht.
 *
 * Andere Rechte-Achse als die Formular-Sektionen (`darfModuleVerwalten` statt
 * `darfImEinsatzSchreiben`): Modul-Overrides verwalten nur Einsatzleitung und System-Admin der
 * Einsatz-Org (Backend-Gate, LFH-995). Führungspersonal darf Einstellungen ändern, die
 * Modulsichtbarkeit nicht.
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

  // Kein `onError`-Toast: der Fehler bleibt als Alert stehen, `fehlerKey` markiert die Zeile.
  const overrideMutation = useMutation({
    mutationFn: (vars: { modulKey: string; update: ModulOverrideUpdate }) =>
      setzeModulOverride(einsatzId, vars.modulKey, vars.update),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.modulOverrides(einsatzId) });
      // Die Freigaben leiten sich aus den Overrides ab; die Navigation folgt ohne Neuladen (LFH-669).
      qc.invalidateQueries({ queryKey: einsatzKeys.modulFreigaben(einsatzId) });
      quittiereModulGespeichert(message, 'Modul-Einstellung gespeichert');
    },
  });

  if (daten.laedt || overridesQuery.isLoading) return <SeitenSkeleton />;
  /**
   * Ein gescheiterter Override-Abruf darf nicht in die Liste fallen: `?? {}` hieße sonst „alle
   * sichtbar, keine Rollenschranke", und der nächste Schalterklick schickte diesen erfundenen Stand
   * als Bestandswert in den Vollersatz-PUT — eine gepflegte Rollenschranke wäre still weg.
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
  const darfVerwalten = darfModuleVerwalten(daten.einsatz, benutzer);

  /** Sichtbarkeit einer Modul-Zeile aus dem Override-Bestand (Default: sichtbar). */
  const sichtbarVon = (modulKey: string) => overrides[modulKey]?.sichtbar ?? true;

  return (
    <>
      <SeitenHinweise
        fehler={overrideMutation.error}
        rechteFehlt={daten.istAktiv && !darfVerwalten}
        rechteText={RECHTE_TEXT}
      />
      <Formularpaneel titel="Modul-Sichtbarkeit & Berechtigungen">
        <ModulEinstellungsListe
          rollenSpalte="Benötigte Rolle"
          rolleVon={(key) => overrides[key]?.benoetigte_rolle ?? ''}
          aufRolle={(modulKey, val) =>
            overrideMutation.mutate({
              modulKey,
              update: {
                // Die Sichtbarkeit muss mitfahren: der PUT ist Vollersatz.
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
                  // Backend typisiert `benoetigte_rolle` als freien String; das FE verengt auf die
                  // Rollen-Codes.
                  benoetigte_rolle: (overrides[modulKey]?.benoetigte_rolle ??
                    null) as ModulOverrideUpdate['benoetigte_rolle'],
                },
              }),
          }}
          darfVerwalten={darfVerwalten}
          // Zwei Ursachen, zwei Wörter: ein abgeschlossener Einsatz sperrt auch die Einsatzleitung,
          // ein Rollenwort widerspräche dann dem Seitenkopf.
          rechteGrund={daten.istAktiv ? NUR_LEITUNG_ORG_ADMIN : EINSATZ_ABGESCHLOSSEN}
          // Nur die schreibende Zeile ist gesperrt, nur die gescheiterte markiert.
          laeuftKey={overrideMutation.isPending ? overrideMutation.variables.modulKey : null}
          fehlerKey={overrideMutation.isError ? overrideMutation.variables.modulKey : null}
          hinweisVon={(key) => orgRollenHinweis(orgModulDefaults[key])}
        />
      </Formularpaneel>
    </>
  );
}
