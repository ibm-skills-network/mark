/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import PromoBanner from "@/components/promo/PromoBanner";
import PromoProvider from "@/components/promo/PromoProvider";
import { isPromoLmsHost } from "@/config/promo";

describe("isPromoLmsHost", () => {
  it.each(["courses.cognitiveclass.ai", "courses.cc-dev.skillsnetwork.site"])(
    "allows %s",
    (host) => {
      expect(isPromoLmsHost(host)).toBe(true);
    },
  );

  it.each([
    "courses.lpu.cognitiveclass.ai",
    "courses.cognitiveclass.ai.evil.com",
    "cognitiveclass.ai",
    undefined,
  ])("rejects %s", (host) => {
    expect(isPromoLmsHost(host)).toBe(false);
  });
});

describe("PromoBanner", () => {
  const renderBanner = (enabled: boolean, lmsHost: string | undefined) =>
    render(
      <PromoProvider enabled={enabled}>
        <PromoBanner placement="preStart" lmsHost={lmsHost} />
      </PromoProvider>,
    );

  it("shows for a Cognitive Class launch when enabled", async () => {
    renderBanner(true, "courses.cognitiveclass.ai");

    expect(
      await screen.findByRole("complementary", { name: "Sponsored" }),
    ).toBeInTheDocument();
  });

  it.each([undefined, "www.coursera.org", "courses.lpu.cognitiveclass.ai"])(
    "stays hidden for LMS host %s",
    (lmsHost) => {
      renderBanner(true, lmsHost);

      expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    },
  );

  it("stays hidden when the feature is disabled", () => {
    renderBanner(false, "courses.cognitiveclass.ai");

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });
});
