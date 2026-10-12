import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CategoryDetailDto,
  CategoryDto,
  CategoryNodeDto,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '@markethub/shared';
import { Prisma, type Category } from '@prisma/client';
import type Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.module';
import { InjectRedis } from '../../redis/redis.module';
import { AuditService } from '../audit/audit.service';
import { slugify } from '../listings/slug';

const TREE_KEY = 'cache:categories:tree';
const TREE_TTL_S = 300;

export const toCategory = (c: Category): CategoryDto => ({
  id: c.id,
  parentId: c.parentId,
  name: c.name,
  slug: c.slug,
  icon: c.icon,
  description: c.description,
  sortOrder: c.sortOrder,
});

const ordered = {
  orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
} satisfies Prisma.CategoryFindManyArgs;

@Injectable()
export class CategoriesService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  /** Two levels (root → children), active only. Read on every page, so cached in Redis. */
  async tree(): Promise<CategoryNodeDto[]> {
    const cached = await this.redis.get(TREE_KEY).catch(() => null);
    if (cached) return JSON.parse(cached) as CategoryNodeDto[];

    const roots = await this.db.category.findMany({
      where: { parentId: null, isActive: true },
      include: { children: { where: { isActive: true }, ...ordered } },
      ...ordered,
    });
    const tree = roots.map((r) => ({ ...toCategory(r), children: r.children.map(toCategory) }));
    await this.redis.set(TREE_KEY, JSON.stringify(tree), 'EX', TREE_TTL_S).catch(() => undefined);
    return tree;
  }

  async bySlug(slug: string): Promise<CategoryDetailDto> {
    const c = await this.db.category.findFirst({
      where: { slug, isActive: true },
      include: { parent: true, children: { where: { isActive: true }, ...ordered } },
    });
    if (!c) throw new NotFoundException('Category not found');
    return {
      ...toCategory(c),
      parent: c.parent && toCategory(c.parent),
      children: c.children.map(toCategory),
    };
  }

  async create(input: CreateCategoryInput, actorId: string, ip?: string): Promise<CategoryDto> {
    await this.assertParent(input.parentId ?? null, null);
    const created = await this.write(() =>
      this.db.$transaction(async (tx) => {
        const c = await tx.category.create({
          data: { ...input, slug: input.slug ?? slugify(input.name) },
        });
        await this.audit.log(
          {
            actorId,
            action: 'category.create',
            entityType: 'category',
            entityId: c.id,
            metadata: { name: c.name, slug: c.slug },
            ipAddress: ip,
          },
          tx,
        );
        return c;
      }),
    );
    return toCategory(created);
  }

  async update(
    id: string,
    input: UpdateCategoryInput,
    actorId: string,
    ip?: string,
  ): Promise<CategoryDto> {
    if (input.parentId !== undefined) await this.assertParent(input.parentId, id);
    const updated = await this.write(() =>
      this.db.$transaction(async (tx) => {
        const c = await tx.category.update({ where: { id }, data: input });
        await this.audit.log(
          {
            actorId,
            action: 'category.update',
            entityType: 'category',
            entityId: id,
            metadata: input as Prisma.InputJsonObject,
            ipAddress: ip,
          },
          tx,
        );
        return c;
      }),
    );
    return toCategory(updated);
  }

  /** Only empty leaves can go; anything in use should be deactivated instead. */
  async remove(id: string, actorId: string, ip?: string) {
    const c = await this.db.category.findUnique({
      where: { id },
      include: { _count: { select: { children: true, listings: true } } },
    });
    if (!c) throw new NotFoundException('Category not found');
    if (c._count.children || c._count.listings) {
      throw new ConflictException(
        'Category has subcategories or listings — set isActive=false instead',
      );
    }
    await this.db.$transaction([
      this.db.category.delete({ where: { id } }),
      this.db.auditLog.create({
        data: {
          actorId,
          action: 'category.delete',
          entityType: 'category',
          entityId: id,
          metadata: { name: c.name, slug: c.slug },
          ipAddress: ip,
        },
      }),
    ]);
    await this.bust();
  }

  /** Two levels only: a parent must itself be a root, and never the category itself. */
  private async assertParent(parentId: string | null, selfId: string | null) {
    if (!parentId) return;
    if (parentId === selfId) throw new ConflictException('A category cannot be its own parent');
    const parent = await this.db.category.findUnique({ where: { id: parentId } });
    if (!parent) throw new NotFoundException('Parent category not found');
    if (parent.parentId) throw new ConflictException('Categories nest two levels deep at most');
    if (selfId && (await this.db.category.count({ where: { parentId: selfId } }))) {
      throw new ConflictException('A category with subcategories must stay at the top level');
    }
  }

  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      const out = await fn();
      await this.bust();
      return out;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') {
          throw new ConflictException({
            message: 'Slug already used',
            fields: { slug: ['Taken'] },
          });
        }
        if (err.code === 'P2025') throw new NotFoundException('Category not found');
      }
      throw err;
    }
  }

  private bust() {
    return this.redis.del(TREE_KEY).catch(() => undefined);
  }
}
