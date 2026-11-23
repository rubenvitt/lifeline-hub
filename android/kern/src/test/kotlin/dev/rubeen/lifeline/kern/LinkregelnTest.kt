package dev.rubeen.lifeline.kern

import java.net.URI
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Linkregeln gegen die gemeinsamen Fälle (`links.json`). */
class LinkregelnTest {
    @Serializable
    private class Datei(
        @SerialName("neues_fenster") val neuesFenster: List<ZielFall>,
        val navigation: List<ZielFall>,
        @SerialName("gehoert_zum_server") val gehoertZumServer: List<ServerFall>,
    )

    @Serializable
    private class ZielFall(val beschreibung: String, val server: String? = null, val ziel: String, val erwartet: String)

    @Serializable
    private class ServerFall(val beschreibung: String, val server: String, val seite: String, val erwartet: Boolean)

    private fun datei() = GemeinsameFaelle.load("links.json", Datei.serializer())

    private fun pruefe(faelle: List<ZielFall>, decide: (URI?, URI) -> Linkregeln.Ziel) {
        for (fall in faelle) {
            assertEquals(fall.erwartet, decide(fall.server?.let(URI::create), URI.create(fall.ziel)).kennwort, fall.beschreibung)
        }
    }

    @Test
    fun `jeder gemeinsame Fall der Linkregeln gilt`() {
        val datei = datei()
        assertTrue(datei.neuesFenster.size >= 22)
        assertTrue(datei.navigation.size >= 17)
        assertTrue(datei.gehoertZumServer.size >= 5)
        pruefe(datei.neuesFenster, Linkregeln::neuesFenster)
        pruefe(datei.navigation, Linkregeln::navigation)
        for (fall in datei.gehoertZumServer) {
            assertEquals(
                fall.erwartet,
                Linkregeln.belongsToServer(URI.create(fall.server), URI.create(fall.seite)),
                fall.beschreibung,
            )
        }
    }
}
