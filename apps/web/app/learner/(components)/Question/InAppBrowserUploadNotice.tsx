"use client";

import { useUiTranslation } from "@/hooks/use-ui-translation";
import {
  isCourseraMobileApp,
  shouldSuggestOpeningInBrowser,
} from "@/lib/upload-accept";
import { IconInfoCircle } from "@tabler/icons-react";
import { useEffect, useState } from "react";

export const IN_APP_BROWSER_UPLOAD_NOTICE = {
  coursera:
    "File uploads may not work in the Coursera app. Open this assignment in a browser such as Chrome or Safari instead.",
  generic:
    "File uploads may not work in this in-app browser. Open this assignment in a browser such as Chrome or Safari instead.",
} as const;

/** Every string this notice renders, for the translation catalog test. */
export const IN_APP_BROWSER_UPLOAD_NOTICE_SOURCE_STRINGS: readonly string[] =
  Object.values(IN_APP_BROWSER_UPLOAD_NOTICE);

/**
 * In-app browsers (the Coursera app's WebView above all) often cannot open a
 * file picker, so tapping the drop zone does nothing. Non-blocking: some of
 * them do work, and the learner may already have a file uploaded.
 */
export default function InAppBrowserUploadNotice() {
  const { t } = useUiTranslation();
  // Read after mount: the server render has no user agent, and guessing there
  // would flash the notice for everyone or for no one.
  const [userAgent, setUserAgent] = useState<string | null>(null);

  useEffect(() => {
    setUserAgent(navigator.userAgent);
  }, []);

  if (!userAgent || !shouldSuggestOpeningInBrowser(userAgent)) return null;

  const message = isCourseraMobileApp(userAgent)
    ? IN_APP_BROWSER_UPLOAD_NOTICE.coursera
    : IN_APP_BROWSER_UPLOAD_NOTICE.generic;

  return (
    <div
      role="note"
      data-no-ui-translate="true"
      className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100"
    >
      <IconInfoCircle size={18} className="mt-0.5 shrink-0" aria-hidden />
      <span>{t(message)}</span>
    </div>
  );
}
