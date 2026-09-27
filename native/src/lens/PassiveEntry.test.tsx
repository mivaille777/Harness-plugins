import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PassiveEntry from './PassiveEntry'
import type { SelectionSnapshot } from '../../../src/context/snapshot.js'

const eventApi = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  listen: vi.fn(),
  emitTo: vi.fn(),
  unlisten: vi.fn(),
}))
const windowApi = vi.hoisted(() => ({
  show: vi.fn(),
  hide: vi.fn(),
}))
const selectionApi = vi.hoisted(() => ({
  getCaptureStatus: vi.fn(),
  getCurrentSelection: vi.fn(),
}))
const placement = vi.hoisted(() => ({ positionCurrentWindowNearSelection: vi.fn() }))

vi.mock('@tauri-apps/api/event', () => ({ listen: eventApi.listen, emitTo: eventApi.emitTo }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => windowApi }))
vi.mock('../api/bridge', () => ({
  getCaptureStatus: selectionApi.getCaptureStatus,
  getCurrentSelection: selectionApi.getCurrentSelection,
}))
vi.mock('./windowPlacement', () => placement)

const snapshot = {
  id: 'entry-s1',
  revision: 7,
  geometry: {
    x: 300,
    y: 240,
    width: 120,
    height: 22,
    precision: 'element',
    anchorType: 'element',
  },
} as unknown as SelectionSnapshot

describe('PassiveEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventApi.handlers.clear()
    eventApi.listen.mockImplementation(async (name: string, handler: (event: { payload: unknown }) => void) => {
      eventApi.handlers.set(name, handler)
      return eventApi.unlisten
    })
    eventApi.emitTo.mockResolvedValue(undefined)
    windowApi.show.mockResolvedValue(undefined)
    windowApi.hide.mockResolvedValue(undefined)
    selectionApi.getCaptureStatus.mockResolvedValue({ paused: false })
    selectionApi.getCurrentSelection.mockResolvedValue(snapshot)
    placement.positionCurrentWindowNearSelection.mockResolvedValue(undefined)
  })

  it('stays hidden until a matching snapshot arrives, then shows without reading selection text into the entry', async () => {
    render(<PassiveEntry />)
    await waitFor(() => expect(eventApi.handlers.get('selection-captured')).toBeDefined())
    expect(screen.queryByRole('button', { name: 'Open selection Lens' })).not.toBeInTheDocument()

    eventApi.handlers.get('selection-captured')?.({ payload: {
      snapshotId: 'entry-s1',
      revision: 7,
      readyAtMs: Date.now() - 200,
    } })
    const button = await screen.findByRole('button', { name: 'Open selection Lens' })

    expect(placement.positionCurrentWindowNearSelection).toHaveBeenCalledWith(snapshot.geometry, { width: 44, height: 44 })
    expect(windowApi.show).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(eventApi.emitTo).toHaveBeenCalledWith(
      'main',
      'lens-performance-sample',
      expect.objectContaining({ kind: 'passiveEntryVisible', durationMs: expect.any(Number) }),
    ))
    const sample = eventApi.emitTo.mock.calls.find(([, name]) => name === 'lens-performance-sample')?.[2] as { durationMs: number } | undefined
    expect(sample?.durationMs).toBeGreaterThanOrEqual(200)
    expect(screen.getByTestId('passive-entry')).not.toHaveTextContent('selected text')
    expect(button).toBeEnabled()
  })

  it('ignores a stale capture response when a newer event has arrived', async () => {
    let resolveOld: ((value: typeof snapshot) => void) | undefined
    selectionApi.getCurrentSelection
      .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
      .mockResolvedValueOnce({ ...snapshot, id: 'entry-s2', revision: 8 })
    render(<PassiveEntry />)
    await waitFor(() => expect(eventApi.handlers.get('selection-captured')).toBeDefined())

    eventApi.handlers.get('selection-captured')?.({ payload: { snapshotId: 'entry-s1', revision: 7 } })
    eventApi.handlers.get('selection-captured')?.({ payload: { snapshotId: 'entry-s2', revision: 8 } })
    expect(await screen.findByRole('button', { name: 'Open selection Lens' })).toBeInTheDocument()
    resolveOld?.(snapshot)
    await waitFor(() => expect(placement.positionCurrentWindowNearSelection).toHaveBeenCalledTimes(1))
  })

  it('sends the selection identity and click time to the main Lens when clicked', async () => {
    render(<PassiveEntry />)
    await waitFor(() => expect(eventApi.handlers.get('selection-captured')).toBeDefined())
    eventApi.handlers.get('selection-captured')?.({ payload: { snapshotId: 'entry-s1', revision: 7 } })
    const button = await screen.findByRole('button', { name: 'Open selection Lens' })
    windowApi.hide.mockClear()
    fireEvent.click(button)

    await waitFor(() => expect(eventApi.emitTo).toHaveBeenCalledWith(
      'main',
      'lens-open-request',
      expect.objectContaining({ snapshotId: 'entry-s1', revision: 7, requestedAtMs: expect.any(Number) }),
    ))
    expect(windowApi.hide).not.toHaveBeenCalled()
  })

  it('hides and clears the passive entry when capture is paused', async () => {
    render(<PassiveEntry />)
    await waitFor(() => expect(eventApi.handlers.get('selection-captured')).toBeDefined())
    eventApi.handlers.get('selection-captured')?.({ payload: { snapshotId: 'entry-s1', revision: 7 } })
    await screen.findByRole('button', { name: 'Open selection Lens' })
    eventApi.handlers.get('capture-state-changed')?.({ payload: { paused: true } })

    await waitFor(() => expect(windowApi.hide).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Open selection Lens' })).not.toBeInTheDocument()
  })

  it('does not show a delayed selection event while capture is paused', async () => {
    selectionApi.getCaptureStatus.mockResolvedValue({ paused: true })
    render(<PassiveEntry />)
    await waitFor(() => expect(eventApi.handlers.get('selection-captured')).toBeDefined())
    eventApi.handlers.get('selection-captured')?.({ payload: { snapshotId: 'entry-s1', revision: 7 } })

    await waitFor(() => expect(selectionApi.getCaptureStatus).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: 'Open selection Lens' })).not.toBeInTheDocument()
    expect(windowApi.show).not.toHaveBeenCalled()
  })
})
