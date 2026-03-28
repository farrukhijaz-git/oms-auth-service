-- Schema: app (renamed from auth to avoid conflict with Supabase reserved schema)
CREATE SCHEMA IF NOT EXISTS app;
CREATE TABLE app.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin','staff')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  invited_by UUID REFERENCES app.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- Schema: orders
CREATE SCHEMA IF NOT EXISTS orders;
CREATE TABLE orders.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT,
  platform TEXT NOT NULL CHECK (platform IN ('walmart','ebay','amazon','manual')),
  customer_name TEXT NOT NULL,
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'US',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN
    ('new','label_generated','inventory_ordered','packed','ready','shipped')),
  label_id UUID,
  tracking_number TEXT,
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE orders.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders.orders(id) ON DELETE CASCADE,
  sku TEXT,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(10,2)
);
CREATE TABLE orders.order_status_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders.orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by UUID NOT NULL,
  note TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE orders.recently_viewed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  order_id UUID NOT NULL REFERENCES orders.orders(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, order_id)
);

-- Schema: labels
CREATE SCHEMA IF NOT EXISTS labels;
CREATE TABLE labels.shipping_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID,
  storage_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  extracted_name TEXT,
  extracted_address TEXT,
  match_confidence NUMERIC(4,3),
  match_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (match_status IN ('pending','confirmed','unmatched','manually_assigned')),
  uploaded_by UUID NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_by UUID,
  confirmed_at TIMESTAMPTZ
);

-- Schema: walmart
CREATE SCHEMA IF NOT EXISTS walmart;
CREATE TABLE walmart.credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  access_token TEXT,
  token_expires_at TIMESTAMPTZ,
  poll_interval_seconds INTEGER NOT NULL DEFAULT 900,
  last_polled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE walmart.sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type TEXT NOT NULL CHECK (sync_type IN ('pull_orders','push_tracking')),
  status TEXT NOT NULL CHECK (status IN ('success','partial','failed')),
  orders_pulled INTEGER DEFAULT 0,
  orders_pushed INTEGER DEFAULT 0,
  error_message TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger: auto-update orders.updated_at
CREATE OR REPLACE FUNCTION orders.update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders.orders
FOR EACH ROW EXECUTE FUNCTION orders.update_updated_at();
