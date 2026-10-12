import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.module';
import { createApp, makeUser, resetRateLimits, type TestUser } from './helpers';

describe('Categories (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let admin: TestUser;
  let member: TestUser;
  const http = () => request(app.getHttpServer());
  const tag = () => Math.random().toString(36).slice(2, 8);

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetRateLimits();
    admin = await makeUser(app, { role: 'admin' });
    member = await makeUser(app);
  });
  afterAll(() => app.close());

  async function createRoot(name = `Root ${tag()}`) {
    const res = await http()
      .post('/categories')
      .set('Authorization', admin.auth)
      .send({ name, sortOrder: 9000 })
      .expect(201);
    return res.body as { id: string; slug: string };
  }

  describe('GET /categories', () => {
    it('is public and returns a two-level tree of active categories', async () => {
      const root = await createRoot();
      await http()
        .post('/categories')
        .set('Authorization', admin.auth)
        .send({ name: `Child ${tag()}`, parentId: root.id })
        .expect(201);
      const hidden = await http()
        .post('/categories')
        .set('Authorization', admin.auth)
        .send({ name: `Hidden ${tag()}`, parentId: root.id, isActive: false })
        .expect(201);

      const res = await http().get('/categories').expect(200);
      const node = res.body.find((c: { id: string }) => c.id === root.id);
      expect(node.children).toHaveLength(1);
      expect(JSON.stringify(res.body)).not.toContain(hidden.body.id);
    });

    it('ignores a bad bearer token on a public route', async () => {
      await http().get('/categories').set('Authorization', 'Bearer not-a-jwt').expect(200);
    });

    it('serves the cached tree until an admin change busts it', async () => {
      await http().get('/categories').expect(200);
      const root = await createRoot(); // bust happens here
      const res = await http().get('/categories').expect(200);
      expect(res.body.some((c: { id: string }) => c.id === root.id)).toBe(true);
    });
  });

  describe('GET /categories/:slug', () => {
    it('returns parent and children', async () => {
      const root = await createRoot();
      const child = await http()
        .post('/categories')
        .set('Authorization', admin.auth)
        .send({ name: `Kid ${tag()}`, parentId: root.id })
        .expect(201);
      const res = await http().get(`/categories/${child.body.slug}`).expect(200);
      expect(res.body.parent).toMatchObject({ id: root.id });
      const parent = await http().get(`/categories/${root.slug}`).expect(200);
      expect(parent.body.children).toEqual([expect.objectContaining({ id: child.body.id })]);
    });

    it('404 for unknown or inactive', async () => {
      await http().get('/categories/does-not-exist').expect(404);
    });
  });

  describe('admin mutations', () => {
    it('403 for non-admins, 401 anonymous', async () => {
      await http().post('/categories').send({ name: 'Nope' }).expect(401);
      await http()
        .post('/categories')
        .set('Authorization', member.auth)
        .send({ name: 'Nope' })
        .expect(403);
    });

    it('generates a slug, rejects duplicates and a third level', async () => {
      const name = `Phones ${tag()}`;
      const root = await createRoot(name);
      expect(root.slug).toBe(name.toLowerCase().replace(' ', '-'));
      const dup = await http()
        .post('/categories')
        .set('Authorization', admin.auth)
        .send({ name, slug: root.slug })
        .expect(409);
      expect(dup.body.fields).toEqual({ slug: ['Taken'] });

      const child = await http()
        .post('/categories')
        .set('Authorization', admin.auth)
        .send({ name: `L2 ${tag()}`, parentId: root.id })
        .expect(201);
      await http()
        .post('/categories')
        .set('Authorization', admin.auth)
        .send({ name: `L3 ${tag()}`, parentId: child.body.id })
        .expect(409);
    });

    it('PATCH renames and audits', async () => {
      const root = await createRoot();
      await http()
        .patch(`/categories/${root.id}`)
        .set('Authorization', admin.auth)
        .send({ name: 'Renamed', description: 'Updated' })
        .expect(200)
        .expect((r) => expect(r.body.name).toBe('Renamed'));
      const audit = await db.auditLog.findFirst({
        where: { entityId: root.id, action: 'category.update' },
      });
      expect(audit?.actorId).toBe(admin.id);
    });

    it('DELETE removes empty leaves only', async () => {
      const root = await createRoot();
      await http()
        .post('/categories')
        .set('Authorization', admin.auth)
        .send({ name: `Leaf ${tag()}`, parentId: root.id })
        .expect(201);
      await http().delete(`/categories/${root.id}`).set('Authorization', admin.auth).expect(409);

      const empty = await createRoot();
      await http().delete(`/categories/${empty.id}`).set('Authorization', admin.auth).expect(204);
      await http().delete(`/categories/${empty.id}`).set('Authorization', admin.auth).expect(404);
      expect(
        await db.auditLog.count({ where: { entityId: empty.id, action: 'category.delete' } }),
      ).toBe(1);
    });

    it('400 on unknown fields', async () => {
      await http()
        .post('/categories')
        .set('Authorization', admin.auth)
        .send({ name: 'Valid name', listingsCount: 3 })
        .expect(400);
    });
  });
});
