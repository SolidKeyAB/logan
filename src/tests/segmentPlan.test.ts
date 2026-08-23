import { describe, it, expect } from 'vitest';
import {
  computeSegmentPlan,
  INDEX_BYTES_PER_FILE_BYTE,
  SystemMemory,
} from '../main/segmentPlan';

const GiB = 1024 * 1024 * 1024;
const MiB = 1024 * 1024;

describe('computeSegmentPlan — adaptive, system-relative segmentation policy', () => {
  it('does NOT segment a file whose whole index fits the budget', () => {
    const mem: SystemMemory = { freeBytes: 16 * GiB, heapLimitBytes: 8 * GiB, heapUsedBytes: 1 * GiB };
    const plan = computeSegmentPlan(50 * MiB, mem); // ~10 MiB index, huge budget
    expect(plan.shouldSegment).toBe(false);
    expect(plan.totalSegments).toBe(1);
    expect(plan.maxResidentSegments).toBe(1);
  });

  it('segments a huge file and keeps resident index within budget', () => {
    const mem: SystemMemory = { freeBytes: 2 * GiB, heapLimitBytes: 4 * GiB, heapUsedBytes: 0.5 * GiB };
    const fileSize = 50 * GiB; // ~10 GiB whole index — far over budget
    const plan = computeSegmentPlan(fileSize, mem);

    expect(plan.shouldSegment).toBe(true);
    // Budget = 0.4 * min(free=2GiB, headroom=3.5GiB) = 0.8 GiB.
    expect(plan.budgetBytes).toBe(Math.floor(0.4 * 2 * GiB));
    // The whole point: the resident fine-index stays within the budget.
    expect(plan.estResidentIndexBytes).toBeLessThanOrEqual(plan.budgetBytes);
    // Segments must cover the whole file.
    expect(plan.totalSegments * plan.segmentBytes).toBeGreaterThanOrEqual(fileSize);
    expect(plan.maxResidentSegments).toBeGreaterThanOrEqual(2);
    expect(plan.maxResidentSegments).toBeLessThanOrEqual(plan.totalSegments);
  });

  it('is bound by V8 heap headroom even when physical RAM is plentiful', () => {
    // 64 GiB free, but the process heap is nearly maxed → tiny real budget.
    const mem: SystemMemory = { freeBytes: 64 * GiB, heapLimitBytes: 2 * GiB, heapUsedBytes: 1.9 * GiB };
    const plan = computeSegmentPlan(10 * GiB, mem);
    expect(plan.shouldSegment).toBe(true);
    // Budget is driven by the 0.1 GiB heap headroom, not the 64 GiB of free RAM.
    expect(plan.budgetBytes).toBe(Math.floor(0.4 * 0.1 * GiB));
    expect(plan.estResidentIndexBytes).toBeLessThanOrEqual(plan.budgetBytes);
    expect(plan.totalSegments * plan.segmentBytes).toBeGreaterThanOrEqual(10 * GiB);
  });

  it('estimates whole-file index at 16 bytes / 80 bytes = 0.2 × file size', () => {
    const mem: SystemMemory = { freeBytes: 1 * GiB, heapLimitBytes: 8 * GiB, heapUsedBytes: 0 };
    const plan = computeSegmentPlan(1 * GiB, mem);
    expect(plan.estWholeIndexBytes).toBe(Math.ceil(1 * GiB * INDEX_BYTES_PER_FILE_BYTE));
  });

  it('respects an explicit desiredResidentSegments', () => {
    const mem: SystemMemory = { freeBytes: 4 * GiB, heapLimitBytes: 8 * GiB, heapUsedBytes: 0.5 * GiB };
    const plan = computeSegmentPlan(100 * GiB, mem, { desiredResidentSegments: 8, minSegmentBytes: 1 * MiB });
    expect(plan.shouldSegment).toBe(true);
    expect(plan.estResidentIndexBytes).toBeLessThanOrEqual(plan.budgetBytes);
  });

  it('handles a zero-memory snapshot without dividing by zero', () => {
    const mem: SystemMemory = { freeBytes: 0, heapLimitBytes: 0, heapUsedBytes: 0 };
    const plan = computeSegmentPlan(10 * GiB, mem);
    // Budget is 0 → nothing is "affordable", so we do not claim segmentation helps.
    expect(plan.shouldSegment).toBe(false);
    expect(Number.isFinite(plan.segmentBytes)).toBe(true);
  });
});
