/// Haptik auf Wunsch der Seite (`__LIFELINE_HUELLE__.haptics(kind)`, Spec `huellen-vertrag`,
/// Entwurf D6). Reine Abbildung; die App spielt die Rückmeldung mit UIKit ab und tut auf dem
/// iPad nichts.
public enum Haptik {
    /// Was die App abspielt: `success`/`warning`/`error` → `UINotificationFeedbackGenerator`,
    /// `selection` → `UISelectionFeedbackGenerator`, `lightImpact` →
    /// `UIImpactFeedbackGenerator(style: .light)`.
    public enum Feedback: CaseIterable, Equatable, Sendable {
        case success
        case warning
        case error
        case selection
        case lightImpact
    }

    /// `kind` kommt ungeprüft aus der Seite. Eine unbekannte Art und der ausgeschaltete Schalter
    /// „Haptik“ ergeben nichts, nie einen Fehler.
    public static func feedback(kind: String, isEnabled: Bool) -> Feedback? {
        guard isEnabled else { return nil }
        switch kind {
        case "success": return .success
        case "warning": return .warning
        case "error": return .error
        case "selection": return .selection
        case "tap": return .lightImpact
        default: return nil
        }
    }
}
