/**
 * Promotional banner content shown in the learner flow.
 *
 * Two placements:
 *  - "pre-start": a banner at the top of the assignment about page. It is not
 *    rendered once the learner starts the quiz.
 *  - "completion": a banner on the results page, shown only to learners who
 *    passed and scored above PROMO_COMPLETION_MIN_SCORE.
 *
 * Whether banners render at all is controlled at runtime by the
 * PROMO_BANNERS_ENABLED environment variable (see app/learner/layout.tsx).
 * This file only controls *what* is shown when the switch is on.
 *
 * Each `href` is a full, ready-to-use URL (tracking parameters are already
 * baked into the link when it is generated upstream) — we render it as-is.
 * When a placement holds more than one item, one is chosen at random per view.
 */

export interface PromoItem {
  /** Stable key for React lists / analytics. */
  id: string;
  title: string;
  blurb: string;
  ctaText: string;
  /** Full destination URL, used verbatim. */
  href: string;
  /**
   * Optional little icon/image shown at the start of the banner. Either a
   * remote URL or a path to an asset dropped in public/promo/
   * (e.g. "/promo/watsonx.svg"). When omitted, a default icon is shown
   * instead. Rendered in a fixed box, so any aspect ratio is fine.
   */
  imgSrc?: string;
  /** Alt text for `imgSrc`. Leave empty for purely decorative logos. */
  imgAlt?: string;
}

// Shown before the quiz starts. One is chosen at random per page view.
// Titles/blurbs are editable copy; hrefs and images are the campaign assets.
export const PROMO_PRE_START: PromoItem[] = [
  {
    id: "prestart-bob",
    title: "Bob",
    blurb: "Get a free 30-day trial to Bob, IBM's new AI Development Partner.",
    ctaText: "Learn more",
    href: "https://product-link.skills.network/r/franavnoazad-9",
    imgSrc: "/promo/Bob.svg",
    imgAlt: "Bob",
  },
  {
    id: "prestart-instana",
    title: "IBM Instana",
    blurb: "Real-time observability and application performance monitoring.",
    ctaText: "Learn more",
    href: "https://product-link.skills.network/r/franavnoazad-10",
    imgSrc: "/promo/Instana.webp",
    imgAlt: "IBM Instana",
  },
  {
    id: "prestart-hashicorp",
    title: "HashiCorp",
    blurb: "Do cloud right. Automate your infrastructure and security with HashiCorp.",
    ctaText: "Learn more",
    href: "https://product-link.skills.network/r/franavnoazad-11",
    imgSrc: "/promo/Hashicorp.png",
    imgAlt: "HashiCorp",
  },
  {
    id: "prestart-watsonx-orchestrate",
    title: "watsonx.orchestrate",
    blurb: "Put AI to work for your business. Build your own AI assistants and agents with watsonx Orchestrate.",
    ctaText: "Explore",
    href: "https://product-link.skills.network/r/franavnoazad-12",
    imgSrc: "/promo/watsonX-Orchestrate.svg",
    imgAlt: "watsonx Orchestrate",
  },
  {
    id: "prestart-watsonx-data",
    title: "watsonx.data",
    blurb: "Make your data AI-ready—connected, governed, and context-rich.",
    ctaText: "Explore",
    href: "https://product-link.skills.network/r/franavnoazad-17",
    imgSrc: "/promo/watsonX-Data.svg",
    imgAlt: "watsonx.data",
  },
];

// Shown on the results page to learners who passed and scored above
// PROMO_COMPLETION_MIN_SCORE. One is chosen at random per page view.
export const PROMO_COMPLETION: PromoItem[] = [
  {
    id: "completion-bob",
    title: "Bob",
    blurb: "Get a free 30-day trial to Bob, IBM's new AI Development Partner.",
    ctaText: "Learn more",
    href: "https://product-link.skills.network/r/franavnoazad-16",
    imgSrc: "/promo/Bob.svg",
    imgAlt: "Bob",
  },
  {
    id: "completion-instana",
    title: "IBM Instana",
    blurb: "Real-time observability and application performance monitoring.",
    ctaText: "Learn more",
    href: "https://product-link.skills.network/r/franavnoazad-15",
    imgSrc: "/promo/Instana.webp",
    imgAlt: "IBM Instana",
  },
  {
    id: "completion-hashicorp",
    title: "HashiCorp",
    blurb: "Do cloud right. Automate your infrastructure and security with HashiCorp.",
    ctaText: "Learn more",
    href: "https://product-link.skills.network/r/franavnoazad-14",
    imgSrc: "/promo/Hashicorp.png",
    imgAlt: "HashiCorp",
  },
  {
    id: "completion-watsonx-orchestrate",
    title: "watsonx Orchestrate",
    blurb: "Put AI to work for your business. Build your own AI assistants and agents with watsonx Orchestrate.",
    ctaText: "Explore",
    href: "https://product-link.skills.network/r/franavnoazad-13",
    imgSrc: "/promo/watsonX-Orchestrate.svg",
    imgAlt: "watsonx Orchestrate",
  },
    {
    id: "completion-watsonx-data",
    title: "watsonx.data",
    blurb: "Make your data AI-ready—connected, governed, and context-rich.",
    ctaText: "Explore",
    href: "https://product-link.skills.network/r/franavnoazad-18",
    imgSrc: "/promo/watsonX-Data.svg",
    imgAlt: "watsonx.data",
  },
];

/**
 * Minimum score (percentage, 0–100) above which the completion banner may
 * show. The completion placement is additionally gated on passing the
 * assignment — see the success page.
 */
export const PROMO_COMPLETION_MIN_SCORE = 70;

/** Pick one item at random, or null when the list is empty. */
export function pickPromo(items: PromoItem[]): PromoItem | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}
