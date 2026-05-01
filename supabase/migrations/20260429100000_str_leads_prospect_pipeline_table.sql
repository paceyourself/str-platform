-- ============================================================
-- str_leads — Prospect pipeline table
-- VeroSTR Platform · Schema v0.13 · Updated May 1, 2026
--
-- Design rules:
--   • Separate from owner_profiles — prospects have no Supabase Auth identity
--   • parcel_id is the bridge to properties table when a lead claims an account
--   • address fields = owner mailing contact for outreach
--   • market_id = platform market assignment, set programmatically from
--     property address during seed — never from mailing address
--   • str_permit_area stored as-is from FOIA for future sub-market segmentation
--   • Phone/email format validation handled in application layer, not schema
--   • invite_email_sent boolean is V1 — future: FK to outreach_events table
--   • outreach_priority is NOT a column — compute at query time from
--     mailing_address state field (out-of-state = high priority). Storing it
--     creates a value that goes stale as addresses are updated.
--
-- Entity enrichment fields (added May 1, 2026 from Sunbiz enrichment exercise):
--   • entity_subtype distinguishes LLC/Trust/Corp/LP for different outreach paths
--   • entity_govt_source + entity_govt_id form a composite audit trail back to
--     the originating government source — works for any state without schema change.
--     IMPORTANT: entity_govt_source applies to BOTH entity and individual records.
--     For individuals from PA tax roll: entity_govt_source = 'walton_county_pa',
--     entity_govt_id = parcel folio number (same as parcel_id — intentional
--     redundancy. parcel_id is the platform bridge key; entity_govt_id is the
--     audit trail back to source. Both should be populated.)
-- ============================================================

CREATE TABLE str_leads (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Property identification
  parcel_id               text,                          -- Bridge to properties.parcel_id on claim
  property_address        text,
  city                    text,
  state                   text,
  zip                     text,
  market_id               text        REFERENCES markets(id),  -- Set from property address, not mailing
  str_permit_area         text,                          -- From FOIA: 30A East | 30A West/Central | Miramar Beach | Inland

  -- Owner identity
  owner_contact_name      text,
  owner_type              text        CHECK (owner_type IN ('individual', 'entity')),
  entity_registered_agent text,                          -- Populated when owner_type = entity
  entity_subtype          text        CHECK (entity_subtype IN ('llc', 'trust', 'corporation', 'limited_partnership', 'other')),
                                                         -- Populated when owner_type = entity
                                                         -- Validated from Sunbiz: 2,050 LLC | 479 Trust | 51 Corp | 15 LP | 50 Other
  entity_govt_source      text,                          -- Government data source for this record.
                                                         -- e.g. 'florida_sunbiz' | 'walton_county_pa' | 'delaware_sos'
                                                         -- Applies to BOTH entity and individual owner records.
                                                         -- No CHECK constraint — vocabulary enforced in app layer
                                                         -- until 2+ real values are established.
  entity_govt_id          text,                          -- ID from that source (doc number, folio, etc.)
                                                         -- For FL LLC: 11-digit Sunbiz document number
                                                         -- For individual from PA tax roll: parcel folio number
                                                         -- (same as parcel_id — intentional redundancy, different purpose)
  mailing_address         text,                          -- Owner contact address — often differs from property
  owner_email             text,                          -- Researched / enriched — no format constraint
  owner_phone             text,                          -- Researched / enriched — no format constraint
  homestead_exempt        boolean,                       -- FALSE = likely STR/investor — primary targeting filter

  -- STR permit data (from FOIA)
  str_permit_number       text,
  str_permit_status       text        CHECK (str_permit_status IN ('active', 'expired', 'suspended')),

  -- Lead pipeline
  lead_status             text        NOT NULL DEFAULT 'new'
                                      CHECK (lead_status IN ('new', 'contacted', 'invited', 'claimed', 'disqualified')),
  lead_source             text        CHECK (lead_source IN ('walton_county_foia', 'manual', 'referral')),
  notes                   text,

  -- Platform linkage — populated when lead claims a platform account
  claimed_by_owner_id     uuid        REFERENCES owner_profiles(id),
  claimed_at              timestamptz,

  -- Outreach tracking
  invited_at              timestamptz,
  invite_email_sent       boolean     NOT NULL DEFAULT false,
  last_contacted_at       timestamptz,

  -- Audit
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────
-- The four columns filtered and joined on constantly
CREATE INDEX ON str_leads (parcel_id);
CREATE INDEX ON str_leads (lead_status);
CREATE INDEX ON str_leads (str_permit_number);
CREATE INDEX ON str_leads (claimed_by_owner_id);
-- Additional index for entity pipeline filtering
CREATE INDEX ON str_leads (entity_subtype);

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE str_leads ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "Admins can read all str_leads"
  ON str_leads FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

CREATE POLICY "Admins can insert str_leads"
  ON str_leads FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

CREATE POLICY "Admins can update str_leads"
  ON str_leads FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

-- No owner or PM access — leads are internal admin data only
-- Exception: when claimed_by_owner_id is set, that owner can read their own lead record
CREATE POLICY "Owners can view their own claimed lead"
  ON str_leads FOR SELECT
  TO authenticated
  USING (claimed_by_owner_id = auth.uid());