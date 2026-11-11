import { describe, expect, it } from "vitest";
import {
  CEO_SECTIONS,
  DESK_HOME,
  ceoPath,
  ceoSectionFromLegacyTab,
  ceoSectionFromSlug,
  homeOf,
  isActivePath,
  navFor,
  portalOf,
  redirectFor,
  tabBarFor,
} from "@/lib/portal";

/**
 * Who sees what: three portals, one per job, and nobody ever lands on a page
 * that isn't theirs.
 */
describe("each login has its own portal", () => {
  it("signs each role in to its own home", () => {
    expect(homeOf("admin")).toBe("/ceo");
    expect(homeOf("cfo")).toBe("/cfo");
    expect(homeOf("manager")).toBe("/");
  });

  it("the CEO's navigation holds the CEO's sections and none of a manager's pages", () => {
    const paths = navFor("ceo").map((i) => i.path);
    expect(paths).toEqual([
      "/ceo",
      "/ceo/payroll",
      "/ceo/stores",
      "/ceo/people",
      "/ceo/insights",
      "/ceo/finance",
      "/ceo/control",
    ]);
    for (const managerPage of ["/", "/payroll", "/employees", "/schedule-import"]) {
      expect(paths).not.toContain(managerPage);
    }
  });

  it("a manager's navigation is the store's four pages", () => {
    expect(navFor("manager").map((i) => i.path)).toEqual([
      "/",
      "/employees",
      "/payroll",
      "/schedule-import",
    ]);
  });

  it("the CEO's store desk is those same pages, with its own dashboard address", () => {
    expect(navFor("desk").map((i) => i.path)).toEqual([
      DESK_HOME,
      "/employees",
      "/payroll",
      "/schedule-import",
    ]);
  });

  it("the CFO's navigation is Finance and the register", () => {
    expect(navFor("cfo").map((i) => i.path)).toEqual(["/cfo", "/cfo/register"]);
  });

  it("the phone tab bar keeps at most four sections beside the +", () => {
    for (const portal of ["ceo", "desk", "manager", "cfo"] as const) {
      const { tabs, more } = tabBarFor(portal);
      expect(tabs.length).toBeLessThanOrEqual(4);
      // nothing is lost: every section is a tab or under More
      expect([...tabs, ...more].map((i) => i.path).sort()).toEqual(
        navFor(portal).map((i) => i.path).sort(),
      );
    }
  });
});

describe("which portal an address belongs to", () => {
  it("the CEO is in the command center on /ceo… and on the store desk elsewhere", () => {
    expect(portalOf("admin", "/ceo")).toBe("ceo");
    expect(portalOf("admin", "/ceo/stores")).toBe("ceo");
    expect(portalOf("admin", DESK_HOME)).toBe("desk");
    expect(portalOf("admin", "/payroll")).toBe("desk");
    expect(portalOf("admin", "/employees/12")).toBe("desk");
  });

  it("a manager and the CFO are always in their own", () => {
    expect(portalOf("manager", "/payroll")).toBe("manager");
    expect(portalOf("manager", "/ceo")).toBe("manager");
    expect(portalOf("cfo", "/cfo")).toBe("cfo");
  });
});

describe("opening an address that isn't yours sends you to where your job is", () => {
  it("the CEO's old home and the CFO's addresses lead into the command center", () => {
    expect(redirectFor("admin", "/")).toBe("/ceo");
    expect(redirectFor("admin", "/cfo")).toBe("/ceo/finance");
    expect(redirectFor("admin", "/cfo/register")).toBe("/ceo/finance/register");
  });

  it("the CEO may open every CEO section and every store-desk page", () => {
    for (const path of [
      "/ceo",
      "/ceo/payroll",
      "/ceo/log",
      DESK_HOME,
      "/payroll",
      "/employees",
      "/employees/7",
      "/schedule-import",
    ]) {
      expect(redirectFor("admin", path)).toBeNull();
    }
  });

  it("a manager can't open the CEO's or CFO's portal, or the CEO's desk address", () => {
    for (const path of ["/ceo", "/ceo/control", "/ceo/people", "/cfo", "/cfo/register", DESK_HOME]) {
      expect(redirectFor("manager", path)).toBe("/");
    }
    for (const path of ["/", "/payroll", "/employees", "/employees/3", "/schedule-import"]) {
      expect(redirectFor("manager", path)).toBeNull();
    }
  });

  it("the CFO stays in Finance", () => {
    for (const path of ["/", "/payroll", "/employees", "/ceo", "/ceo/finance", DESK_HOME]) {
      expect(redirectFor("cfo", path)).toBe("/cfo");
    }
    expect(redirectFor("cfo", "/cfo")).toBeNull();
    expect(redirectFor("cfo", "/cfo/register")).toBeNull();
  });
});

describe("the CEO's sections have addresses", () => {
  it("every section maps to its address and back", () => {
    for (const s of CEO_SECTIONS) {
      const path = ceoPath(s.key);
      expect(path.startsWith("/ceo")).toBe(true);
      expect(ceoSectionFromSlug(path.split("/")[2])).toBe(s.key);
    }
    expect(ceoPath("overview")).toBe("/ceo");
    expect(ceoPath("optimize")).toBe("/ceo/insights");
    expect(ceoPath("activity")).toBe("/ceo/log");
  });

  it("an unknown section is not a section", () => {
    expect(ceoSectionFromSlug("nonsense")).toBeNull();
    expect(ceoSectionFromSlug(undefined)).toBe("overview");
  });

  it("addresses from before the sections existed still find their section", () => {
    expect(ceoSectionFromLegacyTab("payroll")).toBe("payroll");
    expect(ceoSectionFromLegacyTab("optimize")).toBe("optimize");
    expect(ceoSectionFromLegacyTab("pins")).toBe("control");
    expect(ceoSectionFromLegacyTab("portal")).toBe("control");
    expect(ceoSectionFromLegacyTab("activity")).toBe("activity");
    expect(ceoSectionFromLegacyTab(null)).toBeNull();
    expect(ceoSectionFromLegacyTab("whatever")).toBeNull();
  });
});

describe("which navigation entry is lit", () => {
  it("Command is only Command, not every CEO section", () => {
    expect(isActivePath("/ceo", "/ceo")).toBe(true);
    expect(isActivePath("/ceo", "/ceo/payroll")).toBe(false);
    expect(isActivePath("/ceo/payroll", "/ceo/payroll")).toBe(true);
  });
  it("nested pages keep their section lit", () => {
    expect(isActivePath("/employees", "/employees/12")).toBe(true);
    expect(isActivePath("/ceo/finance", "/ceo/finance/register")).toBe(true);
    expect(isActivePath("/cfo", "/cfo/register")).toBe(false);
    expect(isActivePath("/cfo/register", "/cfo/register")).toBe(true);
    expect(isActivePath("/", "/payroll")).toBe(false);
  });
});
