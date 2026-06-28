// filepath: coffee-app/merchant-web/src/api/auth.ts
// Simple local-only auth: stores a token in localStorage.
// In production, this should be replaced with a real backend auth.
const TOKEN_KEY = 'merchant_token';
const PASS_KEY = 'merchant_password';

const DEFAULT_PASSWORD = 'admin123';

export const auth = {
  init() {
    // First-run setup: ensure a default password exists
    if (!localStorage.getItem(PASS_KEY)) {
      localStorage.setItem(PASS_KEY, DEFAULT_PASSWORD);
    }
  },
  login(password: string): boolean {
    const stored = localStorage.getItem(PASS_KEY) || DEFAULT_PASSWORD;
    if (password === stored) {
      localStorage.setItem(TOKEN_KEY, `mock-${Date.now()}`);
      return true;
    }
    return false;
  },
  logout() {
    localStorage.removeItem(TOKEN_KEY);
  },
  isLoggedIn(): boolean {
    return !!localStorage.getItem(TOKEN_KEY);
  },
  changePassword(newPassword: string) {
    localStorage.setItem(PASS_KEY, newPassword);
  }
};
