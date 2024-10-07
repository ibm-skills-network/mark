export function handleScrollToFirstErrorField() {
  // Get all elements that have an id attribute
  const elements = document.querySelectorAll("*[id]");

  // Filter elements with ids starting with 'error-'
  const errorElements = Array.from(elements).filter((el) => {
    const id = el.id;
    // Ensure id is a string and starts with 'error-'
    return typeof id === "string" && id.startsWith("error-");
  });

  if (errorElements.length === 0) return;

  requestAnimationFrame(() => {
    errorElements[0].scrollIntoView({ behavior: "smooth", block: "center" });
  });
}
