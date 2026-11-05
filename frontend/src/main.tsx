import React from 'react';
import { createRoot } from 'react-dom/client';
import { FinanceCenterV2 } from './FinanceCenterV2';
import './styles.css';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className="empty" role="alert"><h2>页面加载遇到问题</h2>
      <button onClick={() => location.reload()}>重新加载</button></div> : this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(<ErrorBoundary><FinanceCenterV2 /></ErrorBoundary>);
