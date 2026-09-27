import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Aviso de privacidad — Quetzal · 3dev',
  description:
    'Cómo 3dev recopila, usa y protege los datos personales en Quetzal, su asistente por web y WhatsApp.',
};

// TODO antes de publicar: revisa los campos marcados con [ ] y valida el texto
// con tu asesor legal. Esto es una plantilla basada en la LFPDPPP (México).
const ACTUALIZADO = '26 de septiembre de 2026';
const CONTACTO = 'contacto@3dev.mx';

export default function PrivacidadPage() {
  return (
    <main style={styles.main}>
      <article style={styles.article}>
        <h1 style={styles.h1}>Aviso de privacidad</h1>
        <p style={styles.meta}>Última actualización: {ACTUALIZADO}</p>

        <p>
          Este aviso explica cómo <strong>3dev</strong> (“nosotros”) trata los datos
          personales de quienes conversan con <strong>Quetzal</strong>, nuestro
          asistente virtual disponible en este sitio web y en WhatsApp.
        </p>

        <h2 style={styles.h2}>1. Responsable</h2>
        <p>
          3dev, con domicilio en 5 poniente 505A, San Pedro Cholula, Puebla, México, es responsable del
          tratamiento de tus datos personales. Para cualquier asunto relacionado con
          este aviso escríbenos a <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a>.
        </p>

        <h2 style={styles.h2}>2. Datos que recopilamos</h2>
        <ul>
          <li>
            <strong>Si nos escribes por WhatsApp:</strong> tu número de teléfono, el
            nombre de tu perfil de WhatsApp y el contenido de los mensajes que nos
            envías.
          </li>
          <li>
            <strong>Si usas el chat del sitio web:</strong> el contenido de tus
            mensajes y un identificador técnico de la sesión.
          </li>
          <li>
            <strong>Datos que decidas compartir</strong> durante la conversación, como
            tu nombre, correo electrónico, empresa o detalles de tu proyecto.
          </li>
        </ul>
        <p>
          No solicitamos datos personales sensibles. Te pedimos no compartirlos en la
          conversación.
        </p>

        <h2 style={styles.h2}>3. Para qué los usamos</h2>
        <ul>
          <li>Responder tus preguntas sobre los servicios de 3dev.</li>
          <li>Darle seguimiento a tu interés y, si lo pides, agendar una llamada.</li>
          <li>Mantener el contexto de la conversación para no repetirte preguntas.</li>
          <li>
            Proteger el servicio contra abuso (por ejemplo, limitar la cantidad de
            mensajes por minuto).
          </li>
          <li>Mejorar la calidad de las respuestas del asistente.</li>
        </ul>
        <p>No vendemos ni rentamos tus datos personales.</p>

        <h2 style={styles.h2}>4. Uso de inteligencia artificial</h2>
        <p>
          Quetzal es un asistente automatizado: las respuestas las genera un modelo de
          inteligencia artificial, no una persona. Para generar cada respuesta, el
          contenido de la conversación se envía a nuestro proveedor de IA. Una persona
          del equipo de 3dev puede revisar la conversación cuando nos solicitas
          contacto o para darle seguimiento.
        </p>

        <h2 style={styles.h2}>5. Con quién los compartimos</h2>
        <p>
          Solo con proveedores que nos ayudan a operar el servicio y que tratan los
          datos por cuenta nuestra:
        </p>
        <ul>
          <li><strong>Meta (WhatsApp Business Platform)</strong>: envío y recepción de mensajes de WhatsApp.</li>
          <li><strong>Anthropic</strong>: generación de las respuestas del asistente.</li>
          <li><strong>Vercel</strong>: alojamiento del sitio y del servicio.</li>
          <li><strong>Upstash</strong>: almacenamiento temporal de sesiones y conversaciones.</li>
          <li><strong>Resend</strong>: envío de notificaciones internas por correo.</li>
          <li><strong>Calendly</strong>: agenda de llamadas, si decides programar una.</li>
        </ul>
        <p>
          Algunos de estos proveedores están fuera de México, por lo que tus datos
          pueden transferirse a otros países. También podríamos compartir datos cuando
          lo exija una autoridad competente conforme a la ley.
        </p>

        <h2 style={styles.h2}>6. Cuánto tiempo los conservamos</h2>
        <p>
          Conservamos las conversaciones 12 meses o mientras sea necesario para darte seguimiento. Después las
          eliminamos o anonimizamos.
        </p>

        <h2 style={styles.h2}>7. Tus derechos (ARCO)</h2>
        <p>
          Puedes solicitar el <strong>Acceso</strong>, <strong>Rectificación</strong>,{' '}
          <strong>Cancelación</strong> u <strong>Oposición</strong> al tratamiento de
          tus datos, así como revocar tu consentimiento, escribiendo a{' '}
          <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a>. Incluye tu nombre, el número
          de teléfono o medio con el que nos contactaste y la descripción de lo que
          solicitas. Te responderemos en un plazo máximo de 20 días hábiles.
        </p>
        <p>
          Si quieres dejar de recibir mensajes por WhatsApp, escríbenos a{' '}
          <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a> o bloquea el número.
        </p>

        <h2 style={styles.h2}>8. Cambios a este aviso</h2>
        <p>
          Si modificamos este aviso, publicaremos la versión actualizada en esta misma
          página con su nueva fecha.
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
