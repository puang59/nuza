import { useCallback, useEffect, useRef, useState } from "react";
import { Notice, NOTICE_EVENT } from "@/lib/notices";

/** How long a notice stays up before it takes itself away. */
const HOLD = 6000;

/** How many are shown at once; older ones drop off the top. */
const LIMIT = 3;

/** Collects what the app has to say, for the stack that shows it. */
export function useNotices() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  useEffect(() => {
    function onNotice(event: Event) {
      const { message, reason } = (event as CustomEvent<Omit<Notice, "id">>).detail;

      setNotices((current) => {
        // The same failure twice is one notice. Autosave runs on a timer, so a
        // note that cannot be written would otherwise stack one up every
        // 800ms until the screen was nothing else.
        if (current.some((notice) => notice.message === message && notice.reason === reason)) {
          return current;
        }

        return [...current, { id: nextId.current++, message, reason }].slice(-LIMIT);
      });
    }

    window.addEventListener(NOTICE_EVENT, onNotice);
    return () => window.removeEventListener(NOTICE_EVENT, onNotice);
  }, []);

  return { notices, dismiss, hold: HOLD };
}
