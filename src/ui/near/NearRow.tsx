import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { NearKind } from '../../domain/near';
import { nextPrayer, PRAYERS, type NextPrayer } from '../../domain/prayer';
import { latinDigits } from '../../i18n';
import { useI18n } from '../i18n';
import { Icon } from '../kit/Icon';

/** A Madinah wall-clock time in the visitor's language, Latin digits (DESIGN §2). */
export function clock(at: Date, lang: string): string {
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' };
  let s: string;
  try {
    s = new Intl.DateTimeFormat(`${lang}-u-nu-latn`, opts).format(at);
  } catch {
    s = new Intl.DateTimeFormat('en', opts).format(at);
  }
  return latinDigits(s);
}

export interface NearRowProps {
  /** The visitor tapped «nearest restroom» or «nearest gate»; resolves when the route is drawn (or not). */
  onNear(kind: NearKind): Promise<void>;
  /** Now, for the next prayer (the tests pass a fixed time). */
  now?: Date;
}

/**
 * «Near you now» (UI plan phase 2, owner 2026-11-07): three clear buttons over the map, above the
 * Rawdah card — the nearest restroom, the nearest gate (one tap draws the way to the two nearest open
 * ones), and the next prayer, whose tap lists today's five. The tapped button shows it is busy at
 * once, so it is never pressed five times.
 */
export function NearRow({ onNear, now }: NearRowProps) {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState<NearKind | null>(null);
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(() => now ?? new Date());
  useEffect(() => {
    if (now) return;
    const id = window.setInterval(() => setTick(new Date()), 30_000);
    return () => clearInterval(id);
  }, [now]);
  const p = nextPrayer(now ?? tick);

  const go = async (kind: NearKind) => {
    if (busy) return;
    setBusy(kind);
    try {
      await onNear(kind);
    } finally {
      setBusy(null);
    }
  };

  const btn = (kind: NearKind, icon: 'toilets' | 'gate', label: string) => (
    <button type="button" class={`near-btn${busy === kind ? ' is-loading' : ''}`} aria-busy={busy === kind ? 'true' : undefined} onClick={() => void go(kind)}>
      {busy === kind ? <span class="spinner" aria-hidden="true" /> : <Icon name={icon} size={20} />}
      <span class="near-label">{label}</span>
    </button>
  );

  return (
    <div class="near">
      <div class="near-row" role="group" aria-label={t('near_title')}>
        {btn('toilet', 'toilets', t('near_wc'))}
        {btn('gate', 'gate', t('near_gate'))}
        <button type="button" class="near-btn near-prayer" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
          <Icon name="prayer" size={20} />
          <span class="near-label">
            <span class="sr-only">{t('pr_next')}: </span>
            {t(`pr_${p.name}`)} <span class="near-time">{clock(p.at, lang)}</span>
          </span>
        </button>
      </div>
      {open ? <PrayerPanel p={p} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

/** Today's five prayers in Madinah, the next one marked with the time left; closed by a tap outside it or Esc. */
function PrayerPanel({ p, onClose }: { p: NextPrayer; onClose(): void }) {
  const { t, lang } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    box.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const h = Math.floor(p.minutesLeft / 60);
  const m = p.minutesLeft % 60;
  const left = h ? t('dur_hm', { h, m }) : t('dur_m', { m });
  // After Isha the next is tomorrow's Fajr: today's list then marks none.
  const nextToday = p.today[p.name].getTime() === p.at.getTime();
  return (
    <>
      <div class="near-scrim" onClick={onClose} aria-hidden="true" />
      <div class="near-panel" role="dialog" aria-labelledby="near-panel-t" tabIndex={-1} ref={box}>
        <strong id="near-panel-t" class="near-panel-t">
          {t('pr_today')}
        </strong>
        <ul class="near-times">
          {PRAYERS.map((name) => {
            const next = nextToday && name === p.name;
            return (
              <li key={name} class={next ? 'is-next' : undefined} aria-current={next ? 'time' : undefined}>
                <span>{t(`pr_${name}`)}</span>
                <span class="near-time">{clock(p.today[name], lang)}</span>
                {next ? <small class="near-left">{t('pr_in', { t: left })}</small> : null}
              </li>
            );
          })}
        </ul>
        {!nextToday ? (
          <div class="near-tomorrow">
            {t('pr_fajr')} · {clock(p.at, lang)} · {t('pr_in', { t: left })}
          </div>
        ) : null}
        <small class="near-src">{t('pr_source')}</small>
      </div>
    </>
  );
}
