package dev.rubeen.lifeline.kern

/**
 * Was die Oberfläche vom Gerät bekommt, außer über die Brücke (Review W4): die Dateiwahl für
 * `<input type="file">` und die Kamera für `getUserMedia`. Wie in `WKWebView` auf iOS, aber
 * ausdrücklich entschieden, weil der Android-WebView beides ohne die App abweist.
 */
object Seitenzugriff {
    /** `PermissionRequest.RESOURCE_VIDEO_CAPTURE`. */
    const val VIDEO_CAPTURE = "android.webkit.resource.VIDEO_CAPTURE"

    /**
     * Was eine Anfrage der Seite bekommt: nur die Kamera (Video), nur für den Hauptframe-Origin
     * des aktiven Servers (dieselbe Regel wie [Bruecke.accepts]). Mikrofon, geschützte Medien und
     * jede andere Origin bleiben ohne; leer heißt ablehnen. Hat die App selbst das Recht `CAMERA`
     * noch nicht, fragt sie danach, bevor sie freigibt.
     */
    fun kamera(origin: SeitenOrigin?, ressourcen: List<String>, aktiverServer: ServerAdresse?): List<String> {
        if (VIDEO_CAPTURE !in ressourcen) return emptyList()
        return if (Bruecke.accepts(isMainFrame = true, origin, aktiverServer)) listOf(VIDEO_CAPTURE) else emptyList()
    }

    /**
     * MIME-Typen für den Systemdialog aus dem `accept` der Seite (`FileChooserParams.acceptTypes`):
     * Typen wie `image/png` bleiben, Endungen wie `.pdf` übersetzt [mimeFuerEndung] (die App fragt
     * `MimeTypeMap`). Leer heißt: keine Einschränkung, auch wenn eine Endung unbekannt ist. Lieber
     * zu viel zeigen, als eine erlaubte Datei zu verstecken; der Server prüft ohnehin.
     */
    fun mimeTypen(accept: List<String>, mimeFuerEndung: (String) -> String?): List<String> {
        val teile = accept.flatMap { it.split(',') }.map { it.trim { c -> c.isWhitespace() }.lowercase() }.filter { it.isNotEmpty() }
        val typen = mutableListOf<String>()
        for (teil in teile) {
            val typ = when {
                teil == "*/*" -> return emptyList()
                teil.startsWith('.') -> mimeFuerEndung(teil.substring(1)) ?: return emptyList()
                '/' in teil -> teil
                else -> return emptyList()
            }
            if (typ !in typen) typen += typ
        }
        return typen
    }
}
