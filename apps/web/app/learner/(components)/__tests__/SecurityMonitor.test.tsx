/**
 * @jest-environment jsdom
 *
 * Note: This test requires @testing-library/react to be installed.
 * Run: yarn add -D @testing-library/react @testing-library/jest-dom @testing-library/user-event
 * See: TESTING_SETUP.md for full setup instructions
 */

import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SecurityMonitor from "../SecurityMonitor";
import { QuestionControls } from "@/config/types";

describe("SecurityMonitor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe("Print Prevention", () => {
    it("should prevent Ctrl+P when preventPrint is enabled", async () => {
      const questionControls: QuestionControls = {
        preventPrint: true,
      };

      render(<SecurityMonitor questionControls={questionControls} />);

      const keydownEvent = new KeyboardEvent("keydown", {
        key: "p",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });

      const preventDefaultSpy = jest.spyOn(keydownEvent, "preventDefault");
      const stopPropagationSpy = jest.spyOn(keydownEvent, "stopPropagation");

      act(() => {
        document.dispatchEvent(keydownEvent);
      });

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(stopPropagationSpy).toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(100);
      });

      expect(
        screen.getByText("Printing is disabled for this assignment"),
      ).toBeInTheDocument();
    });

    it("should prevent Cmd+P on Mac when preventPrint is enabled", async () => {
      const questionControls: QuestionControls = {
        preventPrint: true,
      };

      // Mock Mac platform
      Object.defineProperty(navigator, "platform", {
        value: "MacIntel",
        configurable: true,
      });

      render(<SecurityMonitor questionControls={questionControls} />);

      const keydownEvent = new KeyboardEvent("keydown", {
        key: "p",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });

      const preventDefaultSpy = jest.spyOn(keydownEvent, "preventDefault");

      act(() => {
        document.dispatchEvent(keydownEvent);
      });

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it("should prevent beforeprint event when preventPrint is enabled", async () => {
      const questionControls: QuestionControls = {
        preventPrint: true,
      };

      render(<SecurityMonitor questionControls={questionControls} />);

      const beforePrintEvent = new Event("beforeprint", {
        bubbles: true,
        cancelable: true,
      });

      const preventDefaultSpy = jest.spyOn(beforePrintEvent, "preventDefault");

      act(() => {
        window.dispatchEvent(beforePrintEvent);
      });

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it("should NOT prevent printing when preventPrint is false", async () => {
      const questionControls: QuestionControls = {
        preventPrint: false,
      };

      render(<SecurityMonitor questionControls={questionControls} />);

      const keydownEvent = new KeyboardEvent("keydown", {
        key: "p",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });

      const preventDefaultSpy = jest.spyOn(keydownEvent, "preventDefault");

      act(() => {
        document.dispatchEvent(keydownEvent);
      });

      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });

  describe("Event Listener Cleanup", () => {
    it("should remove event listeners on unmount", async () => {
      const questionControls: QuestionControls = {
        preventPrint: true,
        preventScreenshot: true,
      };

      const addEventListenerSpy = jest.spyOn(document, "addEventListener");
      const removeEventListenerSpy = jest.spyOn(
        document,
        "removeEventListener",
      );
      const windowAddSpy = jest.spyOn(window, "addEventListener");
      const windowRemoveSpy = jest.spyOn(window, "removeEventListener");

      const { unmount } = render(
        <SecurityMonitor questionControls={questionControls} />,
      );

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        "keydown",
        expect.any(Function),
        true,
      );
      expect(windowAddSpy).toHaveBeenCalledWith(
        "beforeprint",
        expect.any(Function),
      );

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "keydown",
        expect.any(Function),
        true,
      );
      expect(windowRemoveSpy).toHaveBeenCalledWith(
        "beforeprint",
        expect.any(Function),
      );
    });
  });

  describe("No Controls Enabled", () => {
    it("should not render anything when no questionControls provided", () => {
      const { container } = render(<SecurityMonitor />);
      expect(container.firstChild).toBeNull();
    });

    it("should not prevent any actions when all controls are false", async () => {
      const questionControls: QuestionControls = {
        preventPrint: false,
        preventScreenshot: false,
      };

      render(<SecurityMonitor questionControls={questionControls} />);

      const printEvent = new KeyboardEvent("keydown", {
        key: "p",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });

      const screenshotEvent = new KeyboardEvent("keydown", {
        key: "PrintScreen",
        bubbles: true,
        cancelable: true,
      });

      const printPreventSpy = jest.spyOn(printEvent, "preventDefault");
      const screenshotPreventSpy = jest.spyOn(
        screenshotEvent,
        "preventDefault",
      );

      act(() => {
        document.dispatchEvent(printEvent);
        document.dispatchEvent(screenshotEvent);
      });

      expect(printPreventSpy).not.toHaveBeenCalled();
      expect(screenshotPreventSpy).not.toHaveBeenCalled();
    });
  });
});
