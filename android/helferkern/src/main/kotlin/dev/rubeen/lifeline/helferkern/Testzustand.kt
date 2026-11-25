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
    BEENDET("beendet");

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
