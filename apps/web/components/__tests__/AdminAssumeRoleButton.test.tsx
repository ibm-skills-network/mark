/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminAssumeRoleButton, {
  pageSessionTarget,
} from "../AdminAssumeRoleButton";

let mockPathname = "/learner/42";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));

function storeAdminSession() {
  localStorage.setItem("adminSessionToken", "admin-session");
  localStorage.setItem("adminEmail", "admin@example.com");
  localStorage.setItem(
    "adminExpiresAt",
    new Date(Date.now() + 60_000).toISOString(),
  );
}

describe("pageSessionTarget", () => {
  it.each([
    ["/learner/42", "", { role: "learner", assignmentId: 42 }],
    ["/learner/42/successPage/9", "", { role: "learner", assignmentId: 42 }],
    ["/learner/42", "?authorMode=true", { role: "author", assignmentId: 42 }],
    ["/author/7/questions", "", { role: "author", assignmentId: 7 }],
    ["/admin", "", undefined],
    ["/learner/abc", "", undefined],
  ])("%s%s", (pathname, search, expected) => {
    expect(pageSessionTarget(pathname, search)).toEqual(expected);
  });
});

describe("AdminAssumeRoleButton", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    localStorage.clear();
    mockPathname = "/learner/42";
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("renders nothing without an admin login", () => {
    const { container } = render(<AdminAssumeRoleButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing off assignment pages", () => {
    storeAdminSession();
    mockPathname = "/";
    const { container } = render(<AdminAssumeRoleButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("requests the page's role with the admin token", async () => {
    storeAdminSession();
    mockPathname = "/author/7";
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    render(<AdminAssumeRoleButton />);

    fireEvent.click(
      await screen.findByRole("button", { name: /open as author/i }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/auth\/admin\/assume-role$/);
    expect(init.headers).toMatchObject({ "x-admin-token": "admin-session" });
    expect(JSON.parse(String(init.body))).toEqual({
      role: "author",
      assignmentId: 7,
    });
  });
});
