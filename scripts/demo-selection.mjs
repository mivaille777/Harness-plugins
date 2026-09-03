import { Context } from '@deepseek-ai/cordis'
import { SelectionContextService } from '../lib/index.js'

const ctx = new Context()
const service = new SelectionContextService(ctx)

const result = service.update({
  id: 'demo-selection-1',
  revision: 1,
  capturedAt: Date.now(),
  selection: {
    text: 'Gaussian-process posterior uncertainty',
  },
  source: {
    kind: 'browser',
    app: 'Chrome',
    process: 'chrome.exe',
    windowTitle: 'Safe Bayesian Optimization',
  },
  document: {
    title: 'Safe Bayesian Optimization',
    url: 'https://example.test/paper',
    section: '3.2 Acquisition Function',
  },
  context: {
    before: 'The acquisition function uses the posterior.',
    after: 'The next paragraph discusses exploitation.',
    pageAvailable: true,
  },
  capabilities: {
    localContext: true,
    sectionContext: false,
    pageContext: true,
    screenshot: false,
  },
  geometry: {
    x: 100,
    y: 100,
    width: 320,
    height: 28,
  },
  provider: 'demo-browser-provider',
  confidence: 1,
})

if (!result.accepted) {
  console.error('Demo snapshot was rejected:', result.reason)
  process.exitCode = 1
} else {
  console.log(JSON.stringify(service.current(), null, 2))
}
