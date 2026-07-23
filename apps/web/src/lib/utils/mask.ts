/** Privacy-safe display masking, bypassed only for roles with customers.pii.view. */

export function maskPhone(phone: string, canSee: boolean): string {
  if (canSee) return phone;
  return phone.replace(/(\+\d+\s?\d{2}[-\s]?)(\d+)(\s?\d{4})$/, "$1•••$3");
}

export function maskEmail(email: string, canSee: boolean): string {
  if (canSee) return email;
  const [user, domain] = email.split("@");
  return `${(user ?? "").slice(0, 2)}•••@${domain}`;
}
