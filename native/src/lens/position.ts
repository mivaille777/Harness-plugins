export interface ScreenRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface FloatingWindowSize {
  readonly width: number
  readonly height: number
}

/** Place a window beside the captured element and keep it inside the monitor work area. */
export function positionBesideSelection(
  selection: ScreenRect | null | undefined,
  workArea: ScreenRect,
  windowSize: FloatingWindowSize,
  gap = 10,
): { readonly x: number; readonly y: number } {
  const maxX = workArea.x + Math.max(0, workArea.width - windowSize.width)
  const maxY = workArea.y + Math.max(0, workArea.height - windowSize.height)
  if (selection === null || selection === undefined) {
    return {
      x: Math.round(workArea.x + Math.max(0, workArea.width - windowSize.width) / 2),
      y: Math.round(workArea.y + Math.max(0, workArea.height - windowSize.height) / 2),
    }
  }

  const right = selection.x + selection.width + gap
  const left = selection.x - gap - windowSize.width
  const candidateX = right + windowSize.width <= workArea.x + workArea.width ? right : left
  const candidateY = selection.y + selection.height / 2 - windowSize.height / 2
  return {
    x: Math.round(Math.min(maxX, Math.max(workArea.x, candidateX))),
    y: Math.round(Math.min(maxY, Math.max(workArea.y, candidateY))),
  }
}
