export type ProjectView = "dashboard" | "budget" | "cashflow" | "settings";
export type LegacyProjectView = "expenses" | "funding";

export type AppRoute =
  | { kind: "projects" }
  | { kind: "project"; projectId: string; view: ProjectView; legacyView?: LegacyProjectView };

const views: ProjectView[] = ["dashboard", "budget", "cashflow", "settings"];
const legacyViews: LegacyProjectView[] = ["expenses", "funding"];

export function parseRoute(hash: string): AppRoute {
  const path = hash.replace(/^#\/?/, "");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "projects" || !parts[1]) return { kind: "projects" };
  if (legacyViews.includes(parts[2] as LegacyProjectView)) {
    return {
      kind: "project",
      projectId: decodeURIComponent(parts[1]),
      view: "cashflow",
      legacyView: parts[2] as LegacyProjectView,
    };
  }
  const view = views.includes(parts[2] as ProjectView) ? parts[2] as ProjectView : "dashboard";
  return { kind: "project", projectId: decodeURIComponent(parts[1]), view };
}

export function projectsRoute(): string {
  return "#/projects";
}

export function projectRoute(projectId: string, view: ProjectView = "dashboard"): string {
  return `#/projects/${encodeURIComponent(projectId)}/${view}`;
}
