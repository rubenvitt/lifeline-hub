import { App, Breadcrumb, Button } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { abrufZustand } from '../api/abrufZustand';
import { ladeEinsatz, ladeModulFreigaben } from '../api/einsaetze';
import { fetchLagebesprechungStand } from '../api/lagebesprechung';
import { einsatzKeys } from '../api/queryKeys';
import EinsatzSeite from '../components/EinsatzSeite';
import { Paneel } from '../components/instrument';
import { einsatzRechteGrund } from '../components/nurAnsicht';
import { RechteHinweis } from '../components/SpeicherHinweis';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import { modulName } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import LagebesprechungHistorie from '../lagebesprechung/LagebesprechungHistorie';
import LagebesprechungModal from '../lagebesprechung/LagebesprechungModal';
import TerminPaneel from '../lagebesprechung/TerminPaneel';
import VorbereitungPaneel from '../lagebesprechung/VorbereitungPaneel';
import { zeigeAbschlussToast } from '../lagebesprechung/abschlussToast';

/**
 * Modul „Lagebesprechung“ (LLH-1111): Termin, Vorbereitung, Abschluss und Verlauf an einem Ort,
 * mit eigener Freigabe und unabhängig vom Stab (Spec `lagebesprechung`, design.md D7).
 *
 * Drei Paneele: „Termin“ (nächster Termin groß mit Zustand, Schnellwahl), „Vorbereitung“ (LFH-550,
 * derselbe Lagestand wie im Dashboard) und „Verlauf“ (alle Besprechungen, neueste zuerst).
 *
 * Der Kopf trägt genau eine Primäraktion „Lagebesprechung abschließen“. Sie öffnet ein Modal;
 * ohne Schreibrecht steht sie gesperrt da, und `neueZeile` der Kommandopalette trägt denselben
 * Riegel.
 *
 * Live: das Ereignis `lagebesprechung` invalidiert Stand und Verlauf, `einsatz` den Stand mit dem
 * Kopf (eine Terminwahrheit, LFH-555).
 */
export default function LagebesprechungPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [abschlussOffen, setAbschlussOffen] = useState(false);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const standQuery = useQuery({
    queryKey: einsatzKeys.lagebesprechung(einsatzId),
    queryFn: () => fetchLagebesprechungStand(einsatzId),
  });
  // Modul-Freigaben vom Server (LFH-669): Rechteweiche der Vorbereitung und ihre Übernahme.
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });

  // Vor den frühen Returns (Hook-Reihenfolge): der `?neu=1`-Leser darunter braucht das Recht, bevor
  // der Einsatz sicher geladen ist. `darfImEinsatzSchreiben` liefert für `undefined` false.
  const darfSchreiben = darfImEinsatzSchreiben(einsatzQuery.data);
  const standDa = standQuery.data != null;
  // Ohne Stand fehlte der bestehende Termin zur Vorbelegung — ein unverändertes Absenden schickte
  // `naechste_at: null` und löschte ihn.
  const abschlussErlaubt = darfSchreiben && standDa;
  const oeffneAbschluss = useCallback(() => setAbschlussOffen(true), []);

  // Fällt das Recht (oder der Stand) bei offener Maske weg, hängt der Render sie aus — der Merker
  // bliebe aber stehen, und kämen die Rechte zurück, stünde die Maske ungefragt wieder auf.
  useEffect(() => {
    if (abschlussOffen && !abschlussErlaubt) setAbschlussOffen(false);
  }, [abschlussOffen, abschlussErlaubt]);

  // Schnellaktion: ?neu=1 öffnet den Abschluss (Kommandopalette). Das Literal
  // `searchParams.get('neu')` muss in dieser Datei stehen: `schnellaktionen.guard.test.ts` ordnet
  // den Leser über den Dateinamen dem Modul zu. Warten, bis Einsatz und Stand geladen sind;
  // Parameter immer räumen (apply-then-clean), die Maske nur mit Schreibrecht und Stand öffnen.
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading || standQuery.isLoading) return;
    if (darfSchreiben && standDa) setAbschlussOffen(true);
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [
    searchParams,
    setSearchParams,
    einsatzQuery.isLoading,
    standQuery.isLoading,
    darfSchreiben,
    standDa,
  ]);

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
  const standGescheitert = standQuery.isError && !standQuery.data;
  const anzahl = standQuery.data?.anzahl_lagebesprechungen;

  return (
    <EinsatzSeite
      dataUpdatedAt={standQuery.dataUpdatedAt}
      titel={modulName('lagebesprechung')}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('lagebesprechung') },
          ]}
        />
      }
      // Gesperrt statt versteckt: der Hinweis darunter nennt den Grund.
      aktionen={
        <Button type="primary" disabled={!abschlussErlaubt} onClick={oeffneAbschluss}>
          Lagebesprechung abschließen
        </Button>
      }
      // Derselbe Riegel wie am Knopf — die Palette ist ein zweiter Weg auf dieselbe Aktion.
      neueZeile={abschlussErlaubt ? oeffneAbschluss : undefined}
      hinweis={
        !darfSchreiben && <RechteHinweis sichtbar text={einsatzRechteGrund(einsatz.status)} />
      }
    >
      {standGescheitert ? (
        <SeitenFehler
          text="Stand der Lagebesprechung konnte nicht geladen werden"
          ursache={standQuery.error}
          onWiederholen={() => void standQuery.refetch()}
        />
      ) : (
        <TerminPaneel
          einsatzId={einsatzId}
          stand={standQuery.data}
          zustand={standQuery.isLoading ? 'laden' : standQuery.isError ? 'fehler' : 'daten'}
          darfSchreiben={darfSchreiben}
        />
      )}

      <VorbereitungPaneel
        einsatzId={einsatzId}
        einsatz={einsatz}
        freigaben={freigabenQuery.data}
        besprechung={standQuery.data}
        besprechungZustand={abrufZustand(standQuery)}
        besprechungStand={standQuery.dataUpdatedAt}
      />

      <Paneel
        titel="Verlauf"
        meta={anzahl != null ? `${anzahl} abgeschlossen` : undefined}
        koerperPolster
      >
        <LagebesprechungHistorie einsatzId={einsatzId} />
      </Paneel>

      {/* Montiert = offen: die Maske friert Vorbelegung und Basis beim Montieren ein, und jede
          Öffnung hat eine frische Mutation ohne alten Fehler. Der Toast nimmt das `navigate`
          dieser Seite — `<AntApp>` liegt außerhalb des Routers. */}
      {abschlussOffen && darfSchreiben && standQuery.data && (
        <LagebesprechungModal
          einsatzId={einsatzId}
          stand={standQuery.data}
          onAbgeschlossen={(eigene) =>
            zeigeAbschlussToast(message, { einsatzId, eigene, navigate })
          }
          onSchliessen={() => setAbschlussOffen(false)}
        />
      )}
    </EinsatzSeite>
  );
}
