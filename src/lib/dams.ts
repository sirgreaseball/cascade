// Starting points for the scenario builder: major Indian dams with approximate public figures
// (National Register of Large Dams, India-WRIS, operator websites). Locations are snapped to
// the river on the DEM when a scenario is built, and every value is editable. Verify against
// the dam owner's data before any operational use.

export interface DamCatalogEntry {
  id: string;
  name: string;
  river: string;
  state: string;
  lng: number;
  lat: number;
  /** Height above the deepest foundation (m). */
  height: number;
  crestLength: number;
  /** Gross storage (million m³). */
  volumeMCM: number;
  type: 'Embankment' | 'Concrete gravity' | 'Arch' | 'Masonry';
}

export const DAM_CATALOG: DamCatalogEntry[] = [
  { id: 'tehri', name: 'Tehri', river: 'Bhagirathi', state: 'Uttarakhand', lng: 78.4806, lat: 30.3778, height: 260.5, crestLength: 575, volumeMCM: 3540, type: 'Embankment' },
  { id: 'bhakra', name: 'Bhakra', river: 'Sutlej', state: 'Himachal Pradesh', lng: 76.4333, lat: 31.4108, height: 226, crestLength: 518, volumeMCM: 9340, type: 'Concrete gravity' },
  { id: 'pong', name: 'Pong (Beas)', river: 'Beas', state: 'Himachal Pradesh', lng: 75.95, lat: 31.967, height: 133, crestLength: 1951, volumeMCM: 8570, type: 'Embankment' },
  { id: 'ranjit-sagar', name: 'Ranjit Sagar', river: 'Ravi', state: 'Punjab', lng: 75.73, lat: 32.44, height: 160, crestLength: 617, volumeMCM: 3280, type: 'Embankment' },
  { id: 'sardar-sarovar', name: 'Sardar Sarovar', river: 'Narmada', state: 'Gujarat', lng: 73.747, lat: 21.83, height: 163, crestLength: 1210, volumeMCM: 9500, type: 'Concrete gravity' },
  { id: 'indira-sagar', name: 'Indira Sagar', river: 'Narmada', state: 'Madhya Pradesh', lng: 76.47, lat: 22.283, height: 92, crestLength: 653, volumeMCM: 12220, type: 'Concrete gravity' },
  { id: 'hirakud', name: 'Hirakud', river: 'Mahanadi', state: 'Odisha', lng: 83.872, lat: 21.572, height: 61, crestLength: 4800, volumeMCM: 8136, type: 'Embankment' },
  { id: 'rihand', name: 'Rihand', river: 'Rihand', state: 'Uttar Pradesh', lng: 83.01, lat: 24.2, height: 91, crestLength: 934, volumeMCM: 10600, type: 'Concrete gravity' },
  { id: 'ukai', name: 'Ukai', river: 'Tapi', state: 'Gujarat', lng: 73.59, lat: 21.25, height: 81, crestLength: 4927, volumeMCM: 8510, type: 'Embankment' },
  { id: 'koyna', name: 'Koyna', river: 'Koyna', state: 'Maharashtra', lng: 73.752, lat: 17.402, height: 103, crestLength: 807, volumeMCM: 2797, type: 'Concrete gravity' },
  { id: 'nagarjuna-sagar', name: 'Nagarjuna Sagar', river: 'Krishna', state: 'Telangana · Andhra Pradesh', lng: 79.312, lat: 16.575, height: 124, crestLength: 1550, volumeMCM: 11560, type: 'Masonry' },
  { id: 'srisailam', name: 'Srisailam', river: 'Krishna', state: 'Andhra Pradesh', lng: 78.897, lat: 16.087, height: 145, crestLength: 512, volumeMCM: 6110, type: 'Concrete gravity' },
  { id: 'tungabhadra', name: 'Tungabhadra', river: 'Tungabhadra', state: 'Karnataka', lng: 76.339, lat: 15.268, height: 50, crestLength: 2449, volumeMCM: 3760, type: 'Masonry' },
  { id: 'mettur', name: 'Mettur', river: 'Kaveri', state: 'Tamil Nadu', lng: 77.801, lat: 11.786, height: 65, crestLength: 1700, volumeMCM: 2650, type: 'Masonry' },
  { id: 'idukki', name: 'Idukki', river: 'Periyar', state: 'Kerala', lng: 76.976, lat: 9.843, height: 169, crestLength: 366, volumeMCM: 1996, type: 'Arch' },
  { id: 'mullaperiyar', name: 'Mullaperiyar', river: 'Periyar', state: 'Kerala', lng: 77.144, lat: 9.529, height: 54, crestLength: 366, volumeMCM: 443, type: 'Masonry' },
];
