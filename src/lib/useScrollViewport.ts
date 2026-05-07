import { useEffect, useState } from 'react';

type Args = {
  cursor: number;
  total: number;
  viewport: number;
};

type Result = {
  safeCursor: number;
  safeScroll: number;
};

/**
 * Tracks a scroll offset that keeps `cursor` inside a window of size `viewport`
 * over a list of size `total`. Returns clamped values safe to use directly.
 */
export function useScrollViewport({ cursor, total, viewport }: Args): Result {
  const [scroll, setScroll] = useState(0);

  const safeCursor = total === 0 ? 0 : Math.min(Math.max(0, cursor), total - 1);
  const safeScroll = Math.max(0, Math.min(scroll, Math.max(0, total - viewport)));

  useEffect(() => {
    setScroll((prev) => {
      let next = prev;
      if (safeCursor < next) next = safeCursor;
      else if (safeCursor >= next + viewport) next = safeCursor - viewport + 1;
      const max = Math.max(0, total - viewport);
      if (next > max) next = max;
      if (next < 0) next = 0;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeCursor, viewport, total]);

  return { safeCursor, safeScroll };
}
