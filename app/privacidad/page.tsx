import Link from "next/link";
import LegalPage, { Owner, WriteTo } from "@/components/legal/LegalPage";
import { getLegal } from "@/lib/legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Política de privacidad" };

// Written from what the code actually does (RGPD and LOPDGDD). If the app starts keeping something new, say it here.
export default async function PrivacidadPage() {
  const legal = await getLegal();
  return (
    <LegalPage title="Política de privacidad" legal={legal}>
      <p>Aquí te explicamos qué datos tuyos guarda esta web, para qué, durante cuánto tiempo y qué puedes hacer con ellos, según el Reglamento General de Protección de Datos (RGPD) y la Ley Orgánica 3/2018 (LOPDGDD).</p>

      <h2>Quién es el responsable</h2>
      <Owner legal={legal} />

      <h2>Qué datos guardamos</h2>
      <ul>
        <li><strong>Tu cuenta:</strong> nombre de usuario, el nombre que se muestra, tu contraseña guardada solo como hash (no se puede leer ni recuperar), el estado de la cuenta, cuándo se creó y cuándo entraste por última vez, y los intentos fallidos de entrar (para bloquearla un rato si hay demasiados).</li>
        <li><strong>Face ID o huella</strong>, si los activas: la clave pública de cada dispositivo, su nombre y cuándo se usó. Tu cara o tu huella nunca salen de tu dispositivo.</li>
        <li><strong>Progreso de lectura:</strong> en qué página vas de cada libro y cuándo.</li>
        <li><strong>Marcadores:</strong> el libro, la página, el nombre que les pongas y la fecha.</li>
        <li><strong>Historial de descargas</strong>, si puedes descargar libros: el libro, las páginas, la fecha, el tipo de dispositivo (móvil u ordenador) y si la descarga terminó.</li>
        <li><strong>Mensajes de contacto:</strong> tu nombre, tu email, el asunto, el mensaje, tu usuario si habías entrado y un código cifrado de tu dirección IP (un hash: la IP no se guarda).</li>
        <li><strong>Códigos de acceso:</strong> qué libros tienes desbloqueados, con qué código y cuándo. Los códigos se guardan solo como hash.</li>
      </ul>
      <p>Para frenar abusos, la web cuenta durante unos minutos los intentos que llegan desde cada dirección IP. Ese recuento está solo en la memoria del servidor y no se guarda.</p>
      <p>La web también recoge estadísticas de visitas anónimas con Vercel Web Analytics (qué páginas se ven, país, tipo de dispositivo y navegador), sin cookies y sin identificarte.</p>
      <p>En tu navegador solo se guardan las cookies técnicas y las preferencias que se explican en la <Link href="/cookies">Política de cookies</Link>.</p>

      <h2>Para qué y con qué base legal</h2>
      <ul>
        <li><strong>Darte el servicio</strong> (tu cuenta, leer los libros, guardar tu progreso y tus marcadores, descargas y códigos de acceso): la ejecución de la relación que aceptas al activar tu cuenta (art. 6.1.b RGPD).</li>
        <li><strong>Seguridad y prevención de abusos</strong> (bloqueos tras intentos fallidos, límites de envíos, historial de descargas, el hash de la IP en los mensajes): nuestro interés legítimo en proteger la web y los libros (art. 6.1.f RGPD).</li>
        <li><strong>Responder a tu mensaje</strong> del formulario de contacto: tu consentimiento, que das al enviarlo (art. 6.1.a RGPD) y que puedes retirar cuando quieras.</li>
        <li><strong>Estadísticas anónimas de visitas:</strong> nuestro interés legítimo en saber cómo se usa la web, sin datos que te identifiquen.</li>
      </ul>
      <p>No vendemos ni cedemos tus datos, no mostramos publicidad y no tomamos decisiones automatizadas sobre ti.</p>

      <h2>Quién más trata tus datos</h2>
      <p>Solo estos proveedores, que actúan como encargados del tratamiento y únicamente para que la web funcione:</p>
      <ul>
        <li><strong>Vercel Inc.</strong>: aloja la web y recibe tus peticiones (incluida tu dirección IP). También da las estadísticas anónimas.</li>
        <li><strong>Google</strong> (Google Sheets): guarda los datos de las cuentas, el progreso, los marcadores, las descargas y los mensajes.</li>
        <li><strong>Cloudflare Inc.</strong> (R2): guarda las páginas de los libros. Tu navegador las descarga directamente de Cloudflare.</li>
      </ul>
      <p>Estas empresas pueden tratar datos fuera del Espacio Económico Europeo, en Estados Unidos. Lo hacen con las garantías del RGPD: el Marco de Privacidad de Datos UE-EE. UU. (EU-US Data Privacy Framework) y/o las cláusulas contractuales tipo de la Comisión Europea.</p>

      <h2>Cuánto tiempo los guardamos</h2>
      <ul>
        <li><strong>Cuenta:</strong> hasta que se elimina.</li>
        <li><strong>Progreso y marcadores:</strong> mientras exista la cuenta; se borran con ella.</li>
        <li><strong>Historial de descargas:</strong> 12 meses.</li>
        <li><strong>Mensajes de contacto:</strong> 12 meses.</li>
      </ul>
      <p>Pasados los 12 meses, las descargas y los mensajes se borran solos. Al eliminar una cuenta también se pueden anonimizar su historial de descargas y sus mensajes.</p>

      <h2>Tus derechos</h2>
      <p>Puedes pedir el <strong>acceso</strong> a tus datos, su <strong>rectificación</strong>, su <strong>supresión</strong>, la <strong>limitación</strong> de su tratamiento, <strong>oponerte</strong> a él y la <strong>portabilidad</strong> (te los damos en un archivo). Para ello, <WriteTo legal={legal} />. Te contestaremos en un mes como máximo.</p>
      <p>Si crees que no hemos tratado bien tus datos, puedes reclamar ante la Agencia Española de Protección de Datos en <a href="https://www.aepd.es" target="_blank" rel="noreferrer">www.aepd.es</a>.</p>

      <h2>Menores de edad</h2>
      <p>Esta web no está pensada para menores de 14 años. Si tienes menos de 14 años, necesitas el consentimiento de tus padres o tutores para tener una cuenta.</p>
    </LegalPage>
  );
}
