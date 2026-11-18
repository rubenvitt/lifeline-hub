import { startTransition, useEffect, useState, type ReactNode } from 'react';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenSkeleton } from '../components/SeitenZustand';
import { modulName, type ModulEintrag } from './modulRegistry';

/**
 * Modulwechsel zeigt sofort Kopf und Gerippe (LLH-1838, Spec `seiten-zustaende`, Regel:
 * `frontend/AGENTS.md`, „Rahmen“, „Modulwechsel“). Herleitung:
 * `openspec/changes/q71gt8zq-modulwechsel-gerippe/design.md` (D1, D2).
 *
 * Der Router zeichnet jede Navigation in `startTransition`; React hält dabei das alte Bild, bis
 * die neue Seite fertig ist. Diese Hülle um das `<Outlet />` des Einsatzrahmens merkt sich, für
 * welches Modul die Seite freigegeben ist. Weicht das Modul der Route ab, steht zuerst die billige
 * Gerippe-Seite da (der Übergang des Routers schließt sofort ab), danach gibt ein eigener
 * Übergang die echte Seite frei, die React im Hintergrund zeichnet und gegen das Gerippe tauscht.
 *
 * Schlüssel ist das Modul, nicht der Pfad: Detailseiten, Unterrouten und Suchparameter desselben
 * Moduls laufen unverändert durch. Der Startwert ist das aktuelle Modul, also zeigt ein direkter
 * Aufruf oder ein Neuladen kein Gerippe vorab.
 */
export default function ModulWechselGerippe({
  modul,
  children,
}: {
  modul: ModulEintrag | null;
  children: ReactNode;
}) {
  const key = modul?.key ?? null;
  const [freigegeben, setFreigegeben] = useState(key);
  const wechselt = key !== null && key !== freigegeben;

  useEffect(() => {
    if (key === freigegeben) return;
    startTransition(() => setFreigegeben(key));
  }, [key, freigegeben]);

  return wechselt ? <ModulGerippeSeite modulKey={key} /> : children;
}

/**
 * Die Gerippe-Seite eines Moduls: derselbe Seitenkopf wie die echte Seite, mit dem Modulnamen als
 * `h1`, darunter das verzögerte Gerippe (D2). Meta, Aktionen und Ortspfad kommen erst mit der
 * Seite (D4). Auch Suspense-Fallback der nachgeladenen Module (Lagekarte, Kräfteübersicht, D3).
 */
export function ModulGerippeSeite({ modulKey }: { modulKey: string }) {
  return (
    <div data-testid="modul-gerippe">
      <EinsatzSeite titel={modulName(modulKey)}>
        <SeitenSkeleton verzoegert />
      </EinsatzSeite>
    </div>
  );
}
