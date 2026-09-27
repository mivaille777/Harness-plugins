import { describe, expect, it } from 'vitest'
import { positionBesideSelection } from './position'

const workArea = { x: 0, y: 0, width: 1920, height: 1040 }

describe('floating window placement', () => {
  it('places a compact entry beside the selection and centers it vertically', () => {
    expect(positionBesideSelection(
      { x: 500, y: 300, width: 220, height: 24 },
      workArea,
      { width: 44, height: 44 },
    )).toEqual({ x: 730, y: 290 })
  })

  it('uses the left side when there is not enough room on the right', () => {
    expect(positionBesideSelection(
      { x: 1840, y: 600, width: 50, height: 28 },
      workArea,
      { width: 420, height: 580 },
    )).toEqual({ x: 1410, y: 324 })
  })

  it('clamps to negative-origin work areas and keeps the window on screen', () => {
    expect(positionBesideSelection(
      { x: -1400, y: -900, width: 80, height: 20 },
      { x: -1600, y: -1000, width: 1600, height: 900 },
      { width: 420, height: 580 },
    )).toEqual({ x: -1310, y: -1000 })
  })

  it('clamps a zero-size pointer anchor at the bottom-right of a negative-origin monitor', () => {
    expect(positionBesideSelection(
      { x: -1, y: 710, width: 0, height: 0 },
      { x: -1280, y: 0, width: 1280, height: 720 },
      { width: 420, height: 580 },
    )).toEqual({ x: -431, y: 140 })
  })

  it('centers on the available work area when selection geometry is missing', () => {
    expect(positionBesideSelection(null, workArea, { width: 44, height: 44 }))
      .toEqual({ x: 938, y: 498 })
  })
})
