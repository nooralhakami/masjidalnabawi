import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { tNext } from '../../i18n-next/strings';
import { checkAdminPassword } from '../../state/admin';
import { useI18n } from '../i18n';
import { Icon } from '../kit/Icon';

/** The password before the supervisor's page (owner, 2026-10-16). Esc or «close» leaves it shut. */
export function AdminGate({ onUnlock, onClose }: { onUnlock(): void; onClose(): void }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    input.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const ok = await checkAdminPassword(input.current?.value ?? '');
    setBusy(false);
    if (ok) return onUnlock();
    setWrong(true);
    if (input.current) {
      input.current.value = '';
      input.current.focus();
    }
  };

  return (
    <div class="admin-gate-scrim">
      <form class="admin-gate" role="dialog" aria-modal="true" aria-labelledby="admin-gate-t" onSubmit={submit}>
        <div class="admin-gate-head">
          <h2 id="admin-gate-t">{t('admin_t')}</h2>
          <button type="button" class="icon-btn" aria-label={t('l_close')} title={t('l_close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <label class="admin-gate-field">
          <span>{tNext('admin_pass')}</span>
          <input
            ref={input}
            type="password"
            autocomplete="current-password"
            dir="ltr"
            aria-invalid={wrong}
            aria-describedby={wrong ? 'admin-gate-err' : undefined}
            onInput={() => setWrong(false)}
          />
        </label>
        {wrong ? (
          <p class="admin-gate-err" id="admin-gate-err" role="alert">
            {tNext('admin_wrong')}
          </p>
        ) : null}
        <button type="submit" class="btn btn-primary btn-block" aria-busy={busy}>
          <span class="btn-label">{tNext('admin_enter')}</span>
        </button>
      </form>
    </div>
  );
}
