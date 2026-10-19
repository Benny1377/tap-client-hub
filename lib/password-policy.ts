/** The shortest password TAP Hub accepts when a password is set or changed. */
export const MIN_PASSWORD_LENGTH = 12;

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}
