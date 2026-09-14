/** Locale-owned product copy for the Selection Companion surface. */
export type AppLocale = 'en-US' | 'zh-CN'

export interface AppCopy {
  readonly locale: AppLocale
  readonly close: string
  readonly brandTagline: string
  readonly sessionAriaLabel: string
  readonly sessionSelectAriaLabel: string
  readonly sessionTitle: string
  readonly sessionCaption: string
  readonly newSession: string
  readonly noSession: string
  readonly untitledSession: string
  readonly sessionRunning: string
  readonly sessionQueued: string
  readonly sessionIdle: string
  readonly sessionReady: string
  readonly sessionUnavailable: string
  readonly navigationUnavailable: string
  readonly restoringHistory: string
  readonly historyLoadFailed: string
  readonly historyLabel: string
  readonly historyAriaLabel: string
  readonly messages: (count: number) => string
  readonly you: string
  readonly harness: string
  readonly emptyTitle: string
  readonly emptyDescription: string
  readonly refreshSelection: string
  readonly currentSelection: string
  readonly selectionUpdated: string
  readonly materialAriaLabel: string
  readonly fixedMaterial: (revision: number) => string
  readonly contextLabel: string
  readonly contextDescription: string
  readonly contextNone: string
  readonly contextBefore: string
  readonly contextAfter: string
  readonly contextSection: string
  readonly contextPage: string
  readonly contextScopeLabel: string
  readonly contextScopeLocal: string
  readonly contextScopeSection: string
  readonly contextScopePage: string
  readonly contextLoad: string
  readonly contextLoading: string
  readonly contextComplete: string
  readonly contextPartial: string
  readonly contextTruncated: string
  readonly contextChanged: string
  readonly contextAuthorizationSelection: string
  readonly contextAuthorizationExpanded: (scope: string) => string
  readonly contextAuthorize: (scope: string) => string
  readonly askLabel: string
  readonly askPlaceholder: string
  readonly explain: string
  readonly ask: string
  readonly useLatest: string
  readonly answerLabel: string
  readonly copyAnswer: string
  readonly answerCopied: string
  readonly copyUnavailable: string
  readonly copyFailed: string
  readonly stopSession: string
  readonly retrySafely: string
  readonly pauseCapture: string
  readonly resumeCapture: string
  readonly phaseLabels: Readonly<Record<string, string>>
}

const english: AppCopy = {
  locale: 'en-US',
  close: 'Close selection companion',
  brandTagline: 'Context, kept in view',
  sessionAriaLabel: 'Harness sessions',
  sessionSelectAriaLabel: 'Harness session',
  sessionTitle: 'Session',
  sessionCaption: 'Durable Harness history',
  newSession: 'New session',
  noSession: 'New session on first request',
  untitledSession: 'Untitled Harness session',
  sessionRunning: 'Running',
  sessionQueued: 'Queued',
  sessionIdle: 'Idle',
  sessionReady: 'Ready',
  sessionUnavailable: 'Unavailable',
  navigationUnavailable: 'Full Harness navigation is unavailable through the current host; this history uses the same durable session.',
  restoringHistory: 'Restoring durable session history…',
  historyLoadFailed: 'The session could not be restored. Choose another session or retry.',
  historyLabel: 'Conversation history',
  historyAriaLabel: 'Durable session history',
  messages: count => `${count} message${count === 1 ? '' : 's'}`,
  you: 'You',
  harness: 'Harness',
  emptyTitle: 'Select text to begin',
  emptyDescription: 'Select non-sensitive browser text, then refresh it here.',
  refreshSelection: 'Refresh selection',
  currentSelection: 'Current selection',
  selectionUpdated: 'Latest browser selection is now shown.',
  materialAriaLabel: 'Fixed source material',
  fixedMaterial: revision => `Fixed material · revision ${revision}`,
  contextLabel: 'Captured context',
  contextDescription: 'Only context already captured with this selection is shown. Loading context is a preview only; expanded text is used only after explicit authorization.',
  contextNone: 'No surrounding context was captured for this selection.',
  contextBefore: 'Before selection',
  contextAfter: 'After selection',
  contextSection: 'Section context',
  contextPage: 'Page context',
  contextScopeLabel: 'Scope to show',
  contextScopeLocal: 'Nearby text',
  contextScopeSection: 'Current section',
  contextScopePage: 'Captured page',
  contextLoad: 'Load context',
  contextLoading: 'Loading context…',
  contextComplete: 'Context loaded completely',
  contextPartial: 'Context loaded partially',
  contextTruncated: 'bounded for this response',
  contextChanged: 'The selection changed before context finished loading. Refresh and try again.',
  contextAuthorizationSelection: 'This request is authorized for: Selection only',
  contextAuthorizationExpanded: scope => `This request is authorized for: Selection + ${scope} context`,
  contextAuthorize: scope => `Use ${scope} context for this request`,
  askLabel: 'Ask about this selection',
  askPlaceholder: 'Ask a follow-up question',
  explain: 'Explain',
  ask: 'Ask',
  useLatest: 'Use latest selection',
  answerLabel: 'Harness answer',
  copyAnswer: 'Copy answer',
  answerCopied: 'Answer copied to clipboard.',
  copyUnavailable: 'Clipboard is unavailable in this window.',
  copyFailed: 'The answer could not be copied.',
  stopSession: 'Stop session',
  retrySafely: 'Retry safely',
  pauseCapture: 'Pause capture',
  resumeCapture: 'Resume capture',
  phaseLabels: {
    idle: 'No request active',
    submitting: 'Submitting request',
    queued: 'Waiting for Harness',
    streaming: 'Receiving answer',
    cancelling: 'Stopping session',
    completed: 'Answer complete',
    cancelled: 'Session stopped',
    error: 'Request failed',
    'connection-lost': 'Connection lost',
    'submission-unknown': 'Submission status unknown',
  },
}

const simplifiedChinese: AppCopy = {
  ...english,
  locale: 'zh-CN',
  close: '关闭选区助手',
  brandTagline: '让上下文始终可见',
  sessionAriaLabel: 'Harness 会话',
  sessionSelectAriaLabel: 'Harness 会话选择',
  sessionTitle: '会话',
  sessionCaption: 'Harness 持久历史',
  newSession: '新建会话',
  noSession: '首次请求时新建会话',
  untitledSession: '未命名 Harness 会话',
  sessionRunning: '运行中',
  sessionQueued: '排队中',
  sessionIdle: '空闲',
  sessionReady: '就绪',
  sessionUnavailable: '不可用',
  navigationUnavailable: '当前宿主暂不提供完整 Harness 导航；此处显示同一持久会话的历史。',
  restoringHistory: '正在恢复持久会话历史…',
  historyLoadFailed: '无法恢复该会话。请选择其他会话或重试。',
  historyLabel: '对话历史',
  historyAriaLabel: '持久会话历史',
  messages: count => `${count} 条消息`,
  you: '你',
  harness: 'Harness',
  emptyTitle: '选择文本开始',
  emptyDescription: '请在浏览器中选择非敏感文本，然后在此刷新。',
  refreshSelection: '刷新选区',
  currentSelection: '当前选区',
  selectionUpdated: '已显示最新浏览器选区。',
  materialAriaLabel: '固定来源材料',
  fixedMaterial: revision => `已固定材料 · 修订 ${revision}`,
  contextLabel: '已捕获上下文',
  contextDescription: '这里只展示随选区一起捕获的上下文。加载上下文仅用于预览；只有经过明确授权后，扩展文本才可用于请求。',
  contextNone: '该选区没有捕获到周边上下文。',
  contextBefore: '选区之前',
  contextAfter: '选区之后',
  contextSection: '段落上下文',
  contextPage: '页面上下文',
  contextScopeLabel: '显示范围',
  contextScopeLocal: '邻近文本',
  contextScopeSection: '当前段落',
  contextScopePage: '已捕获页面',
  contextLoad: '加载上下文',
  contextLoading: '正在加载上下文…',
  contextComplete: '上下文已完整加载',
  contextPartial: '上下文已部分加载',
  contextTruncated: '已按响应上限截断',
  contextChanged: '加载上下文前选区已变化。请刷新后重试。',
  contextAuthorizationSelection: '本次请求已授权：仅当前选区',
  contextAuthorizationExpanded: scope => `本次请求已授权：当前选区 + ${scope} 上下文`,
  contextAuthorize: scope => `将 ${scope} 上下文用于本次请求`,
  askLabel: '针对当前选区提问',
  askPlaceholder: '输入追问',
  explain: '解释',
  ask: '提问',
  useLatest: '使用最新选区',
  answerLabel: 'Harness 回答',
  copyAnswer: '复制回答',
  answerCopied: '回答已复制到剪贴板。',
  copyUnavailable: '当前窗口无法使用剪贴板。',
  copyFailed: '无法复制回答。',
  stopSession: '停止会话',
  retrySafely: '安全重试',
  pauseCapture: '暂停采集',
  resumeCapture: '恢复采集',
  phaseLabels: {
    idle: '没有活动请求',
    submitting: '正在提交请求',
    queued: '等待 Harness',
    streaming: '正在接收回答',
    cancelling: '正在停止会话',
    completed: '回答完成',
    cancelled: '会话已停止',
    error: '请求失败',
    'connection-lost': '连接已断开',
    'submission-unknown': '提交状态未知',
  },
}

/** Select product copy from the browser locale without making locale a runtime setting. */
export function getAppCopy(language = typeof navigator === 'undefined' ? '' : navigator.language): AppCopy {
  return language.toLowerCase().startsWith('zh') ? simplifiedChinese : english
}
