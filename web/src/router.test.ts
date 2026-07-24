import { describe, expect, it } from "vitest";
import { parseRoute, projectRoute } from "./router";

describe("project hash routes", () => {
  it("defaults to the project list", () => {
    expect(parseRoute("")).toEqual({ kind: "projects" });
    expect(parseRoute("#/projects")).toEqual({ kind: "projects" });
  });

  it("keeps a project and its selected page across refreshes", () => {
    const hash = projectRoute("job/一號", "expenses");
    expect(parseRoute(hash)).toEqual({ kind: "project", projectId: "job/一號", view: "expenses" });
  });

  it("falls back to the project dashboard for an unknown page", () => {
    expect(parseRoute("#/projects/abc/unknown")).toEqual({
      kind: "project",
      projectId: "abc",
      view: "dashboard",
    });
  });
});
