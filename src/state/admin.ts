import { signal } from '@preact/signals';

/**
 * The supervisor's page is hidden (owner, 2026-10-16): it is offered only when «ADMIN» is typed in
 * the search box, exactly so, and opens only with the password.
 *
 * Only the password's SHA-256 is here, not the password. This hides the page from visitors; it is
 * not real protection (the check runs in the browser), which is acceptable while the page's changes
 * stay on the supervisor's own device. Changes shared with every visitor need the check on a server
 * (docs/SPEC.md decision log).
 */
export const ADMIN_WORD = 'ADMIN';
const ADMIN_SHA256 = '41e5653fc7aeb894026d6bb7b2db7f65902b454945fa8fd65a6327047b5277fb';

/** Exactly «ADMIN» (capitals, the whole word; spaces around it ignored). */
export const isAdminWord = (typed: string): boolean => typed.trim() === ADMIN_WORD;

export async function checkAdminPassword(pw: string): Promise<boolean> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return hex === ADMIN_SHA256;
  } catch {
    // No Web Crypto (an insecure http page): the page stays closed.
    return false;
  }
}

/** The password was given on this page (kept across a language change; a reload asks again). */
export const adminUnlocked = signal(false);

