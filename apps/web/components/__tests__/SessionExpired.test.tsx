/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import SessionExpired from "../SessionExpired";

describe("SessionExpired", () => {
  it("renders the session-expired message, a reload action, and relaunch guidance", () => {
    render(<SessionExpired />);

    expect(
      screen.getByRole("heading", { name: /session has expired/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /reload page/i }),
    ).toBeInTheDocument();
    // Keeps the actionable fallback copy from silently disappearing.
    expect(screen.getByText(/relaunch the assignment/i)).toBeInTheDocument();
  });
});
