export function handleScrollToFirstErrorField() {
  const elements = document.querySelectorAll("*[id]");

  const errorElements = Array.from(elements).filter((el) => {
    const id = el.id;

    return typeof id === "string" && id.startsWith("error-");
  });

  if (errorElements.length === 0) return;

  requestAnimationFrame(() => {
    errorElements[0].scrollIntoView({ behavior: "smooth", block: "center" });
  });
}
