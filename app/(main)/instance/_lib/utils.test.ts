// Issue #68: CPU percent must be a delta over time normalized by core count,
// and instances without `limits.cpu` must use the host core count (not 1).
import { describe, expect, test } from 'bun:test';
import type { Instance } from '../../instances/_lib/instances.d';
import { calcCpuPercent, getCPUCount } from './utils';

const instance = (config: Record<string, string>) =>
  ({ config }) as unknown as Instance;

describe('calcCpuPercent', () => {
  test('full load across cores normalizes to 100%', () => {
    // 2 cores fully busy for 1s => 2s CPU time in 1s wall time.
    expect(calcCpuPercent(2_000_000_000, 1_000_000_000, 2)).toBe(100);
  });

  test('half load on one core yields 50%', () => {
    expect(calcCpuPercent(500_000_000, 1_000_000_000, 1)).toBe(50);
  });

  test('invalid window or reset counter yields 0, not negative', () => {
    expect(calcCpuPercent(-1, 1_000_000_000, 2)).toBe(0);
    expect(calcCpuPercent(100, 0, 2)).toBe(0);
    expect(calcCpuPercent(100, -5, 2)).toBe(0);
  });
});

describe('getCPUCount', () => {
  test('simple limit is the count', () => {
    expect(getCPUCount(instance({ 'limits.cpu': '4' }))).toBe(4);
  });

  test('list limit counts entries', () => {
    expect(getCPUCount(instance({ 'limits.cpu': '0,2,4' }))).toBe(3);
  });

  test('range limit spans the endpoints inclusively', () => {
    expect(getCPUCount(instance({ 'limits.cpu': '0-3' }))).toBe(4);
  });

  test('without a limit the host core count is used', () => {
    expect(getCPUCount(instance({}), 8)).toBe(8);
  });

  test('without any data at all it defaults to 1 core', () => {
    expect(getCPUCount(instance({}))).toBe(1);
  });
});
