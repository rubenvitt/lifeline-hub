import { Alert } from 'antd';
import { useId } from 'react';
import { Segmentleiste } from '../components/instrument';
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
 * Datenkontext der Einstellungs-Sektionen (LFH-345 · C10, H15/M15; seit LFH-606 auch „Pegel").
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
 * Erklärt die fehlende Berechtigung auf den Sektionen mit Einsatz-Schreibrecht gleich (M16).
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
  const panelId = useId();

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
      // Reine Formularseite: ausdrücklich die schmale Lesebreite, unabhängig von der Vorgabe
      // des Primitivs (die für Arbeitsflächen breit wird).
      breite="schmal"
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
      {/* Die Reiter als Segmentleiste im Tablist-Modus (Neuentwurf: Radius 0, Fugenraster
          statt antds Unterstrich-Reitern). Die aktive Sektion kommt weiter aus der URL; ein
          Wechsel — Klick oder Pfeiltaste — navigiert auf die Sektions-Route. Das EINE
          Reiterfeld darunter trägt den `<Outlet>`: nur das aktive Feld ist gebaut, und ein
          leeres Feld je inaktivem Reiter wäre für Hilfsmittel eine Beschriftung ohne
          Gegenstand. */}
      <Segmentleiste
        rolle="tablist"
        beschriftung="Einstellungsbereiche"
        wert={aktiv}
        onWechsel={(key) => navigate(einsatzEinstellungenPfad(einsatzId, key))}
        optionen={EINSTELLUNGEN_SEKTIONEN.map((s) => ({
          wert: s.key,
          label: s.label,
          steuert: panelId,
        }))}
        style={{ marginBottom: 16 }}
      />
      <div
        role="tabpanel"
        id={panelId}
        aria-label={EINSTELLUNGEN_SEKTIONEN.find((s) => s.key === aktiv)?.label}
      >
        <Outlet />
      </div>
    </EinsatzSeite>
  );
}
