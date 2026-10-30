import { render, screen, waitFor } from "@testing-library/react";
import LayoutContent from "../LayoutContent";

const mockPathname = jest.fn<string, []>();

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));
jest.mock("../../app/chatbot/components/MarkChat", () => ({
  MarkChat: () => <div>mark chat</div>,
}));
jest.mock("../../app/chatbot/store/AuthorStoreBridge", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/AdminAssumeRoleButton", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/ReportBugButton", () => ({
  __esModule: true,
  default: () => <div>report bug</div>,
}));
jest.mock("../../hooks/useChatbot", () => ({
  useChatbot: () => ({ isOpen: false }),
}));
jest.mock("../../hooks/useTheme", () => ({
  useTheme: () => ({ isDark: false }),
}));
jest.mock("@/lib/ai-status", () => ({
  getAiStatus: jest.fn().mockResolvedValue({ chat: true }),
}));

const renderAt = async (pathname: string) => {
  mockPathname.mockReturnValue(pathname);
  render(<LayoutContent>page</LayoutContent>);
  await waitFor(() => {
    expect(screen.getByText("page")).toBeTruthy();
  });
};

describe("LayoutContent chat visibility", () => {
  it.each(["/learner/2849", "/learner/2849/"])(
    "hides the chat but keeps bug reports on the overview %s",
    async (pathname) => {
      await renderAt(pathname);

      expect(screen.queryByText("mark chat")).toBeNull();
      expect(screen.getByText("report bug")).toBeTruthy();
    },
  );

  it.each([
    "/learner/2849/questions",
    "/learner/2849/attempts",
    "/learner/2849/successPage/1914414",
    "/author/2849",
  ])("keeps the chat on %s", async (pathname) => {
    await renderAt(pathname);

    expect(screen.getByText("mark chat")).toBeTruthy();
  });
});
