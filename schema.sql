CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  store_name VARCHAR(255) NOT NULL,
  phone VARCHAR(50) UNIQUE NOT NULL,
  area VARCHAR(100),
  category VARCHAR(120),
  address TEXT,
  website TEXT,
  google_maps_url TEXT,
  google_place_id VARCHAR(255) UNIQUE,
  osm_type VARCHAR(30),
  osm_id VARCHAR(80),
  osm_url TEXT,
  whatsapp_number VARCHAR(50),
  whatsapp_url TEXT,
  whatsapp_available BOOLEAN,
  whatsapp_check_method VARCHAR(80),
  distance_km NUMERIC(8,2),
  business_status VARCHAR(80),
  rating NUMERIC(3,2),
  review_count INTEGER DEFAULT 0,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  source VARCHAR(80) DEFAULT 'MANUAL',
  discovery_query TEXT,
  social_links JSONB DEFAULT '{}'::jsonb,
  profile_data JSONB DEFAULT '{}'::jsonb,
  lead_score INTEGER DEFAULT 0,
  shortlisted BOOLEAN DEFAULT FALSE,
  status VARCHAR(50) DEFAULT 'PENDING',
  bot_active BOOLEAN DEFAULT TRUE,
  last_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT leads_status_check CHECK (
    status IN ('PENDING', 'INITIATED', 'REPLIED', 'MIGRATED', 'REJECTED')
  )
);

ALTER TABLE leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS category VARCHAR(120);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS google_maps_url TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS google_place_id VARCHAR(255);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS osm_type VARCHAR(30);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS osm_id VARCHAR(80);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS osm_url TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(50);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp_url TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp_available BOOLEAN;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp_check_method VARCHAR(80);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS distance_km NUMERIC(8,2);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS business_status VARCHAR(80);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS rating NUMERIC(3,2);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source VARCHAR(80) DEFAULT 'MANUAL';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS discovery_query TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS social_links JSONB DEFAULT '{}'::jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS profile_data JSONB DEFAULT '{}'::jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_score INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS shortlisted BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_leads_area_status ON leads (area, status);
CREATE INDEX IF NOT EXISTS idx_leads_hot ON leads (status) WHERE status = 'REPLIED';
CREATE INDEX IF NOT EXISTS idx_leads_score ON leads (lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_shortlisted ON leads (shortlisted) WHERE shortlisted = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_google_place_id ON leads (google_place_id) WHERE google_place_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_osm_key ON leads (osm_type, osm_id) WHERE osm_type IS NOT NULL AND osm_id IS NOT NULL;

CREATE OR REPLACE FUNCTION set_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
CREATE TRIGGER trg_leads_updated_at
BEFORE UPDATE ON leads
FOR EACH ROW
EXECUTE FUNCTION set_leads_updated_at();
