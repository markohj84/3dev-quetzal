/**
 * Evals del cliente: los genéricos de scripts/evals.ts más los propios.
 *
 *   CLIENT=<cliente> npm run dev     # en una terminal
 *   CLIENT=<cliente> npm run eval    # en otra
 *
 * Agrega un caso por cada regla del negocio que no se puede romper: un
 * precio publicado, algo que nunca debe prometer, a qué servicio manda
 * cada tipo de pregunta.
 */
import assert from 'node:assert';
import config from './assistant.config.ts';
import { genericCases, runEvals, type Case } from '../../scripts/evals.ts';

const cases: Case[] = [
  // TODO: `offer` debe atrapar la invitación a agendar de voice.md.
  ...genericCases({ clientId: config.id, offer: /agendar (una|tu) cita|te gustar[íi]a agendar/i }),
  {
    // TODO: ejemplo; cámbialo por un precio real de knowledge/servicios.md.
    name: 'da el precio publicado del servicio principal',
    turns: ['¿Cuánto cuesta [servicio 1]?'],
    check([r]) {
      assert.match(r, /\$/, `debería dar el precio: ${r}`);
    },
  },
];

runEvals({ clientId: config.id, cases });
