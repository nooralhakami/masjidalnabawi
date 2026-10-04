import 'leaflet';

declare module 'leaflet' {
  interface MapOptions {
    rotate?: boolean;
    bearing?: number;
    touchRotate?: boolean;
    shiftKeyRotate?: boolean;
    rotateControl?: boolean | {
      closeOnZeroBearing?: boolean;
      position?: ControlPosition;
    };
  }

  interface Map {
    setBearing(degrees: number): this;
    getBearing(): number;
  }
}
