'use client';

import { Component, useEffect, useState } from 'react';
import NotFoundScreen from './NotFoundScreen';

class RenderBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false };
  }

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  render() {
    if (this.state.crashed) return <NotFoundScreen />;
    return this.props.children;
  }
}

function fromThisApp(file) {
  if (typeof file !== 'string' || file === '') return false;
  try {
    return new URL(file).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** Render crashes, uncaught exceptions, and unhandled rejections show the 404 instead of a blank page. */
export default function CrashGuard({ children }) {
  const [crashed, setCrashed] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return undefined;

    const onError = (event) => {
      const message = String(event?.message || '');
      if (message.includes('ResizeObserver loop')) return;
      if (!fromThisApp(event?.filename)) return;
      setCrashed(true);
    };

    const onReject = (event) => {
      const stack = typeof event?.reason?.stack === 'string' ? event.reason.stack : '';
      if (stack.includes('chrome-extension://') || stack.includes('moz-extension://')) return;
      if (stack === '' && typeof event?.reason !== 'object') return;
      setCrashed(true);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onReject);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onReject);
    };
  }, []);

  if (crashed) return <NotFoundScreen />;
  return <RenderBoundary>{children}</RenderBoundary>;
}
