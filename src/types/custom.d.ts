declare module 'tokml' {
  const tokml: (geojson: any, options?: any) => string;
  export default tokml;
}

declare module 'shp-write' {
  export function download(geojson: any, options?: any): void;
  export function zip(geojson: any, options?: any): Promise<ArrayBuffer>;
}
