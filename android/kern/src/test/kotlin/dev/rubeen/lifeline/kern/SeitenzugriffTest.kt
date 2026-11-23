package dev.rubeen.lifeline.kern

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Dateiwahl und Kamera der Oberfläche (Review W4): die Kamera nur für die Origin des aktiven
 * Servers und nur als Video, die Dateiwahl mit den Typen aus `accept`.
 */
class SeitenzugriffTest {
    private val elw = ServerAdresse.parse("https://elw.local:8443/")
    private val video = Seitenzugriff.VIDEO_CAPTURE
    private val audio = "android.webkit.resource.AUDIO_CAPTURE"

    private fun kamera(origin: String?, vararg ressourcen: String, aktiv: ServerAdresse? = elw) =
        Seitenzugriff.kamera(origin?.let(SeitenOrigin::parse), ressourcen.toList(), aktiv)

    @Test
    fun `die Seite des aktiven Servers bekommt die Kamera`() {
        assertEquals(listOf(video), kamera("https://elw.local:8443", video))
        assertEquals(listOf(video), kamera("https://ELW.local:8443/", video))
    }

    @Test
    fun `nur das Video wird freigegeben, sonst nichts`() {
        assertEquals(listOf(video), kamera("https://elw.local:8443", video, audio))
        assertEquals(emptyList(), kamera("https://elw.local:8443", audio))
        assertEquals(emptyList(), kamera("https://elw.local:8443", "android.webkit.resource.PROTECTED_MEDIA_ID"))
        assertEquals(emptyList(), kamera("https://elw.local:8443"))
    }

    @Test
    fun `fremde Origins und ein fehlender Server bekommen keine Kamera`() {
        assertEquals(emptyList(), kamera("https://idp.example", video))
        assertEquals(emptyList(), kamera("https://elw.local", video))
        assertEquals(emptyList(), kamera("http://elw.local:8443", video))
        assertEquals(emptyList(), kamera("null", video))
        assertEquals(emptyList(), kamera(null, video))
        assertEquals(emptyList(), kamera("https://elw.local:8443", video, aktiv = null))
    }

    private val endungen = mapOf("pdf" to "application/pdf", "png" to "image/png", "jpg" to "image/jpeg", "jpeg" to "image/jpeg")

    private fun typen(vararg accept: String) = Seitenzugriff.mimeTypen(accept.toList()) { endungen[it] }

    @Test
    fun `accept nennt MIME-Typen und Endungen`() {
        assertEquals(listOf("application/pdf", "image/png"), typen(".pdf,.png"))
        assertEquals(listOf("image/png", "image/jpeg"), typen("image/png", "image/jpeg"))
        assertEquals(listOf("image/jpeg", "image/png"), typen(" .JPG , .jpeg,.png "))
        assertEquals(listOf("image/*"), typen("image/*"))
    }

    @Test
    fun `ohne accept oder mit unbekannter Endung schränkt die Wahl nichts ein`() {
        assertEquals(emptyList(), typen())
        assertEquals(emptyList(), typen(""))
        assertEquals(emptyList(), typen(".pdf,.age"))
        assertEquals(emptyList(), typen("*/*"))
    }
}
