import { render, screen } from "@testing-library/react";
import { MarkChatToggleButton } from "../MarkChatToggleButton";

const mockPathname = jest.fn<string, []>();

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

describe("MarkChatToggleButton", () => {
  it("is not offered on the learner overview, where the chat is hidden", () => {
    mockPathname.mockReturnValue("/learner/2849");
    render(<MarkChatToggleButton role="learner" />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is offered inside an attempt", () => {
    mockPathname.mockReturnValue("/learner/2849/questions");
    render(<MarkChatToggleButton role="learner" />);

    expect(screen.getByRole("button")).toBeTruthy();
  });
});
