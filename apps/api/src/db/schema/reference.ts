import { doublePrecision, pgTable, serial, text, unique } from 'drizzle-orm/pg-core';

/** Kenya's county → sub-county → ward hierarchy. Ward centroids drive USSD matching. */
export const locations = pgTable(
  'locations',
  {
    id: serial('id').primaryKey(),
    county: text('county').notNull(),
    subCounty: text('sub_county').notNull(),
    ward: text('ward').notNull(),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
  },
  (t) => [unique('locations_county_sub_county_ward_key').on(t.county, t.subCounty, t.ward)],
);
