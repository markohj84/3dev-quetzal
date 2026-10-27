# Plantilla de cliente

Copia esta carpeta a `clients/<cliente>/` y sigue `docs/nuevo-cliente.md`.

| Archivo | Qué es | Quién lo llena |
|---|---|---|
| `assistant.config.ts` | Agenda, canales, avisos, seguimiento | Tú, con los datos del cliente |
| `voice.md` | Cómo habla y qué no puede hacer el asistente. Va literal al prompt | Tú, con el dueño |
| `knowledge/` | Lo único que el asistente puede afirmar | A mano, con el dueño. Nunca documentos crudos |
| `widget.html` | Nombre, colores y saludo del chat del sitio | Tú |
| `home.html` | Landing opcional en "/" del dominio (Quetzal Local): colores, servicios, horario, mapa | Tú, con los datos del cliente. Sin este archivo, "/" es 404 |
| `privacidad.tsx` | Aviso de privacidad | El cliente, con su asesor legal |
| `evals.ts` | Pruebas que debe pasar antes de cada deploy | Tú |

Todo lo que está entre `[corchetes]` o marcado `TODO` se llena antes del primer deploy.
`client-check` falla si quedan marcadores en `widget.html` o `home.html`.
`node --env-file=.env.<cliente> scripts/client-check.ts <cliente>` te dice qué falta.
