import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as XLSX from "xlsx";
import ImportModal from "../ImportModal";
jest.mock("@/lib/utils", () => ({ generateTempQuestionId: () => -1 }));
async function upload(container: HTMLElement, rows: string[][]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    "Questions",
  );
  const data = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const file = new File([], "quiz.xlsx");
  Object.defineProperty(file, "arrayBuffer", { value: async () => data });
  await act(async () => {
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });
  });
}
it("previews and imports the correct answer from a reordered workbook", async () => {
  const onImport = jest.fn();
  const { container } = render(
    <ImportModal isOpen onClose={jest.fn()} onImport={onImport} />,
  );
  await upload(container, [
    ["Question text", "Answer 2", "Answer 3", "Answer 4", "Correct answer"],
    ["2+2?", "3", "5", "6", "4"],
  ]);
  const preview = await screen.findByRole("region", {
    name: "Imported answer key",
  });
  expect(within(preview).getByText("Correct answer: 4")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Import 1 Questions" }));
  expect(onImport).toHaveBeenCalledTimes(1);
  expect(onImport.mock.calls[0][0][0].choices).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ choice: "4", isCorrect: true, points: 1 }),
      expect.objectContaining({ choice: "3", isCorrect: false, points: 0 }),
    ]),
  );
});
it("blocks ambiguous workbooks before import configuration", async () => {
  const alert = jest.spyOn(window, "alert").mockImplementation(() => undefined);
  const onImport = jest.fn();
  try {
    const { container } = render(
      <ImportModal isOpen onClose={jest.fn()} onImport={onImport} />,
    );
    await upload(container, [
      ["Question text", "Answer 1", "Answer 2", "Answer 3", "Answer 4"],
      ["2+2?", "3", "4", "5", "6"],
    ]);
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        expect.stringContaining('Missing Excel header: "correct answer"'),
      ),
    );
    expect(
      screen.queryByRole("button", { name: "Import 1 Questions" }),
    ).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
  } finally {
    alert.mockRestore();
  }
});
