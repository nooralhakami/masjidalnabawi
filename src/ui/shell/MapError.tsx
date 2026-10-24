import { Button } from '../kit/Button';
import { Icon } from '../kit/Icon';
import { useI18n } from '../i18n';

/**
 * When the map cannot start on this device (no WebGL, or it was refused): a calm card in place of
 * a blank screen, with «try again». The page around it (search, cards) needs the map, so it waits.
 */
export function MapError({ onRetry }: { onRetry(): void }) {
  const { t } = useI18n();
  return (
    <div class="map-error" role="alert">
      <span class="map-error-ic" aria-hidden="true">
        <Icon name="info" size={26} />
      </span>
      <h1 class="map-error-t">{t('map_fail')}</h1>
      <p class="map-error-p">{t('title')}</p>
      <Button onClick={onRetry}>{t('retry')}</Button>
    </div>
  );
}
