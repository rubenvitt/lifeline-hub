package dev.rubeen.lifeline.android

import dev.rubeen.lifeline.android.web.Vertragsabruf
import dev.rubeen.lifeline.kern.Netzfehler
import dev.rubeen.lifeline.kern.ServerAdresse
import dev.rubeen.lifeline.kern.ShellAbruf
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import java.net.URI
import kotlinx.coroutines.runBlocking

/**
 * `GET /api/shell` gegen einen Testserver (Entwurf D4). Der Testserver spricht `http`; der Abruf
 * bekommt dafür eine eigene Basis, die App fragt immer die `https`-Adresse des Eintrags.
 */
class VertragsabrufTest {
    private val server = MockWebServer()
    private val elw = ServerAdresse.parse("https://elw.local:8443")

    @Before
    fun starte() {
        server.start()
    }

    @After
    fun beende() {
        server.shutdown()
    }

    /** Ersetzt Schema, Host und Port der Adresse durch den Testserver, der Pfad bleibt. */
    private fun abruf() = Vertragsabruf { adresse ->
        val pfad = URI(adresse.text).rawPath ?: ""
        URI(server.url("/").toString().trimEnd('/') + pfad)
    }

    private fun json(body: String, status: Int = 200) =
        MockResponse().setResponseCode(status).setHeader("Content-Type", "application/json; charset=utf-8").setBody(body)

    @Test
    fun `ein Server mit Vertrag antwortet mit JSON`() = runBlocking {
        server.enqueue(json("""{"version":"1.0.0","shell_contract":1}"""))

        val (antwort, health) = abruf().abrufen(elw)

        assertEquals(ShellAbruf.Antwort(200, """{"version":"1.0.0","shell_contract":1}""", "application/json; charset=utf-8"), antwort)
        assertNull(health)
        assertEquals("/api/shell", server.takeRequest().path)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `ohne Vertrag fragt der Abruf die Version aus health`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(404).setBody("nicht gefunden"))
        server.enqueue(json("""{"status":"ok","version":"1.0.0-alpha.200"}"""))

        val (antwort, health) = abruf().abrufen(elw)

        assertEquals(404, (antwort as ShellAbruf.Antwort).status)
        assertEquals("1.0.0-alpha.200", health)
        assertEquals("/api/shell", server.takeRequest().path)
        assertEquals("/api/health", server.takeRequest().path)
    }

    @Test
    fun `eine Weiterleitung auf eine fremde Origin kommt als 302 an`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "https://portal.example/anmelden"))

        val (antwort, health) = abruf().abrufen(elw)

        assertEquals(302, (antwort as ShellAbruf.Antwort).status)
        assertNull(health)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `eine Weiterleitung auf derselben Origin wird verfolgt`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(301).setHeader("Location", "/api/shell/"))
        server.enqueue(json("""{"version":"1.0.0","shell_contract":1}"""))

        val (antwort, _) = abruf().abrufen(elw)

        assertEquals(200, (antwort as ShellAbruf.Antwort).status)
        assertEquals("/api/shell", server.takeRequest().path)
        assertEquals("/api/shell/", server.takeRequest().path)
    }

    @Test
    fun `die API liegt an der Wurzel, auch wenn die Adresse einen Pfad trägt`() = runBlocking {
        server.enqueue(json("""{"version":"1.0.0","shell_contract":1}"""))

        abruf().abrufen(ServerAdresse.parse("https://elw.local:8443/einsatz/"))

        assertEquals("/api/shell", server.takeRequest().path)
    }

    @Test
    fun `ohne Verbindung meldet der Abruf einen Verbindungsfehler`() = runBlocking {
        server.shutdown()

        val (antwort, health) = abruf().abrufen(elw)

        assertEquals(ShellAbruf.Fehler(Netzfehler.VERBINDUNG), antwort)
        assertNull(health)
    }
}
