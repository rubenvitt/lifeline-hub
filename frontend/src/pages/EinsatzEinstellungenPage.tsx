import { Alert, Tabs } from 'antd';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import { ladeEinsatz, ladeEinstellungen } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import { useAuth } from '../auth/AuthContext';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import {
  EINSTELLUNGEN_SEKTIONEN,
  einsatzEinstellungenPfad,
  type EinstellungenSektion,
} from '../routing/deeplinks';
import type { EinsatzEinstellungen } from '../api/types';

/**
 * Datenkontext der vier Einstellungs-Sektionen (LFH-345 · C10, H15/M15).
 *
 * **Bewusst ein Hook, kein `useOutletContext`.** Jede Sektion stellt ihre Queries selbst und
 * hat ihren eigenen Lade-/Fehler-Riegel; sie ist damit ohne dieses Layout montierbar — was
 * nicht nur die Tests trägt, sondern eine echte Falle schließt: `Form initialValues` wird
 * genau einmal beim Mount gelesen. Eine Sektion, die ohne Daten montiert, zeigt ein leeres
 * Formular, und der nächste Klick auf Speichern schickt einen Vollersatz-PUT aus lauter
 * `null` — der Datensatz wäre weg, ohne Fehlermeldung. Ein Kontext vom Elternteil verschöbe
 * diese Frage nur nach oben. TanStack führt die gleichen Query-Keys ohnehin zusammen, der
 * doppelte Aufruf kostet also keinen zweiten Request.
 */
export interface EinstellungenDaten {
  laedt: boolean;
  einsatz?: Awaited<ReturnType<typeof ladeEinsatz>>;
  einstellungen?: EinsatzEinstellungen;
  /** Einsatz läuft noch — abgeschlossene Einsätze sind eingefroren. */
  istAktiv: boolean;
  /** Allgemeines Einsatz-Schreibrecht (schließt „aktiv" bereits ein). */
  darfBearbeiten: boolean;
  neuLaden: () => void;
}

export function useEinstellungenDaten(einsatzId: number): EinstellungenDaten {
  const { benutzer } = useAuth();
  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const einstellungenQuery = useQuery({
    queryKey: einsatzKeys.einstellungen(einsatzId),
    queryFn: () => ladeEinstellungen(einsatzId),
  });
  return {
    laedt: einsatzQuery.isLoading || einstellungenQuery.isLoading,
    einsatz: einsatzQuery.data,
    einstellungen: einstellungenQuery.data,
    istAktiv: einsatzQuery.data?.status === 'aktiv',
    darfBearbeiten: darfImEinsatzSchreiben(einsatzQuery.data, benutzer),
    neuLaden: () => {
      void einsatzQuery.refetch();
      void einstellungenQuery.refetch();
    },
  };
}

/**
 * Erklärt die fehlende Berechtigung auf allen vier Sektionen gleich (M16).
 *
 * Ausgegraut allein ist eine Ein-Kanal-Aussage und nennt keinen Grund; der Text steht hier
 * statt viermal daneben, damit er nicht auseinanderläuft.
 */
export const RECHTE_TEXT =
  'Nur die Einsatzleitung, Führungspersonal oder ein System-Admin darf die Einstellungen dieses Einsatzes ändern — die Werte stehen hier zum Nachlesen.';

/** Aktive Sektion aus dem Pfad: `/einsaetze/1/einstellungen/verhalten` → `verhalten`. */
function sektionAus(pathname: string): EinstellungenSektion {
  // Kein `.at(-1)`: `tsconfig.lib` steht auf ES2020, die Methode bricht dort den Typecheck.
  const teile = pathname.split('/').filter(Boolean);
  const letztes = teile[teile.length - 1];
  const treffer = EINSTELLUNGEN_SEKTIONEN.find((s) => s.key === letztes);
  return treffer?.key ?? EINSTELLUNGEN_SEKTIONEN[0].key;
}

/**
 * Sektions-Layout der Einsatz-Einstellungen (LFH-345 · C10, Befunde H15/M15).
 *
 * Die Seite trug bis dahin fünfzehn Formularfelder UND die Modul-Sichtbarkeitsliste in einem
 * Zug, mit einem Speichern-Knopf im Kopf, der die Liste gar nicht betraf (die speichert je
 * Zeile sofort). Zerlegt in vier Reiter: drei Formular-Sektionen, die sich einen
 * **Vollersatz-Merge** teilen (`einstellungen/einsatzEinstellungenForm.ts`), und die Liste
 * als eigene Sektion — sie hat kein Speichern und gehört deshalb nicht unter einen
 * Speichern-Knopf.
 *
 * **Der Kopf-Aktionen-Slot bleibt leer.** Die Speichern-Leiste liegt sticky am unteren Rand
 * der jeweiligen Sektion und damit IM `<form>`; nur so sendet Enter ab (Erfassungs-Norm
 * B4/LFH-332 — ein Knopf im Kopf-Slot ist ein DOM-Geschwister außerhalb des `<form>` und
 * kann nichts übermitteln). „Genau eine Primäraktion im Kopf" (LFH-340 · C5) ist damit
 * trivial erfüllt statt verletzt.
 *
 * Die aktive Sektion kommt aus der URL, nicht aus eigenem State — dasselbe Muster wie
 * `AdminLayout` (LFH-284). Ein zweiter Zustand neben dem Pfad ginge bei jedem Deeplink
 * auseinander.
 */
export default function EinsatzEinstellungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const daten = useEinstellungenDaten(einsatzId);
  const aktiv = sektionAus(pathname);

  if (daten.laedt) return <SeitenSkeleton />;
  if (!daten.einsatz) {
    return (
      <SeitenFehler
        text="Einstellungen nicht ladbar oder kein Zugriff"
        onWiederholen={daten.neuLaden}
      />
    );
  }

  return (
    <EinsatzSeite
      titel="Einstellungen"
      beschreibung={`Einsatzbezogene Einstellungen für „${daten.einsatz.bezeichnung}". Gelten nur für diesen Einsatz.`}
      hinweis={
        !daten.istAktiv && (
          <Alert
            type="info"
            showIcon
            title="Einsatz abgeschlossen — Einstellungen sind eingefroren und können nicht mehr geändert werden."
          />
        )
      }
    >
      {/* Der `<Outlet>` haengt IM aktiven Reiterfeld, nicht als Geschwister daneben: antd
          rendert je Eintrag ein `role="tabpanel"`, und ein leeres Panel neben dem eigentlichen
          Inhalt waere fuer Hilfsmittel eine Beschriftung ohne Gegenstand. antd baut ohnehin nur
          das AKTIVE Feld auf, der Ausdruck laeuft also genau einmal. */}
      <Tabs
        activeKey={aktiv}
        onChange={(key) =>
          navigate(einsatzEinstellungenPfad(einsatzId, key as EinstellungenSektion))
        }
        items={EINSTELLUNGEN_SEKTIONEN.map((s) => ({
          key: s.key,
          label: s.label,
          children: s.key === aktiv ? <Outlet /> : null,
        }))}
      />
    </EinsatzSeite>
  );
}
