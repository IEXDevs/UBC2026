'use client';

import { useEffect } from 'react';
import './globals.css';
import NotFoundScreen from '../components/NotFoundScreen';

/** Root-layout crashes. This replaces the layout, so it owns html, body, and global CSS. */
export default function GlobalError({ error }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <NotFoundScreen />
      </body>
    </html>
  );
}
