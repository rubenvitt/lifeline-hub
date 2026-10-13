import { Breadcrumb, theme } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ladeEinsatz, ladeModulFreigaben } from '../api/einsaetze';
import { ladeModulZaehler } from '../api/modulZaehler';
import { ladeMedienkontaktKennzahlen } from '../api/presse';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import { ladeStab } from '../api/stab';
import type { Sachgebiet } from '../api/types';
import EinsatzSeite from '../components/EinsatzSeite';
import { RechteHinweis } from '../components/SpeicherHinweis';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import { useViewport } from '../components/useViewport';
import { modulName } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import LagebesprechungZeile from '../lagebesprechung/LagebesprechungZeile';
import BesetzungModal from '../stab/BesetzungModal';
import ChecklistePaneel from '../stab/ChecklistePaneel';
import { besetzungRechteText, zeileFuer } from '../stab/besetzung';
import { mitWirksamemLabel } from '../stab/sachgebiete';
import SachgebietKachel from '../stab/SachgebietKachel';
import { stabRasterStil, stabSpalten } from '../stab/stabRaster';
import { useFunkplanLuecken } from '../stab/useFunkplanLuecken';
import type { WerkzeugZahlQuellen } from '../stab/werkzeugZahlen';
import { ladeFuehrungsfunktionen } from '../api/fuehrungsfunktionen';

/**
 * Modul „Stab" (LFH-46): Übersicht der Stabsfunktionen S1–S6 (LLH-1124,
 * `openspec/changes/o5nxgqbl-stab-uebersicht/design.md`).
 *
 * Oben die Zeile „Nächste Lagebesprechung“ mit Sprung in das eigene Modul (LLH-1111,
 * `lagebesprechung/LagebesprechungZeile.tsx`). Darunter ein Raster aus sechs Kacheln
 * (`stab/SachgebietKachel.tsx`, eine Spalte am Handy, zwei ab `md`, drei ab `xl`): Besetzung,
 * „Besetzung ändern“, Aufgaben mit Fundstelle und die Werkzeuge des Sachgebiets, je mit einer Zahl
 * aus ihrer Heimat (`stab/werkzeugZahlen.ts`). Den Besetzungsstand trägt der Seitenkopf.
 *
 * Die Zahlenquellen lädt die Seite je einmal: den Modulzähler (dieselbe Abfrage wie das
 * Modulmenü), die Kennzahlen des Presse-Logs und die Lückenzahl des Funkplans
 * (`stab/useFunkplanLuecken.ts`, nur mit Freigabe des Fernmeldewesens). Alle drei folgen live
 * ihren Ereignissen.
 *
 * Das Paneel „Arbeitsaufnahme" (LFH-551) steht unter dem Raster und klappt ein, wenn beim Öffnen
 * alles erledigt ist (D6). Eigene Abfrage, eigener Endpunkt.
 *
 * Live: das `stab`-Ereignis invalidiert `einsatz-stab` samt Checkliste; den Termin der Zeile frischt
 * `einsatz` mit dem Kopf auf (LFH-555).
 */
export default function StabPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { token } = theme.useToken();
  const { abBreite } = useViewport();
  const [offenFuer, setOffenFuer] = useState<Sachgebiet | null>(null);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const stabQuery = useQuery({
    queryKey: einsatzKeys.stab(einsatzId),
    queryFn: () => ladeStab(einsatzId),
  });
  // Modul-Freigaben vom Server (LFH-669): entscheiden, welches Werkzeug fehlt, gesperrt steht oder
  // springt, und sperren den Sprung in die Lagebesprechung.
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  // Wirksame Mandantenlabels der Kacheln (LFH-549); ohne Katalog das Standardlabel.
  const katalogQuery = useQuery({
    queryKey: globalKeys.fuehrungsfunktionen(),
    queryFn: ladeFuehrungsfunktionen,
    staleTime: 5 * 60_000,
  });
  // Die Quellen der Zahlen je Werkzeug (D4): eine Heimat je Zahl, hier nur gelesen.
  const zaehlerQuery = useQuery({
    queryKey: einsatzKeys.modulZaehler(einsatzId),
    queryFn: () => ladeModulZaehler(einsatzId),
  });
  const presseQuery = useQuery({
    queryKey: einsatzKeys.medienkontaktKennzahlen(einsatzId),
    queryFn: () => ladeMedienkontaktKennzahlen(einsatzId),
  });
  const funkplan = useFunkplanLuecken(einsatzId);
  const zahlQuellen: WerkzeugZahlQuellen = {
    zaehler: zaehlerQuery,
    presse: presseQuery,
    funkplan,
  };

  const darfSchreiben = darfImEinsatzSchreiben(einsatzQuery.data);

  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;

  // Fehler ≠ leer: ohne Daten tritt der Fehler an die Stelle des Rasters — sechs „nicht vergeben"
  // wären sonst eine Aussage über eine Menge, die nie ankam.
  const stabGescheitert = stabQuery.isError && !stabQuery.data;
  const standVeraltet = stabQuery.isError && stabQuery.data != null;
  const sachgebiete = mitWirksamemLabel(katalogQuery.data ?? []);
  const offenerEintrag = sachgebiete.find((s) => s.sachgebiet === offenFuer);
  const besetzt = sachgebiete.filter((s) => zeileFuer(stabQuery.data, s.sachgebiet)).length;

  return (
    <EinsatzSeite
      dataUpdatedAt={stabQuery.dataUpdatedAt}
      titel={modulName('stab')}
      meta={stabQuery.data ? `${besetzt}/${sachgebiete.length} besetzt` : undefined}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('stab') },
          ]}
        />
      }
      // Bedingt übergeben, nicht über `sichtbar` allein: `EinsatzSeite` rendert den Slot, sobald er
      // truthy ist — ein JSX-Element ist das immer, auch wenn es `null` zurückgibt, und hinterließe
      // ein leeres `div` mit Außenabstand.
      hinweis={
        !darfSchreiben && <RechteHinweis sichtbar text={besetzungRechteText(einsatz.status)} />
      }
    >
      <LagebesprechungZeile
        einsatzId={einsatzId}
        termin={einsatz.naechste_lagebesprechung_at}
        freigaben={freigabenQuery.data}
      />

      {stabGescheitert ? (
        <SeitenFehler
          text="Führungsorganisation konnte nicht geladen werden"
          ursache={stabQuery.error}
          onWiederholen={() => void stabQuery.refetch()}
        />
      ) : (
        <>
          {standVeraltet && <SeitenStandVeraltet onWiederholen={() => void stabQuery.refetch()} />}
          <div style={stabRasterStil(stabSpalten(abBreite), token.margin)}>
            {sachgebiete.map((s) => (
              <SachgebietKachel
                key={s.sachgebiet}
                einsatzId={einsatzId}
                eintrag={s}
                zeile={zeileFuer(stabQuery.data, s.sachgebiet)}
                hatBesetzung={stabQuery.data != null}
                darfSchreiben={darfSchreiben}
                freigaben={freigabenQuery.data}
                zahlQuellen={zahlQuellen}
                onBesetzungAendern={() => setOffenFuer(s.sachgebiet)}
              />
            ))}
          </div>
        </>
      )}

      <ChecklistePaneel
        einsatzId={einsatzId}
        darfSchreiben={darfSchreiben}
        style={{ marginTop: token.margin }}
      />
      {offenerEintrag && darfSchreiben && (
        <BesetzungModal
          key={offenerEintrag.sachgebiet}
          einsatzId={einsatzId}
          eintrag={offenerEintrag}
          zeile={zeileFuer(stabQuery.data, offenerEintrag.sachgebiet)}
          onSchliessen={() => setOffenFuer(null)}
        />
      )}
    </EinsatzSeite>
  );
}
