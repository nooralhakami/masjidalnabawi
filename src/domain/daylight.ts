/**
 * Where the sun stands over the Prophet's Mosque at a given moment (NOAA's solar position equations,
 * good to a fraction of a degree), so the 3D view can be lit as Madinah is lit right now.
 */

const MOSQUE = { lat: 24.4672, lng: 39.6112 };

const RAD = Math.PI / 180;

export interface SunPosition {
  /** Degrees above the horizon (negative below it). */
  elevation: number;
  /** Degrees clockwise from true north. */
  azimuth: number;
}

/** The sun's elevation and azimuth seen from the Mosque at `at` (any time zone: it works in UTC). */
export function sunPosition(at: Date, lat = MOSQUE.lat, lng = MOSQUE.lng): SunPosition {
  // Julian century from J2000.0.
  const jd = at.getTime() / 86_400_000 + 2_440_587.5;
  const t = (jd - 2_451_545) / 36_525;

  const meanLong = (280.46646 + t * (36_000.76983 + t * 0.0003032)) % 360;
  const meanAnom = 357.52911 + t * (35_999.05029 - 0.0001537 * t);
  const ecc = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const center =
    Math.sin(meanAnom * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * meanAnom * RAD) * (0.019993 - 0.000101 * t) + Math.sin(3 * meanAnom * RAD) * 0.000289;
  const trueLong = meanLong + center;
  const omega = 125.04 - 1934.136 * t;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(obliq * RAD) * Math.sin(appLong * RAD));

  const y = Math.tan((obliq / 2) * RAD) ** 2;
  const eqTime =
    (4 / RAD) *
    (y * Math.sin(2 * meanLong * RAD) -
      2 * ecc * Math.sin(meanAnom * RAD) +
      4 * ecc * y * Math.sin(meanAnom * RAD) * Math.cos(2 * meanLong * RAD) -
      0.5 * y * y * Math.sin(4 * meanLong * RAD) -
      1.25 * ecc * ecc * Math.sin(2 * meanAnom * RAD));

  const utcMinutes = at.getUTCHours() * 60 + at.getUTCMinutes() + at.getUTCSeconds() / 60;
  const trueSolarTime = (((utcMinutes + eqTime + 4 * lng) % 1440) + 1440) % 1440;
  const hourAngle = trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180;

  const latR = lat * RAD;
  const cosZenith = Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(hourAngle * RAD);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  const elevation = 90 - zenith / RAD;

  const az = Math.acos(Math.min(1, Math.max(-1, (Math.sin(latR) * Math.cos(zenith) - Math.sin(decl)) / (Math.cos(latR) * Math.sin(zenith)))));
  const azimuth = hourAngle > 0 ? (az / RAD + 180) % 360 : (540 - az / RAD) % 360;

  return { elevation, azimuth };
}
