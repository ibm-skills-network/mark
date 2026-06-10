/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import AccessRestricted from "../AccessRestricted";

describe("AccessRestricted", () => {
  it("renders the access-restricted message and relaunch guidance, with no reload action", () => {
    render(<AccessRestricted />);

    expect(
      screen.getByRole("heading", { name: /access to this assignment/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/relaunch the assignment/i)).toBeInTheDocument();
    // Reloading can't fix a permissions issue, so there must be no reload action.
    expect(
      screen.queryByRole("button", { name: /reload/i }),
    ).not.toBeInTheDocument();
  });
});
