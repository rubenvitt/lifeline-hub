import { Breadcrumb } from 'antd';
import { startTransition, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenSkeleton } from '../components/SeitenZustand';
import { useEinsatzRahmen } from './EinsatzRahmenKontext';
import { modulName, type ModulEintrag } from './modulRegistry';

/**
 * Modulwechsel zeigt sofort Kopf und Gerippe (LLH-1838, Spec `seiten-zustaende`, Regel:
 * `frontend/AGENTS.md`, „Rahmen“, „Modulwechsel“). Herleitung:
 * `openspec/changes/archive/2026-11-18-q71gt8zq-modulwechsel-gerippe/design.md` (D1, D2).
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
 * `h1` und im Einsatzrahmen dem Ortspfad der Modulseiten („Einsätze › Einsatz › Modul“, den
 * Einsatz kennt der Rahmen schon), damit der Titel beim Ablösen nicht springt. Darunter das
 * verzögerte Gerippe (D2). Meta und Aktionen kommen erst mit der Seite (D4). Auch
 * Suspense-Fallback der nachgeladenen Module (Lagekarte, Kräfteübersicht, D3).
 */
export function ModulGerippeSeite({ modulKey }: { modulKey: string }) {
  const einsatz = useEinsatzRahmen();
  const name = modulName(modulKey);
  return (
    <div data-testid="modul-gerippe">
      <EinsatzSeite
        titel={name}
        breadcrumb={
          einsatz && (
            <Breadcrumb
              items={[
                { title: <Link to="/einsaetze">Einsätze</Link> },
                { title: einsatz.bezeichnung },
                { title: name },
              ]}
            />
          )
        }
      >
        <SeitenSkeleton verzoegert />
      </EinsatzSeite>
    </div>
  );
}
