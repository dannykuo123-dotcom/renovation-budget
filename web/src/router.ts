export type ProjectView = "dashboard" | "budget" | "expenses" | "funding" | "cashflow" | "settings";

export type AppRoute =
  | { kind: "projects" }
  | { kind: "project"; projectId: string; view: ProjectView };

const views: ProjectView[] = ["dashboard", "budget", "expenses", "funding", "cashflow", "settings"];

export function parseRoute(hash: string): AppRoute {
  const path = hash.replace(/^#\/?/, "");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "projects" || !parts[1]) return { kind: "projects" };
  const view = views.includes(parts[2] as ProjectView) ? parts[2] as ProjectView : "dashboard";
  return { kind: "project", projectId: decodeURIComponent(parts[1]), view };
}

export function projectsRoute(): string {
  return "#/projects";
}

export function projectRoute(projectId: string, view: ProjectView = "dashboard"): string {
  return `#/projects/${encodeURIComponent(projectId)}/${view}`;
}
