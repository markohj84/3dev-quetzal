# Cliente: 3dev

| Archivo | Qué controla |
|---|---|
| `assistant.config.ts` | Canales, agenda, límites declarativos |
| `voice.md` | Tono, reglas de conducta, ejemplos de respuesta |
| `knowledge/` | Todo lo que Quetzal puede afirmar como cierto |
| `theme.css` | Tokens visuales del widget |
| `offer.lock.json` | Copia exacta del catálogo canónico (`markohj84/3dev` → `docs/strategy/oferta.json`). No se edita a mano: se reemplaza al cambiar la oferta |

## Pendientes antes de producción

- [ ] Caso Las Cholulas documentado con cifras verificadas → `knowledge/casos/`
- [ ] Rango real de duración de proyecto → `knowledge/preguntas.md`
- [ ] `CALENDLY_URL` en variables de entorno
- [ ] Monto de la renovación anual de los sitios web (hoy Quetzal dice que se da en la cotización)
- [ ] ¿La Tienda en línea cobra en línea? Hoy se comunica como catálogo; el cobro se cotiza aparte
