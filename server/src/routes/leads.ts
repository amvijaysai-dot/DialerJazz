import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';
import { getDbPool } from '../lib/db.js';

const router = Router();
router.use(requireAuth);

const leadSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  company: z.string().optional(),
  phone: z.string().min(1, 'Phone is required'),
  email: z.string().optional().or(z.literal('')),
  website: z.string().optional().or(z.literal('')),
  linkedin_url: z.string().optional().or(z.literal('')),
  google_maps_url: z.string().optional().or(z.literal('')),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  google_rating: z.number().optional(),
  review_count: z.number().optional(),
  business_category: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: z.string().default('new'),
  priority: z.number().default(0),
  custom_fields: z.record(z.string(), z.any()).optional()
});

const bulkLeadsSchema = z.object({
  campaign_id: z.string().uuid(),
  leads: z.array(leadSchema).min(1).max(2000)
});

// Mini-CRM: Fetch all leads globally for this user with server-side search/filter
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 25));
    const offset = (page - 1) * perPage;

    const search = req.query.search as string | undefined;
    const status = req.query.status as string | undefined;
    const tags = req.query.tags as string | undefined;

    let query = req.db!.database
      .from('leads')
      .select('*', { count: 'exact' })
      .eq('user_id', req.user.id);

    // Server-side search across name, company, email, and phone
    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      query = query.or(`first_name.ilike.*${searchTerm}*,last_name.ilike.*${searchTerm}*,company.ilike.*${searchTerm}*,email.ilike.*${searchTerm}*,phone.ilike.*${searchTerm}*`);
    }

    // Filter by status
    if (status && status.trim()) {
      query = query.eq('status', status);
    }

    // Filter by tags (contains any of the specified tags)
    if (tags && tags.trim()) {
      const tagArray = tags.split(',').map(t => t.trim()).filter(Boolean);
      if (tagArray.length > 0) {
        query = query.overlaps('tags', tagArray);
      }
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + perPage - 1);

    if (error) throw new ApiError(500, error.message, 'db_error');

    const total = count || 0;

    res.json({
      data: data || [],
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Bulk Insert CSV into CRM and assign to campaign
router.post('/bulk', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const body = bulkLeadsSchema.parse(req.body);
    const pool = getDbPool();

    // Deduplicate leads by phone before interacting with DB
    const uniqueLeads = new Map();
    for (const l of body.leads) {
      uniqueLeads.set(l.phone, l);
    }

    const leadsToUpsert = Array.from(uniqueLeads.values()).map(lead => ({
      ...lead,
      user_id: req.user.id
    }));

    // Step 1: Upsert all leads based on User ID & Phone (prevents duplicate contacts globally)
    const upsertedLeads: any[] = [];
    for (const lead of leadsToUpsert) {
      const columns = ['user_id', ...Object.keys(lead).filter(k => k !== 'user_id')];
      const placeholders = columns.map((_, i) => `$${i + 1}`);
      const values = columns.map(c => (lead as any)[c]);
      const updateCols = columns.filter(c => c !== 'user_id' && c !== 'phone');
      const updateClause = updateCols.map(c => `${c} = EXCLUDED.${c}`).join(', ');

      const { rows } = await pool.query(
        `INSERT INTO public.leads (${columns.join(', ')})
         VALUES (${placeholders.join(', ')})
         ON CONFLICT (user_id, phone) DO UPDATE SET ${updateClause}, updated_at = now()
         RETURNING id`,
        values
      );
      if (rows.length) upsertedLeads.push({ id: rows[0].id });
    }

    if (!upsertedLeads.length) {
      throw new ApiError(500, 'Failed to upsert leads', 'db_error');
    }

    // Step 2: Map these lead IDs to the Campaign in the junction table
    for (const lead of upsertedLeads) {
      await pool.query(
        `INSERT INTO public.campaign_leads (campaign_id, lead_id, user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (campaign_id, lead_id) DO NOTHING`,
        [body.campaign_id, lead.id, req.user.id]
      );
    }

    // Step 3: Update campaign total_leads count
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM public.campaign_leads WHERE campaign_id = $1`,
      [body.campaign_id]
    );
    const count = countRows[0]?.count ?? 0;

    await pool.query(
      `UPDATE public.campaigns SET total_leads = $1, updated_at = now() WHERE id = $2`,
      [count, body.campaign_id]
    );

    res.status(201).json({ data: upsertedLeads, count: upsertedLeads.length });
  } catch (error) {
    next(error);
  }
});

// Fetch Leads specifically bound to a campaign via Junction Table
router.get('/campaign/:campaignId', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { limit = '50', offset = '0' } = req.query;

    const { data, count, error } = await req.db!
      .database.from('campaign_leads')
      .select(`
        id,
        leads (*)
      `, { count: 'exact' })
      .eq('campaign_id', req.params.campaignId)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: true })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) throw new ApiError(500, error.message, 'db_error');

    // Flatten PostgREST structure for the frontend
    const flatData = data?.map((row: any) => ({
      ...row.leads,
      _campaign_lead_id: row.id,
      // override tracking status/tags if we intend to track state per campaign later
    })) || [];

    res.json({ data: flatData, meta: { total: count || 0, count: flatData.length } });
  } catch (error) {
    next(error);
  }
});

// Assign EXISTING leads from CRM to a campaign
router.post('/assign', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const assignSchema = z.object({
      campaign_id: z.string().uuid(),
      lead_ids: z.array(z.string().uuid()).min(1)
    });
    const body = assignSchema.parse(req.body);
    const pool = getDbPool();

    for (const lead_id of body.lead_ids) {
      await pool.query(
        `INSERT INTO public.campaign_leads (campaign_id, lead_id, user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (campaign_id, lead_id) DO NOTHING`,
        [body.campaign_id, lead_id, req.user.id]
      );
    }

    // Update count
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM public.campaign_leads WHERE campaign_id = $1`,
      [body.campaign_id]
    );
    const count = countRows[0]?.count ?? 0;

    await pool.query(
      `UPDATE public.campaigns SET total_leads = $1, updated_at = now() WHERE id = $2`,
      [count, body.campaign_id]
    );

    res.status(201).json({ success: true, count: body.lead_ids.length });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/disposition', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const dispositionSchema = z.object({
      status: z.enum([
        'new',
        'calling',
        'answered',
        'meeting_booked',
        'callback',
        'not_interested',
        'no_answer',
        'voicemail',
        'busy',
        'failed',
        'dnc',
      ])
    });
    const { status } = dispositionSchema.parse(req.body);
    const pool = getDbPool();

    const { rows } = await pool.query(
      `UPDATE public.leads SET status = $1, updated_at = now() WHERE id = $2 AND user_id = $3 RETURNING *`,
      [status, req.params.id, req.user.id]
    );

    if (!rows.length) throw new ApiError(404, 'Lead not found', 'not_found');
    res.json({ data: rows[0] });
  } catch (error) {
    next(error);
  }
});

export default router;
