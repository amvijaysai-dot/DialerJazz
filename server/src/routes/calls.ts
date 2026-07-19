import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';
import { getDbPool, withTransaction } from '../lib/db.js';

const router = Router();

// ── Zod Validation Schema ──────────────────────────────────────────
const callLogSchema = z.object({
  lead_id: z.string().uuid('lead_id must be a valid UUID').optional().nullable(),
  campaign_id: z.string().uuid('campaign_id must be a valid UUID').optional().nullable().or(z.literal('')),
  duration_seconds: z.number().int().min(0).default(0),
  status: z.string().min(1).max(50).default('completed'),
  disposition: z.string().min(1).max(50).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  provider: z.enum(['telnyx', 'twilio', 'local']).default('telnyx'),
});

// POST /api/calls/log
router.post('/log', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized', 'auth_required');

    // Validate input with Zod — throws ZodError caught by centralized errorHandler
    const validated = callLogSchema.parse(req.body);

    // Execute all steps in a single transaction
    const logData = await withTransaction(async (client) => {
      // Insert call log
      const { rows } = await client.query(
        `INSERT INTO public.call_logs
          (user_id, lead_id, campaign_id, provider, direction, duration_seconds, status, disposition, notes, started_at, ended_at)
         VALUES ($1, $2, $3, $4, 'outbound', $5, $6, $7, $8, now(), now())
         RETURNING *`,
        [
          userId,
          validated.lead_id || null,
          validated.campaign_id || null,
          validated.provider,
          validated.duration_seconds,
          validated.status,
          validated.disposition || null,
          validated.notes || null,
        ]
      );

      const logData = rows[0];

      // Step 1: Check if this lead was previously uncalled (status is 'new' or 'calling')
      if (validated.lead_id && validated.campaign_id && validated.disposition) {
        const { rows: leadRows } = await client.query(
          `SELECT status FROM public.leads WHERE id = $1 AND user_id = $2`,
          [validated.lead_id, userId]
        );

        const wasUncalled = !leadRows[0]?.status || leadRows[0].status === 'new' || leadRows[0].status === 'calling';

        // Step 2: Update lead status to the disposition
        await client.query(
          `UPDATE public.leads SET status = $1, updated_at = now() WHERE id = $2 AND user_id = $3`,
          [validated.disposition, validated.lead_id, userId]
        );

        // Step 3: If this was a fresh call, atomically increment the campaign call counter
        if (validated.campaign_id && wasUncalled) {
          await client.query(
            `UPDATE public.campaigns SET leads_called = COALESCE(leads_called, 0) + 1, updated_at = now() WHERE id = $1`,
            [validated.campaign_id]
          );
        }
      }

      return logData;
    });

    res.status(200).json({ data: logData });
  } catch (err) {
    next(err);
  }
});
// GET /api/calls — List call logs for user
router.get('/', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const { campaign_id, lead_id } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 25));
    const offset = (page - 1) * perPage;

    const pool = getDbPool();

    // Build WHERE clauses dynamically
    const conditions: string[] = ['cl.user_id = $1'];
    const params: any[] = [userId];
    let paramIndex = 2;

    if (campaign_id) {
      conditions.push(`cl.campaign_id = $${paramIndex}`);
      params.push(campaign_id as string);
      paramIndex++;
    }
    if (lead_id) {
      conditions.push(`cl.lead_id = $${paramIndex}`);
      params.push(lead_id as string);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Count query
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM public.call_logs cl WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count || '0', 10);

    // Data query with LEFT JOINs (no foreign key required)
    const dataParams = [...params, perPage, offset];
    const { rows: data } = await pool.query(
      `SELECT
        cl.id,
        cl.lead_id,
        cl.campaign_id,
        cl.provider,
        cl.direction,
        cl.from_number,
        cl.to_number,
        cl.status,
        cl.disposition,
        cl.disposition_sub,
        cl.duration_seconds,
        cl.recording_url,
        cl.notes,
        cl.started_at,
        cl.ended_at,
        cl.created_at,
        l.first_name AS lead_first_name,
        l.last_name AS lead_last_name,
        l.company AS lead_company,
        l.phone AS lead_phone,
        c.name AS campaign_name
      FROM public.call_logs cl
      LEFT JOIN public.leads l ON l.id = cl.lead_id
      LEFT JOIN public.campaigns c ON c.id = cl.campaign_id
      WHERE ${whereClause}
      ORDER BY cl.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      dataParams
    );

    const formattedData = data?.map((row: any) => ({
      id: row.id,
      lead_id: row.lead_id,
      campaign_id: row.campaign_id,
      provider: row.provider,
      direction: row.direction,
      from_number: row.from_number,
      to_number: row.to_number,
      status: row.status,
      disposition: row.disposition,
      disposition_sub: row.disposition_sub,
      duration_seconds: row.duration_seconds,
      recording_url: row.recording_url,
      notes: row.notes,
      started_at: row.started_at,
      ended_at: row.ended_at,
      created_at: row.created_at,
      lead: row.lead_id ? {
        first_name: row.lead_first_name,
        last_name: row.lead_last_name,
        company: row.lead_company,
        phone: row.lead_phone
      } : null,
      campaign: row.campaign_id ? { name: row.campaign_name } : null
    })) || [];

    res.json({
      data: formattedData,
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    });
  } catch (err) {
    console.error('[calls/list] Error:', err);
    // Return empty result on error — do not block the caller
    res.json({
      data: [],
      meta: {
        total: 0,
        page: 1,
        per_page: 25,
        total_pages: 0,
      },
    });
  }
});

// GET /api/calls/stats — Get call statistics
router.get('/stats', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const { campaign_id } = req.query;

    let baseQuery = req.db!.database
      .from('call_logs')
      .select('id, status, disposition, duration_seconds', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (campaign_id) {
      baseQuery = baseQuery.eq('campaign_id', campaign_id as string);
    }

    const { data, error } = await baseQuery;

    if (error) throw new ApiError(500, error.message, 'db_error');

    const totalCalls = data?.length || 0;
    const answeredCalls = data?.filter((c: any) => c.status === 'completed' || c.status === 'answered').length || 0;
    const totalDuration = data?.reduce((sum: number, c: any) => sum + (c.duration_seconds || 0), 0) || 0;
    
    const dispositionCounts: Record<string, number> = {};
    data?.forEach((c: any) => {
      if (c.disposition) {
        dispositionCounts[c.disposition] = (dispositionCounts[c.disposition] || 0) + 1;
      }
    });

    res.json({
      data: {
        totalCalls,
        answeredCalls,
        totalDuration,
        avgDuration: totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0,
        dispositionCounts
      }
    });
  } catch (err) {
    next(err);
  }
});

export default router;
