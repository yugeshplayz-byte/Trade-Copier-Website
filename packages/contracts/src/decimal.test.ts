import { describe, expect, it } from 'vitest';
import {
  DecimalFormatError,
  TickAlignmentError,
  compareDecimal,
  normalizeDecimal,
  priceToTicks,
  tickMoney,
  ticksToPrice,
} from './decimal.ts';

describe('priceToTicks / ticksToPrice', () => {
  it('converts exactly for quarter-point contracts', () => {
    expect(priceToTicks('21012.75', '0.25')).toBe(84051);
    expect(ticksToPrice(84051, '0.25')).toBe('21012.75');
    expect(ticksToPrice(84052, '0.25')).toBe('21013');
  });

  it('handles fine tick sizes without floating point drift', () => {
    // 0.1 + 0.2 style errors would break a float implementation.
    expect(priceToTicks('1.0835', '0.0001')).toBe(10835);
    expect(priceToTicks('0.3', '0.1')).toBe(3);
    expect(ticksToPrice(3, '0.1')).toBe('0.3');
    expect(priceToTicks('3.140625', '0.015625')).toBe(201); // 1/64 tick
  });

  it('refuses to round an unaligned price', () => {
    expect(() => priceToTicks('21012.80', '0.25')).toThrow(TickAlignmentError);
    expect(() => priceToTicks('1.00005', '0.0001')).toThrow(TickAlignmentError);
  });

  it('supports negative prices', () => {
    expect(priceToTicks('-37.63', '0.01')).toBe(-3763);
    expect(ticksToPrice(-3763, '0.01')).toBe('-37.63');
  });

  it.each(['1e3', ' 1', '1.', '.5', 'NaN', '', '0x10', '1,000.25', '١٢'])('rejects malformed decimal %j', (bad) => {
    expect(() => priceToTicks(bad, '0.25')).toThrow(DecimalFormatError);
  });

  it('rejects non-positive tick sizes and unsafe tick counts', () => {
    expect(() => priceToTicks('1', '0')).toThrow(DecimalFormatError);
    expect(() => priceToTicks('1', '-0.25')).toThrow(DecimalFormatError);
    expect(() => priceToTicks('999999999999999999999', '0.000001')).toThrow(RangeError);
    expect(() => ticksToPrice(1.5, '0.25')).toThrow(RangeError);
  });
});

describe('tickMoney', () => {
  it('computes exact signed amounts', () => {
    // MNQ: 0.25 tick, $0.50 per tick per contract.
    expect(tickMoney(8, 3, '0.50')).toBe('12');
    expect(tickMoney(-5, 2, '12.50')).toBe('-125');
    expect(tickMoney(1, 1, '0.0001')).toBe('0.0001');
    expect(tickMoney(0, 10, '5')).toBe('0');
  });
});

describe('normalizeDecimal / compareDecimal', () => {
  it('canonicalises and compares exactly', () => {
    expect(normalizeDecimal('12.5000')).toBe('12.5');
    expect(normalizeDecimal('-0.00')).toBe('0');
    expect(compareDecimal('0.30', '0.3')).toBe(0);
    expect(compareDecimal('0.1', '0.10001')).toBe(-1);
    expect(compareDecimal('-1', '-2')).toBe(1);
  });
});
