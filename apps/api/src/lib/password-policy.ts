const MIN_PASSWORD_LENGTH = 12;

const WEAK_EXACT = new Set([
  "password123",
  "admin123",
  "quickbopha123",
  "password1234",
  "admin1234",
  "123456789012",
  "qwertyuiop12",
  "letmein12345",
]);

const WEAK_SUBSTRINGS = [
  "password",
  "admin123",
  "quickbopha",
  "changeme",
  "welcome",
  "plethora",
];

export interface PasswordValidationResult {
  valid: boolean;
  message?: string;
}

export function validatePassword(
  password: string,
  opts?: { companyName?: string }
): PasswordValidationResult {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      valid: false,
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }

  const lower = password.toLowerCase();
  if (WEAK_EXACT.has(lower)) {
    return { valid: false, message: "Password is too common. Choose a stronger password." };
  }

  for (const sub of WEAK_SUBSTRINGS) {
    if (lower.includes(sub)) {
      return { valid: false, message: "Password is too predictable. Avoid common words and patterns." };
    }
  }

  if (/^(.)\1{5,}/.test(password)) {
    return { valid: false, message: "Password cannot repeat the same character excessively." };
  }

  const company = opts?.companyName?.trim();
  if (company && company.length >= 3) {
    const slug = company.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (slug.length >= 3) {
      if (lower.includes(slug) || lower.includes(`${slug}123`)) {
        return {
          valid: false,
          message: "Password must not include the company name or obvious variants.",
        };
      }
    }
  }

  return { valid: true };
}

export const PASSWORD_MIN_LENGTH = MIN_PASSWORD_LENGTH;
