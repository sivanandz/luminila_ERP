-- Create table for tracking catalog sync history
CREATE TABLE public.catalog_sync_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    products_added INTEGER DEFAULT 0,
    products_updated INTEGER DEFAULT 0,
    products_deleted INTEGER DEFAULT 0,
    errors JSONB DEFAULT '[]'::jsonb
);

-- Add RLS policies
ALTER TABLE public.catalog_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access to authenticated users" 
ON public.catalog_sync_logs FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Allow insert access to authenticated users" 
ON public.catalog_sync_logs FOR INSERT 
TO authenticated 
WITH CHECK (true);

CREATE POLICY "Allow update access to authenticated users" 
ON public.catalog_sync_logs FOR UPDATE
TO authenticated 
USING (true);
