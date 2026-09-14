// Generates public/data/dams-national.json: comprehensive national catalogue of major Indian dams
// across all states, districts and rivers.
//
// Data sources and licensing:
//   - Central Water Commission (CWC), Ministry of Jal Shakti: National Register of Large Dams (NRLD)
//     under Government Open Data License - India (GODL).
//   - OpenStreetMap contributors: geospatial coordinates under Open Database License (ODbL).
//   - Wikidata: public domain data under Creative Commons CC0.
//
// Usage:
//   node scripts/build-national-catalogue.ts

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export interface NationalDamRecord {
  id: string;
  name: string;
  river: string;
  state: string;
  district: string;
  nearestCity: string;
  lng: number;
  lat: number;
  height: number;
  crestLength: number;
  volumeMCM: number;
  type: 'Embankment' | 'Concrete gravity' | 'Arch' | 'Masonry' | 'Composite' | 'Rockfill' | string;
  year?: number;
}

export const NATIONAL_DAMS: NationalDamRecord[] = [
  // --- UTTARAKHAND ---
  { id: 'tehri', name: 'Tehri', river: 'Bhagirathi', state: 'Uttarakhand', district: 'Tehri Garhwal', nearestCity: 'New Tehri', lng: 78.4806, lat: 30.3778, height: 260.5, crestLength: 575, volumeMCM: 3540, type: 'Embankment', year: 2006 },
  { id: 'koteshwar', name: 'Koteshwar', river: 'Bhagirathi', state: 'Uttarakhand', district: 'Tehri Garhwal', nearestCity: 'Devprayag', lng: 78.6186, lat: 30.2819, height: 97.5, crestLength: 300, volumeMCM: 88, type: 'Concrete gravity', year: 2011 },
  { id: 'ramganga', name: 'Ramganga (Kalagarh)', river: 'Ramganga', state: 'Uttarakhand', district: 'Pauri Garhwal', nearestCity: 'Kotdwar', lng: 78.7594, lat: 29.5222, height: 128, crestLength: 630, volumeMCM: 2449, type: 'Embankment', year: 1974 },
  { id: 'srinagar', name: 'Srinagar Hydro', river: 'Alaknanda', state: 'Uttarakhand', district: 'Pauri Garhwal', nearestCity: 'Srinagar', lng: 78.8028, lat: 30.2289, height: 90, crestLength: 248, volumeMCM: 53, type: 'Concrete gravity', year: 2015 },
  { id: 'tapovan-vishnugad', name: 'Tapovan Vishnugad', river: 'Dhauliganga', state: 'Uttarakhand', district: 'Chamoli', nearestCity: 'Joshimath', lng: 79.6267, lat: 30.5517, height: 35, crestLength: 200, volumeMCM: 15, type: 'Concrete gravity', year: 2021 },
  { id: 'maneri-bhali', name: 'Maneri Bhali I', river: 'Bhagirathi', state: 'Uttarakhand', district: 'Uttarkashi', nearestCity: 'Uttarkashi', lng: 78.5375, lat: 30.7381, height: 39, crestLength: 127, volumeMCM: 0.6, type: 'Concrete gravity', year: 1984 },
  { id: 'dhauliganga-dam', name: 'Dhauliganga', river: 'Dhauliganga', state: 'Uttarakhand', district: 'Pithoragarh', nearestCity: 'Dharchula', lng: 80.5367, lat: 29.9678, height: 56, crestLength: 270, volumeMCM: 6.2, type: 'Concrete gravity', year: 2005 },
  { id: 'chibro', name: 'Chibro (Ichari)', river: 'Tons', state: 'Uttarakhand', district: 'Dehradun', nearestCity: 'Dakpathar', lng: 77.7972, lat: 30.5283, height: 59, crestLength: 155, volumeMCM: 5.1, type: 'Concrete gravity', year: 1972 },

  // --- HIMACHAL PRADESH ---
  { id: 'bhakra', name: 'Bhakra', river: 'Sutlej', state: 'Himachal Pradesh', district: 'Bilaspur', nearestCity: 'Nangal', lng: 76.4333, lat: 31.4108, height: 226, crestLength: 518, volumeMCM: 9340, type: 'Concrete gravity', year: 1963 },
  { id: 'pong', name: 'Pong (Maharana Pratap Sagar)', river: 'Beas', state: 'Himachal Pradesh', district: 'Kangra', nearestCity: 'Talwara', lng: 75.95, lat: 31.967, height: 133, crestLength: 1951, volumeMCM: 8570, type: 'Embankment', year: 1974 },
  { id: 'chamera-1', name: 'Chamera I', river: 'Ravi', state: 'Himachal Pradesh', district: 'Chamba', nearestCity: 'Dalhousie', lng: 75.9222, lat: 32.5936, height: 140, crestLength: 295, volumeMCM: 391, type: 'Concrete gravity', year: 1994 },
  { id: 'chamera-2', name: 'Chamera II', river: 'Ravi', state: 'Himachal Pradesh', district: 'Chamba', nearestCity: 'Chamba', lng: 76.2239, lat: 32.5286, height: 43, crestLength: 119, volumeMCM: 1.5, type: 'Concrete gravity', year: 2004 },
  { id: 'nathpa-jhakri', name: 'Nathpa Jhakri', river: 'Sutlej', state: 'Himachal Pradesh', district: 'Kinnaur', nearestCity: 'Rampur', lng: 77.9739, lat: 31.5647, height: 62.5, crestLength: 185, volumeMCM: 3.4, type: 'Concrete gravity', year: 2004 },
  { id: 'karcham-wangtoo', name: 'Karcham Wangtoo', river: 'Sutlej', state: 'Himachal Pradesh', district: 'Kinnaur', nearestCity: 'Reckong Peo', lng: 78.1811, lat: 31.5008, height: 98, crestLength: 177, volumeMCM: 9.6, type: 'Concrete gravity', year: 2011 },
  { id: 'kol-dam', name: 'Kol Dam', river: 'Sutlej', state: 'Himachal Pradesh', district: 'Bilaspur', nearestCity: 'Sundernagar', lng: 76.8622, lat: 31.3653, height: 167, crestLength: 500, volumeMCM: 560, type: 'Embankment', year: 2015 },
  { id: 'pandoh', name: 'Pandoh', river: 'Beas', state: 'Himachal Pradesh', district: 'Mandi', nearestCity: 'Mandi', lng: 77.0664, lat: 31.6706, height: 76, crestLength: 255, volumeMCM: 41, type: 'Embankment', year: 1977 },

  // --- PUNJAB ---
  { id: 'ranjit-sagar', name: 'Ranjit Sagar (Thein)', river: 'Ravi', state: 'Punjab', district: 'Pathankot', nearestCity: 'Pathankot', lng: 75.73, lat: 32.44, height: 160, crestLength: 617, volumeMCM: 3280, type: 'Embankment', year: 2001 },
  { id: 'siswan', name: 'Siswan', river: 'Siswan', state: 'Punjab', district: 'Mohali (SAS Nagar)', nearestCity: 'Chandigarh', lng: 76.7125, lat: 30.8681, height: 24, crestLength: 380, volumeMCM: 14, type: 'Embankment', year: 1998 },
  { id: 'mirzapur', name: 'Mirzapur', river: 'Budki', state: 'Punjab', district: 'Mohali (SAS Nagar)', nearestCity: 'Kurali', lng: 76.6847, lat: 30.8933, height: 22, crestLength: 420, volumeMCM: 9.2, type: 'Embankment', year: 2000 },
  { id: 'dholbaha', name: 'Dholbaha', river: 'Dholbaha', state: 'Punjab', district: 'Hoshiarpur', nearestCity: 'Hoshiarpur', lng: 75.8944, lat: 31.7389, height: 38.8, crestLength: 427, volumeMCM: 34.6, type: 'Embankment', year: 1987 },

  // --- MAHARASHTRA ---
  { id: 'koyna', name: 'Koyna', river: 'Koyna', state: 'Maharashtra', district: 'Satara', nearestCity: 'Koynanagar', lng: 73.752, lat: 17.402, height: 103, crestLength: 807, volumeMCM: 2797, type: 'Concrete gravity', year: 1964 },
  { id: 'jayakwadi', name: 'Jayakwadi (Nath Sagar)', river: 'Godavari', state: 'Maharashtra', district: 'Chhatrapati Sambhaji Nagar', nearestCity: 'Paithan', lng: 75.3853, lat: 19.4864, height: 41.3, crestLength: 9964, volumeMCM: 2909, type: 'Embankment', year: 1976 },
  { id: 'ujani', name: 'Ujani (Bhima)', river: 'Bhima', state: 'Maharashtra', district: 'Solapur', nearestCity: 'Tembhurni', lng: 75.1189, lat: 18.0758, height: 56.4, crestLength: 2534, volumeMCM: 3140, type: 'Masonry', year: 1980 },
  { id: 'bhatsa', name: 'Bhatsa', river: 'Bhatsa', state: 'Maharashtra', district: 'Thane', nearestCity: 'Shahapur', lng: 73.2667, lat: 19.5167, height: 88.5, crestLength: 959, volumeMCM: 976, type: 'Masonry', year: 1983 },
  { id: 'upper-vaitarna', name: 'Upper Vaitarna', river: 'Vaitarna', state: 'Maharashtra', district: 'Nashik', nearestCity: 'Igatpuri', lng: 73.5511, lat: 19.6861, height: 41, crestLength: 2531, volumeMCM: 331, type: 'Embankment', year: 1973 },
  { id: 'middle-vaitarna', name: 'Middle Vaitarna', river: 'Vaitarna', state: 'Maharashtra', district: 'Thane', nearestCity: 'Mokhada', lng: 73.4356, lat: 19.7028, height: 102, crestLength: 565, volumeMCM: 193, type: 'Concrete gravity', year: 2012 },
  { id: 'khadakwasla', name: 'Khadakwasla', river: 'Mutha', state: 'Maharashtra', district: 'Pune', nearestCity: 'Pune', lng: 73.7631, lat: 18.4414, height: 32.9, crestLength: 1539, volumeMCM: 86, type: 'Masonry', year: 1879 },
  { id: 'panshet', name: 'Panshet (Tanajisagar)', river: 'Ambi', state: 'Maharashtra', district: 'Pune', nearestCity: 'Pune', lng: 73.6192, lat: 18.3756, height: 63.5, crestLength: 1039, volumeMCM: 303, type: 'Embankment', year: 1961 },
  { id: 'varasgaon', name: 'Varasgaon (Veerbaji Pasalkar)', river: 'Mose', state: 'Maharashtra', district: 'Pune', nearestCity: 'Pune', lng: 73.6069, lat: 18.3972, height: 63.4, crestLength: 785, volumeMCM: 374, type: 'Masonry', year: 1993 },
  { id: 'temghar', name: 'Temghar', river: 'Mutha', state: 'Maharashtra', district: 'Pune', nearestCity: 'Lavasa', lng: 73.5414, lat: 18.5283, height: 86.5, crestLength: 1075, volumeMCM: 107, type: 'Concrete gravity', year: 2010 },
  { id: 'mulshi', name: 'Mulshi', river: 'Mula', state: 'Maharashtra', district: 'Pune', nearestCity: 'Paud', lng: 73.5042, lat: 18.5219, height: 48.8, crestLength: 1540, volumeMCM: 615, type: 'Masonry', year: 1927 },
  { id: 'pawana', name: 'Pawana', river: 'Pawana', state: 'Maharashtra', district: 'Pune', nearestCity: 'Lonavala', lng: 73.4917, lat: 18.6675, height: 42.4, crestLength: 1329, volumeMCM: 271, type: 'Embankment', year: 1972 },
  { id: 'chaskaman', name: 'Chaskaman', river: 'Bhima', state: 'Maharashtra', district: 'Pune', nearestCity: 'Rajgurunagar', lng: 73.7844, lat: 18.8986, height: 46.1, crestLength: 955, volumeMCM: 241, type: 'Embankment', year: 2008 },
  { id: 'bhandardara', name: 'Bhandardara (Wilson)', river: 'Pravara', state: 'Maharashtra', district: 'Ahmednagar', nearestCity: 'Akole', lng: 73.7583, lat: 19.5492, height: 82.3, crestLength: 507, volumeMCM: 312, type: 'Masonry', year: 1926 },
  { id: 'mula', name: 'Mula', river: 'Mula', state: 'Maharashtra', district: 'Ahmednagar', nearestCity: 'Rahuri', lng: 74.5889, lat: 19.3361, height: 48.2, crestLength: 2856, volumeMCM: 736, type: 'Embankment', year: 1974 },
  { id: 'gangapur', name: 'Gangapur', river: 'Godavari', state: 'Maharashtra', district: 'Nashik', nearestCity: 'Nashik', lng: 73.6806, lat: 20.0278, height: 36.6, crestLength: 3902, volumeMCM: 215, type: 'Embankment', year: 1965 },
  { id: 'girna', name: 'Girna', river: 'Girna', state: 'Maharashtra', district: 'Nashik', nearestCity: 'Malegaon', lng: 74.6542, lat: 20.4856, height: 54.6, crestLength: 967, volumeMCM: 609, type: 'Embankment', year: 1969 },
  { id: 'radhanagari', name: 'Radhanagari', river: 'Bhogawati', state: 'Maharashtra', district: 'Kolhapur', nearestCity: 'Radhanagari', lng: 73.9856, lat: 16.4111, height: 42.7, crestLength: 1143, volumeMCM: 236, type: 'Masonry', year: 1957 },
  { id: 'dudhganga', name: 'Dudhganga (Kallammawadi)', river: 'Dudhganga', state: 'Maharashtra', district: 'Kolhapur', nearestCity: 'Radhanagari', lng: 74.0322, lat: 16.3547, height: 75.6, crestLength: 1280, volumeMCM: 719, type: 'Masonry', year: 1989 },
  { id: 'warna', name: 'Warna (Chandoli)', river: 'Warna', state: 'Maharashtra', district: 'Sangli', nearestCity: 'Shirala', lng: 73.7917, lat: 17.1333, height: 88.5, crestLength: 1580, volumeMCM: 974, type: 'Embankment', year: 2000 },
  { id: 'totladoh', name: 'Totladoh (Pench)', river: 'Pench', state: 'Maharashtra', district: 'Nagpur', nearestCity: 'Ramtek', lng: 79.2272, lat: 21.5286, height: 74.5, crestLength: 680, volumeMCM: 1241, type: 'Masonry', year: 1989 },
  { id: 'yeldari', name: 'Yeldari', river: 'Purna', state: 'Maharashtra', district: 'Parbhani', nearestCity: 'Jintur', lng: 76.7344, lat: 19.7214, height: 51.2, crestLength: 4232, volumeMCM: 934, type: 'Embankment', year: 1968 },
  { id: 'isapur', name: 'Isapur', river: 'Penganga', state: 'Maharashtra', district: 'Yavatmal', nearestCity: 'Shegaon', lng: 77.3039, lat: 19.7344, height: 57, crestLength: 4120, volumeMCM: 1254, type: 'Embankment', year: 1982 },

  // --- GUJARAT ---
  { id: 'sardar-sarovar', name: 'Sardar Sarovar', river: 'Narmada', state: 'Gujarat', district: 'Narmada', nearestCity: 'Kevadia (Ekta Nagar)', lng: 73.747, lat: 21.83, height: 163, crestLength: 1210, volumeMCM: 9500, type: 'Concrete gravity', year: 2017 },
  { id: 'ukai', name: 'Ukai (Vallabh Sagar)', river: 'Tapi', state: 'Gujarat', district: 'Tapi', nearestCity: 'Songadh', lng: 73.59, lat: 21.25, height: 81, crestLength: 4927, volumeMCM: 8510, type: 'Embankment', year: 1972 },
  { id: 'kadana', name: 'Kadana', river: 'Mahi', state: 'Gujarat', district: 'Mahisagar', nearestCity: 'Santrampur', lng: 73.83, lat: 23.31, height: 66, crestLength: 1551, volumeMCM: 1542, type: 'Masonry', year: 1978 },
  { id: 'dharoi', name: 'Dharoi', river: 'Sabarmati', state: 'Gujarat', district: 'Mehsana', nearestCity: 'Vadnagar', lng: 72.8528, lat: 24.0042, height: 46, crestLength: 1207, volumeMCM: 908, type: 'Embankment', year: 1978 },
  { id: 'dantiwada', name: 'Dantiwada', river: 'Banas', state: 'Gujarat', district: 'Banaskantha', nearestCity: 'Palanpur', lng: 72.3361, lat: 24.3314, height: 61, crestLength: 4832, volumeMCM: 464, type: 'Embankment', year: 1965 },
  { id: 'shetrunji', name: 'Shetrunji', river: 'Shetrunji', state: 'Gujarat', district: 'Bhavnagar', nearestCity: 'Palitana', lng: 71.8653, lat: 21.5039, height: 38, crestLength: 3120, volumeMCM: 309, type: 'Masonry', year: 1965 },
  { id: 'machchhu', name: 'Machchhu II', river: 'Machchhu', state: 'Gujarat', district: 'Morbi', nearestCity: 'Morbi', lng: 70.892, lat: 22.756, height: 26, crestLength: 4000, volumeMCM: 110, type: 'Embankment', year: 1972 },
  { id: 'machchhu-1', name: 'Machchhu I', river: 'Machchhu', state: 'Gujarat', district: 'Surendranagar', nearestCity: 'Wankaner', lng: 70.9786, lat: 22.5639, height: 28, crestLength: 1478, volumeMCM: 73, type: 'Masonry', year: 1961 },
  { id: 'panam', name: 'Panam', river: 'Panam', state: 'Gujarat', district: 'Panchmahal', nearestCity: 'Godhra', lng: 73.7125, lat: 23.0567, height: 56, crestLength: 271, volumeMCM: 554, type: 'Masonry', year: 1999 },
  { id: 'damanganga', name: 'Madhuvan (Damanganga)', river: 'Damanganga', state: 'Gujarat', district: 'Valsad', nearestCity: 'Vapi', lng: 73.0867, lat: 20.1983, height: 58.6, crestLength: 2860, volumeMCM: 567, type: 'Embankment', year: 1989 },

  // --- MADHYA PRADESH ---
  { id: 'indira-sagar', name: 'Indira Sagar', river: 'Narmada', state: 'Madhya Pradesh', district: 'Khandwa', nearestCity: 'Punasa', lng: 76.47, lat: 22.283, height: 92, crestLength: 653, volumeMCM: 12220, type: 'Concrete gravity', year: 2005 },
  { id: 'omkareshwar', name: 'Omkareshwar', river: 'Narmada', state: 'Madhya Pradesh', district: 'Khandwa', nearestCity: 'Omkareshwar', lng: 76.1625, lat: 22.2472, height: 53, crestLength: 949, volumeMCM: 987, type: 'Concrete gravity', year: 2007 },
  { id: 'gandhi-sagar', name: 'Gandhi Sagar', river: 'Chambal', state: 'Madhya Pradesh', district: 'Mandsaur', nearestCity: 'Bhanpura', lng: 75.7408, lat: 24.7078, height: 62.17, crestLength: 514, volumeMCM: 7322, type: 'Masonry', year: 1960 },
  { id: 'bargi', name: 'Bargi (Rani Avantibai Sagar)', river: 'Narmada', state: 'Madhya Pradesh', district: 'Jabalpur', nearestCity: 'Jabalpur', lng: 79.9142, lat: 22.9431, height: 69.8, crestLength: 5357, volumeMCM: 3920, type: 'Concrete gravity', year: 1990 },
  { id: 'bansagar', name: 'Bansagar', river: 'Son', state: 'Madhya Pradesh', district: 'Shahdol', nearestCity: 'Deolond', lng: 81.2889, lat: 24.1917, height: 67, crestLength: 1020, volumeMCM: 5410, type: 'Concrete gravity', year: 2006 },
  { id: 'tawa', name: 'Tawa', river: 'Tawa', state: 'Madhya Pradesh', district: 'Narmadapuram (Hoshangabad)', nearestCity: 'Itarsi', lng: 77.9739, lat: 22.5567, height: 57.9, crestLength: 1815, volumeMCM: 2312, type: 'Embankment', year: 1978 },
  { id: 'madikheda', name: 'Madikheda (Atal Sagar)', river: 'Sindh', state: 'Madhya Pradesh', district: 'Shivpuri', nearestCity: 'Narwar', lng: 77.9022, lat: 25.5539, height: 62, crestLength: 1070, volumeMCM: 900, type: 'Concrete gravity', year: 2008 },
  { id: 'rajghat', name: 'Rajghat', river: 'Betwa', state: 'Madhya Pradesh', district: 'Ashoknagar', nearestCity: 'Chanderi', lng: 78.2389, lat: 24.7644, height: 43.8, crestLength: 11200, volumeMCM: 2170, type: 'Masonry', year: 2000 },
  { id: 'barna', name: 'Barna', river: 'Barna', state: 'Madhya Pradesh', district: 'Raisen', nearestCity: 'Bareli', lng: 78.0611, lat: 22.9556, height: 47.7, crestLength: 432, volumeMCM: 539, type: 'Masonry', year: 1978 },

  // --- KARNATAKA ---
  { id: 'tungabhadra', name: 'Tungabhadra', river: 'Tungabhadra', state: 'Karnataka', district: 'Vijayanagara (Ballari)', nearestCity: 'Hosapete', lng: 76.339, lat: 15.268, height: 50, crestLength: 2449, volumeMCM: 3760, type: 'Masonry', year: 1953 },
  { id: 'almatti', name: 'Almatti (Lal Bahadur Shastri Sagar)', river: 'Krishna', state: 'Karnataka', district: 'Vijayapura (Bijapur)', nearestCity: 'Bagalkote', lng: 75.8894, lat: 16.3278, height: 52.25, crestLength: 1565, volumeMCM: 3440, type: 'Concrete gravity', year: 2005 },
  { id: 'krs', name: 'Krishna Raja Sagara (KRS)', river: 'Kaveri', state: 'Karnataka', district: 'Mandya', nearestCity: 'Mysuru', lng: 76.5728, lat: 12.3814, height: 42.6, crestLength: 2621, volumeMCM: 1369, type: 'Masonry', year: 1938 },
  { id: 'linganamakki', name: 'Linganamakki', river: 'Sharavathi', state: 'Karnataka', district: 'Shivamogga', nearestCity: 'Sagara', lng: 74.8431, lat: 14.2386, height: 61.26, crestLength: 2749, volumeMCM: 4410, type: 'Masonry', year: 1964 },
  { id: 'supa', name: 'Supa', river: 'Kali', state: 'Karnataka', district: 'Uttara Kannada', nearestCity: 'Dandeli', lng: 74.6369, lat: 15.275, height: 101, crestLength: 332, volumeMCM: 4178, type: 'Concrete gravity', year: 1987 },
  { id: 'bhadra', name: 'Bhadra', river: 'Bhadra', state: 'Karnataka', district: 'Chikkamagaluru', nearestCity: 'Bhadravati', lng: 75.6428, lat: 13.7083, height: 59.13, crestLength: 1708, volumeMCM: 2025, type: 'Masonry', year: 1965 },
  { id: 'hidkal', name: 'Ghataprabha (Hidkal)', river: 'Ghataprabha', state: 'Karnataka', district: 'Belagavi', nearestCity: 'Hukkeri', lng: 74.6406, lat: 16.1481, height: 53.34, crestLength: 4830, volumeMCM: 1448, type: 'Embankment', year: 1977 },
  { id: 'malaprabha', name: 'Malaprabha (Renuka Sagar)', river: 'Malaprabha', state: 'Karnataka', district: 'Belagavi', nearestCity: 'Saundatti', lng: 75.1056, lat: 15.8239, height: 43.13, crestLength: 154, volumeMCM: 1070, type: 'Masonry', year: 1972 },
  { id: 'hemavathi', name: 'Hemavathi', river: 'Hemavathi', state: 'Karnataka', district: 'Hassan', nearestCity: 'Gorur', lng: 76.0528, lat: 12.8333, height: 58.5, crestLength: 4692, volumeMCM: 1051, type: 'Masonry', year: 1979 },
  { id: 'kabini', name: 'Kabini', river: 'Kabini', state: 'Karnataka', district: 'Mysuru', nearestCity: 'Heggadadevankote', lng: 76.3533, lat: 11.9744, height: 59.4, crestLength: 2732, volumeMCM: 553, type: 'Masonry', year: 1974 },

  // --- TAMIL NADU ---
  { id: 'mettur', name: 'Mettur (Stanley Reservoir)', river: 'Kaveri', state: 'Tamil Nadu', district: 'Salem', nearestCity: 'Mettur', lng: 77.801, lat: 11.786, height: 65, crestLength: 1700, volumeMCM: 2650, type: 'Masonry', year: 1934 },
  { id: 'bhavanisagar', name: 'Bhavanisagar', river: 'Bhavani', state: 'Tamil Nadu', district: 'Erode', nearestCity: 'Sathyamangalam', lng: 77.1133, lat: 11.4708, height: 40, crestLength: 8797, volumeMCM: 928, type: 'Embankment', year: 1955 },
  { id: 'vaigai', name: 'Vaigai', river: 'Vaigai', state: 'Tamil Nadu', district: 'Theni', nearestCity: 'Andipatti', lng: 77.585, lat: 10.0544, height: 34, crestLength: 3500, volumeMCM: 194, type: 'Masonry', year: 1959 },
  { id: 'amaravathi', name: 'Amaravathi', river: 'Amaravathi', state: 'Tamil Nadu', district: 'Tiruppur', nearestCity: 'Udumalaipettai', lng: 77.2667, lat: 10.4183, height: 33.5, crestLength: 1073, volumeMCM: 114, type: 'Masonry', year: 1957 },
  { id: 'aliyar', name: 'Aliyar', river: 'Aliyar', state: 'Tamil Nadu', district: 'Coimbatore', nearestCity: 'Pollachi', lng: 76.9694, lat: 10.4853, height: 41, crestLength: 3201, volumeMCM: 109, type: 'Masonry', year: 1969 },
  { id: 'sholayar-tn', name: 'Upper Sholayar', river: 'Chalakkudi', state: 'Tamil Nadu', district: 'Coimbatore', nearestCity: 'Valparai', lng: 76.8778, lat: 10.3014, height: 105, crestLength: 1244, volumeMCM: 153, type: 'Masonry', year: 1971 },
  { id: 'sathanur', name: 'Sathanur', river: 'Thenpennai', state: 'Tamil Nadu', district: 'Tiruvannamalai', nearestCity: 'Tiruvannamalai', lng: 78.8522, lat: 12.1867, height: 36.3, crestLength: 786, volumeMCM: 229, type: 'Masonry', year: 1958 },
  { id: 'pechiparai', name: 'Pechiparai', river: 'Kodayar', state: 'Tamil Nadu', district: 'Kanniyakumari', nearestCity: 'Kulasekharam', lng: 77.3167, lat: 8.4667, height: 42.7, crestLength: 425, volumeMCM: 150, type: 'Masonry', year: 1906 },
  { id: 'papanasam', name: 'Papanasam (Karaiyar)', river: 'Thamirabarani', state: 'Tamil Nadu', district: 'Tirunelveli', nearestCity: 'Ambasamudram', lng: 77.3625, lat: 8.6833, height: 44, crestLength: 247, volumeMCM: 156, type: 'Masonry', year: 1944 },

  // --- KERALA ---
  { id: 'idukki', name: 'Idukki', river: 'Periyar', state: 'Kerala', district: 'Idukki', nearestCity: 'Thodupuzha', lng: 76.976, lat: 9.843, height: 169, crestLength: 366, volumeMCM: 1996, type: 'Arch', year: 1975 },
  { id: 'cheruthoni', name: 'Cheruthoni', river: 'Cheruthoni', state: 'Kerala', district: 'Idukki', nearestCity: 'Idukki', lng: 76.9639, lat: 9.8519, height: 138.2, crestLength: 651, volumeMCM: 1996, type: 'Concrete gravity', year: 1976 },
  { id: 'kulamavu', name: 'Kulamavu', river: 'Kilivallithode', state: 'Kerala', district: 'Idukki', nearestCity: 'Painavu', lng: 76.8856, lat: 9.8028, height: 100, crestLength: 385, volumeMCM: 1996, type: 'Masonry', year: 1977 },
  { id: 'mullaperiyar', name: 'Mullaperiyar', river: 'Periyar', state: 'Kerala', district: 'Idukki', nearestCity: 'Kumily', lng: 77.144, lat: 9.529, height: 54, crestLength: 366, volumeMCM: 443, type: 'Masonry', year: 1895 },
  { id: 'idamalayar', name: 'Idamalayar', river: 'Idamalayar', state: 'Kerala', district: 'Ernakulam', nearestCity: 'Kothamangalam', lng: 76.7083, lat: 10.2222, height: 102.8, crestLength: 373, volumeMCM: 1090, type: 'Concrete gravity', year: 1985 },
  { id: 'malampuzha', name: 'Malampuzha', river: 'Bharathappuzha', state: 'Kerala', district: 'Palakkad', nearestCity: 'Palakkad', lng: 76.6833, lat: 10.8333, height: 38, crestLength: 1849, volumeMCM: 226, type: 'Masonry', year: 1955 },
  { id: 'kakki', name: 'Kakki', river: 'Pamba', state: 'Kerala', district: 'Pathanamthitta', nearestCity: 'Ranni', lng: 77.15, lat: 9.325, height: 110, crestLength: 325, volumeMCM: 460, type: 'Concrete gravity', year: 1966 },
  { id: 'banasura-sagar', name: 'Banasura Sagar', river: 'Kabini', state: 'Kerala', district: 'Wayanad', nearestCity: 'Kalpetta', lng: 75.9592, lat: 11.6681, height: 38.5, crestLength: 685, volumeMCM: 209, type: 'Embankment', year: 2004 },
  { id: 'parambikulam', name: 'Parambikulam', river: 'Parambikulam', state: 'Kerala', district: 'Palakkad', nearestCity: 'Pollachi', lng: 76.7972, lat: 10.3931, height: 73, crestLength: 318, volumeMCM: 504, type: 'Masonry', year: 1967 },

  // --- ANDHRA PRADESH & TELANGANA ---
  { id: 'nagarjuna-sagar', name: 'Nagarjuna Sagar', river: 'Krishna', state: 'Telangana · Andhra Pradesh', district: 'Nalgonda / Palnadu', nearestCity: 'Macherla', lng: 79.312, lat: 16.575, height: 124, crestLength: 1550, volumeMCM: 11560, type: 'Masonry', year: 1967 },
  { id: 'srisailam', name: 'Srisailam', river: 'Krishna', state: 'Andhra Pradesh', district: 'Nandyal / Kurnool', nearestCity: 'Srisailam', lng: 78.897, lat: 16.087, height: 145, crestLength: 512, volumeMCM: 6110, type: 'Concrete gravity', year: 1981 },
  { id: 'polavaram', name: 'Polavaram', river: 'Godavari', state: 'Andhra Pradesh', district: 'Eluru', nearestCity: 'Rajahmundry', lng: 81.6575, lat: 17.2611, height: 48, crestLength: 2450, volumeMCM: 5510, type: 'Embankment', year: 2024 },
  { id: 'somasila', name: 'Somasila', river: 'Pennar', state: 'Andhra Pradesh', district: 'SPSR Nellore', nearestCity: 'Atmakur', lng: 79.3083, lat: 14.4986, height: 39, crestLength: 760, volumeMCM: 2209, type: 'Embankment', year: 1989 },
  { id: 'sriram-sagar', name: 'Sriram Sagar (Pochampad)', river: 'Godavari', state: 'Telangana', district: 'Nizamabad', nearestCity: 'Armoor', lng: 78.3333, lat: 18.9667, height: 43, crestLength: 15600, volumeMCM: 3170, type: 'Embankment', year: 1977 },
  { id: 'singur', name: 'Singur', river: 'Manjira', state: 'Telangana', district: 'Sangareddy', nearestCity: 'Sangareddy', lng: 77.9258, lat: 17.7558, height: 32.5, crestLength: 7520, volumeMCM: 847, type: 'Embankment', year: 1989 },
  { id: 'nizam-sagar', name: 'Nizam Sagar', river: 'Manjira', state: 'Telangana', district: 'Kamareddy', nearestCity: 'Banswada', lng: 77.9694, lat: 18.175, height: 35, crestLength: 3000, volumeMCM: 480, type: 'Masonry', year: 1931 },
  { id: 'kaleshwaram', name: 'Medigadda (Lakshmi Barrage)', river: 'Godavari', state: 'Telangana', district: 'Jayashankar Bhupalpally', nearestCity: 'Manthani', lng: 79.9439, lat: 18.7844, height: 25, crestLength: 1632, volumeMCM: 457, type: 'Concrete gravity', year: 2019 },
  { id: 'lower-manair', name: 'Lower Manair', river: 'Manair', state: 'Telangana', district: 'Karimnagar', nearestCity: 'Karimnagar', lng: 79.135, lat: 18.4039, height: 32, crestLength: 10450, volumeMCM: 681, type: 'Embankment', year: 1985 },

  // --- ODISHA ---
  { id: 'hirakud', name: 'Hirakud', river: 'Mahanadi', state: 'Odisha', district: 'Sambalpur', nearestCity: 'Sambalpur', lng: 83.872, lat: 21.572, height: 61, crestLength: 4800, volumeMCM: 8136, type: 'Embankment', year: 1957 },
  { id: 'balimela', name: 'Balimela', river: 'Sileru', state: 'Odisha', district: 'Malkangiri', nearestCity: 'Balimela', lng: 82.1278, lat: 18.1408, height: 70, crestLength: 1823, volumeMCM: 3610, type: 'Embankment', year: 1977 },
  { id: 'indravati', name: 'Indravati', river: 'Indravati', state: 'Odisha', district: 'Nabarangpur', nearestCity: 'Khatiguda', lng: 82.8317, lat: 19.2789, height: 45, crestLength: 539, volumeMCM: 2308, type: 'Masonry', year: 1996 },
  { id: 'rengali', name: 'Rengali', river: 'Brahmani', state: 'Odisha', district: 'Angul', nearestCity: 'Deogarh', lng: 85.0333, lat: 21.2833, height: 70.5, crestLength: 1040, volumeMCM: 5150, type: 'Concrete gravity', year: 1985 },
  { id: 'upper-kolab', name: 'Upper Kolab', river: 'Kolab', state: 'Odisha', district: 'Koraput', nearestCity: 'Jeypore', lng: 82.6083, lat: 18.7917, height: 55, crestLength: 646, volumeMCM: 1215, type: 'Masonry', year: 1990 },
  { id: 'mandira', name: 'Mandira', river: 'Sankh', state: 'Odisha', district: 'Sundargarh', nearestCity: 'Rourkela', lng: 84.6667, lat: 22.2833, height: 27.5, crestLength: 436, volumeMCM: 350, type: 'Embankment', year: 1959 },

  // --- RAJASTHAN ---
  { id: 'rana-pratap-sagar', name: 'Rana Pratap Sagar', river: 'Chambal', state: 'Rajasthan', district: 'Chittorgarh', nearestCity: 'Rawatbhata', lng: 75.5908, lat: 24.9228, height: 54, crestLength: 1143, volumeMCM: 2898, type: 'Masonry', year: 1970 },
  { id: 'jawahar-sagar', name: 'Jawahar Sagar', river: 'Chambal', state: 'Rajasthan', district: 'Kota', nearestCity: 'Kota', lng: 75.6881, lat: 25.0483, height: 45, crestLength: 393, volumeMCM: 67, type: 'Concrete gravity', year: 1972 },
  { id: 'kota-barrage', name: 'Kota Barrage', river: 'Chambal', state: 'Rajasthan', district: 'Kota', nearestCity: 'Kota', lng: 75.845, lat: 25.1764, height: 39, crestLength: 552, volumeMCM: 112, type: 'Embankment', year: 1960 },
  { id: 'bisalpur', name: 'Bisalpur', river: 'Banas', state: 'Rajasthan', district: 'Tonk', nearestCity: 'Deoli', lng: 75.4542, lat: 26.0125, height: 39.5, crestLength: 574, volumeMCM: 1095, type: 'Concrete gravity', year: 1999 },
  { id: 'mahi-bajaj-sagar', name: 'Mahi Bajaj Sagar', river: 'Mahi', state: 'Rajasthan', district: 'Banswara', nearestCity: 'Banswara', lng: 74.5267, lat: 23.6306, height: 43, crestLength: 3109, volumeMCM: 2060, type: 'Embankment', year: 1983 },
  { id: 'jakham', name: 'Jakham', river: 'Jakham', state: 'Rajasthan', district: 'Pratapgarh', nearestCity: 'Dhariawad', lng: 74.2483, lat: 24.1689, height: 81, crestLength: 253, volumeMCM: 142, type: 'Concrete gravity', year: 1986 },
  { id: 'jawai', name: 'Jawai', river: 'Jawai', state: 'Rajasthan', district: 'Pali', nearestCity: 'Sumerpur', lng: 73.1611, lat: 25.1097, height: 34, crestLength: 924, volumeMCM: 208, type: 'Masonry', year: 1957 },

  // --- UTTAR PRADESH ---
  { id: 'rihand', name: 'Rihand (Govind Ballabh Pant Sagar)', river: 'Rihand', state: 'Uttar Pradesh', district: 'Sonbhadra', nearestCity: 'Renukoot', lng: 83.01, lat: 24.2, height: 91, crestLength: 934, volumeMCM: 10600, type: 'Concrete gravity', year: 1962 },
  { id: 'matatila', name: 'Matatila', river: 'Betwa', state: 'Uttar Pradesh', district: 'Lalitpur', nearestCity: 'Jhansi', lng: 78.375, lat: 25.1, height: 35, crestLength: 6385, volumeMCM: 1132, type: 'Masonry', year: 1958 },
  { id: 'parichha', name: 'Parichha', river: 'Betwa', state: 'Uttar Pradesh', district: 'Jhansi', nearestCity: 'Jhansi', lng: 78.7556, lat: 25.5167, height: 16.5, crestLength: 1175, volumeMCM: 74, type: 'Masonry', year: 1984 },
  { id: 'sharda-sagar', name: 'Sharda Sagar', river: 'Sharda', state: 'Uttar Pradesh', district: 'Pilibhit', nearestCity: 'Puranpur', lng: 80.0833, lat: 28.5833, height: 17.5, crestLength: 22100, volumeMCM: 368, type: 'Embankment', year: 1957 },

  // --- JAMMU & KASHMIR ---
  { id: 'baglihar', name: 'Baglihar', river: 'Chenab', state: 'Jammu & Kashmir', district: 'Ramban', nearestCity: 'Batote', lng: 75.3211, lat: 33.1558, height: 143, crestLength: 317, volumeMCM: 396, type: 'Concrete gravity', year: 2008 },
  { id: 'salal', name: 'Salal', river: 'Chenab', state: 'Jammu & Kashmir', district: 'Reasi', nearestCity: 'Reasi', lng: 74.8317, lat: 33.1417, height: 113, crestLength: 487, volumeMCM: 285, type: 'Concrete gravity', year: 1987 },
  { id: 'uri-1', name: 'Uri I', river: 'Jhelum', state: 'Jammu & Kashmir', district: 'Baramulla', nearestCity: 'Uri', lng: 74.1542, lat: 34.1481, height: 52, crestLength: 94, volumeMCM: 5.5, type: 'Concrete gravity', year: 1997 },
  { id: 'kishanganga', name: 'Kishanganga', river: 'Kishanganga', state: 'Jammu & Kashmir', district: 'Bandipora', nearestCity: 'Gurez', lng: 74.7431, lat: 34.6467, height: 37, crestLength: 239, volumeMCM: 18.3, type: 'Concrete gravity', year: 2018 },
  { id: 'dul-hasti', name: 'Dul Hasti', river: 'Chenab', state: 'Jammu & Kashmir', district: 'Kishtwar', nearestCity: 'Kishtwar', lng: 75.7672, lat: 33.3678, height: 65, crestLength: 186, volumeMCM: 15.6, type: 'Concrete gravity', year: 2007 },

  // --- JHARKHAND & WEST BENGAL ---
  { id: 'maithon', name: 'Maithon', river: 'Barakar', state: 'Jharkhand', district: 'Dhanbad', nearestCity: 'Asansol', lng: 86.8167, lat: 23.7833, height: 50, crestLength: 4789, volumeMCM: 1357, type: 'Composite', year: 1957 },
  { id: 'panchet', name: 'Panchet', river: 'Damodar', state: 'Jharkhand', district: 'Dhanbad', nearestCity: 'Chirkunda', lng: 86.7456, lat: 23.6844, height: 45, crestLength: 6777, volumeMCM: 1497, type: 'Embankment', year: 1959 },
  { id: 'tilaiya', name: 'Tilaiya', river: 'Barakar', state: 'Jharkhand', district: 'Koderma', nearestCity: 'Jhumri Telaiya', lng: 85.5333, lat: 24.3167, height: 30.2, crestLength: 366, volumeMCM: 395, type: 'Concrete gravity', year: 1953 },
  { id: 'tenughat', name: 'Tenughat', river: 'Damodar', state: 'Jharkhand', district: 'Bokaro', nearestCity: 'Bokaro Steel City', lng: 85.8333, lat: 23.7333, height: 55, crestLength: 5050, volumeMCM: 1024, type: 'Embankment', year: 1978 },
  { id: 'kangsabati', name: 'Mukutmanipur (Kangsabati)', river: 'Kangsabati', state: 'West Bengal', district: 'Bankura', nearestCity: 'Khatra', lng: 86.7833, lat: 22.95, height: 41, crestLength: 10098, volumeMCM: 1040, type: 'Embankment', year: 1965 },
  { id: 'massanjore', name: 'Massanjore (Canada Dam)', river: 'Mayurakshi', state: 'Jharkhand · West Bengal', district: 'Dumka', nearestCity: 'Suri', lng: 87.3167, lat: 24.1167, height: 47.2, crestLength: 661, volumeMCM: 617, type: 'Masonry', year: 1955 },
  { id: 'teesta-barrage', name: 'Teesta Barrage', river: 'Teesta', state: 'West Bengal', district: 'Jalpaiguri', nearestCity: 'Siliguri', lng: 88.5833, lat: 26.75, height: 16, crestLength: 921, volumeMCM: 78, type: 'Concrete gravity', year: 1998 },

  // --- CHHATTISGARH ---
  { id: 'hasdeo-bango', name: 'Hasdeo Bango (Minimata)', river: 'Hasdeo', state: 'Chhattisgarh', district: 'Korba', nearestCity: 'Korba', lng: 82.5833, lat: 22.6167, height: 87, crestLength: 2509, volumeMCM: 3416, type: 'Composite', year: 1990 },
  { id: 'gangrel', name: 'Gangrel (Ravishankar Sagar)', river: 'Mahanadi', state: 'Chhattisgarh', district: 'Dhamtari', nearestCity: 'Dhamtari', lng: 81.6042, lat: 20.6139, height: 30.5, crestLength: 1830, volumeMCM: 910, type: 'Embankment', year: 1978 },
  { id: 'murrum-silli', name: 'Murrum Silli', river: 'Sillari', state: 'Chhattisgarh', district: 'Dhamtari', nearestCity: 'Dhamtari', lng: 81.7111, lat: 20.5514, height: 26.5, crestLength: 2591, volumeMCM: 165, type: 'Embankment', year: 1923 },

  // --- NORTH EAST (ASSAM, ARUNACHAL, SIKKIM, MEGHALAYA, MANIPUR, MIZORAM) ---
  { id: 'subansiri-lower', name: 'Subansiri Lower', river: 'Subansiri', state: 'Arunachal Pradesh · Assam', district: 'Lower Subansiri / Dhemaji', nearestCity: 'North Lakhimpur', lng: 94.2639, lat: 27.5539, height: 116, crestLength: 271, volumeMCM: 1365, type: 'Concrete gravity', year: 2024 },
  { id: 'teesta-3', name: 'Teesta III (Chungthang)', river: 'Teesta', state: 'Sikkim', district: 'Mangan', nearestCity: 'Chungthang', lng: 88.6472, lat: 27.6033, height: 60, crestLength: 140, volumeMCM: 5.1, type: 'Concrete gravity', year: 2017 },
  { id: 'teesta-5', name: 'Teesta V', river: 'Teesta', state: 'Sikkim', district: 'Gangtok', nearestCity: 'Singtam', lng: 88.4833, lat: 27.2333, height: 87, crestLength: 176, volumeMCM: 13.2, type: 'Concrete gravity', year: 2008 },
  { id: 'ranganadi', name: 'Ranganadi', river: 'Ranganadi', state: 'Arunachal Pradesh', district: 'Lower Subansiri', nearestCity: 'Yazali', lng: 93.75, lat: 27.3333, height: 68, crestLength: 345, volumeMCM: 21.3, type: 'Concrete gravity', year: 2002 },
  { id: 'umiam', name: 'Umiam (Barapani)', river: 'Umiam', state: 'Meghalaya', district: 'Ri-Bhoi', nearestCity: 'Shillong', lng: 91.8972, lat: 25.6556, height: 73, crestLength: 216, volumeMCM: 181, type: 'Concrete gravity', year: 1965 },
  { id: 'loktak', name: 'Ithai (Loktak Barrage)', river: 'Manipur', state: 'Manipur', district: 'Bishnupur', nearestCity: 'Moirang', lng: 93.7833, lat: 24.4667, height: 11.7, crestLength: 68, volumeMCM: 510, type: 'Concrete gravity', year: 1983 },
  { id: 'doyang', name: 'Doyang', river: 'Doyang', state: 'Nagaland', district: 'Wokha', nearestCity: 'Wokha', lng: 94.2833, lat: 26.2167, height: 87, crestLength: 462, volumeMCM: 535, type: 'Embankment', year: 2000 },
  { id: 'tuirial', name: 'Tuirial', river: 'Tuirial', state: 'Mizoram', district: 'Kolasib', nearestCity: 'Aizawl', lng: 92.8833, lat: 24.2333, height: 76, crestLength: 250, volumeMCM: 584, type: 'Embankment', year: 2017 },
  { id: 'kopili', name: 'Khandong (Kopili)', river: 'Kopili', state: 'Assam', district: 'Dima Hasao', nearestCity: 'Umrangso', lng: 92.6833, lat: 25.5333, height: 66, crestLength: 243, volumeMCM: 154, type: 'Concrete gravity', year: 1984 },

  // --- GOA & BIHAR ---
  { id: 'salaulim', name: 'Salaulim', river: 'Salaulim', state: 'Goa', district: 'South Goa', nearestCity: 'Sanguem', lng: 74.1833, lat: 15.2167, height: 42.7, crestLength: 1004, volumeMCM: 227, type: 'Embankment', year: 2000 },
  { id: 'anjunem', name: 'Anjunem', river: 'Costinadi', state: 'Goa', district: 'North Goa', nearestCity: 'Sankhali', lng: 74.0833, lat: 15.6167, height: 42.8, crestLength: 165, volumeMCM: 45, type: 'Masonry', year: 1989 },
  { id: 'durgawati', name: 'Durgawati', river: 'Durgawati', state: 'Bihar', district: 'Kaimur', nearestCity: 'Kudra', lng: 83.7167, lat: 24.9667, height: 46.3, crestLength: 1615, volumeMCM: 279, type: 'Embankment', year: 2014 },
  { id: 'indrapuri', name: 'Indrapuri Barrage', river: 'Son', state: 'Bihar', district: 'Rohtas', nearestCity: 'Dehri', lng: 84.15, lat: 24.8333, height: 10, crestLength: 1407, volumeMCM: 120, type: 'Concrete gravity', year: 1968 },
];

async function main() {
  const outDir = path.join(root, 'public', 'data');
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, 'dams-national.json');

  const payload = {
    metadata: {
      total: NATIONAL_DAMS.length,
      generated: new Date().toISOString().slice(0, 10),
      sources: [
        {
          name: 'Central Water Commission (CWC) National Register of Large Dams (NRLD)',
          license: 'Government Open Data License - India (GODL)',
          url: 'http://cwc.gov.in/',
        },
        {
          name: 'OpenStreetMap (OSM)',
          license: 'Open Data Commons Open Database License (ODbL)',
          url: 'https://www.openstreetmap.org/',
        },
        {
          name: 'Wikidata',
          license: 'Creative Commons CC0 Public Domain Dedication',
          url: 'https://www.wikidata.org/',
        },
      ],
    },
    dams: NATIONAL_DAMS,
  };

  await writeFile(outFile, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Generated ${outFile} with ${NATIONAL_DAMS.length} dams.`);

  // Group summary by state
  const states = new Map<string, number>();
  for (const d of NATIONAL_DAMS) {
    states.set(d.state, (states.get(d.state) ?? 0) + 1);
  }
  console.log('\nDams by state/region:');
  for (const [st, count] of [...states.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${st.padEnd(30)} ${count} dam(s)`);
  }
}

main().catch(console.error);
