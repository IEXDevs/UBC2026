'use client';

import { Component, useEffect, useState } from 'react';
import NotFoundScreen from './NotFoundScreen';
import { shouldCrashOnError, shouldCrashOnRejection } from '../lib/crash-guard.mjs';

class RenderBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false };
  }

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[CrashGuard] Component render error:', error, errorInfo);
  }

  render() {
    if (this.state.crashed) return <NotFoundScreen />;
    return this.props.children;
  }
}

/** Render crashes show the 404. Privy / wallet-connect rejections stay on the desk. */
export default function CrashGuard({ children }) {
  const [crashed, setCrashed] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return undefined;
    const origin = window.location.origin;

    const onError = (event) => {
      console.error('[CrashGuard] Window error event:', event?.error || event?.message, event);
      if (!shouldCrashOnError({
        message: event?.message,
        filename: event?.filename,
        origin,
      })) return;
      setCrashed(true);
    };

    const onReject = (event) => {
      console.error('[CrashGuard] Unhandled promise rejection:', event?.reason);
      if (!shouldCrashOnRejection(event?.reason, { origin })) return;
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
