/**
 * @jest-environment jsdom
 */
import { act, render, screen, fireEvent } from "@testing-library/react";
import { OverrideMode } from "../OverrideMode";
import * as adminSession from "../../../../lib/admin-session";

jest.mock("../../../../lib/admin-session", () => ({
  ...jest.requireActual("../../../../lib/admin-session"),
  enterOverrideMode: jest.fn(),
}));

const mockEnterOverrideMode = adminSession.enterOverrideMode as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

it("mints an override session and reveals the open-assignment input", async () => {
  mockEnterOverrideMode.mockResolvedValue({
    expiresAt: "2026-06-29T12:00:00Z",
  });

  render(<OverrideMode sessionToken="tok" />);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /enter override mode/i }));
  });

  expect(mockEnterOverrideMode).toHaveBeenCalledWith("tok");
  expect(screen.getByPlaceholderText(/assignment id/i)).toBeInTheDocument();
});

it("calls the API with the provided session token", async () => {
  mockEnterOverrideMode.mockResolvedValue({
    expiresAt: "2026-06-29T12:00:00Z",
  });

  render(<OverrideMode sessionToken="my-secret-token" />);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /enter override mode/i }));
  });

  expect(mockEnterOverrideMode).toHaveBeenCalledWith("my-secret-token");
});

it("shows an error message when the API call fails", async () => {
  mockEnterOverrideMode.mockRejectedValue(
    new Error("Could not enter override mode"),
  );

  render(<OverrideMode sessionToken="tok" />);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /enter override mode/i }));
  });

  expect(
    screen.getByText(/could not enter override mode/i),
  ).toBeInTheDocument();
  expect(
    screen.queryByPlaceholderText(/assignment id/i),
  ).not.toBeInTheDocument();
});

it("disables the button when sessionToken is null", () => {
  render(<OverrideMode sessionToken={null} />);
  expect(
    screen.getByRole("button", { name: /enter override mode/i }),
  ).toBeDisabled();
});

it("shows override active message with localized time on success", async () => {
  mockEnterOverrideMode.mockResolvedValue({
    expiresAt: "2026-06-29T12:00:00Z",
  });

  render(<OverrideMode sessionToken="tok" />);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /enter override mode/i }));
  });

  expect(screen.getByText(/override active until/i)).toBeInTheDocument();
});
