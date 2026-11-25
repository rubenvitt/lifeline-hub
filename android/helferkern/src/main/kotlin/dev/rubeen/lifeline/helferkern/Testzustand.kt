package dev.rubeen.lifeline.helferkern

/**
 * Seiten, die die Helfer-App im Testzustand mit Beispieldaten zeigt (Intent-Extra [EXTRA]; ohne
 * Netz, Ablage und Ortung). Für die Bildschirmbilder in `android/helfer/src/test/…/BilderTest.kt`;
 * die Werte sind die von `-HelferTestzustand` der iOS-App.
 */
enum class Testzustand(val wert: String) {
    START("start"),
    ANMELDEN("anmelden"),
    WARTET("wartet"),
    ANGEMELDET("angemeldet"),
    PAUSIERT("pausiert"),

    /** „Angemeldet – Ortung ruht“ ohne Ortungsrolle ([Phase.Ruht]). */
    RUHT("ruht"),
    BEENDET("beendet"),

    // Aufträge (ADR-0106); „angemeldet“ zeigt den leeren Bereich.

    /** „Angemeldet“ mit offenen, übernommenen und aufgehobenen Aufträgen. */
    AUFTRAEGE("auftraege"),

    /** „Angemeldet“ ohne Mitteilungsrecht: Hinweis über dem Bereich. */
    MITTEILUNGEN_AUS("mitteilungen-aus"),

    /** Detail eines offenen Auftrags mit „Übernommen“. */
    AUFTRAG_OFFEN("auftrag-offen"),

    /** Detail: ein anderer Helfer derselben Einheit war schneller. */
    AUFTRAG_UEBERNOMMEN("auftrag-uebernommen"),

    /** Detail eines aufgehobenen Auftrags, ohne Knopf. */
    AUFTRAG_AUFGEHOBEN("auftrag-aufgehoben"),

    /** Detail nach einer gescheiterten Quittung („Bitte über Funk bestätigen“). */
    QUITTUNG_FEHLER("quittung-fehler");

    companion object {
        const val EXTRA = "lifeline.helfer.testzustand"

        fun from(wert: String?): Testzustand? = entries.firstOrNull { it.wert == wert }

        /**
         * Testzustand aus dem Start der Activity: nur in einem Debug-Bau. Die Release-App übergeht
         * das Extra; sonst könnte jede App sie mit erfundenen Seiten starten.
         */
        fun fromStart(wert: String?, isDebug: Boolean): Testzustand? = if (isDebug) from(wert) else null
    }
}
