# Lead Engine

Free/manual-first business lead discovery and WhatsApp review console.

The current workflow uses OpenStreetMap + Overpass instead of Google Maps APIs. You click a location on the map, adjust the radius, fetch nearby businesses that have phone/WhatsApp-style contact data, review their profiles, then open WhatsApp manually with the `wa.me` button.

## Free Setup

```bash
npm install
cp .env.example .env
npm start
```

Run `schema.sql` in Neon before saving discovered leads.

Required:
- `DATABASE_URL` from Neon free Postgres: https://console.neon.tech/signup
- `ADMIN_SECRET`, any strong password you choose

Recommended:
- `OSM_CONTACT_EMAIL`, your email for a proper OSM/Nominatim user agent

No Google Maps API key is required for the OSM/Overpass workflow.

## Routes

- `GET /` - map-based lead research console
- `GET /qr` - optional WhatsApp QR for availability verification
- `GET /api/status` - app status and stats
- `GET /api/osm/geocode?q=Gulberg Lahore` - user-triggered OSM search
- `POST /api/discovery/osm` - free Overpass radius discovery
- `GET /api/leads` - filtered saved leads
- `GET /api/leads/shortlisted` - top shortlisted records
- `PATCH /api/leads/:id` - protected lead updates
- `POST /api/campaign/trigger` - disabled by design

Protected routes accept `secret`, `x-admin-secret`, or `secret` in the JSON body.

## OSM Discovery Example

```bash
curl -X POST http://localhost:3000/api/discovery/osm \
  -H "Content-Type: application/json" \
  -d "{\"latitude\":31.5204,\"longitude\":74.3587,\"radius_km\":5,\"categories\":\"restaurant,gym,dentist,salon,retail\",\"limit\":10,\"verify_whatsapp\":true,\"secret\":\"your_secret\"}"
```

## Notes

- Overpass and Nominatim are free public services with fair-use rules.
- Nominatim should not be used for autocomplete; this app only searches when you click the Find button.
- WhatsApp availability can only be truly checked when WhatsApp is connected through `/qr`; otherwise records are mobile-format candidates with `wa.me` links.
