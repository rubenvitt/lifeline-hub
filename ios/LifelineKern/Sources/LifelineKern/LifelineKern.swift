/// Testbare Logik der iOS-Hülle ohne UIKit und WebKit (LLH-1978). Keine Fachlogik: die Hülle lädt
/// die Weboberfläche des Servers (ADR-0068, Entwurf `design.md` D1).
public enum LifelineKern {
    /// Die Hüllen-Verträge (`shell_contract` aus `GET /api/shell`), mit denen diese App arbeitet.
    /// Ein neuer Wert kommt erst hinzu, wenn die App den Bruch des Servers mitgeht.
    /// Vertrag 2 (LLH-1979): der Login-Pfad heißt `/api/auth/app-code/redeem`, nicht mehr `…/einloesen`.
    public static let bekannteVertraege: [Int] = [2]
}
