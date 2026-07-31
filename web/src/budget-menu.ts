export function setBudgetAddMenuOpen(
  menu: HTMLElement,
  button: HTMLButtonElement,
  open: boolean,
  restoreOpenerFocus = true,
): void {
  menu.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
  if (open) menu.querySelector<HTMLButtonElement>("button")?.focus();
  else if (restoreOpenerFocus) button.focus();
}