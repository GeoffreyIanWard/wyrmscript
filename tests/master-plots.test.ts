import { describe, expect, it } from 'vitest'
import { findMasterPlot, MASTER_PLOTS, sampleMasterPlot } from '../src/renderer/src/lib/masterPlots'
import { TENSION_MAX, TENSION_MIN } from '../src/renderer/src/lib/plotGraph'

/**
 * F-35: a preset is a fixed shape and a manuscript has an arbitrary scene
 * count, so the thing that can actually go wrong here is the stretch —
 * a shape sampled to the wrong length, or one that drifts outside the
 * tension scale the real curve is drawn against.
 */

describe('the master-plot presets', () => {
  it('gives every preset a unique id', () => {
    const ids = MASTER_PLOTS.map((p) => p.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('starts every preset at position 0 and ends at position 1', () => {
    // The stretch assumes the shape spans the whole story; a preset that
    // stopped at 0.8 would silently flatten across its last fifth.
    for (const plot of MASTER_PLOTS) {
      expect(plot.points[0][0]).toBe(0)
      expect(plot.points[plot.points.length - 1][0]).toBe(1)
    }
  })

  it('keeps every control point inside the same tension scale as a real scene', () => {
    for (const plot of MASTER_PLOTS) {
      for (const [, tension] of plot.points) {
        expect(tension).toBeGreaterThanOrEqual(TENSION_MIN)
        expect(tension).toBeLessThanOrEqual(TENSION_MAX)
      }
    }
  })

  it('finds a preset by id, and nothing for an unknown one', () => {
    expect(findMasterPlot('rags-to-riches')?.name).toBe('Rags to Riches')
    expect(findMasterPlot('no-such-shape')).toBeUndefined()
  })
})

describe('stretching a preset across a manuscript', () => {
  const rags = findMasterPlot('rags-to-riches')!

  it('returns exactly one value per scene', () => {
    expect(sampleMasterPlot(rags, 7)).toHaveLength(7)
    expect(sampleMasterPlot(rags, 40)).toHaveLength(40)
  })

  it('anchors the first and last samples to the shape’s own endpoints', () => {
    const sampled = sampleMasterPlot(rags, 9)

    expect(sampled[0]).toBe(1)
    expect(sampled[sampled.length - 1]).toBe(10)
  })

  it('interpolates between control points rather than stepping between them', () => {
    // Rags to Riches is a straight climb 1 → 5 → 10; the exact midpoint is
    // its middle control point, and the quarter marks land between them.
    const sampled = sampleMasterPlot(rags, 5)

    expect(sampled[2]).toBe(5)
    expect(sampled[1]).toBeGreaterThan(sampled[0])
    expect(sampled[1]).toBeLessThan(sampled[2])
  })

  it('holds every sample inside the tension scale, for every preset', () => {
    for (const plot of MASTER_PLOTS) {
      for (const tension of sampleMasterPlot(plot, 25)) {
        expect(tension).toBeGreaterThanOrEqual(TENSION_MIN)
        expect(tension).toBeLessThanOrEqual(TENSION_MAX)
      }
    }
  })

  it('returns the shape’s opening value for a single scene', () => {
    // One scene has no span to stretch across — interpolating would invent
    // a position the manuscript does not have.
    expect(sampleMasterPlot(rags, 1)).toEqual([1])
  })

  it('returns nothing for an empty manuscript', () => {
    expect(sampleMasterPlot(rags, 0)).toEqual([])
  })

  it('traces the fall and recovery of a shape that is not monotonic', () => {
    // Man in a Hole drops to its floor around a third of the way in, then
    // climbs above where it started — a flat or monotonic sampler would
    // pass the length checks above while losing the shape entirely.
    const hole = findMasterPlot('man-in-a-hole')!
    const sampled = sampleMasterPlot(hole, 11)
    const lowest = Math.min(...sampled)
    const lowestAt = sampled.indexOf(lowest)

    expect(lowestAt).toBeGreaterThan(0)
    expect(lowestAt).toBeLessThan(sampled.length - 1)
    expect(sampled[sampled.length - 1]).toBeGreaterThan(sampled[0])
  })
})
