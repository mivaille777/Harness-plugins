import { availableMonitors, currentMonitor, getCurrentWindow, PhysicalPosition, type Monitor } from '@tauri-apps/api/window'
import { positionBesideSelection, type ScreenRect, type FloatingWindowSize } from './position'

function monitorForSelection(monitors: readonly Monitor[], selection: ScreenRect | undefined): Monitor | undefined {
  if (selection === undefined) return undefined
  const centerX = selection.x + selection.width / 2
  const centerY = selection.y + selection.height / 2
  return monitors.find(monitor => (
    centerX >= monitor.position.x
    && centerX < monitor.position.x + monitor.size.width
    && centerY >= monitor.position.y
    && centerY < monitor.position.y + monitor.size.height
  ))
}

/** Convert UIA screen coordinates into a clamped physical window position. */
export async function positionCurrentWindowNearSelection(
  selection: ScreenRect | undefined,
  logicalSize: FloatingWindowSize,
): Promise<void> {
  let monitors: readonly Monitor[] = []
  try {
    monitors = await availableMonitors()
  } catch {
    // Fall back to the monitor containing the current window when enumeration is unavailable.
  }
  const monitor = monitorForSelection(monitors, selection)
    ?? await currentMonitor().catch(() => null)
    ?? monitors[0]
  if (monitor === undefined || monitor === null) return

  const scale = monitor.scaleFactor || 1
  const workArea: ScreenRect = {
    x: monitor.workArea.position.x,
    y: monitor.workArea.position.y,
    width: monitor.workArea.size.width,
    height: monitor.workArea.size.height,
  }
  const position = positionBesideSelection(selection, workArea, {
    width: logicalSize.width * scale,
    height: logicalSize.height * scale,
  })
  await getCurrentWindow().setPosition(new PhysicalPosition(position.x, position.y))
}
