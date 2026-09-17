import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

function hasTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function BrowserPreview() {
  return <main className="lens browser-preview" data-testid="selection-lens-preview" lang="zh-CN">
    <header className="lens-header">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">✦</span>
        <span className="brand">DeepSeek</span>
        <span className="brand-tagline">让上下文始终可见</span>
      </div>
      <button className="icon-button" type="button" onClick={() => window.close()} aria-label="关闭预览">×</button>
    </header>

    <section className="empty-state" aria-live="polite">
      <div className="empty-mark" aria-hidden="true">✦</div>
      <h1>浏览器预览模式</h1>
      <p>当前页面没有 Tauri Native Runtime，因此不会连接 Selection、Session 或 Harness。</p>
      <p>请使用 <code>pnpm native:dev</code> 打开真实悬浮窗进行功能测试。</p>
    </section>

    <footer>
      <span aria-live="polite">Native bridge 未连接</span>
      <span>仅用于 UI 预览</span>
    </footer>
  </main>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {hasTauriRuntime() ? <App /> : <BrowserPreview />}
  </StrictMode>,
)
