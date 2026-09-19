/**
 * Example suite with the defects Vigía detects.
 *
 * All six pass in Jest. None of them verify anything.
 */

describe('cart', () => {
  it('calculates the total', () => {
    const total = sum([10, 20]);
    // Missing expect: the test passes even if sum() returns garbage.
  });

  it('applies the discount', () => {
    expect(applyDiscount(100, 10));
  });

  it('cart exists', () => {
    expect(true).toBe(true);
  });

  it.skip('validates an expired coupon', () => {
    expect(validateCoupon('EXPIRED')).toBe(false);
  });

  it.only('adds tax', () => {
    expect(withTax(100)).toBe(116);
  });

  it('rejects an unknown coupon', async () => {
    // No await: the promise resolves after the test has already ended.
    expect(findCoupon('MISSING')).rejects.toThrow();
  });
});

declare function sum(values: number[]): number;
declare function applyDiscount(amount: number, pct: number): number;
declare function validateCoupon(code: string): boolean;
declare function withTax(amount: number): number;
declare function findCoupon(code: string): Promise<unknown>;
