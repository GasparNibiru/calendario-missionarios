CREATE TABLE IF NOT EXISTS families (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bookings (
  id BIGSERIAL PRIMARY KEY,
  family_id BIGINT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  booking_date DATE NOT NULL,
  meal_type VARCHAR(10) NOT NULL CHECK (meal_type IN ('almoco', 'janta')),
  fixed_type VARCHAR(10) NOT NULL DEFAULT 'none'
    CHECK (fixed_type IN ('none', 'date', 'weekday')),
  day_of_month INTEGER,
  weekday INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_booking_per_meal UNIQUE (booking_date, meal_type)
);

CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_family ON bookings(family_id);
