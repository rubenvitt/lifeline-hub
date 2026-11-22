package dev.rubeen.lifeline.kern

/**
 * Update-Kanal der App (Entwurf D4, D9; Vorbild `src-tauri/src/kanal.rs`). Beim ersten Start aus
 * der eigenen Version abgeleitet, gespeichert und von einem Update nie geändert; eine Version
 * ohne erkennbaren Kanal bekommt keine Updates.
 */
enum class Kanal(val kennwort: String) {
    ALPHA("alpha"),
    BETA("beta"),
    STABIL("stabil");

    /**
     * Adresse des Manifests `android.json` des Kanals: je Kanal ein eigenes Release
     * (`android-alpha`, `android-beta`, `android-stabil`), auch für stabil nicht
     * `releases/latest/download/` (dort stünde nach jeder Freigabe bis zum fertigen Bau nichts;
     * `scripts/release/android-kanal.mjs`).
     */
    val manifestUrl: String
        get() = when (this) {
            ALPHA -> "$REPO/releases/download/android-alpha/android.json"
            BETA -> "$REPO/releases/download/android-beta/android.json"
            STABIL -> "$REPO/releases/download/android-stabil/android.json"
        }

    companion object {
        const val REPO = "https://github.com/rubenvitt/lifeline-hub"

        /**
         * `-alpha.` → [ALPHA], `-beta.` → [BETA], ohne Vorab-Suffix → [STABIL]; jede andere
         * Vorabversion (`rc`, `dev`) und alles Unlesbare ergibt `null`: dann gibt es keine Updates.
         */
        fun fromVersion(version: String): Kanal? {
            val vorab = Semver.parse(version)?.vorab ?: return STABIL.takeIf { Semver.parse(version) != null }
            return when (vorab.first()) {
                "alpha" -> if (vorab.size > 1) ALPHA else null
                "beta" -> if (vorab.size > 1) BETA else null
                else -> null
            }
        }

        fun fromKennwort(text: String?): Kanal? = entries.firstOrNull { it.kennwort == text }
    }
}
