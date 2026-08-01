import { describe, expect, it } from 'vitest'
import {
  clampTension,
  DEFAULT_TENSION,
  TENSION_MAX,
  TENSION_MIN
} from '../src/renderer/src/lib/plotGraph'

describe('clampTension', () => {
  it('rounds to the nearest whole number', () => {
    expect(clampTension(3.4)).toBe(3)
    expect(clampTension(3.6)).toBe(4)
  })

  it('clamps below the minimum', () => {
    expect(clampTension(-5)).toBe(TENSION_MIN)
  })

  it('clamps above the maximum', () => {
    expect(clampTension(50)).toBe(TENSION_MAX)
  })

  it('leaves an in-range whole number untouched', () => {
    expect(clampTension(7)).toBe(7)
  })
})

describe('DEFAULT_TENSION', () => {
  it('sits in the middle of the range', () => {
    expect(DEFAULT_TENSION).toBeGreaterThan(TENSION_MIN)
    expect(DEFAULT_TENSION).toBeLessThan(TENSION_MAX)
  })
})
