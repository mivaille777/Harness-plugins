import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getBridgeStatus,
  getCaptureStatus,
  getCurrentSelection,
  getInteractionGuardStatus,
  getProcessMemoryStatus,
  getWindowLifecycleStatus,
  listSessions,
  pingBridge,
  type BridgeStatus,
  type CaptureStatus,
  type InteractionStatus,
  type ProcessMemoryStatus,
  type WindowLifecycleStatus,
} from './api/bridge'
import type { LensState } from './lens/store'
import type { LensPerformanceState } from './lens/performance'
import type { SelectionSnapshot } from '../../src/context/snapshot.js'
import { buildDiagnosticsSnapshot, getBridgeHealth, type DiagnosticsInput } from './diagnosticsSnapshot'

interface DiagnosticsPageProps {
  readonly locale: 'en-US' | 'zh-CN'
  readonly lens: LensState
  readonly lensPerformance: LensPerformanceState
  readonly pinnedSnapshot: SelectionSnapshot | null
  readonly sessionId: string | null
  readonly requestId: string | null
  readonly lastEventSequence: number | null
  readonly subscriptionState: string
  readonly onBack: () => void
}

interface LoadResult<T> {
  readonly value: T | null
  readonly error: string | null
}

interface PageState {
  readonly input: DiagnosticsInput
  readonly refreshedAt: number
}

function readResult<T>(result: PromiseSettledResult<T>): LoadResult<T> {
  return result.status === 'fulfilled'
    ? { value: result.value, error: null }
    : { value: null, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }
}

function display(value: unknown, unavailable: string): string {
  if (value === null || value === undefined || value === '') return unavailable
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.length === 0 ? unavailable : value.join(', ')
  return String(value)
}

function statusLabel(locale: 'en-US' | 'zh-CN', status: string): string {
  if (locale !== 'zh-CN') return status
  const labels: Readonly<Record<string, string>> = {
    healthy: '正常',
    unhealthy: '异常',
    disconnected: '未连接',
    unknown: '未知',
    available: '可用',
    unavailable: '不可用',
    'no-selection': '暂无选区',
    'notApplicable': '不适用',
    excluded: '已排除',
    running: '运行中',
    paused: '已暂停',
    publishing: '发布中',
    error: '错误',
  }
  return labels[status] ?? status
}

export default function DiagnosticsPage({
  locale,
  lens,
  lensPerformance,
  pinnedSnapshot,
  sessionId,
  requestId,
  lastEventSequence,
  subscriptionState,
  onBack,
}: DiagnosticsPageProps) {
  const zh = locale === 'zh-CN'
  const [pageState, setPageState] = useState<PageState | null>(null)
  const [loading, setLoading] = useState(false)
  const [copyResult, setCopyResult] = useState<string | null>(null)
  const inFlight = useRef(false)
  const labels = zh ? {
    back: '返回 Lens',
    title: '运行诊断',
    subtitle: '查看选区到 Harness 会话的实时状态。',
    refresh: '刷新状态',
    refreshing: '正在检查…',
    copy: '复制诊断快照',
    copied: '诊断快照已复制。',
    copyFailed: '无法访问剪贴板。',
    privacy: '快照不包含选区正文或对话历史。',
    unavailable: '暂无数据',
    notReported: '宿主未提供',
    updated: '上次检查',
    harness: 'Harness',
    bridge: '连接',
    capture: '采集',
    selection: '选区',
    lens: 'Lens',
    session: '会话',
    runtime: '运行时',
    overall: '链路状态',
    version: 'Harness 版本',
    profile: 'Profile',
    notReportedDetail: '当前宿主未提供 Harness 版本和 Profile。',
    plugin: '插件状态',
    pluginVersion: '插件版本',
    sessionAdapter: 'Session Adapter',
    sessionCount: '可见会话数',
    bridgeHealth: '连接健康度',
    connected: '已连接',
    protocol: '协议版本',
    pipe: '管道',
    latency: '最近延迟',
    reconnects: '重连次数',
    requestTimeouts: '请求超时数',
    memoryScope: '采样进程',
    memoryAvailable: '内存指标',
    workingSet: '工作集',
    privateBytes: '私有内存',
    windowScope: '统计范围',
    windowsCreated: '窗口创建数',
    windowsDestroyed: '窗口销毁数',
    windowsActive: '当前窗口数',
    lastError: '最近错误',
    currentProbe: '选区查询',
    provider: 'Provider',
    captureState: '采集状态',
    lastEvent: '最近事件时间',
    captureLatency: '最近 Provider 读取耗时',
    eventLatencyP50: 'UIA 事件到快照 P50',
    eventLatencyP95: 'UIA 事件到快照 P95',
    fallbackLatencyP50: '回退 Provider 耗时 P50',
    fallbackLatencyP95: '回退 Provider 耗时 P95',
    deduplicated: '去重次数',
    dropped: '丢弃或合并触发',
    snapshotId: 'Snapshot ID',
    revision: 'Revision',
    source: '来源',
    capabilities: '可用能力',
    geometry: '定位精度',
    cacheAge: '缓存时长',
    lensState: 'Lens 状态',
    pinned: '固定选区',
    focusEpoch: '焦点版本',
    passiveEntryP50: '入口显示 P50',
    passiveEntryP95: '入口显示 P95',
    passiveEntrySamples: '入口显示样本数',
    lensInteractiveP50: 'Lens 可交互 P50',
    lensInteractiveP95: 'Lens 可交互 P95',
    lensInteractiveSamples: 'Lens 打开样本数',
    interaction: '交互模式',
    suppressed: '采集抑制',
    boundSession: '绑定会话',
    request: '请求 ID',
    sequence: '最近事件序号',
    subscription: '订阅状态',
    errorPrefix: '错误：',
  } : {
    back: 'Back to Lens',
    title: 'Runtime diagnostics',
    subtitle: 'Live status from selection capture through the Harness session.',
    refresh: 'Refresh status',
    refreshing: 'Checking…',
    copy: 'Copy diagnostics snapshot',
    copied: 'Diagnostics snapshot copied.',
    copyFailed: 'Clipboard is unavailable.',
    privacy: 'The snapshot excludes selected text and conversation history.',
    unavailable: 'No data',
    notReported: 'Not reported by host',
    updated: 'Last checked',
    harness: 'Harness',
    bridge: 'Bridge',
    capture: 'Capture',
    selection: 'Selection',
    lens: 'Lens',
    session: 'Session',
    runtime: 'Runtime',
    overall: 'Overall health',
    version: 'Harness version',
    profile: 'Profile',
    notReportedDetail: 'The current host does not report the Harness version or profile.',
    plugin: 'Plugin loaded',
    pluginVersion: 'Plugin version',
    sessionAdapter: 'Session Adapter',
    sessionCount: 'Available sessions',
    bridgeHealth: 'Bridge health',
    connected: 'Connected',
    protocol: 'Protocol',
    pipe: 'Pipe',
    latency: 'Recent latency',
    reconnects: 'Reconnect count',
    requestTimeouts: 'Request timeouts',
    memoryScope: 'Sampled process',
    memoryAvailable: 'Memory metrics',
    workingSet: 'Working set',
    privateBytes: 'Private bytes',
    windowScope: 'Window scope',
    windowsCreated: 'Windows created',
    windowsDestroyed: 'Windows destroyed',
    windowsActive: 'Windows active',
    lastError: 'Last error',
    currentProbe: 'selection.current',
    provider: 'Provider',
    captureState: 'Capture state',
    lastEvent: 'Last event',
    captureLatency: 'Last provider read',
    eventLatencyP50: 'UIA event to snapshot P50',
    eventLatencyP95: 'UIA event to snapshot P95',
    fallbackLatencyP50: 'Fallback provider P50',
    fallbackLatencyP95: 'Fallback provider P95',
    deduplicated: 'Deduplicated',
    dropped: 'Dropped or coalesced triggers',
    snapshotId: 'Snapshot ID',
    revision: 'Revision',
    source: 'Source',
    capabilities: 'Capabilities',
    geometry: 'Geometry precision',
    cacheAge: 'Cache age',
    lensState: 'Lens state',
    pinned: 'Pinned selection',
    focusEpoch: 'Focus epoch',
    passiveEntryP50: 'Passive entry visible P50',
    passiveEntryP95: 'Passive entry visible P95',
    passiveEntrySamples: 'Passive entry samples',
    lensInteractiveP50: 'Lens interactive P50',
    lensInteractiveP95: 'Lens interactive P95',
    lensInteractiveSamples: 'Lens open samples',
    interaction: 'Interaction mode',
    suppressed: 'Capture suppressed',
    boundSession: 'Bound session',
    request: 'Request ID',
    sequence: 'Last event sequence',
    subscription: 'Subscription state',
    errorPrefix: 'Error: ',
  }

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setCopyResult(null)
    const [pingResult, captureResult, interactionResult, memoryResult, windowLifecycleResult] = await Promise.allSettled([
      pingBridge(),
      getCaptureStatus(),
      getInteractionGuardStatus(),
      getProcessMemoryStatus(),
      getWindowLifecycleStatus(),
    ])
    let bridge = readResult(pingResult)
    if (bridge.error !== null) {
      const [statusResult] = await Promise.allSettled([getBridgeStatus()])
      const status = readResult(statusResult)
      bridge = { value: status.value, error: bridge.error ?? status.error }
    }
    const capture = readResult(captureResult)
    const interaction = readResult(interactionResult)
    const memory: LoadResult<ProcessMemoryStatus> = readResult(memoryResult)
    const windowLifecycle: LoadResult<WindowLifecycleStatus> = readResult(windowLifecycleResult)
    let selection: LoadResult<SelectionSnapshot | null> = { value: null, error: null }
    let sessions: LoadResult<readonly unknown[]> = { value: null, error: null }
    if (bridge.value?.connected) {
      const [selectionResult, sessionsResult] = await Promise.allSettled([
        getCurrentSelection(),
        listSessions(),
      ])
      selection = readResult(selectionResult)
      sessions = readResult(sessionsResult)
    }
    const refreshedAt = Date.now()
    setPageState({
      refreshedAt,
      input: {
        bridge: bridge.value,
        bridgeError: bridge.error,
        capture: capture.value,
        captureError: capture.error,
        interaction: interaction.value,
        interactionError: interaction.error,
        processMemoryStatus: memory.value,
        processMemoryError: memory.error,
        windowLifecycleStatus: windowLifecycle.value,
        windowLifecycleError: windowLifecycle.error,
        selection: selection.value,
        selectionError: selection.error,
        sessionCount: sessions.value?.length ?? null,
        sessionError: sessions.error,
        lens,
        pinnedSnapshot,
        sessionId,
        requestId,
        lastEventSequence,
        subscriptionState,
        generatedAt: refreshedAt,
      },
    })
    inFlight.current = false
    setLoading(false)
  }, [lastEventSequence, lens, pinnedSnapshot, requestId, sessionId, subscriptionState])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 10_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const diagnostics = pageState === null ? null : buildDiagnosticsSnapshot(pageState.input, lensPerformance)
  const bridgeHealth = pageState === null
    ? 'unknown'
    : getBridgeHealth(pageState.input)

  const copySnapshot = useCallback(async () => {
    if (diagnostics === null) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2))
      setCopyResult(labels.copied)
    } catch {
      setCopyResult(labels.copyFailed)
    }
  }, [diagnostics, labels.copyFailed, labels.copied])

  const row = (label: string, value: unknown) => <div className="diagnostic-row" key={label}>
    <dt>{label}</dt>
    <dd>{display(value, labels.unavailable)}</dd>
  </div>
  const errorRow = (label: string, error: string | null) => error === null ? null : row(label, `${labels.errorPrefix}${error}`)
  const capabilityList = pageState?.input.selection === null || pageState?.input.selection === undefined
    ? null
    : Object.entries(pageState.input.selection.capabilities)
      .map(([capability, available]) => `${capability}: ${available ? (zh ? '可用' : 'available') : (zh ? '不可用' : 'unavailable')}`)

  return <main className="diagnostics-page" data-testid="diagnostics-page" lang={locale}>
    <header className="diagnostics-header">
      <button type="button" className="text-button" onClick={onBack}>← {labels.back}</button>
      <div>
        <h1>{labels.title}</h1>
        <p>{labels.subtitle}</p>
      </div>
    </header>
    <div className="diagnostics-actions">
      <span className={`diagnostics-health ${bridgeHealth}`} role="status">{statusLabel(locale, bridgeHealth)}</span>
      <button type="button" className="secondary compact-button" onClick={() => void refresh()} disabled={loading}>{loading ? labels.refreshing : labels.refresh}</button>
      <button type="button" className="secondary compact-button" onClick={() => void copySnapshot()} disabled={diagnostics === null}>{labels.copy}</button>
    </div>
    <p className="diagnostics-meta">{labels.privacy}{pageState === null ? '' : ` · ${labels.updated}: ${new Date(pageState.refreshedAt).toLocaleTimeString(locale)}`}</p>
    {copyResult === null ? null : <p className="diagnostics-feedback" role="status">{copyResult}</p>}
    <div className="diagnostics-grid">
      <section className="diagnostics-card">
        <h2>{labels.harness}</h2>
        <dl>
          {row(labels.overall, diagnostics?.overall)}
          {row(labels.version, labels.notReported)}
          {row(labels.profile, labels.notReported)}
          {row(labels.plugin, diagnostics?.harness.pluginLoaded)}
          {row(labels.pluginVersion, diagnostics?.harness.pluginVersion)}
          {row(labels.sessionAdapter, diagnostics?.harness.sessionAdapter === undefined ? null : statusLabel(locale, diagnostics.harness.sessionAdapter))}
          {row(labels.sessionCount, diagnostics?.harness.sessionCount)}
          {errorRow(labels.lastError, pageState?.input.sessionError ?? null)}
        </dl>
      </section>
      <section className="diagnostics-card">
        <h2>{labels.bridge}</h2>
        <dl>
          {row(labels.bridgeHealth, statusLabel(locale, bridgeHealth))}
          {row(labels.connected, diagnostics?.bridge.connected)}
          {row(labels.protocol, diagnostics?.bridge.protocol)}
          {row(labels.pipe, diagnostics?.bridge.pipe)}
          {row(labels.latency, diagnostics?.bridge.latencyMs === null || diagnostics?.bridge.latencyMs === undefined ? null : `${diagnostics.bridge.latencyMs} ms`)}
          {row(labels.reconnects, diagnostics?.bridge.reconnectCount)}
          {row(labels.requestTimeouts, diagnostics?.bridge.requestTimeoutCount)}
          {errorRow(labels.lastError, diagnostics?.bridge.lastError ?? pageState?.input.bridgeError ?? null)}
          {errorRow(labels.currentProbe, diagnostics?.bridge.selectionCurrentError ?? null)}
        </dl>
      </section>
      <section className="diagnostics-card">
        <h2>{labels.capture}</h2>
        <dl>
          {row(labels.provider, diagnostics?.capture.provider)}
          {row(labels.captureState, diagnostics?.capture.state === null || diagnostics?.capture.state === undefined ? null : statusLabel(locale, diagnostics.capture.state))}
          {row(labels.lastEvent, diagnostics?.capture.lastEventAt === null || diagnostics?.capture.lastEventAt === undefined ? null : new Date(diagnostics.capture.lastEventAt).toLocaleTimeString(locale))}
          {row(labels.captureLatency, diagnostics?.capture.latencyMs === null || diagnostics?.capture.latencyMs === undefined ? null : `${diagnostics.capture.latencyMs} ms`)}
          {row(labels.eventLatencyP50, diagnostics?.capture.eventLatencyP50Ms === null || diagnostics?.capture.eventLatencyP50Ms === undefined ? null : `${diagnostics.capture.eventLatencyP50Ms} ms`)}
          {row(labels.eventLatencyP95, diagnostics?.capture.eventLatencyP95Ms === null || diagnostics?.capture.eventLatencyP95Ms === undefined ? null : `${diagnostics.capture.eventLatencyP95Ms} ms`)}
          {row(labels.fallbackLatencyP50, diagnostics?.capture.fallbackLatencyP50Ms === null || diagnostics?.capture.fallbackLatencyP50Ms === undefined ? null : `${diagnostics.capture.fallbackLatencyP50Ms} ms`)}
          {row(labels.fallbackLatencyP95, diagnostics?.capture.fallbackLatencyP95Ms === null || diagnostics?.capture.fallbackLatencyP95Ms === undefined ? null : `${diagnostics.capture.fallbackLatencyP95Ms} ms`)}
          {row(labels.deduplicated, diagnostics?.capture.deduplicatedCount)}
          {row(labels.dropped, diagnostics?.capture.droppedTriggerCount)}
          {errorRow(labels.lastError, diagnostics?.capture.error ?? pageState?.input.captureError ?? null)}
        </dl>
      </section>
      <section className="diagnostics-card">
        <h2>{labels.runtime}</h2>
        <dl>
          {row(labels.memoryScope, zh ? 'Native Companion 进程' : 'Native Companion process')}
          {row(labels.memoryAvailable, statusLabel(locale, diagnostics?.runtime.processMemoryAvailable ? 'available' : 'unavailable'))}
          {row(labels.workingSet, diagnostics?.runtime.workingSetBytes === null || diagnostics?.runtime.workingSetBytes === undefined ? null : `${(diagnostics.runtime.workingSetBytes / (1024 * 1024)).toFixed(1)} MiB`)}
          {row(labels.privateBytes, diagnostics?.runtime.privateBytes === null || diagnostics?.runtime.privateBytes === undefined ? null : `${(diagnostics.runtime.privateBytes / (1024 * 1024)).toFixed(1)} MiB`)}
          {errorRow(labels.lastError, diagnostics?.runtime.memoryError ?? null)}
          {row(labels.windowScope, zh ? 'Tauri 配置窗口，自进程启动累计' : 'Tauri configured windows, counted since process start')}
          {row(labels.windowsCreated, diagnostics?.runtime.windowCreatedCount)}
          {row(labels.windowsDestroyed, diagnostics?.runtime.windowDestroyedCount)}
          {row(labels.windowsActive, diagnostics?.runtime.windowActiveCount)}
          {errorRow(labels.lastError, diagnostics?.runtime.windowLifecycleError ?? null)}
        </dl>
      </section>
      <section className="diagnostics-card">
        <h2>{labels.selection}</h2>
        <dl>
          {row(labels.snapshotId, diagnostics?.selection.snapshotId)}
          {row(labels.revision, diagnostics?.selection.revision)}
          {row(labels.source, diagnostics?.selection.sourceApp ?? diagnostics?.selection.sourceKind)}
          {row(labels.capabilities, capabilityList)}
          {row(labels.geometry, diagnostics?.selection.geometryPrecision)}
          {row(labels.cacheAge, diagnostics?.selection.cacheAgeMs === null || diagnostics?.selection.cacheAgeMs === undefined ? null : `${diagnostics.selection.cacheAgeMs} ms`)}
          {errorRow(labels.lastError, diagnostics?.selection.error ?? null)}
        </dl>
      </section>
      <section className="diagnostics-card">
        <h2>{labels.lens}</h2>
        <dl>
          {row(labels.lensState, diagnostics?.lens.state)}
          {row(labels.pinned, diagnostics?.lens.pinnedSnapshotId === null || diagnostics?.lens.pinnedSnapshotId === undefined ? null : `${diagnostics.lens.pinnedSnapshotId} · r${diagnostics.lens.pinnedRevision}`)}
          {row(labels.focusEpoch, diagnostics?.lens.focusEpoch)}
          {row(labels.passiveEntryP50, diagnostics?.lens.passiveEntryVisibleLatencyP50Ms === null || diagnostics?.lens.passiveEntryVisibleLatencyP50Ms === undefined ? null : `${diagnostics.lens.passiveEntryVisibleLatencyP50Ms.toFixed(1)} ms`)}
          {row(labels.passiveEntryP95, diagnostics?.lens.passiveEntryVisibleLatencyP95Ms === null || diagnostics?.lens.passiveEntryVisibleLatencyP95Ms === undefined ? null : `${diagnostics.lens.passiveEntryVisibleLatencyP95Ms.toFixed(1)} ms`)}
          {row(labels.passiveEntrySamples, diagnostics?.lens.passiveEntryVisibleSampleCount)}
          {row(labels.lensInteractiveP50, diagnostics?.lens.lensInteractiveLatencyP50Ms === null || diagnostics?.lens.lensInteractiveLatencyP50Ms === undefined ? null : `${diagnostics.lens.lensInteractiveLatencyP50Ms.toFixed(1)} ms`)}
          {row(labels.lensInteractiveP95, diagnostics?.lens.lensInteractiveLatencyP95Ms === null || diagnostics?.lens.lensInteractiveLatencyP95Ms === undefined ? null : `${diagnostics.lens.lensInteractiveLatencyP95Ms.toFixed(1)} ms`)}
          {row(labels.lensInteractiveSamples, diagnostics?.lens.lensInteractiveSampleCount)}
          {row(labels.interaction, diagnostics?.lens.interactionMode)}
          {row(labels.suppressed, diagnostics?.lens.captureSuppressed)}
          {errorRow(labels.lastError, diagnostics?.lens.interactionError ?? null)}
        </dl>
      </section>
      <section className="diagnostics-card">
        <h2>{labels.session}</h2>
        <dl>
          {row(labels.boundSession, diagnostics?.session.boundSessionId)}
          {row(labels.request, diagnostics?.session.requestId)}
          {row(labels.sequence, diagnostics?.session.lastEventSequence)}
          {row(labels.subscription, diagnostics?.session.subscriptionState)}
        </dl>
      </section>
    </div>
    <p className="diagnostics-meta diagnostics-host-note">{labels.notReportedDetail}</p>
  </main>
}
