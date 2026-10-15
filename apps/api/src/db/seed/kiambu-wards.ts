// Kiambu County: 12 sub-counties (constituencies), 60 wards, per the IEBC electoral units.
// DEV SEED ONLY. Coordinates are APPROXIMATE sub-county centres shared by every ward in that
// sub-county, not surveyed ward centroids. Replace with official ward centroids (IEBC/KNBS
// boundaries) before any pilot; the pilot county itself is still Open Question 21.1.

export const COUNTY = 'Kiambu';

interface SubCounty {
  name: string;
  lat: number;
  lng: number;
  wards: string[];
}

const SUB_COUNTIES: SubCounty[] = [
  {
    name: 'Gatundu South',
    lat: -1.01,
    lng: 36.91,
    wards: ['Kiamwangi', 'Kiganjo', 'Ndarugu', 'Ngenda'],
  },
  {
    name: 'Gatundu North',
    lat: -0.95,
    lng: 36.93,
    wards: ['Gituamba', 'Githobokoni', 'Chania', "Mang'u"],
  },
  {
    name: 'Juja',
    lat: -1.1,
    lng: 37.01,
    wards: ['Murera', 'Theta', 'Juja', 'Witeithie', 'Kalimoni'],
  },
  {
    name: 'Thika Town',
    lat: -1.04,
    lng: 37.08,
    wards: ['Township', 'Kamenu', 'Hospital', 'Gatuanyaga', 'Ngoliba'],
  },
  {
    name: 'Ruiru',
    lat: -1.15,
    lng: 36.96,
    wards: [
      'Gitothua',
      'Biashara',
      'Gatongora',
      'Kahawa Sukari',
      'Kahawa Wendani',
      'Kiuu',
      'Mwiki',
      'Mwihoko',
    ],
  },
  {
    name: 'Githunguri',
    lat: -1.06,
    lng: 36.78,
    wards: ['Githunguri', 'Githiga', 'Ikinu', 'Ngewa', 'Komothai'],
  },
  {
    name: 'Kiambu',
    lat: -1.17,
    lng: 36.83,
    wards: ["Ting'ang'a", 'Ndumberi', 'Riabai', 'Township'],
  },
  {
    name: 'Kiambaa',
    lat: -1.18,
    lng: 36.77,
    wards: ['Cianda', 'Karuri', 'Ndenderu', 'Muchatha', 'Kihara'],
  },
  {
    name: 'Kabete',
    lat: -1.24,
    lng: 36.7,
    wards: ['Gitaru', 'Muguga', 'Nyathuna', 'Kabete', 'Uthiru'],
  },
  {
    name: 'Kikuyu',
    lat: -1.25,
    lng: 36.66,
    wards: ['Karai', 'Nachu', 'Sigona', 'Kikuyu', 'Kinoo'],
  },
  {
    name: 'Limuru',
    lat: -1.11,
    lng: 36.64,
    wards: ['Bibirioni', 'Limuru Central', 'Ndeiya', 'Limuru East', 'Ngecha Tigoni'],
  },
  {
    name: 'Lari',
    lat: -0.97,
    lng: 36.63,
    wards: ['Kinale', 'Kijabe', 'Nyanduma', 'Kamburu', 'Lari/Kirenga'],
  },
];

export const KIAMBU_WARDS = SUB_COUNTIES.flatMap((sc) =>
  sc.wards.map((ward) => ({ county: COUNTY, subCounty: sc.name, ward, lat: sc.lat, lng: sc.lng })),
);
