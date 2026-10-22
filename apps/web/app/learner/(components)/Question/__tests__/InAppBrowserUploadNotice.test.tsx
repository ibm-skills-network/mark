/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import InAppBrowserUploadNotice, {
  IN_APP_BROWSER_UPLOAD_NOTICE,
} from "../InAppBrowserUploadNotice";

jest.mock("@/hooks/use-ui-translation", () => ({
  useUiTranslation: () => ({ t: (source: string) => source }),
}));

function withUserAgent(userAgent: string): void {
  Object.defineProperty(window.navigator, "userAgent", {
    value: userAgent,
    configurable: true,
  });
}

describe("InAppBrowserUploadNotice", () => {
  it("tells Coursera app learners to open a browser", () => {
    withUserAgent("CourseraMobileApp/6.13 (Android; WebView)");
    render(<InAppBrowserUploadNotice />);

    expect(screen.getByRole("note")).toHaveTextContent(
      IN_APP_BROWSER_UPLOAD_NOTICE.coursera,
    );
  });

  it("uses neutral wording in other Android WebViews", () => {
    withUserAgent(
      "Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36",
    );
    render(<InAppBrowserUploadNotice />);

    expect(screen.getByRole("note")).toHaveTextContent(
      IN_APP_BROWSER_UPLOAD_NOTICE.generic,
    );
  });

  it("renders nothing in a regular browser", () => {
    withUserAgent(
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    );
    render(<InAppBrowserUploadNotice />);

    expect(screen.queryByRole("note")).toBeNull();
  });
});
