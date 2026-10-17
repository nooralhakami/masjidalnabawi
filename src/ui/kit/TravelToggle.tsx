import { useI18n } from '../i18n';
import { SlideToggle } from './SlideToggle';

export type Travel = 'walk' | 'drive';
export type Level = 'A' | 'B';

/** On foot (green) or by car (blue). */
export function TravelToggle({ value, onChange, disabled }: { value: Travel; onChange(v: Travel): void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <SlideToggle
      label={t('travel_mode')}
      value={value}
      onChange={onChange}
      disabled={disabled}
      options={[
        { value: 'walk', label: t('travel_walk'), icon: 'walk', tone: 'walk' },
        { value: 'drive', label: t('travel_drive'), icon: 'car', tone: 'drive' },
      ]}
    />
  );
}

/** The car park level: B below (green, the way in and out), A above (yellow, by the ramps). */
export function FloorSwitch({ value, onChange, disabled }: { value: Level; onChange(v: Level): void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <div class="floor-row">
      <span class="floor-k">{t('lvl_title')}</span>
      <SlideToggle
        label={t('lvl_title')}
        value={value}
        onChange={onChange}
        disabled={disabled}
        options={[
          { value: 'B', label: t('lvl_name', { l: 'B' }), tone: 'level-b' },
          { value: 'A', label: t('lvl_name', { l: 'A' }), tone: 'level-a' },
        ]}
      />
    </div>
  );
}
