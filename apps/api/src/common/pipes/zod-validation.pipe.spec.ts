import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

const pipe = new ZodValidationPipe(
  z.object({ email: z.string().email(), age: z.number().min(18) }).strict(),
);

describe('ZodValidationPipe', () => {
  it('returns parsed data', () => {
    expect(pipe.transform({ email: 'a@b.co', age: 30 })).toEqual({ email: 'a@b.co', age: 30 });
  });

  it('groups issues by field', () => {
    try {
      pipe.transform({ email: 'nope', age: 3, extra: 1 });
      fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const body = (e as BadRequestException).getResponse() as { fields: Record<string, string[]> };
      expect(Object.keys(body.fields).sort()).toEqual(['_', 'age', 'email']);
    }
  });
});
