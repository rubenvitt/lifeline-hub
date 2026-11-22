package dev.rubeen.lifeline.kern

import kotlin.coroutines.cancellation.CancellationException

/**
 * Was die App zum Entfernen eines Servers tut; die App setzt es mit dem WebView-Profil und der
 * Ablage um, die Tests mit einer Attrappe.
 */
interface Entfernungsdienste {
    /** Die Liste in diesem Moment (sie kann sich während des Löschens ändern). */
    val serverliste: Serverliste

    /** Schließt einen WebView, der das Profil [profil] benutzt; sonst nichts. */
    fun closeWebView(profil: String)

    /** Löscht das WebView-Profil (`ProfileStore.deleteProfile`). */
    suspend fun removeProfil(profil: String)

    /**
     * Nimmt den Eintrag aus der Liste und speichert sie; wirft [ListException], oder eine andere
     * Ausnahme, wenn das Speichern scheitert (der Eintrag ist dann aus der Liste im Speicher).
     */
    fun removeEintrag(id: String)
}

/** Wirft [Serverentfernung.run], wenn das Entfernen nicht gelingt. */
class EntfernungException(val fehler: Serverentfernung.Fehler) : Exception(fehler.meldung)

/**
 * Entfernen eines Servers (Entwurf D3). Reihenfolge: WebView des Profils schließen (ein Profil
 * lässt sich nicht löschen, solange ein WebView es benutzt), Profil löschen, erst dann den
 * Eintrag. Scheitert das Löschen, bleibt der Eintrag, und die App meldet den Fehler; so bleibt
 * kein Profil ohne Eintrag zurück, und ein zweiter Versuch geht.
 */
object Serverentfernung {
    sealed interface Fehler {
        data object Unbekannt : Fehler

        /** Der aktive Server lässt sich erst nach einem Wechsel entfernen. */
        data object Aktiv : Fehler

        data class Profil(val name: String, val grund: String) : Fehler

        /** Profil gelöscht, aber die Liste ließ sich nicht speichern (Review K10). */
        data class Speichern(val name: String, val grund: String) : Fehler

        val meldung: String
            get() = when (this) {
                Unbekannt -> "Der Server steht nicht mehr in der Liste."
                Aktiv -> "Der aktive Server lässt sich erst nach einem Wechsel entfernen."
                is Profil ->
                    "Die Daten von „$name“ ließen sich nicht löschen ($grund). Der Server bleibt in " +
                        "der Liste; bitte später erneut entfernen."
                is Speichern ->
                    "Die Serverliste ließ sich nicht speichern ($grund). Nach einem Neustart kann " +
                        "„$name“ wieder in der Liste stehen; dann bitte erneut entfernen."
            }
    }

    /**
     * Hinweis der Rückfrage. Die Hülle liest die Schreib-Queue des Frontends nicht aus, sagt also
     * allgemein, was verloren geht (Entwurf D3).
     */
    val HINWEIS: String =
        "Einträge, die noch nicht übertragen wurden, gehen verloren. Auch die Anmeldung und die " +
            "Offline-Daten dieses Servers werden auf diesem Gerät gelöscht."

    fun rueckfrageTitel(e: ServerEintrag): String = "„${e.name}“ entfernen?"

    /** Bietet die Liste das Entfernen an? Nur für einen bekannten, nicht aktiven Server. */
    fun isEntfernbar(id: String, liste: Serverliste): Boolean =
        liste.aktiv?.id != id && liste.eintraege.any { it.id == id }

    suspend fun run(id: String, dienste: Entfernungsdienste) {
        val liste = dienste.serverliste
        val eintrag = liste.eintraege.firstOrNull { it.id == id } ?: throw EntfernungException(Fehler.Unbekannt)
        if (liste.aktiv?.id == id) throw EntfernungException(Fehler.Aktiv)
        dienste.closeWebView(id)
        try {
            dienste.removeProfil(id)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw EntfernungException(Fehler.Profil(eintrag.name, e.message ?: e.toString()))
        }
        try {
            dienste.removeEintrag(id)
        } catch (e: ListException) {
            throw EntfernungException(if (e.error == ListError.AKTIV_NICHT_ENTFERNBAR) Fehler.Aktiv else Fehler.Unbekannt)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw EntfernungException(Fehler.Speichern(eintrag.name, e.message ?: e.toString()))
        }
    }
}
