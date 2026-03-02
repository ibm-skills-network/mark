/**
 * @jest-environment jsdom
 *
 * Note: This test requires @testing-library/react to be installed.
 * Run: yarn add -D @testing-library/react @testing-library/jest-dom @testing-library/user-event
 * See: TESTING_SETUP.md for full setup instructions
 */

import React from "react";
import { render, screen, act } from "@testing-library/react";
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

  describe("Copy Prevention", () => {
    it("should prevent Ctrl+C when disableCopy is enabled", async () => {
      const questionControls: QuestionControls = {
        disableCopy: true,
      };

      render(<SecurityMonitor questionControls={questionControls} />);

      const keydownEvent = new KeyboardEvent("keydown", {
        key: "c",
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
        screen.getByText("Copying is disabled for this assignment"),
      ).toBeInTheDocument();
    });

    it("should prevent copy event when disableCopy is enabled", async () => {
      const questionControls: QuestionControls = {
        disableCopy: true,
      };

      render(<SecurityMonitor questionControls={questionControls} />);

      const copyEvent = new ClipboardEvent("copy", {
        bubbles: true,
        cancelable: true,
      });

      const preventDefaultSpy = jest.spyOn(copyEvent, "preventDefault");

      act(() => {
        document.dispatchEvent(copyEvent);
      });

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it("should NOT prevent copying when disableCopy is false", async () => {
      const questionControls: QuestionControls = {
        disableCopy: false,
      };

      render(<SecurityMonitor questionControls={questionControls} />);

      const keydownEvent = new KeyboardEvent("keydown", {
        key: "c",
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

  describe("Paste Prevention", () => {
    it("should prevent Ctrl+V when disablePaste is enabled", async () => {
      const questionControls: QuestionControls = {
        disablePaste: true,
      };

      render(<SecurityMonitor questionControls={questionControls} />);

      const keydownEvent = new KeyboardEvent("keydown", {
        key: "v",
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
        screen.getByText("Pasting is disabled for this assignment"),
      ).toBeInTheDocument();
    });

    it("should prevent paste event when disablePaste is enabled", async () => {
      const questionControls: QuestionControls = {
        disablePaste: true,
      };

      render(<SecurityMonitor questionControls={questionControls} />);

      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
      });

      const preventDefaultSpy = jest.spyOn(pasteEvent, "preventDefault");

      act(() => {
        document.dispatchEvent(pasteEvent);
      });

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it("should NOT prevent pasting when disablePaste is false", async () => {
      const questionControls: QuestionControls = {
        disablePaste: false,
      };

      render(<SecurityMonitor questionControls={questionControls} />);

      const keydownEvent = new KeyboardEvent("keydown", {
        key: "v",
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

  describe("Print Prevention", () => {
    it("should prevent Ctrl+P when disablePrint is enabled", async () => {
      const questionControls: QuestionControls = {
        disablePrint: true,
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

    it("should prevent Cmd+P on Mac when disablePrint is enabled", async () => {
      const questionControls: QuestionControls = {
        disablePrint: true,
      };

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

    it("should prevent beforeprint event when disablePrint is enabled", async () => {
      const questionControls: QuestionControls = {
        disablePrint: true,
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

    it("should NOT prevent printing when disablePrint is false", async () => {
      const questionControls: QuestionControls = {
        disablePrint: false,
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

  describe("Right-Click Prevention", () => {
    it("should prevent right-click when disableRightClick is enabled", async () => {
      const questionControls: QuestionControls = {
        disableRightClick: true,
      };

      render(<SecurityMonitor questionControls={questionControls} />);

      const contextMenuEvent = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
      });

      const preventDefaultSpy = jest.spyOn(contextMenuEvent, "preventDefault");
      const stopPropagationSpy = jest.spyOn(
        contextMenuEvent,
        "stopPropagation",
      );

      act(() => {
        document.dispatchEvent(contextMenuEvent);
      });

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(stopPropagationSpy).toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(100);
      });

      expect(
        screen.getByText("Right-click is disabled for this assignment"),
      ).toBeInTheDocument();
    });

    it("should NOT prevent right-click when disableRightClick is false", async () => {
      const questionControls: QuestionControls = {
        disableRightClick: false,
      };

      render(<SecurityMonitor questionControls={questionControls} />);

      const contextMenuEvent = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
      });

      const preventDefaultSpy = jest.spyOn(contextMenuEvent, "preventDefault");

      act(() => {
        document.dispatchEvent(contextMenuEvent);
      });

      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });

  describe("Event Listener Cleanup", () => {
    it("should remove event listeners on unmount", async () => {
      const questionControls: QuestionControls = {
        disableCopy: true,
        disablePaste: true,
        disablePrint: true,
        disableRightClick: true,
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
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        "contextmenu",
        expect.any(Function),
        true,
      );
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        "copy",
        expect.any(Function),
        true,
      );
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        "paste",
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
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "contextmenu",
        expect.any(Function),
        true,
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "copy",
        expect.any(Function),
        true,
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "paste",
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
        disablePrint: false,
      };

      render(<SecurityMonitor questionControls={questionControls} />);

      const printEvent = new KeyboardEvent("keydown", {
        key: "p",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });

      const printPreventSpy = jest.spyOn(printEvent, "preventDefault");

      act(() => {
        document.dispatchEvent(printEvent);
      });

      expect(printPreventSpy).not.toHaveBeenCalled();
    });
  });
});
