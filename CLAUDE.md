# Instrucciones para Claude Code

Este repositorio es una base de asistentes conversacionales vendible a
clientes. Una instancia por cliente, un núcleo compartido.

## La invariante

**Ningún archivo bajo `core/` puede nombrar a un cliente.** Ni "3dev", ni
"Quetzal", ni Las Cholulas, ni Marco.

Verificado con `npm run check:boundary`. Corre ese comando antes de dar
cualquier tarea por terminada. Si falla, la solución nunca es relajar el
check — es mover el código al lugar correcto.

## Dónde va cada cosa

Antes de escribir código nuevo, decide de qué lado cae:

- **Conducta que cambia entre clientes** → `clients/<id>/voice.md` o
  `assistant.config.ts`. Si no se puede expresar ahí, amplía el esquema en
  `core/config/schema.ts`. Nunca lo resuelvas con un condicional.
- **Mecánica que es igual para todos** → `core/`.
- **Particularidad de un canal** (ventana de 24h de WhatsApp, longitud
  máxima, dialecto de formato) → el adaptador de ese canal, nunca el motor.

El motor no debe poder averiguar por qué canal llegó un mensaje.

## Reglas de producto que no se negocian

1. **El asistente no inventa datos.** Ninguna cifra, duración, nombre o
   resultado que no esté en `clients/<id>/knowledge/`. Si falta, responde
   que no lo tiene y ofrece la conversación con el humano.
2. **La oferta de agendar es una sola vez por conversación.** Se aplica con
   estado (`hasOffered`), no pidiéndoselo al modelo.
3. **`voice.md` se inserta literal en el prompt.** Nunca lo parafrasees,
   resumas ni reescribas desde código.
4. **Los documentos crudos del cliente no entran al conocimiento.**
   Contienen precios internos y criterios de calificación que no pueden
   salir por boca del asistente. El conocimiento se cura a mano.

## Stack

Next.js 15 (App Router), TypeScript, SDK de Anthropic, Zod, Vercel.
El sitio de 3dev es un repositorio aparte y solo consume el widget por embed.

## Pendientes conocidos

- Falta validar la firma del webhook de Meta
- Falta límite de peticiones por sesión
- Falta registro de conversaciones
- El widget del mockup todavía simula respuestas; conectarlo a `/api/chat`

## Estilo

Comentarios solo donde expliquen *por qué*, no *qué*. Nombres en inglés en
el código; el contenido de cara al usuario en español.
