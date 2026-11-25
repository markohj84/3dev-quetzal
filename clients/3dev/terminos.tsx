import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Términos de servicio — Quetzal · 3dev',
  description:
    'Condiciones de uso de Quetzal, el asistente de 3dev por web y WhatsApp, para quien conversa con él y para los negocios que lo usan.',
};

// Es la URL de términos de la app de Meta de 3dev. Falta validarlo con asesor
// legal. Al cambiar el texto, cambia también esta fecha: la sección 9 lo promete.
const ACTUALIZADO = '24 de noviembre de 2026';
const CONTACTO = 'contacto@3dev.mx';

export default function TerminosPage() {
  return (
    <main style={styles.main}>
      <article style={styles.article}>
        <h1 style={styles.h1}>Términos de servicio</h1>
        <p style={styles.meta}>Última actualización: {ACTUALIZADO}</p>

        <p>
          Estos términos regulan el uso de <strong>Quetzal</strong>, el asistente virtual
          que <strong>3dev</strong> (“nosotros”) opera en sitios web y en WhatsApp, para
          3dev y para los negocios que lo contratan. Al conversar con Quetzal o al
          conectar tu negocio a él, aceptas estos términos.
        </p>

        <h2 style={styles.h2}>1. Quién presta el servicio</h2>
        <p>
          3dev, con domicilio en 5 poniente 505A, San Pedro Cholula, Puebla, México.
          Contacto: <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a>.
        </p>

        <h2 style={styles.h2}>2. Qué es Quetzal</h2>
        <p>
          Quetzal contesta mensajes en nombre de un negocio: responde preguntas con la
          información que ese negocio le dio, toma datos de contacto, puede agendar
          citas y avisa al negocio. Las respuestas las genera un modelo de inteligencia
          artificial, no una persona. El negocio puede tomar la conversación y
          contestar él mismo en cualquier momento.
        </p>

        <h2 style={styles.h2}>3. Si conversas con Quetzal</h2>
        <ul>
          <li>
            Las respuestas son informativas. Si algo importa para una decisión (un
            precio, una fecha, una condición), confírmalo con el negocio.
          </li>
          <li>Quetzal no da asesoría médica, legal, fiscal ni financiera.</li>
          <li>
            Una cita está agendada solo cuando el asistente la confirma en la
            conversación y te llega la confirmación del calendario.
          </li>
          <li>
            No compartas datos sensibles ni contraseñas, y no uses el servicio para
            enviar contenido ilegal, ofensivo o automatizado.
          </li>
          <li>
            Puedes dejar de recibir mensajes cuando quieras: bloquea el número o escribe
            a <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a>.
          </li>
        </ul>

        <h2 style={styles.h2}>4. Si eres un negocio que usa Quetzal</h2>
        <ul>
          <li>
            Al conectar tu número de WhatsApp Business, nos autorizas a enviar y recibir
            mensajes en tu nombre por la plataforma de WhatsApp Business de Meta, y a
            crear las plantillas de mensaje que el servicio necesita.
          </li>
          <li>
            Eres responsable de que la información que nos das para el asistente sea
            correcta y de que puedas publicarla. El asistente solo afirma lo que está en
            esa información.
          </li>
          <li>
            Te comprometes a cumplir las políticas de WhatsApp Business y de comercio de
            Meta, y a escribir primero solo a personas que te dieron su consentimiento.
          </li>
          <li>
            Meta cobra por separado los mensajes de la plataforma, según su tarifa, al
            método de pago de tu cuenta de WhatsApp Business. Los precios y condiciones
            de 3dev se pactan en la propuesta o el contrato con cada negocio.
          </li>
          <li>
            Puedes desconectar tu número en cualquier momento desde tu cuenta de
            WhatsApp Business o pidiéndonoslo.
          </li>
        </ul>

        <h2 style={styles.h2}>5. Datos personales</h2>
        <p>
          El tratamiento de datos personales se rige por el{' '}
          <a href="/privacidad">aviso de privacidad</a>. Cada negocio que usa Quetzal es
          responsable de los datos de las personas que le escriben, y 3dev los trata por
          su cuenta para operar el servicio.
        </p>

        <h2 style={styles.h2}>6. Disponibilidad</h2>
        <p>
          Procuramos que el servicio esté disponible siempre, pero depende de
          proveedores externos (Meta, el proveedor de IA, el alojamiento) y puede
          interrumpirse. Cuando el asistente no puede contestar, avisamos para que una
          persona lo haga.
        </p>

        <h2 style={styles.h2}>7. Responsabilidad</h2>
        <p>
          El servicio se ofrece tal cual. En la medida que la ley lo permita, 3dev no
          responde por decisiones tomadas solo con base en una respuesta automática, ni
          por fallas de proveedores externos.
        </p>

        <h2 style={styles.h2}>8. Suspensión</h2>
        <p>
          Podemos suspender el acceso de quien use el servicio para abuso, spam o
          actividades ilegales, o de un negocio que incumpla las políticas de Meta.
        </p>

        <h2 style={styles.h2}>9. Cambios y ley aplicable</h2>
        <p>
          Si modificamos estos términos, publicaremos la versión nueva en esta misma
          página con su fecha. Se rigen por las leyes de México; cualquier controversia
          se resolverá ante los tribunales competentes de Puebla, Puebla.
        </p>
      </article>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: '100vh',
    padding: '48px 16px',
    display: 'flex',
    justifyContent: 'center',
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    lineHeight: 1.65,
  },
  article: { width: '100%', maxWidth: 720 },
  h1: { fontSize: '2rem', lineHeight: 1.2, margin: '0 0 8px' },
  h2: { fontSize: '1.2rem', margin: '32px 0 8px' },
  meta: { opacity: 0.65, marginTop: 0, fontSize: '0.9rem' },
};
