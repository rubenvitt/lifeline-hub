/// Feste Texte der Seiten, die ohne Oberfläche feststehen; gleich wie `Anzeige` in
/// `android/helferkern`.
public enum Anzeige {
    /// Satz für eine abgewiesene Anfrage: `status` `0` ist ein Netzfehler, `grund` (`reason`) und
    /// `fehlertext` (`error`) stammen aus dem Fehler-Body (`{error, reason?}`).
    public static func meldung(status: Int, grund: String? = nil, fehlertext: String? = nil) -> String {
        switch (status, grund) {
        case (0, _):
            return "Der Server ist nicht erreichbar. Prüfe die Verbindung und versuche es erneut."
        case (401, _):
            return "Der Code ist ungültig oder abgelaufen. Bitte den QR-Code neu scannen."
        case (403, "tracking_off"?):
            return "Die Ortung ist für diese Organisation ausgeschaltet."
        case (403, "no_role"?):
            return "Dieses Gerät ortet weder ein Ziel noch eine Person."
        case (403, "target_removed"?):
            return "Das Ziel gibt es nicht mehr."
        case (403, _):
            return "Das ist mit dieser Anmeldung nicht erlaubt."
        case (409, "person_session"?):
            return "Auf diesem Gerät ist eine persönliche Anmeldung aktiv."
        case (409, _):
            return "Das geht im aktuellen Zustand der Anmeldung nicht."
        case (422, "invitation_exhausted"?):
            return "Diese Einladung ist ausgeschöpft. Bitte die Einsatzleitung um einen neuen QR-Code."
        case (400, _), (422, _):
            return fehlertext ?? "Die Angaben passen nicht. Bitte prüfen."
        case (429, _):
            return "Zu viele Versuche. Bitte kurz warten."
        default:
            return fehlertext ?? "Unerwartete Antwort des Servers (\(status))."
        }
    }
}
