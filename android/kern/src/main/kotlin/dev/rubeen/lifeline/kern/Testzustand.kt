package dev.rubeen.lifeline.kern

/**
 * Zustände für die Oberflächentests (Intent-Extra [EXTRA]): die App zeigt dann die Seite mit
 * Beispieldaten, ohne Netz und ohne die gespeicherte Liste.
 */
enum class Testzustand(val wert: String) {
    ONBOARDING("onboarding"),
    SERVERLISTE("serverliste"),
    EINSTELLUNGEN("einstellungen"),
    ZERTIFIKAT("zertifikat"),
    NICHT_ERREICHBAR("nicht-erreichbar"),
    ZU_ALT("zu-alt"),
    ZU_NEU("zu-neu"),
    WEBVIEW_VERALTET("webview-veraltet"),
    UPDATE_BEREIT("update-bereit"),
    UPDATE_LAEUFT("update-laeuft"),

    /** Der WebView mit [BEISPIELSEITE] unter der Adresse des Beispielservers (natives Gefühl). */
    WEB("web"),

    /** Der WebView auf einer fremden Seite mit dem Hinweis „Zur Oberfläche“. */
    FREMDE_SEITE("fremde-seite");

    companion object {
        const val EXTRA = "lifeline.testzustand"

        fun from(wert: String?): Testzustand? = entries.firstOrNull { it.wert == wert }

        /**
         * Seite des Testzustands [WEB]: lädt die App ohne Netz unter der Adresse des
         * Beispielservers. Lang genug zum Ziehen, mit Text für die lange Berührung, einem
         * Eingabefeld und einem Knopf, der eine Rückfrage (`confirm`) auslöst.
         */
        val BEISPIELSEITE: String = """
            <!doctype html>
            <html lang="de"><head><meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Lifeline</title>
            <style>
            body { margin: 0; font: 17px system-ui, sans-serif; background: #f4f4f5; color: #18181b; }
            header { background: #18181b; color: #fafafa; padding: 12px 16px; font-weight: 600; }
            main { padding: 16px; }
            p { line-height: 1.5; }
            input { width: 100%; box-sizing: border-box; padding: 10px; font-size: 17px; }
            </style></head>
            <body>
            <header id="kopf">ELW 1 · Einsatztagebuch</header>
            <main>
            <p id="text">Lange Berührung auf diesem Text zeigt weder Lupe noch Textmenü.</p>
            <label>Eintrag <input id="eingabe" value="Eingaben bleiben auswählbar"></label>
            <p>Die Seite federt am Rand nicht nach und lädt beim Ziehen nicht neu.</p>
            <button id="rueckfrage" onclick="document.getElementById('antwort').textContent = confirm('Eintrag wirklich löschen?') ? 'Bestätigt' : 'Abgelehnt'">Eintrag löschen</button>
            <p id="antwort">Noch nicht gefragt</p>
            </main>
            </body></html>
        """.trimIndent()
    }
}
