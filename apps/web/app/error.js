'use client';

import { useEffect } from 'react';
import NotFoundScreen from '../components/NotFoundScreen';

/** Route render crashes. The root layout stays mounted; the page becomes the 404. */
export default function Error({ error }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <NotFoundScreen />;
}
