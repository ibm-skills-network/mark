import { computeCreepStep } from "../useCreepingProgress";

// Helper: a grading snapshot with the two fields the creep cares about.
const gs = (completed: number, total: number) => ({ completed, total });

describe("computeCreepStep", () => {
  it("approaches but never reaches the next-completion bound during grading", () => {
    // 1 of 3 done => realProgress 30; bound = (1+1)/3*90 = 60.
    let displayed = 30;
    for (let i = 0; i < 600; i++) {
      displayed = computeCreepStep({
        displayed,
        realProgress: 30,
        gradingState: gs(1, 3),
        status: "processing",
        dt: 0.016,
        k: 0.6,
      });
    }
    expect(displayed).toBeGreaterThan(30);
    expect(displayed).toBeLessThan(60);
  });

  it("never decreases across frames", () => {
    let displayed = 30;
    let prev = displayed;
    for (let i = 0; i < 100; i++) {
      displayed = computeCreepStep({
        displayed,
        realProgress: 30,
        gradingState: gs(1, 3),
        status: "processing",
        dt: 0.016,
        k: 0.4,
      });
      expect(displayed).toBeGreaterThanOrEqual(prev);
      prev = displayed;
    }
  });

  it("uses the real value as a hard floor (leapfrog when a parallel wave lands)", () => {
    // Was creeping at 35; two of three now done => realProgress 60.
    const next = computeCreepStep({
      displayed: 35,
      realProgress: 60,
      gradingState: gs(2, 3),
      status: "processing",
      dt: 0.016,
      k: 0.4,
    });
    expect(next).toBeGreaterThanOrEqual(60);
  });

  it("does not move backward when a stale lower real value arrives", () => {
    // Display already crept to 58; a stale 30 must not pull it back.
    const next = computeCreepStep({
      displayed: 58,
      realProgress: 30,
      gradingState: gs(1, 3),
      status: "processing",
      dt: 0.016,
      k: 0.4,
    });
    expect(next).toBeGreaterThanOrEqual(58);
    expect(next).toBeLessThan(60);
  });

  it("eases to exactly 100 when completed", () => {
    let displayed = 90;
    for (let i = 0; i < 300; i++) {
      displayed = computeCreepStep({
        displayed,
        realProgress: 100,
        gradingState: gs(3, 3),
        status: "completed",
        dt: 0.016,
        k: 0.4,
      });
    }
    expect(displayed).toBeGreaterThan(99.9);
    expect(displayed).toBeLessThanOrEqual(100);
  });

  it("eases up to 100 on completion rather than snapping in one frame", () => {
    // Creep was mid-grade at 85 when completion landed; the first frame must
    // move up but NOT jump straight to 100 (regression guard for the snap bug).
    const afterOneFrame = computeCreepStep({
      displayed: 85,
      realProgress: 100,
      gradingState: gs(3, 3),
      status: "completed",
      dt: 0.016,
      k: 0.4,
    });
    expect(afterOneFrame).toBeGreaterThan(85);
    expect(afterOneFrame).toBeLessThan(100);
  });

  it("tracks the real value with no creep when gradingState is undefined", () => {
    expect(
      computeCreepStep({
        displayed: 0,
        realProgress: 0,
        gradingState: undefined,
        status: "processing",
        dt: 0.016,
        k: 0.4,
      }),
    ).toBe(0);
    // Floor still applies: a real value with no snapshot is tracked, not crept past.
    expect(
      computeCreepStep({
        displayed: 0,
        realProgress: 5,
        gradingState: undefined,
        status: "processing",
        dt: 0.016,
        k: 0.4,
      }),
    ).toBe(5);
  });
});
