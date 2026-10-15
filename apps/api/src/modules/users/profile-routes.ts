import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { responses } from '../../schemas/common.js';
import { access, authOf } from '../auth/access.js';
import {
  animal,
  animalBody,
  animalHistory,
  farmerProfile,
  farmerProfileBody,
  wardView,
} from './schemas.js';
import {
  addAnimal,
  animalWithHistory,
  getFarmerProfile,
  listAnimals,
  listCounties,
  listWards,
  updateFarmerProfile,
} from './service.js';

const animalParams = z.object({ id: z.uuid() });

export function profileRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/v1/locations/counties',
    {
      config: { access: access.public },
      schema: {
        tags: ['locations'],
        summary: 'Counties with wards',
        response: responses({ 200: z.array(z.string()) }),
      },
    },
    async () => listCounties(ctx),
  );

  r.get(
    '/v1/locations/wards',
    {
      config: { access: access.public },
      schema: {
        tags: ['locations'],
        summary: "A county's wards, by sub-county",
        querystring: z.object({ county: z.string().min(1).max(60) }),
        response: responses({ 200: z.array(wardView) }),
      },
    },
    async (req) => listWards(ctx, req.query.county),
  );

  r.get(
    '/v1/farmers/me',
    {
      config: { access: access.role('farmer') },
      schema: {
        tags: ['farmer'],
        summary: 'My farm: ward, landmarks, optional pin',
        response: responses({ 200: farmerProfile }),
      },
    },
    async (req) => getFarmerProfile(ctx, authOf(req).userId),
  );

  r.put(
    '/v1/farmers/me',
    {
      config: { access: access.role('farmer') },
      schema: {
        tags: ['farmer'],
        summary: 'Set my ward (required), landmarks and optional farm pin',
        description: 'Precise coordinates are stored only when the farmer gives them (§17).',
        body: farmerProfileBody,
        response: responses({ 200: farmerProfile }),
      },
    },
    async (req) => updateFarmerProfile(ctx, authOf(req).userId, req.body),
  );

  r.get(
    '/v1/animals',
    {
      config: { access: access.role('farmer') },
      schema: {
        tags: ['animals'],
        summary: 'My animals',
        response: responses({ 200: z.array(animal) }),
      },
    },
    async (req) => listAnimals(ctx, authOf(req).userId),
  );

  r.post(
    '/v1/animals',
    {
      config: { access: access.role('farmer') },
      schema: {
        tags: ['animals'],
        summary: 'Add an animal',
        body: animalBody,
        response: responses({ 201: animal }),
      },
    },
    async (req, reply) => reply.code(201).send(await addAnimal(ctx, authOf(req).userId, req.body)),
  );

  r.get(
    '/v1/animals/:id/history',
    {
      config: { access: access.role('farmer') },
      schema: {
        tags: ['animals'],
        summary: 'An animal and its visits and treatments',
        params: animalParams,
        response: responses({ 200: animalHistory }),
      },
    },
    async (req) => animalWithHistory(ctx, authOf(req).userId, req.params.id),
  );
}
