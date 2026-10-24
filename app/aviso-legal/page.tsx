import Link from "next/link";
import LegalPage, { Owner, WriteTo } from "@/components/legal/LegalPage";
import { getLegal } from "@/lib/legal";
import { SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aviso legal" };

// LSSI-CE art. 10: who runs the site and how to reach them, plus the terms of use.
export default async function AvisoLegalPage() {
  const legal = await getLegal();
  return (
    <LegalPage title="Aviso legal" legal={legal}>
      <p>En cumplimiento de la Ley 34/2002, de servicios de la sociedad de la información y de comercio electrónico (LSSI-CE), estos son los datos de quien gestiona esta web.</p>

      <h2>Titular</h2>
      <Owner legal={legal} />

      <h2>Para qué sirve esta web</h2>
      <p>{SITE_NAME} es una biblioteca privada: permite leer en cualquier dispositivo los libros a los que el titular te ha dado acceso, con una cuenta o con un código de acceso. No es una tienda: no se vende nada ni se cobra por usarla.</p>

      <h2>Condiciones de uso</h2>
      <p>Al usar la web te comprometes a hacerlo de buena fe y conforme a la ley. En particular, no puedes:</p>
      <ul>
        <li>compartir tu usuario, tu contraseña o tus códigos de acceso con otras personas;</li>
        <li>copiar, descargar, capturar o distribuir los libros por medios distintos de los que ofrece la propia web;</li>
        <li>intentar entrar en partes de la web a las que no tienes acceso, ni sobrecargarla.</li>
      </ul>
      <p>Si no se cumplen estas condiciones, el titular puede desactivar la cuenta o anular los códigos de acceso.</p>

      <h2>Propiedad intelectual</h2>
      <p>Los libros y su contenido pertenecen a sus autores y editores, y están protegidos por la Ley de Propiedad Intelectual. Se ofrecen solo para tu lectura personal: no se permite reproducirlos, distribuirlos ni comunicarlos públicamente sin la autorización de sus titulares. El diseño y el código de la web pertenecen a su titular.</p>
      <p>Si eres titular de derechos sobre algún contenido y crees que no debería estar aquí, <WriteTo legal={legal} /> y lo retiraremos lo antes posible.</p>

      <h2>Responsabilidad</h2>
      <p>Hacemos lo posible para que la web funcione bien y sin interrupciones, pero no podemos garantizarlo siempre: puede haber pausas por mantenimiento o fallos de los proveedores. El titular no se hace responsable de los daños que se deriven de esas interrupciones ni del mal uso de la web por parte de terceros. Los enlaces a otras webs se ofrecen solo como ayuda y no somos responsables de su contenido.</p>

      <h2>Privacidad y cookies</h2>
      <p>Cómo tratamos tus datos se explica en la <Link href="/privacidad">Política de privacidad</Link>, y qué guarda la web en tu navegador, en la <Link href="/cookies">Política de cookies</Link>.</p>

      <h2>Ley aplicable</h2>
      <p>Este aviso legal se rige por la ley española. Para cualquier conflicto serán competentes los juzgados y tribunales que correspondan según la ley; si eres consumidor, los de tu domicilio.</p>
    </LegalPage>
  );
}
