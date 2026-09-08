/** Locale-owned product copy for the Selection Companion surface. */
export type AppLocale = 'en-US' | 'zh-CN'

export interface AppCopy {
  readonly locale: AppLocale
  readonly close: string
  readonly brandTagline: string
  readonly sessionAriaLabel: string
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
  readonly messages: (count: number) => string
  readonly you: string
  readonly harness: string
  readonly emptyTitle: string
  readonly emptyDescription: string
  readonly refreshSelection: string
  readonly fixedMaterial: (revision: number) => string
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
  messages: count => `${count} message${count === 1 ? '' : 's'}`,
  you: 'You',
  harness: 'Harness',
  emptyTitle: 'Select text to begin',
  emptyDescription: 'Select non-sensitive browser text, then refresh it here.',
  refreshSelection: 'Refresh selection',
  fixedMaterial: revision => `Fixed material · revision ${revision}`,
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
  messages: count => `${count} 条消息`,
  you: '你',
  harness: 'Harness',
  emptyTitle: '选择文本开始',
  emptyDescription: '请在浏览器中选择非敏感文本，然后在此刷新。',
  refreshSelection: '刷新选区',
  fixedMaterial: revision => `已固定材料 · 修订 ${revision}`,
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
