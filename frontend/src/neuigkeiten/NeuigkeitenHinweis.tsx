import { lazy, Suspense } from 'react';
import { istUngelesen, useVersionsstand } from './useVersionsstand';

// Die Karte trägt die Einträge der CHANGELOG; sie wird erst geladen, wenn es etwas Neues gibt,
// damit die Einsatzliste die Notizen nicht mitlädt (Spec `neuigkeiten`).
const HinweisKarte = lazy(() => import('./HinweisKarte'));

/**
 * Nicht modale Hinweiskarte auf der Einstiegsseite nach einem Versionswechsel (Spec
 * `neuigkeiten`). Sie unterbricht nichts und ist schließbar; Schließen markiert die laufende
 * Version als gelesen.
 */
export default function NeuigkeitenHinweis() {
  const { data: stand } = useVersionsstand();
  if (!istUngelesen(stand) || !stand) return null;
  return (
    <Suspense fallback={null}>
      <HinweisKarte stand={stand} />
    </Suspense>
  );
}
