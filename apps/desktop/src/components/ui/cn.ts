/**
 * cn() — class-name composer. Wraps tailwind-merge over clsx.
 * Last writer wins on conflicts (e.g. cn("p-2", maybeClass, "p-4") → "p-4").
 *
 * Use everywhere that conditionally builds a className. Stops the cargo-cult
 * `${a} ${b ? c : ""} ${d}` pattern that leaves dangling spaces and
 * creates conflicts the user sees as "second class won't override first".
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
