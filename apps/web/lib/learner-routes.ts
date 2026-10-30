/** The assignment overview, `/learner/<id>`. Attempt and results pages are deeper. */
export const isLearnerOverviewPath = (pathname: string | null): boolean =>
  /^\/learner\/[^/]+\/?$/.test(pathname ?? "");
