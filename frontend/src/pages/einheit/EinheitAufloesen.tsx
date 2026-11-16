import BeendenAbschnitt from '../../components/BeendenAbschnitt';

/**
 * „Einheit auflösen oder stornieren“ als letzter Abschnitt der Seite (LLH-1036, design.md D12),
 * über den geteilten Baustein `components/BeendenAbschnitt.tsx` (LLH-1722). Beide Wege sind
 * unumkehrbar: eine aufgelöste Einheit wird nicht reaktiviert (LLH-1079), eine stornierte ist
 * gelöscht.
 *
 * Stornieren (LLH-1881) nimmt eine Fehlanlage zurück und gelingt nur ohne jede Spur; ob eine
 * Einheit Spuren hat, weiß nur der Server. Der Knopf steht deshalb immer da wie bei Fahrzeug,
 * Personal und Material, und der Server nennt den Grund einer Ablehnung.
 *
 * Nur mit Schreibrecht und Freigabe Einheiten eingehängt; der Aufrufer entscheidet.
 */
export default function EinheitAufloesen({
  onAufloesen,
  onStornieren,
}: {
  /** Löst auf; lehnt bei Ablehnung ab. Nach Erfolg führt der Aufrufer zur Gliederung. */
  onAufloesen: () => Promise<unknown>;
  /** Storniert die Fehlanlage; lehnt bei Ablehnung ab. Nach Erfolg wie `onAufloesen`. */
  onStornieren: () => Promise<unknown>;
}) {
  return (
    <BeendenAbschnitt
      titel="Einheit auflösen oder stornieren"
      schritte={[
        {
          key: 'aufloesen',
          knopf: 'Einheit auflösen',
          frage: 'Einheit auflösen?',
          folge:
            'Mitglieder werden frei, Unter-Einheiten rücken eine Ebene hoch, gekoppelte Geräte enden.',
          fehlerTitel: 'Nicht aufgelöst',
          fehlerFallback: 'Auflösen fehlgeschlagen',
          ausfuehren: onAufloesen,
        },
        {
          key: 'stornieren',
          knopf: 'Einheit stornieren',
          frage: 'Einheit stornieren?',
          folge:
            'Unter-Einheiten rücken eine Ebene hoch, gekoppelte Geräte enden, die Einheit wird gelöscht.',
          fehlerTitel: 'Nicht storniert',
          fehlerFallback: 'Stornieren fehlgeschlagen',
          ausfuehren: onStornieren,
        },
      ]}
    />
  );
}
