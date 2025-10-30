"use client";

/**
 * Scrolls the page to the specified question element.
 *
 * @param questionId - The ID of the question element to scroll to.
 */
export function handleJumpToQuestion(elementString: string) {
  const element = document.getElementById(elementString);
  if (!element) return;
  requestAnimationFrame(() => {
    element.scrollIntoView({
      behavior: "smooth",
      block: "start",
      inline: "nearest",
    });
  });
}

export function handleJumpToQuestionTitle(elementString: string) {
  const element = document.getElementById(`question-title-${elementString}`);
  if (!element) return;
  requestAnimationFrame(() => {
    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });
  });
}
