import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Alert, Breadcrumb, Button, Typography } from 'antd';
import { ApiError } from '../api/client';
import { ladeEinsatz, ladeModulFreigaben } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenFehler, SeitenSackgasse, SeitenSkeleton } from '../components/SeitenZustand';
import Druckkopf from '../components/druck/Druckkopf';
import DruckKnopf from '../components/druck/DruckKnopf';
import Auswahlleiste from '../druck/einsatzbericht/Auswahlleiste';
import Bloecke from '../druck/einsatzbericht/Bloecke';
import { auswahlSchluessel, umfangZeilen } from '../druck/einsatzbericht/auswahl';
import { useBerichtAuswahl } from '../druck/einsatzbericht/useBerichtAuswahl';
import { berichtZustand, ladeEinsatzbericht } from '../druck/einsatzbericht/abruf';
import { berichtFreigabe } from '../druck/einsatzbericht/quellen';
import { verdichteEinsatzbericht } from '../druck/einsatzbericht/verdichtung';
import { einsatzdatenPfad } from '../routing/deeplinks';

/**
 * Druckansicht des Einsatzberichts (LFH-726, `openspec/changes/archive/2026-10-01-lfh-726-einsatzbericht/`): der
 * ganze Einsatz auf wenigen Seiten für Nachbereitung und Behörde, über den Druckdialog des
 * Browsers.
 *
 * Vollständig oder gar nicht: die Freigabe-Weiche (`druck/einsatzbericht/quellen.ts`) entscheidet
 * VOR dem Abruf. Ein für die Rolle gesperrtes Modul führt in die Sackgasse mit den fehlenden
 * Modulen; ein im Einsatz ausgeblendetes Modul erscheint als „nicht genutzt“. Danach zählt der
 * Zustand des Abrufs: ein 403 heißt kein Zugriff (auch nach Ablauf der Aufbewahrungsfrist), ein
 * Fehler sperrt das Drucken bis zum gelungenen neuen Versuch.
 *
 * Schnappschuss wie der ETB-Druck: `einsatzKeys.einsatzberichtDruck` ist nicht live, „Neu laden“
 * holt einen neuen Stand. Route unter den Einsatzdaten (nie ausgeblendet, nie gesperrt).
 *
 * Blöcke wählbar (LFH-902,
 * `openspec/changes/archive/2026-10-05-lfh-902-einsatzbericht-bloecke-auswaehlen/design.md`):
 * die Auswahl steht in `?bloecke=`, Weiche und Abruf gelten nur für die gewählten Blöcke, der
 * Druckkopf nennt den Umfang. Die Auswahlleiste bleibt auch in der Sackgasse stehen — dort ist das
 * Abwählen des gesperrten Blocks der Ausweg.
 */
export default function EinsatzberichtDruckPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const { konventionen } = useAnzeigeKonventionen();
  const [auswahl, setzeAuswahl] = useBerichtAuswahl();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  // Die Freigaben rechnet der Server je Benutzer aus (LFH-669: Override, Rolle, Org-Vorgabe).
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const freigabe = useMemo(
    () => (freigabenQuery.data ? berichtFreigabe(freigabenQuery.data, auswahl) : null),
    [freigabenQuery.data, auswahl],
  );
  const gesperrt = freigabe != null && freigabe.gesperrteModule.length > 0;

  const berichtQuery = useQuery({
    queryKey: einsatzKeys.einsatzberichtDruck(einsatzId, auswahlSchluessel(auswahl)),
    queryFn: () => ladeEinsatzbericht(einsatzId, freigabe!.je),
    enabled: freigabe != null && !gesperrt,
    // Ein Druckbeleg ist ein Schnappschuss (wie `EtbDruckPage`): kein stilles Nachladen, beim
    // Öffnen aber der Stand von jetzt, und ein gescheiterter Abruf wird nicht still wiederholt.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: 'always',
    retry: false,
    // Je Auswahl ein eigener Key (LFH-902): ohne `gcTime: 0` zeigte die Rückkehr zu einer früheren
    // Auswahl deren alten Schnappschuss, denn `staleTime: Infinity` lädt beim Key-Wechsel nicht.
    gcTime: 0,
  });

  const zustand = berichtQuery.data ? berichtZustand(berichtQuery.data) : null;
  const bericht = useMemo(
    () =>
      berichtQuery.data && zustand?.art === 'bereit'
        ? verdichteEinsatzbericht(berichtQuery.data, konventionen, auswahl)
        : null,
    [berichtQuery.data, zustand?.art, konventionen, auswahl],
  );

  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  // Nach Ablauf der Aufbewahrungsfrist sperrt der Server schon den Einsatzkopf
  // (`src/einsatz/berechtigung.rs`, `darf_lesen`): ein 403 hier ist endgültig, ein neuer Versuch
  // änderte nichts (Spec `einsatzbericht`, „Aufbewahrungsfrist abgelaufen“).
  if (einsatzQuery.error instanceof ApiError && einsatzQuery.error.status === 403) {
    return (
      <SeitenSackgasse
        titel="Einsatzbericht nicht verfügbar"
        hinweis="Der Einsatz ist nicht lesbar: kein Zugriff, oder die Aufbewahrungsfrist ist abgelaufen. Der Einsatzbericht kann nicht erzeugt werden."
        rueckweg={{ pfad: '/einsaetze', label: 'Zur Einsatzliste' }}
      />
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const zurueck = einsatzdatenPfad(einsatzId);
  const keinZugriff = gesperrt || zustand?.art === 'kein-zugriff';
  const laedt = !berichtQuery.data || berichtQuery.isFetching;
  // Kopf und Blöcke aus DEMSELBEN Schnappschuss: ein umbenannter Einsatz stünde sonst im Kopf
  // anders als in den Stammdaten.
  const einsatzStand =
    berichtQuery.data?.quellen.einsatz.zustand === 'daten'
      ? berichtQuery.data.quellen.einsatz.daten
      : einsatz;

  let inhalt;
  if (freigabenQuery.isError) {
    inhalt = (
      <SeitenFehler
        text="Freigaben des Einsatzes nicht ermittelbar — der Bericht bleibt verborgen"
        ursache={freigabenQuery.error}
        onWiederholen={() => void freigabenQuery.refetch()}
      />
    );
  } else if (!freigabe) {
    inhalt = <SeitenSkeleton />;
  } else if (gesperrt) {
    inhalt = (
      <SeitenSackgasse
        titel="Einsatzbericht nicht verfügbar"
        hinweis={`Für den Einsatzbericht fehlen Rechte an: ${freigabe.gesperrteModule.join(', ')}. Blöcke, die daraus schöpfen, lassen sich oben abwählen.`}
        rueckweg={{ pfad: zurueck, label: 'Zu den Einsatzdaten' }}
      />
    );
  } else if (berichtQuery.isError) {
    // `ladeEinsatzbericht` fängt jede Quelle selbst; hierher führt nur ein Programmfehler.
    inhalt = (
      <SeitenFehler
        text="Der Einsatzbericht konnte nicht erzeugt werden"
        ursache={berichtQuery.error}
        onWiederholen={() => void berichtQuery.refetch()}
      />
    );
  } else if (laedt) {
    inhalt = (
      <Typography.Text role="status" aria-live="polite">
        Einsatzbericht wird geladen …
      </Typography.Text>
    );
  } else if (zustand?.art === 'kein-zugriff') {
    // Ein 403 trotz Freigabe: eine Rechteänderung nach dem Laden der Freigaben oder eine eben
    // abgelaufene Frist (Org-Vorgaben stehen seit LFH-669 schon in den Freigaben).
    inhalt = (
      <Alert
        type="info"
        showIcon
        title="Kein Zugriff auf den Einsatzbericht"
        description={`Der Server verweigert den Zugriff auf: ${zustand.module.join(', ')}. Ohne diese Teile wird nicht gedruckt.`}
      />
    );
  } else if (zustand?.art === 'fehler') {
    inhalt = (
      <Alert
        type="error"
        showIcon
        title="Der Einsatzbericht konnte nicht vollständig geladen werden"
        description={`Nicht geladen: ${zustand.module.join(', ')}. Drucken bleibt gesperrt, bis alles da ist — ein Teilausdruck ist ausgeschlossen.`}
        action={<Button onClick={() => void berichtQuery.refetch()}>Erneut laden</Button>}
      />
    );
  } else if (bericht) {
    inhalt = (
      <div data-lfh="druckwurzel">
        <Druckkopf
          dokumentart="Einsatzbericht"
          einsatz={einsatzStand}
          sichtbarkeit="immer"
          // Am Bildschirm steht darüber der Seitenkopf mit dem `h1`.
          ebene={2}
          zeilen={[
            ...umfangZeilen(auswahl),
            { etikett: 'Stand', wert: bericht.stand },
            ...(bericht.vorlaeufig
              ? [{ etikett: 'Status', wert: 'Vorläufig – Einsatz läuft' }]
              : []),
          ]}
        />
        <Bloecke bericht={bericht} />
      </div>
    );
  }

  return (
    <EinsatzSeite
      titel="Einsatzbericht – Druckansicht"
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: <Link to={zurueck}>Einsatzdaten</Link> },
            { title: 'Einsatzbericht' },
          ]}
        />
      }
      aktionen={
        <>
          <Button
            href={zurueck}
            onClick={(e) => {
              // Ein Link mit Knopfgestalt: Strg/⌘+Klick öffnet den neuen Tab wie jeder Link.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              navigate(zurueck);
            }}
          >
            Zurück zu den Einsatzdaten
          </Button>
          {freigabe && !keinZugriff && (
            <Button onClick={() => void berichtQuery.refetch()} disabled={berichtQuery.isFetching}>
              Neu laden
            </Button>
          )}
          {freigabe && !keinZugriff && (
            <DruckKnopf typ="primary" gesperrt={laedt || zustand?.art !== 'bereit'} />
          )}
        </>
      }
    >
      <Auswahlleiste auswahl={auswahl} onAendern={setzeAuswahl} />
      {inhalt}
    </EinsatzSeite>
  );
}
