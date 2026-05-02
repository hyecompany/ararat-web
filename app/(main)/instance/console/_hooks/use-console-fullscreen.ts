'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface UseConsoleFullscreenOptions {
  onFullscreenChange?: (isFullscreen: boolean) => void;
}

export function useConsoleFullscreen({
  onFullscreenChange,
}: UseConsoleFullscreenOptions = {}) {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const notifyChange = useCallback(
    (nextValue: boolean) => {
      setIsFullscreen(nextValue);
      onFullscreenChange?.(nextValue);
    },
    [onFullscreenChange],
  );

  useEffect(() => {
    const handleChange = () => {
      notifyChange(document.fullscreenElement === targetRef.current);
    };

    document.addEventListener('fullscreenchange', handleChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleChange);
    };
  }, [notifyChange]);

  const toggleFullscreen = useCallback(async () => {
    const target = targetRef.current;
    if (!target) {
      return;
    }

    if (document.fullscreenElement === target) {
      await document.exitFullscreen();
      return;
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen();
    }

    await target.requestFullscreen();
  }, []);

  return {
    targetRef,
    isFullscreen,
    toggleFullscreen,
  };
}
