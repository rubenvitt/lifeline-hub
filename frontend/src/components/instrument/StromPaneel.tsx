import { useRef, type CSSProperties, type ReactNode } from 'react';
import DashboardPaneel, { type DashboardPaneelBasis } from './DashboardPaneel';
import Sammelbanner, { sammelbannerKurz } from './Sammelbanner';
import { schriftStil } from './rollenwerte';

/**
 * StromPaneel — jüngste Einträge eines Zeitstroms, Neues per Sammelbanner statt Einschieben
 * (Regel „Dashboard-Baukasten“, `frontend/AGENTS.md`; Vorbild „Jüngste ETB-Einträge“ im Lagebild,
 * LLH-1140). Abnehmer: ETB-Einträge im Lagebild, Entscheidungen im Überblick.
 *
 * Die Kinder sind die `<li>` der Liste, meist `Zeitachseneintrag als="li"` (Mono, Typfarbe).
 * Der Aufrufer hält die Wassermarke: `neu` zählt, was über ihr liegt, `onAnzeigen` zieht sie
 * nach. Live-Updates springen nicht unter dem Cursor (Layout und Live, CLS ≤ 0,1).
 *
 * DER BANNER STEHT IM PANEELKOPF (LLH-1934), in der Kurzform „↓ 2 neu“: der ganze Hinweis ist ein
 * Knopf, der volle Satz (`bannerText`) steht für Hilfstechnik im Statusbereich (wie auf dem
 * Handschirm, LFH-694). Vorher lag er als Überlagerung über der Liste (LFH-900; im Fluss machte er
 * das Paneel höher und das Band darunter rutschte) und verdeckte die halbe jüngste Zeile. Im Kopf
 * steht schon der Sprung „… ↗“ in Knopfhöhe, der Hinweis macht ihn also nicht höher und verdeckt
 * nichts. Er steht an der Stelle des Metas: der Aufrufer lässt sein Meta weichen, wenn es neben
 * dem Hinweis nichts sagt, und reserviert mit `bannerBreite` dieselbe Breite wie für das Meta,
 * damit der Kopf mit Hinweis genauso umbricht wie ohne.
 *
 * Nach „anzeigen“ geht der Fokus auf die Liste (der Knopf verschwindet mit dem Banner; WCAG 2.4.3).
 */
export default function StromPaneel({
  neu,
  bannerText,
  bannerBreite,
  onAnzeigen,
  listeName,
  children,
  ...basis
}: DashboardPaneelBasis & {
  /** Einträge über der Wassermarke; 0 = kein Banner. */
  neu: number;
  bannerText: string;
  /** Mindestbreite des Banners im Kopf, in der Schrift des Metas (siehe Dateikopf). */
  bannerBreite?: CSSProperties['minWidth'];
  onAnzeigen: () => void;
  /** Zugänglicher Name der Liste („Jüngste Einträge“). */
  listeName: string;
  children: ReactNode;
}) {
  const listeRef = useRef<HTMLOListElement>(null);
  return (
    <DashboardPaneel
      {...basis}
      kopfHinweis={
        neu > 0 ? (
          <span
            style={{
              ...schriftStil('meta'),
              display: 'inline-flex',
              justifyContent: 'flex-end',
              minWidth: bannerBreite,
            }}
          >
            <Sammelbanner
              kurz={sammelbannerKurz(neu, false)}
              aktion={{
                label: 'anzeigen',
                onKlick: () => {
                  listeRef.current?.focus({ preventScroll: true });
                  onAnzeigen();
                },
              }}
            >
              {bannerText}
            </Sammelbanner>
          </span>
        ) : undefined
      }
    >
      <ol
        ref={listeRef}
        tabIndex={-1}
        aria-label={listeName}
        style={{ listStyle: 'none', margin: 0, padding: 0 }}
      >
        {children}
      </ol>
    </DashboardPaneel>
  );
}
