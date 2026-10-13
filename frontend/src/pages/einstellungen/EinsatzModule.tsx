import { App, Button, Typography, theme } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { Formularpaneel } from '../../components/instrument';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { SeitenHinweise } from '../../components/SpeicherHinweis';
import ModulEinstellungsListe from './ModulEinstellungsListe';
import { quittiereModulGespeichert } from './modulQuittung';
import { ladeModulFreigaben, ladeModulOverrides, setzeModulOverride } from '../../api/einsaetze';
import { ladeOrgModulEinstellungen } from '../../api/orgEinstellungen';
import { orgVorgabe } from '../../components/vorgabeText';
import { rollenName } from './optionen';
import { EINSATZ_ABGESCHLOSSEN, NUR_LEITUNG_ORG_ADMIN } from '../../components/nurAnsicht';
import { einsatzKeys, globalKeys } from '../../api/queryKeys';
import { useAuth } from '../../auth/AuthContext';
import { darfModuleVerwalten } from '../../einsatz/schreibrecht';
import { useEinstellungenDaten } from '../EinsatzEinstellungenPage';
import { istModulAusblendbar, modulName } from '../../einsatz/modulRegistry';
import type { ModulOverrideUpdate, OrgModulEinstellungen } from '../../api/types';

/** Org-Rollen-Hinweis im Modul-Override („Vorgabe der Organisation: Führung im Einsatz“, LFH-944);
 *  der Name kommt aus der Auswahl, damit er nur einmal steht (LFH-1150). */
function orgRollenHinweis(rolle: string | null | undefined): string | undefined {
  const name = rollenName(rolle);
  return name === undefined ? undefined : orgVorgabe(name);
}

/** Herkunft einer geerbten Ausblendung (LLH-1179), im Wortlaut des Rollen-Hinweises (LFH-944). */
const ORG_AUSGEBLENDET = orgVorgabe('ausgeblendet');

/**
 * Grund des `RechteHinweis`: Modul-Overrides verwalten Einsatzleitung und System-Admin der
 * Einsatz-Org (LFH-995), nicht Führungspersonal — anders als die Formular-Sektionen.
 */
const RECHTE_TEXT = NUR_LEITUNG_ORG_ADMIN;

/**
 * Sektion `…/einstellungen/module` — Modul-Sichtbarkeit und Rollen-Schranke je Modul.
 *
 * Sichtbarkeit (LLH-1179, design.md D4 der Change `ivtkmf43-org-modul-sichtbarkeit`): der Schalter
 * zeigt den wirksamen Wert — eigener Wert des Einsatzes, sonst die Freigabe des Servers (dort ist
 * die Org-Vorgabe schon aufgelöst, auch für eine Einsatzleitung, die die Vorgaben nicht lesen
 * darf), sonst die Org-Vorgabe, sonst sichtbar. Umlegen setzt einen eigenen Wert; „Vorgabe
 * übernehmen“ nimmt ihn zurück (`sichtbar: null`). Ein Rollenwechsel schickt den eigenen Wert mit,
 * nie den wirksamen — sonst würde eine geerbte Ausblendung nebenbei festgeschrieben.
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
  const { token } = theme.useToken();
  const daten = useEinstellungenDaten(einsatzId);

  const overridesQuery = useQuery({
    queryKey: einsatzKeys.modulOverrides(einsatzId),
    queryFn: () => ladeModulOverrides(einsatzId),
  });
  // Org-Modul-Vorgaben (optional, nicht-blockierend; ohne Org-Rolle 403).
  const orgModulQuery = useQuery({
    queryKey: globalKeys.orgModulEinstellungen(),
    queryFn: () => ladeOrgModulEinstellungen(),
  });
  // Dieselben Freigaben wie die Navigation: der wirksame Sichtbarkeitswert, vom Server aufgelöst.
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
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

  const freigaben = freigabenQuery.data;
  /** Eigener Wert des Einsatzes; `null` = erbt. */
  const eigenerWert = (modulKey: string): boolean | null => overrides[modulKey]?.sichtbar ?? null;
  /** Wirksame Sichtbarkeit einer Modul-Zeile (Rangfolge im Kopfkommentar). */
  const sichtbarVon = (modulKey: string) =>
    eigenerWert(modulKey) ??
    freigaben?.[modulKey]?.sichtbar ??
    orgModulDefaults[modulKey]?.sichtbar ??
    true;
  /**
   * Blendet die Organisation aus? Aus der Vorgabe, oder — ohne Leserecht darauf — aus der Freigabe:
   * ohne eigenen Wert kann nur die Organisation ausgeblendet haben.
   */
  const orgBlendetAus = (modulKey: string) =>
    orgModulDefaults[modulKey]?.sichtbar === false ||
    (eigenerWert(modulKey) === null && freigaben?.[modulKey]?.sichtbar === false);
  /** Bestandsrolle der Zeile, für die Vollersatz-PUTs. */
  const bestandsRolle = (modulKey: string) =>
    (overrides[modulKey]?.benoetigte_rolle ?? null) as ModulOverrideUpdate['benoetigte_rolle'];
  const laeuftKey = overrideMutation.isPending ? overrideMutation.variables.modulKey : null;

  function zusatzVon(modulKey: string) {
    if (!istModulAusblendbar(modulKey)) return undefined;
    const hinweis = orgBlendetAus(modulKey);
    const eigen = eigenerWert(modulKey) !== null;
    if (!hinweis && !eigen) return undefined;
    return (
      <>
        {hinweis && (
          <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {ORG_AUSGEBLENDET}
          </Typography.Text>
        )}
        {eigen && (
          <Button
            type="link"
            style={{ paddingInline: 0 }}
            // Zeilenkennung im Namen, wie „Sichtbar: …“ am Schalter.
            aria-label={`Vorgabe übernehmen: ${modulName(modulKey)}`}
            disabled={!darfVerwalten || laeuftKey === modulKey}
            onClick={() =>
              overrideMutation.mutate({
                modulKey,
                update: { sichtbar: null, benoetigte_rolle: bestandsRolle(modulKey) },
              })
            }
          >
            Vorgabe übernehmen
          </Button>
        )}
      </>
    );
  }

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
                // Die Sichtbarkeit muss mitfahren (der PUT ist Vollersatz) — der EIGENE Wert, nicht
                // der wirksame: eine geerbte Ausblendung bleibt geerbt.
                sichtbar: eigenerWert(modulKey),
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
                  benoetigte_rolle: bestandsRolle(modulKey),
                },
              }),
          }}
          darfVerwalten={darfVerwalten}
          // Zwei Ursachen, zwei Wörter: ein abgeschlossener Einsatz sperrt auch die Einsatzleitung,
          // ein Rollenwort widerspräche dann dem Seitenkopf.
          rechteGrund={daten.istAktiv ? NUR_LEITUNG_ORG_ADMIN : EINSATZ_ABGESCHLOSSEN}
          // Nur die schreibende Zeile ist gesperrt, nur die gescheiterte markiert.
          laeuftKey={laeuftKey}
          fehlerKey={overrideMutation.isError ? overrideMutation.variables.modulKey : null}
          hinweisVon={(key) => orgRollenHinweis(orgModulDefaults[key]?.benoetigte_rolle)}
          zusatzVon={zusatzVon}
        />
      </Formularpaneel>
    </>
  );
}
