import { snapToSignal } from "@/lib/osm-snap";

/** Junction seed, mirrors supabase/migrations so the simulation engine and the database agree. */
export type SeedJunction = {
  id: number;
  name: string;
  zone: string;
  lat: number;
  lng: number;
  /** Per-approach capacity, same values the migrations give each road. */
  capacity: number;
  /** True when the position was moved onto a real traffic signal mapped in OpenStreetMap. */
  verified?: boolean;
  /** How far the seed point was from the nearest mapped signal, metres. */
  offsetM?: number;
};

/** The junctions exactly as the database migrations seed them, before any position is checked. */
export const DATABASE_JUNCTIONS: SeedJunction[] = [
  {
    id: 1,
    name: "Tambaram Junction",
    zone: "GST Corridor",
    lat: 12.9249,
    lng: 80.1,
    capacity: 120,
  },
  {
    id: 2,
    name: "Vandalur Junction",
    zone: "GST Corridor",
    lat: 12.893,
    lng: 80.081,
    capacity: 120,
  },
  {
    id: 3,
    name: "Chengalpattu Bypass Junction",
    zone: "GST Corridor",
    lat: 12.692,
    lng: 79.977,
    capacity: 120,
  },
  {
    id: 4,
    name: "SRM Main Gate Junction",
    zone: "GST Corridor",
    lat: 12.823,
    lng: 80.045,
    capacity: 120,
  },
  {
    id: 5,
    name: "Guduvancheri Junction",
    zone: "GST Corridor",
    lat: 12.842,
    lng: 80.06,
    capacity: 120,
  },
  {
    id: 6,
    name: "Gemini Flyover (Anna Salai)",
    zone: "Central",
    lat: 13.045,
    lng: 80.248,
    capacity: 140,
  },
  { id: 7, name: "Teynampet Signal", zone: "Central", lat: 13.039, lng: 80.249, capacity: 140 },
  { id: 8, name: "Nandanam Signal", zone: "Central", lat: 13.03, lng: 80.241, capacity: 140 },
  {
    id: 9,
    name: "Saidapet Bridge Junction",
    zone: "Central",
    lat: 13.022,
    lng: 80.223,
    capacity: 140,
  },
  { id: 10, name: "Guindy Signal", zone: "Central", lat: 13.01, lng: 80.22, capacity: 140 },
  { id: 11, name: "Kathipara Junction", zone: "Central", lat: 13.008, lng: 80.201, capacity: 140 },
  { id: 12, name: "Alandur Signal", zone: "Central", lat: 13.003, lng: 80.203, capacity: 140 },
  {
    id: 13,
    name: "Little Mount Junction",
    zone: "Central",
    lat: 13.014,
    lng: 80.218,
    capacity: 140,
  },
  {
    id: 14,
    name: "Egmore Station Junction",
    zone: "Central",
    lat: 13.079,
    lng: 80.261,
    capacity: 140,
  },
  { id: 15, name: "Chetpet Signal", zone: "Central", lat: 13.072, lng: 80.243, capacity: 140 },
  { id: 16, name: "Choolaimedu Signal", zone: "Central", lat: 13.06, lng: 80.226, capacity: 140 },
  { id: 17, name: "Vadapalani Signal", zone: "Central", lat: 13.05, lng: 80.211, capacity: 140 },
  {
    id: 18,
    name: "Ashok Pillar Junction",
    zone: "Central",
    lat: 13.024,
    lng: 80.211,
    capacity: 140,
  },
  {
    id: 19,
    name: "Kodambakkam Bridge Junction",
    zone: "Central",
    lat: 13.051,
    lng: 80.224,
    capacity: 140,
  },
  {
    id: 20,
    name: "Nungambakkam High Road Signal",
    zone: "Central",
    lat: 13.057,
    lng: 80.242,
    capacity: 140,
  },
  { id: 21, name: "Royapettah Signal", zone: "Central", lat: 13.054, lng: 80.266, capacity: 140 },
  {
    id: 22,
    name: "Mount Road LIC Junction",
    zone: "Central",
    lat: 13.064,
    lng: 80.262,
    capacity: 140,
  },
  { id: 23, name: "Broadway Junction", zone: "North", lat: 13.093, lng: 80.287, capacity: 140 },
  {
    id: 24,
    name: "Chennai Central Junction",
    zone: "North",
    lat: 13.082,
    lng: 80.275,
    capacity: 140,
  },
  { id: 25, name: "Parrys Corner Signal", zone: "North", lat: 13.094, lng: 80.29, capacity: 140 },
  { id: 26, name: "Basin Bridge Junction", zone: "North", lat: 13.103, lng: 80.272, capacity: 140 },
  { id: 27, name: "Vyasarpadi Signal", zone: "North", lat: 13.118, lng: 80.26, capacity: 140 },
  { id: 28, name: "Tondiarpet Signal", zone: "North", lat: 13.129, lng: 80.287, capacity: 140 },
  { id: 29, name: "Washermanpet Junction", zone: "North", lat: 13.115, lng: 80.286, capacity: 140 },
  { id: 30, name: "Perambur Signal", zone: "North", lat: 13.118, lng: 80.233, capacity: 140 },
  { id: 31, name: "Villivakkam Junction", zone: "North", lat: 13.103, lng: 80.21, capacity: 140 },
  {
    id: 32,
    name: "Ambattur Estate Junction",
    zone: "North",
    lat: 13.111,
    lng: 80.162,
    capacity: 140,
  },
  { id: 33, name: "Padi Flyover Junction", zone: "North", lat: 13.1, lng: 80.183, capacity: 140 },
  { id: 34, name: "Thiruvottiyur Signal", zone: "North", lat: 13.16, lng: 80.302, capacity: 140 },
  {
    id: 35,
    name: "Manali New Town Junction",
    zone: "North",
    lat: 13.167,
    lng: 80.26,
    capacity: 140,
  },
  { id: 36, name: "Ennore Junction", zone: "North", lat: 13.22, lng: 80.32, capacity: 140 },
  { id: 37, name: "Red Hills Junction", zone: "North", lat: 13.19, lng: 80.18, capacity: 140 },
  { id: 38, name: "Adyar Signal", zone: "South", lat: 13.006, lng: 80.256, capacity: 120 },
  {
    id: 39,
    name: "Madhya Kailash Junction",
    zone: "South",
    lat: 13.008,
    lng: 80.248,
    capacity: 120,
  },
  { id: 40, name: "Tidel Park Signal", zone: "South", lat: 12.988, lng: 80.248, capacity: 120 },
  { id: 41, name: "Thiruvanmiyur Signal", zone: "South", lat: 12.983, lng: 80.259, capacity: 120 },
  {
    id: 42,
    name: "Perungudi Toll Junction",
    zone: "South",
    lat: 12.964,
    lng: 80.246,
    capacity: 120,
  },
  {
    id: 43,
    name: "Sholinganallur Junction",
    zone: "South",
    lat: 12.901,
    lng: 80.227,
    capacity: 120,
  },
  { id: 44, name: "Navalur Signal", zone: "South", lat: 12.845, lng: 80.227, capacity: 120 },
  { id: 45, name: "Siruseri Signal", zone: "South", lat: 12.823, lng: 80.22, capacity: 120 },
  { id: 46, name: "Velachery Signal", zone: "South", lat: 12.98, lng: 80.221, capacity: 120 },
  { id: 47, name: "Medavakkam Junction", zone: "South", lat: 12.92, lng: 80.193, capacity: 120 },
  { id: 48, name: "Pallikaranai Signal", zone: "South", lat: 12.933, lng: 80.21, capacity: 120 },
  { id: 49, name: "Thoraipakkam Junction", zone: "South", lat: 12.94, lng: 80.234, capacity: 120 },
  { id: 50, name: "Besant Nagar Signal", zone: "South", lat: 12.999, lng: 80.266, capacity: 120 },
  {
    id: 51,
    name: "Saidapet Kotturpuram Signal",
    zone: "South",
    lat: 13.017,
    lng: 80.245,
    capacity: 120,
  },
  { id: 52, name: "Koyambedu Junction", zone: "West", lat: 13.07, lng: 80.195, capacity: 120 },
  { id: 53, name: "Maduravoyal Junction", zone: "West", lat: 13.065, lng: 80.16, capacity: 120 },
  { id: 54, name: "Porur Junction", zone: "West", lat: 13.035, lng: 80.156, capacity: 120 },
  { id: 55, name: "Valasaravakkam Signal", zone: "West", lat: 13.043, lng: 80.174, capacity: 120 },
  { id: 56, name: "Alwarthirunagar Signal", zone: "West", lat: 13.049, lng: 80.183, capacity: 120 },
  { id: 57, name: "Virugambakkam Signal", zone: "West", lat: 13.056, lng: 80.193, capacity: 120 },
  {
    id: 58,
    name: "Poonamallee Bypass Junction",
    zone: "West",
    lat: 13.048,
    lng: 80.096,
    capacity: 120,
  },
  { id: 59, name: "Nerkundram Signal", zone: "West", lat: 13.062, lng: 80.181, capacity: 120 },
  {
    id: 60,
    name: "Mount Poonamallee Road Signal",
    zone: "West",
    lat: 13.027,
    lng: 80.147,
    capacity: 120,
  },
  {
    id: 61,
    name: "Iyyappanthangal Junction",
    zone: "West",
    lat: 13.027,
    lng: 80.115,
    capacity: 120,
  },
  {
    id: 62,
    name: "Tambaram Sanatorium Signal",
    zone: "Outer",
    lat: 12.933,
    lng: 80.118,
    capacity: 100,
  },
  { id: 63, name: "Chromepet Signal", zone: "Outer", lat: 12.951, lng: 80.14, capacity: 100 },
  { id: 64, name: "Pallavaram Signal", zone: "Outer", lat: 12.967, lng: 80.15, capacity: 100 },
  { id: 65, name: "Avadi Junction", zone: "Outer", lat: 13.115, lng: 80.1, capacity: 100 },
  { id: 66, name: "Thiruninravur Junction", zone: "Outer", lat: 13.118, lng: 80.03, capacity: 100 },
  { id: 67, name: "Perungalathur Signal", zone: "Outer", lat: 12.907, lng: 80.093, capacity: 100 },
  { id: 68, name: "Kelambakkam Junction", zone: "Outer", lat: 12.79, lng: 80.22, capacity: 100 },
  { id: 69, name: "Minjur Signal", zone: "Outer", lat: 13.27, lng: 80.26, capacity: 100 },
];

/**
 * The junctions with positions checked against OpenStreetMap: where a mapped signal lies within a
 * short walk of the seed point the junction sits on it, otherwise the seed position stays and the
 * junction is marked unverified. The database seed keeps the original coordinates.
 */
export const SEED_JUNCTIONS: SeedJunction[] = DATABASE_JUNCTIONS.map((junction) => {
  const snap = snapToSignal(junction.lat, junction.lng);
  return {
    ...junction,
    lat: snap.lat,
    lng: snap.lng,
    verified: snap.verified,
    offsetM: snap.offsetM,
  };
});
