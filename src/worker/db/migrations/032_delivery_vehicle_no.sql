-- Add vehicle_no (license plate / transport vehicle) to delivery notes.
ALTER TABLE delivery_notes ADD COLUMN vehicle_no TEXT;
