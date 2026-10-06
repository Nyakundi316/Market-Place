import { sanitize } from './transform.interceptor';

class Decimal {
  constructor(private readonly v: string) {}
  toFixed() {
    return this.v;
  }
}

describe('sanitize', () => {
  it('strips secrets at any depth', () => {
    const out = sanitize({
      id: 'u1',
      passwordHash: 'x',
      orders: [{ txn: { gatewayPayload: { pan: '4242' }, amount: 1 } }],
    });
    expect(out).toEqual({ id: 'u1', orders: [{ txn: { amount: 1 } }] });
  });

  it('serialises money, bigints and dates as strings', () => {
    const at = new Date('2026-01-02T03:04:05.000Z');
    expect(sanitize({ total: new Decimal('10.50'), n: 9n, at })).toEqual({
      total: '10.50',
      n: '9',
      at: '2026-01-02T03:04:05.000Z',
    });
  });

  it('passes primitives and null through', () => {
    expect(sanitize(null)).toBeNull();
    expect(sanitize('ok')).toBe('ok');
  });
});
