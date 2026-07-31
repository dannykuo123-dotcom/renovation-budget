import { describe, expect, it, vi } from "vitest";
import { setBudgetAddMenuOpen } from "./budget-menu";

describe("setBudgetAddMenuOpen", () => {
  it("moves focus to the first action when opening", () => {
    const firstAction = { focus: vi.fn() };
    const menu = { hidden: true, querySelector: vi.fn(() => firstAction) };
    const button = { focus: vi.fn(), setAttribute: vi.fn() };

    setBudgetAddMenuOpen(menu as unknown as HTMLElement, button as unknown as HTMLButtonElement, true);

    expect(menu.hidden).toBe(false);
    expect(button.setAttribute).toHaveBeenCalledWith("aria-expanded", "true");
    expect(firstAction.focus).toHaveBeenCalledOnce();
  });

  it("returns focus to the add button when closing", () => {
    const menu = { hidden: false, querySelector: vi.fn() };
    const button = { focus: vi.fn(), setAttribute: vi.fn() };

    setBudgetAddMenuOpen(menu as unknown as HTMLElement, button as unknown as HTMLButtonElement, false);

    expect(menu.hidden).toBe(true);
    expect(button.setAttribute).toHaveBeenCalledWith("aria-expanded", "false");
    expect(button.focus).toHaveBeenCalledOnce();
  });
  it("does not restore opener focus when a menu action is opening a modal", () => {
    const menu = { hidden: false, querySelector: vi.fn() };
    const button = { focus: vi.fn(), setAttribute: vi.fn() };

    setBudgetAddMenuOpen(menu as unknown as HTMLElement, button as unknown as HTMLButtonElement, false, false);

    expect(menu.hidden).toBe(true);
    expect(button.focus).not.toHaveBeenCalled();
  });
});