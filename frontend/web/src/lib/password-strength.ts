export function isStrongPassword(pw: string) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(pw);
}

export function getPasswordStrength(password: string) {
  if (password.length === 0) return 0;
  return isStrongPassword(password) ? 100 : Math.min(75, password.length * 8);
}

export function getStrengthBarClass(strength: number) {
  if (strength > 80) return "bg-emerald-500";
  if (strength > 50) return "bg-yellow-500";
  return "bg-red-500";
}
