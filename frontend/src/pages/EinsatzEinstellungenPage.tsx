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
 * Datenkontext der Einstellungs-Sektionen.
 *
 * **Bewusst ein Hook, kein `useOutletContext`.** Jede Sektion stellt ihre Queries selbst und hat
 * ihren eigenen Lade-/Fehler-Riegel. Das schließt eine Falle: `Form initialValues` wird genau
 * einmal beim Mount gelesen. Eine Sektion, die ohne Daten montiert, zeigt ein leeres Formular, und
 * der nächste Klick auf Speichern schickt einen Vollersatz-PUT aus lauter `null`. TanStack führt
 * gleiche Query-Keys zusammen, der doppelte Aufruf kostet keinen zweiten Request.
 */
interface EinstellungenDaten {
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
 * Erklärt die fehlende Berechtigung auf allen Sektionen mit Einsatz-Schreibrecht gleich. Ausgegraut
 * allein nennt keinen Grund; der Text steht einmal, damit er nicht auseinanderläuft.
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
 * Sektions-Layout der Einsatz-Einstellungen: drei Formular-Sektionen, die sich einen
 * Vollersatz-Merge teilen (`einstellungen/einsatzEinstellungenForm.ts`), und die Modulliste als
 * eigene Sektion — sie speichert je Zeile sofort und gehört nicht unter einen Speichern-Knopf.
 *
 * **Der Kopf-Aktionen-Slot bleibt leer.** Die Speichern-Leiste liegt sticky am unteren Rand der
 * Sektion und damit im `<form>`; nur so sendet Enter ab (ein Knopf im Kopf-Slot liegt außerhalb des
 * `<form>`).
 *
 * Die aktive Sektion kommt aus der URL, nicht aus eigenem State (Muster `AdminLayout`) — ein
 * zweiter Zustand ginge bei jedem Deeplink auseinander.
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
      // Reine Formularseite: ausdrücklich die schmale Lesebreite.
      breite="schmal"
      beschreibung={`Einsatzbezogene Einstellungen für „${daten.einsatz.bezeichnung}". Gelten nur für diesen Einsatz.`}
      hinweis={
        !daten.istAktiv && (
          <Alert
            type="info"
            showIcon
            title="Einsatz abgeschlossen — Einstellungen sind eingefroren und können nicht mehr geändert werden, außer der Aufbewahrungsfrist."
          />
        )
      }
    >
      {/* Die Reiter als Segmentleiste im Tablist-Modus. Die aktive Sektion kommt aus der URL;
          ein Wechsel (Klick oder Pfeiltaste) navigiert auf die Sektions-Route. Das eine
          Reiterfeld darunter trägt den `<Outlet>`: ein leeres Feld je inaktivem Reiter wäre für
          Hilfsmittel eine Beschriftung ohne Gegenstand. */}
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
